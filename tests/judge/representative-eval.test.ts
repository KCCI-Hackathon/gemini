// 통합 설계 10.2: 대표 정책(K-뉴딜 아카데미) 한 건 작은 평가
import { afterEach, describe, expect, test } from "vitest";
import { loadVerified, type Round } from "@/lib/data/verified";
import { judgeAll } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import { REASON, type Profile } from "@/lib/judge/types";
import { buildRoadmap } from "@/lib/route/roadmap";
import { buildTimeline } from "@/lib/route/timeline";

const KNEWDEAL = "20260714005400113258";
const at = (ymd: string) => new Date(`${ymd}T12:00:00+09:00`);
const judge = (p: Profile, ymd: string) => judgeAll(p, at(ymd)).find((x) => x.policy.id === KNEWDEAL)!.axes.personal;

// 수료가 2026-12-19에 실제로 일어난다고 둔 인물
const completing: Profile = { ...PERSONA_A, events: [{ type: "training_completion", date: "2026-12-19", status: "simulated" }] };

describe("기준일 직전·직후: 결과가 경계에서 정확히 바뀐다", () => {
  test("수료 전날은 '개시일 전 해소 확인', 수료일부터 조건 충족", () => {
    expect(judge(PERSONA_A, "2026-12-18").value).toBe("needs_check"); // 수료 예정, 아직 수강 중
    expect(judge(completing, "2026-12-19").value).toBe("eligible");
    // 타임라인도 정확히 수료일에서 판정이 바뀐다고 기록한다
    const row = buildTimeline(PERSONA_A, at("2026-11-18"), {}).rows.find((r) => r.policyId === KNEWDEAL)!;
    expect(row.breaks).toEqual(["2026-12-19"]);
  });

  test("수료일 바로 취업하면 비해당이 아니라 '재직: 개시일 전 해소 확인'", () => {
    const p: Profile = { ...completing, events: [...completing.events, { type: "employment", date: "2026-12-19", status: "simulated" }] };
    const r = judge(p, "2026-12-19");
    expect(r.value).toBe("needs_check");
    expect(r.reasons).toContain("재직: 프로그램 개시일 전 해소 여부 확인 필요");
  });
});

describe("날짜가 불명확하면 '선후 확인 필요'", () => {
  test("가정한 수료 달은 경계 칸으로 표시된다", () => {
    const t = buildTimeline(PERSONA_A, at("2026-11-18"), {});
    const row = buildRoadmap(t).rows.find((r) => r.policyId === KNEWDEAL)!;
    expect(row.boundaries.map((b) => b.text)).toContain("신청일과 수료일의 선후 확인 필요");
  });
});

describe("붙은 원문만 읽고 판정을 설명할 수 있다", () => {
  test("확인 필요 사유마다 같은 조건의 근거 문장·기준일 종류·회차가 붙는다", () => {
    const r = judge(PERSONA_A, "2026-11-18");
    const ev = r.evidence!.filter((e) => e.outcome !== "met");
    expect(ev.map((e) => e.key)).toEqual(["in_training"]);
    expect(ev[0]).toMatchObject({ basis: "resolvable_before_start", basisLabel: "개시일 전 해소 가능", round: "2026년 K-뉴딜 아카데미(고용24 제도 안내)" });
    expect(ev[0].quote.source).toBe("official");
    expect(ev[0].quote.text).toContain("개시일 전까지 참여 제한 사유가 해소되는 경우 참여 가능");
  });
});

describe("예전 회차로는 비해당, 새 회차는 검토 중", () => {
  const v = loadVerified().get(KNEWDEAL)!;
  const original = v.rounds!;
  afterEach(() => {
    v.rounds = original;
  });

  test("새 회차가 검토 중이면 '이번 공고 기준 확인 중' (예전 규칙으로 비해당을 고정하지 않음)", () => {
    const strictOld: Round = { ...original[0], conditions: original[0].conditions.map((c) => ({ ...c, basis: "apply_date" as const })) };
    const next: Round = { ...original[0], id: "2027", notice: { ...original[0].notice, year: 2027, round: "2027년", title: "2027년 공고", applyStart: "2027-01-01", applyEnd: "2027-12-31" }, status: "under_review" };
    v.rounds = [strictOld, next];
    expect(judge(PERSONA_A, "2026-11-18").value).toBe("ineligible"); // 예전 회차 기간: 그 회차 규칙
    const r = judge(PERSONA_A, "2027-02-01");
    expect(r.value).toBe("needs_check");
    expect(r.reasons).toEqual([REASON.roundReview]);
  });

  test("새 회차를 승인하면 그 회차 규칙으로 판정한다", () => {
    const next: Round = { ...original[0], id: "2027", notice: { ...original[0].notice, year: 2027, applyStart: "2027-01-01", applyEnd: "2027-12-31" }, status: "approved", conditions: [] };
    v.rounds = [...original, next];
    expect(judge(PERSONA_A, "2027-02-01").value).toBe("eligible");
  });
});
