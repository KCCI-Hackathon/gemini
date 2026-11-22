import { expect, test } from "vitest";
import { bodyOnlyTarget, parseRecommendScope, scopedRecommendations } from "@/lib/planner/recommend-scope";
import type { Card, Evaluation, Stage } from "@/lib/planner/types";

const stages: Stage[] = [
  { stageId: "current", label: "현재", start: "2026-11-23", endExclusive: "2027-01-20", eventIds: [] },
  { stageId: "ev-course", label: "수료 후", start: "2027-01-20", endExclusive: "2027-07-29", eventIds: ["e1"] },
  { stageId: "ev-job", label: "취업 후", start: "2027-07-29", endExclusive: null, eventIds: ["e2"] },
];

test("‘현재 시점 · 취업 위주’는 현재 시점과 취업·일자리 분야로 좁힌다", () => {
  expect(parseRecommendScope("난 현재 시점에서 취업 관련한 거를 찾고 싶은데 그거 위주로 추천해줘봐", stages)).toEqual({ stageIds: ["current"], categories: ["job"] });
});

test("‘취업 후’는 분야가 아니라 시점이다", () => {
  expect(parseRecommendScope("취업 후에 받을 수 있는 거 추천해줘", stages)).toEqual({ stageIds: ["ev-job"] });
});

test("여러 시점 · 분야를 함께 말할 수 있다", () => {
  expect(parseRecommendScope("지금이랑 수료 후에 주거랑 교육 쪽으로 추천해줘", stages)).toEqual({ stageIds: ["current", "ev-course"], categories: ["housing", "edu"] });
});

test("범위가 없는 ‘추천해줘’는 범위 없음", () => {
  expect(parseRecommendScope("나에게 맞는 경로 추천해줘", stages)).toEqual({});
});

const card = (id: string, over: Partial<Card> = {}): Card => ({
  policyId: id, offeringId: id, roundLabel: "", title: id, category: "job", summary: "", support: "", org: "",
  official: { kind: "fixed", start: null, end: null, closeAt: null }, rules: [], evidence: [], regions: [], restrictions: [], reviewed: true, dataVersion: "t",
  verifyLabel: null, stageId: "current", personalWindow: null, stageWindow: null, applicationWindows: [], deadlineKind: "official", daysLeft: 10,
  availability: "eligible", eligibility: "eligible", eligibilityReason: "", reasons: [], selectedStageId: null, otherStageIds: [], conflicts: [], canReplace: false, ...over,
});
const ev = (cards: Card[]): Evaluation => ({ stages, cards, recommendations: [], questions: [] } as unknown as Evaluation);

test("박사 · 위험군처럼 공고 본문에만 있는 대상 조건을 알아본다", () => {
  expect(bodyOnlyTarget(card("a", { title: "국토교통 과학기술 신진연구자 지원사업(R&D)", summary: "박사학위 취득 후 7년이내인 신진연구자" }))).toBe("박사");
  expect(bodyOnlyTarget(card("b", { title: "부산 고독사 위험군 지원" }))).toBe("위험군");
  expect(bodyOnlyTarget(card("c", { title: "공공기관 청년인턴 운영" }))).toBeNull();
});

test("범위 안에서만 고르고, 범위 밖 시점 · 분야는 채우지 않는다", () => {
  const picks = scopedRecommendations(ev([
    card("job1"), card("job2", { daysLeft: 20 }), card("life1", { category: "life" }), card("later", { stageId: "ev-course" }),
  ]), { stageIds: ["current"], categories: ["job"] });
  expect(picks.map(p => p.offeringId)).toEqual(["job1", "job2"]);
});

test("AI가 고른 카드를 먼저 두고, 모자라면 같은 범위에서 채운다", () => {
  const picks = scopedRecommendations(ev([card("job1"), card("job2", { daysLeft: 20 }), card("job3", { daysLeft: 30 })]), { stageIds: ["current"], categories: ["job"] }, [{ offeringId: "job3", stageId: "current" }]);
  expect(picks.map(p => p.offeringId)).toEqual(["job3", "job1"]);
});

test("본문 대상 조건이 있는 카드는 채우기 순위에서 뒤로, 고르면 확인 문구가 붙는다", () => {
  const picks = scopedRecommendations(ev([
    card("phd", { title: "신진연구자 지원", summary: "박사학위 취득 후", daysLeft: 1 }), card("intern", { title: "청년인턴", daysLeft: 40 }),
  ]), { stageIds: ["current"] });
  expect(picks.map(p => p.offeringId)).toEqual(["intern", "phd"]);
  expect(picks[1].confirmation).toContain("박사");
});

test("범위 안에 카드가 하나뿐이면 하나만", () => {
  expect(scopedRecommendations(ev([card("job1"), card("life1", { category: "life" })]), { categories: ["job"] }).map(p => p.offeringId)).toEqual(["job1"]);
});

test("불가 카드는 고르지 않고, 확인 필요 카드는 사유를 확인 문구로 붙인다", () => {
  const picks = scopedRecommendations(ev([
    card("no", { eligibility: "blocked", availability: "blocked" }),
    card("check", { eligibility: "needs_check", availability: "needs_check", reasons: [{ code: "X", message: "소득 조건 확인 필요" }] }),
  ]), { stageIds: ["current"] });
  expect(picks).toEqual([{ offeringId: "check", stageId: "current", confirmation: "소득 조건 확인 필요" }]);
});

test("applyScope는 범위 밖 시점과 카드를 지우고, 규칙 추천도 범위 안에서 만든다", async () => {
  const { applyScope, scopeLabel } = await import("@/lib/planner/recommend-scope");
  const scoped = applyScope(ev([card("job1"), card("life1", { category: "life" }), card("later", { stageId: "ev-course" })]), { stageIds: ["current"], categories: ["job"] });
  expect(scoped.stages.map(s => s.stageId)).toEqual(["current"]);
  expect(scoped.cards.map(c => c.offeringId)).toEqual(["job1"]);
  expect(scoped.recommendations.map(c => c.offeringId)).toEqual(["job1"]);
  expect(scopeLabel({ stageIds: ["current"], categories: ["job"] }, stages)).toBe("현재 시점, 취업·일자리 분야");
});
