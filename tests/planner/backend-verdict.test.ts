import { expect, test } from "vitest";
import { PERSONA_A } from "../../lib/judge/personas";
import { evaluateRequest } from "../../lib/planner/catalog";
import type { PlannerInput } from "../../lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const input = { revision: 0, events: [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }], choices: [], mutedKeys: [], preferredCategory: "all" } as const satisfies PlannerInput;
const ev = evaluateRequest({ ...PERSONA_A, events: [] }, structuredClone(input) as PlannerInput, now);
test("backend eligible policy is eligible with its verify badge", () => {
  const card = ev.cards.find(c => c.title === "청년 자격증 응시료 지원(인천)" && c.stageId === "current")!;
  expect(card.availability).toBe("eligible");
  expect(card.eligibility).toBe("needs_check"); // 응시료 감면 조항이 있으나 수혜 사실과 연결된 검토 규칙이 없음
  expect(card.eligibilityReason).toContain("중복수혜 문구");
  expect(card.verifyLabel).toBe("근거 확인 대기");
  expect(card.reasons.map(r => r.code)).not.toContain("UNREVIEWED");
});
test("code_met_unreviewed keeps the spec wording", () => {
  const card = ev.cards.find(c => c.availability === "needs_check" && c.reasons.some(r => r.message === "일부 조건 충족 · 공고 확인 필요"));
  expect(card).toBeDefined();
});
test("overlap language in an official notice without a linked rule stays in needs-check", () => {
  const card = ev.cards.find(c => c.title === "K-뉴딜 아카데미" && c.stageId === "ev-course");
  expect(card).toBeDefined();
  expect(card).toMatchObject({ overlapAssessment: "unresolved", eligibility: "needs_check" });
  expect(card!.eligibilityReason).toContain("중복수혜");
});
test("rule recommendations use the same eligibility classification as the tabs", () => {
  expect(ev.recommendations.length).toBeGreaterThan(0);
  expect(ev.recommendations.some(choice => !!choice.confirmation)).toBe(true);
  for (const choice of ev.recommendations) {
    const card = ev.cards.find(card => card.offeringId === choice.offeringId && card.stageId === choice.stageId);
    expect(card?.eligibility).toBe(choice.confirmation ? "needs_check" : "eligible");
  }
});
