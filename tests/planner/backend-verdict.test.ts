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
test("code-met policies without a reviewed notice are eligible when nothing else is unknown", () => {
  const cards = ev.cards.filter(c => c.reasons.some(r => r.code === "UNREVIEWED"));
  expect(cards.length).toBeGreaterThan(0);
  // 입력 정보로 확인할 조건을 모두 충족하고 다른 확인 사유가 없으면 신청 가능, 본문 확인은 안내로만 남긴다
  const clean = cards.filter(c => c.reasons.every(r => r.code === "UNREVIEWED"));
  expect(clean.length).toBeGreaterThan(0);
  expect(clean.every(c => c.availability === "eligible")).toBe(true);
  expect(clean[0].reasons[0].message).toBe("입력 정보 기준 조건 충족 · 공고 본문 확인 권장");
});
test("overlap language in an official notice without a linked rule stays in needs-check", () => {
  const card = ev.cards.find(c => c.title === "K-뉴딜 아카데미" && c.stageId === "ev-course");
  expect(card).toBeDefined();
  expect(card).toMatchObject({ overlapAssessment: "unresolved", eligibility: "needs_check" });
  expect(card!.eligibilityReason).toContain("중복수혜");
});
test("rule recommendations use the same eligibility classification as the tabs", () => {
  expect(ev.recommendations.every(choice => ev.cards.find(card => card.offeringId === choice.offeringId && card.stageId === choice.stageId)?.eligibility === "eligible")).toBe(true);
  expect(ev.recommendations.some(choice => ev.cards.find(card => card.offeringId === choice.offeringId && card.stageId === choice.stageId)?.eligibility === "needs_check")).toBe(false);
});
