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
  expect(card.verifyLabel).toBe("근거 확인 대기");
  expect(card.reasons.map(r => r.code)).not.toContain("UNREVIEWED");
});
test("code_met_unreviewed keeps the spec wording", () => {
  const card = ev.cards.find(c => c.availability === "needs_check" && c.reasons.some(r => r.message === "일부 조건 충족 · 공고 확인 필요"));
  expect(card).toBeDefined();
});
test("at least one rule recommendation exists for the persona", () => {
  expect(ev.recommendations.length).toBeGreaterThan(0);
});
