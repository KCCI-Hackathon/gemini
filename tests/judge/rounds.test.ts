import { describe, expect, test } from "vitest";
import type { Round } from "@/lib/data/verified";
import { loadVerified } from "@/lib/data/verified";
import { judgeAll } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import { judgeConditions, pickRound } from "@/lib/judge/rules";
import type { Profile } from "@/lib/judge/types";

const KNEWDEAL = "20260714005400113258";
const NOW = new Date("2026-11-18T12:00:00+09:00");
const q = (text: string) => ({ text, source: "official" as const, url: "https://example.go.kr/notice" });

const round = (id: string, year: number, start: string, end: string, status: Round["status"], basis: Round["conditions"][number]["basis"] = "apply_date"): Round => ({
  id,
  notice: { year, round: `${year}년`, title: `${year}년 공고`, url: "https://example.go.kr/notice", applyStart: start, applyEnd: end, checkedAt: "2026-11-16" },
  status,
  conditions: [{ key: "employed", kind: "excludes", basis, definitionClear: true, quote: q("취업 중인 사람"), supportsConfirmed: null }],
});

describe("pickRound: 신청 시점이 속한 회차를 고른다", () => {
  const old = round("2026", 2026, "2026-01-01", "2026-06-30", "approved");
  const next = round("2027", 2027, "2027-01-01", "2027-06-30", "under_review");

  test("승인된 회차 기간이면 그 회차", () => {
    expect(pickRound([old, next], "2026-03-01")).toEqual({ round: old, state: "approved" });
  });
  test("새 회차가 검토 중이면 '검토 중' (예전 규칙으로 계산하지 않음)", () => {
    expect(pickRound([old, next], "2027-02-01")).toEqual({ round: next, state: "under_review" });
  });
  test("어느 회차 기간도 아니면 지난 승인 회차를 참고로", () => {
    expect(pickRound([old, next], "2026-09-01")).toEqual({ round: old, state: "outside" });
  });
  test("같은 해 추가 모집은 저장 순서와 무관하며 겹치는 회차는 식별값이 필요하다", () => {
    const extra = round("extra", 2026, "2026-06-15", "2026-07-31", "under_review");
    for (const rounds of [[old, extra], [extra, old]]) {
      expect(pickRound(rounds, "2026-07-01")).toEqual({ round: extra, state: "under_review" });
      expect(pickRound(rounds, "2026-06-20")).toEqual({ round: null, state: "under_review" });
      expect(pickRound(rounds, "2026-06-20", "extra")).toEqual({ round: extra, state: "under_review" });
    }
  });
});

describe("judgeConditions: 조건마다 기준일 종류로 판정하고 근거를 붙인다", () => {
  test("apply_date 제외 조건에 걸리면 비해당", () => {
    const r = judgeConditions(round("a", 2026, "2026-01-01", "2026-12-31", "approved"), new Set(["employed"]));
    expect(r.verdicts).toEqual([["ineligible", "재직 제외(신청일 기준)"]]);
    expect(r.evidence[0]).toMatchObject({ key: "employed", outcome: "unmet", basisLabel: "신청일 기준", round: "2026년 공고", confirmed: false });
  });
  test("resolvable_before_start 제외 조건은 '개시일 전 해소 여부 확인 필요'", () => {
    const r = judgeConditions(round("a", 2026, "2026-01-01", "2026-12-31", "approved", "resolvable_before_start"), new Set(["employed"]));
    expect(r.verdicts).toEqual([["needs_check", "재직: 프로그램 개시일 전 해소 여부 확인 필요"]]);
    expect(r.evidence[0].outcome).toBe("check");
  });
  test("걸리지 않으면 판정 없음, 근거는 충족으로 남긴다", () => {
    const r = judgeConditions(round("a", 2026, "2026-01-01", "2026-12-31", "approved"), new Set(["unemployed"]));
    expect(r.verdicts).toEqual([]);
    expect(r.evidence[0].outcome).toBe("met");
  });
});

describe("K-뉴딜 아카데미: 회차별 규칙으로 판정", () => {
  test("규칙 파일에 2026년 승인 회차가 있고, 조건마다 공식 인용이 있다", () => {
    const v = loadVerified().get(KNEWDEAL)!;
    expect(v.rounds?.length).toBe(1);
    expect(v.rounds![0].status).toBe("approved");
    for (const c of v.rounds![0].conditions) expect(c.quote.text.length).toBeGreaterThan(0);
  });

  test("국비 교육 수강 중이면 비해당이 아니라 '개시일 전 해소 여부 확인 필요'", () => {
    const r = judgeAll(PERSONA_A, NOW).find((x) => x.policy.id === KNEWDEAL)!;
    expect(r.axes.personal.value).toBe("needs_check");
    expect(r.axes.personal.reasons).toContain("교육·훈련 수강 중: 프로그램 개시일 전 해소 여부 확인 필요");
    const ev = r.axes.personal.evidence!.find((e) => e.key === "in_training")!;
    expect(ev.quote.text).toContain("개시일 전까지 참여 제한 사유가 해소되는 경우 참여 가능");
  });

  test("수료하고 구직 중이면 조건 충족", () => {
    const p: Profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [] };
    expect(judgeAll(p, NOW).find((x) => x.policy.id === KNEWDEAL)!.axes.personal.value).toBe("eligible");
  });

  test("상태를 모르면 '현재 취업 상태 확인 필요'", () => {
    const p: Profile = { ...PERSONA_A, currentStatus: [], events: [] };
    const r = judgeAll(p, NOW).find((x) => x.policy.id === KNEWDEAL)!;
    expect(r.axes.personal.reasons).toContain("현재 취업 상태 확인 필요");
  });
});

describe("조건 단위 확장: 정의 불명확, 기준 시점 없음, 응시일", () => {
  const base = round("a", 2026, "2026-01-01", "2026-12-31", "approved");
  const withCond = (c: Partial<Round["conditions"][number]>): Round => ({ ...base, conditions: [{ ...base.conditions[0], ...c }] });

  test("정의가 불명확한 조건은 비해당 대신 '공고의 대상 정의 확인 필요'", () => {
    const r = judgeConditions(withCond({ key: "unemployed", kind: "requires", definitionClear: false }), new Set(["employed"]));
    expect(r.verdicts).toEqual([["needs_check", "미취업 조건: 공고의 대상 정의 확인 필요"]]);
  });

  test("기준 시점이 공고에 없으면 '기준 시점 확인 필요'", () => {
    const r = judgeConditions(withCond({ basis: "unspecified" }), new Set(["employed"]));
    expect(r.verdicts).toEqual([["needs_check", "재직: 공고에 기준 시점이 없어 확인 필요"]]);
  });

  test("응시일 기준: 응시일을 모르면 '응시일 확인 필요'", () => {
    const r = judgeConditions(withCond({ key: "unemployed", kind: "requires", basis: "exam_date" }), new Set(["employed"]));
    expect(r.verdicts).toEqual([["needs_check", "응시일 확인 필요"]]);
  });

  test("응시일 기준: 응시일의 상태로 판정한다", () => {
    const c = withCond({ key: "unemployed", kind: "requires", basis: "exam_date" });
    // 지금은 재직이지만 응시일에는 미취업이었다
    expect(judgeConditions(c, new Set(["employed"]), new Set(["unemployed"])).verdicts).toEqual([]);
    // 응시일에도 재직이었다
    expect(judgeConditions(c, new Set(["unemployed"]), new Set(["employed"])).verdicts).toEqual([["ineligible", "미취업 필요(응시일 기준)"]]);
  });
});

describe("statusAt: 그날까지 일어난 사건만 반영한 상태", () => {
  test("취업일 전에는 미취업, 그날부터 재직", async () => {
    const { statusAt } = await import("@/lib/judge/personal");
    const p: Profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [{ type: "employment", date: "2027-03-01", status: "simulated" }] };
    expect(statusAt(p, "2027-02-28").has("employed")).toBe(false);
    expect(statusAt(p, "2027-03-01").has("employed")).toBe(true);
  });
});

describe("나머지 5건도 회차별 규칙으로 옮겼다", () => {
  test.each(["20250122005400110346", "20260406005400212442", "20260406005400212445", "20260710005400113256", "20260921005400113480"])("%s", (id) => {
    const v = loadVerified().get(id)!;
    expect(v.rounds?.length).toBeGreaterThan(0);
    for (const c of v.rounds![0].conditions) expect(c.quote.text.length).toBeGreaterThan(0);
  });

  test("인천 응시료: 미취업은 응시일 기준, 직장가입·사업자 제외는 기준 시점 없음", () => {
    const v = loadVerified().get("20260406005400212445")!;
    const by = Object.fromEntries(v.rounds![0].conditions.map((c) => [c.key, c.basis]));
    expect(by).toEqual({ unemployed: "exam_date", health_insured_employee: "unspecified", business_registered: "unspecified" });
  });

  test("인천 응시료: 응시일을 답하면 그날 상태로 판정한다", () => {
    const p: Profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [{ type: "employment", date: "2026-11-01", status: "simulated" }], examDate: "2026-10-15" };
    const r = judgeAll(p, NOW).find((x) => x.policy.id === "20260406005400212445")!;
    expect(r.axes.personal.reasons).not.toContain("응시일 확인 필요");
    expect(r.axes.personal.reasons).not.toContain("미취업 필요(응시일 기준)");
  });
});
