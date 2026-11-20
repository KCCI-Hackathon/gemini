import { describe, expect, test } from "vitest";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { judgePolicy, judgeAll, REASON } from "@/lib/judge";
import { ageRange } from "@/lib/judge/personal";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Policy } from "@/lib/data/types";

const { policies } = loadSnapshot();
const verified = loadVerified();
const P = (id: string) => policies.find((p) => p.id === id)!;
const V = (id: string) => verified.get(id);
const NOW = new Date("2026-11-24T12:00:00+09:00");

const INCHEON = "20260406005400212445";
const KNEWDEAL = "20260714005400113258";
const NATIONAL = "20260710005400113256";
const CHALLENGE = "20250122005400110346";
const DREAMFOR = "20260406005400212442";
const LUNCH = "20260921005400113480";

describe("ageRange", () => {
  test("생일 달이 아니면 만 나이가 하나로 정해진다", () => {
    expect(ageRange("1999-03", "2026-11-24")).toEqual([27, 27]);
  });
  test("기준일이 생일 달이면 두 값", () => {
    expect(ageRange("1986-01", "2026-01-15")).toEqual([39, 40]);
  });
});

describe("judgePolicy: 시연 인물 가(수강 중, 미취업)의 현재 판정", () => {
  const j = (id: string) => judgePolicy(P(id), V(id), PERSONA_A, NOW);

  test("인천 응시료: 조건상 해당, 모집 중", () => {
    expect(j(INCHEON).personal.value).toBe("eligible");
    expect(j(INCHEON).recruitment).toBe("open");
  });
  test("k-뉴딜: 훈련 수강 중이지만 공고상 개시일 전 해소 가능이라 확인 필요", () => {
    expect(j(KNEWDEAL).personal.value).toBe("needs_check");
  });
  test("국민취업지원제도: 소득 조건이 있어 확인 필요, 상시", () => {
    expect(j(NATIONAL).personal.value).toBe("needs_check");
    expect(j(NATIONAL).recruitment).toBe("always");
  });
  test("청년도전: 코드로는 해당이지만 수강 중이라 비해당, 시간 조건 미충족, 제한 문구 표시", () => {
    const a = j(CHALLENGE);
    expect(a.personal.value).toBe("ineligible");
    expect(a.time.value).toBe("unmet");
    expect(a.restriction.value).toBe("confirmed_relation");
    expect(a.restriction.quotes.join(" ")).toContain("구직급여를 받고 있거나");
  });
  test("드림For: 재직자 대상이라 비해당, 모집 종료, 확인된 중복 관계", () => {
    const a = j(DREAMFOR);
    expect(a.personal.value).toBe("ineligible");
    expect(a.recruitment).toBe("closed");
    expect(a.restriction.value).toBe("confirmed_relation");
  });
  test("든든한 점심밥: 인천은 시범 지역이 아니라 비해당", () => {
    expect(j(LUNCH).personal.value).toBe("ineligible");
  });
});

describe("judgePolicy 규칙", () => {
  test("모집 종료와 자격은 따로 나온다(12/7의 인천 응시료)", () => {
    const a = judgePolicy(P(INCHEON), V(INCHEON), PERSONA_A, new Date("2026-12-07T12:00:00+09:00"));
    expect(a.personal.value).toBe("eligible");
    expect(a.recruitment).toBe("closed");
  });

  test("드림For 나이: 2026-01-01 기준 1986-01생은 경계라 확인 필요, 1985-11생은 만 40세로 비해당", () => {
    const employed = { ...PERSONA_A, currentStatus: ["employed" as const] };
    const edge = judgePolicy(P(DREAMFOR), V(DREAMFOR), { ...employed, birthYm: "1986-01" }, NOW);
    expect(edge.personal.value).toBe("needs_check");
    expect(edge.personal.reasons).toContain(REASON.ageBoundary);
    const ok = judgePolicy(P(DREAMFOR), V(DREAMFOR), { ...employed, birthYm: "1995-06" }, NOW);
    expect(ok.personal.reasons).not.toContain(REASON.ageBoundary);
    const over = judgePolicy(P(DREAMFOR), V(DREAMFOR), { ...employed, birthYm: "1985-11" }, NOW);
    expect(over.personal.value).toBe("ineligible");
  });

  test("비검증 정책은 별도 자격 항목이 비면 '코드 조건 충족(본문 미검토)', 있으면 확인 필요", () => {
    const base = P(INCHEON);
    const clean: Policy = { ...base, id: "x1", jobCodes: ["0013010"], schoolCodes: ["0049010"], specialCodes: ["0014010"], incomeCode: "0043001", marriageCode: "0055003", texts: { ...base.texts, addQualification: "", excluded: "", income: "" } };
    expect(judgePolicy(clean, undefined, PERSONA_A, NOW).personal.value).toBe("code_met_unreviewed");
    const withText: Policy = { ...clean, id: "x2", texts: { ...clean.texts, addQualification: "인천 거주 3년 이상" } };
    expect(judgePolicy(withText, undefined, PERSONA_A, NOW).personal.value).toBe("needs_check");
  });

  test("비검증 정책은 절대 eligible이 되지 않는다", () => {
    const results = judgeAll(PERSONA_A, NOW);
    for (const r of results) if (!r.verified) expect(r.axes.personal.value).not.toBe("eligible");
  });

  test("국민취업지원제도 참여만으로 수급을 단정하지 않고 명시적 수급 사실로 제한을 적용한다", () => {
    const a = judgePolicy(P(CHALLENGE), V(CHALLENGE), { ...PERSONA_A, participating: [NATIONAL] }, NOW);
    expect(a.restriction.current_restrictions?.find(r => r.sourceId === NATIONAL)?.state).toBe("needs_info");
    const receiving = judgePolicy(P(CHALLENGE), V(CHALLENGE), { ...PERSONA_A, benefits: [{ policyId: NATIONAL, status: "receiving" }] }, NOW);
    expect(receiving.restriction.value).toBe("applies");
  });

  test("예정일이 지났는데 완료로 바꾸지 않았으면 안내 문구", () => {
    const p = { ...PERSONA_A, events: [{ type: "training_completion" as const, date: "2026-11-20", status: "scheduled" as const }] };
    const a = judgePolicy(P(CHALLENGE), V(CHALLENGE), p, NOW);
    expect(a.time.note).toContain("수료하셨다면 상태를 바꿔 주세요");
    expect(a.personal.value).toBe("ineligible"); // 아직 수강 중으로 본다
  });

  test("상시인데 사업 종료일이 지났으면 기간 확인 필요", () => {
    const base = P(INCHEON);
    const p: Policy = { ...base, id: "x3", applyPeriodType: "always", bizEnd: "2026-10-31" };
    expect(judgePolicy(p, undefined, PERSONA_A, NOW).recruitment).toBe("unknown");
  });
});

describe("judgeAll", () => {
  test("개인 신청형만, 마감 코드 제외, 기간 지난 비검증은 과거 이력 층", () => {
    const results = judgeAll(PERSONA_A, NOW);
    expect(results.some((r) => r.policy.applyPeriodType === "closed")).toBe(false);
    expect(results.some((r) => /위원회|홍보사업/.test(r.policy.name))).toBe(false);
    const hist = results.filter((r) => r.layer === "history");
    expect(hist.length).toBeGreaterThan(0);
    for (const r of hist) expect(r.verified).toBe(false);
    expect(results.filter((r) => r.verified).length).toBe(6);
  });
});
