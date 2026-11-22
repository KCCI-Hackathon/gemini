import { expect, test } from "vitest";
import { PERSONA_A } from "../../lib/judge/personas";
import { evaluateRequest } from "../../lib/planner/catalog";
import type { Benefit, Restriction } from "../../lib/judge/overlap";
import { restrictionVerdict } from "../../lib/planner/overlap-bridge";
import type { Evaluation, PlannerInput } from "../../lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const input = { revision: 0, events: [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }], choices: [], mutedKeys: [], preferredCategory: "all" } as const satisfies PlannerInput;
const run = (benefits?: Benefit[]) => evaluateRequest({ ...PERSONA_A, events: [], ...(benefits ? { benefits } : {}) }, structuredClone(input) as PlannerInput, now);
const card = (ev: Evaluation, policyId: string, stageId = "ev-course") => ev.cards.find(c => c.policyId === policyId && c.stageId === stageId)!;
const CHALLENGE = "20250122005400110346", NATIONAL = "20260710005400113256", JOBSEEK = "20250122005400110369";
const RENT_SRC = "20250617005400110952", RENT_YEONSU = "20260406005400212400"; // 승인 규칙 personal_payment_block · restricted_item "해당 월 청년월세 지급액"
test("I1 receiving national program blocks challenge support", () => {
  const c = card(run([{ policyId: NATIONAL, status: "receiving" }]), CHALLENGE);
  expect(c.availability).toBe("blocked");
  expect(c.reasons[0]).toMatchObject({ code: "PARTICIPATION_CONFLICT" });
  expect(c.reasons[0].message).toContain("국민취업지원제도");
  expect(c.evidence.find(e => e.evidenceId === c.reasons[0].evidenceId)?.quote).toBeTruthy();
});
test("I2 partial restriction does not lower the verdict", () => {
  const before = card(run([{ policyId: RENT_SRC, status: "eligible_unpaid" }]), RENT_YEONSU, "current");
  const after = card(run([{ policyId: RENT_SRC, status: "receiving" }]), RENT_YEONSU, "current");
  expect(after.reasons.some(r => r.code === "PARTIAL_RESTRICTION" && r.message.includes("청년월세"))).toBe(true);
  expect(after.availability).toBe(before.availability);
});
test("I3 six months after last payment releases the block", () => {
  expect(card(run([{ policyId: JOBSEEK, status: "ended", lastPaymentDate: "2026-08-01" }]), CHALLENGE).availability).toBe("blocked");
  expect(card(run([{ policyId: JOBSEEK, status: "ended", lastPaymentDate: "2026-05-01" }]), CHALLENGE).reasons.map(r => r.code)).not.toContain("PARTICIPATION_CONFLICT");
});
test("monthly payment distinguishes confirmed rent restrictions from missing facts", () => {
  const assessed = card(run([{ policyId: RENT_SRC, status: "receiving", monthlyPayment: {
    month: "2026-11", amountWon: 200000,
  } }]), RENT_YEONSU, "current");
  expect(assessed.reasons).toContainEqual(expect.objectContaining({
    code: "PARTIAL_RESTRICTION", message: expect.stringContaining("청년월세 지급액 미지급"),
  }));
  const unknown = run([{ policyId: RENT_SRC, status: "receiving" }]);
  expect(card(unknown, RENT_YEONSU, "current").reasons).toContainEqual(expect.objectContaining({
    code: "PARTIAL_RESTRICTION", message: "해당 월 청년월세 지급액 · 제한 여부 확인 필요",
  }));
  expect(card(unknown, RENT_YEONSU, "current").reasons).toContainEqual(expect.objectContaining({
    code: "RESTRICTION_QUESTION", message: expect.stringContaining("지급액 확인 필요"),
  }));
  expect(unknown.questions.some(q => q.policyId === RENT_YEONSU && q.sourcePolicyId === RENT_SRC)).toBe(false);
});
test("I5 unknown benefit produces an answerable question", () => {
  const ev = run();
  expect(card(ev, CHALLENGE).availability).toBe("needs_check");
  expect(ev.questions.some(q => q.policyId === CHALLENGE && q.answerKind === "receiving")).toBe(true);
  const answered = run([{ policyId: NATIONAL, status: "eligible_unpaid" }, { policyId: JOBSEEK, status: "eligible_unpaid" }]);
  expect(answered.questions.filter(q => q.policyId === CHALLENGE && [NATIONAL, JOBSEEK].includes(q.sourcePolicyId))).toEqual([]);
});
test("full block wins over partial", () => {
  const fullBlock: Restriction = {
    ruleId: "full", sourceId: NATIONAL, sourceName: "National", effect: "participation_block",
    restricted_item: null, state: "applies", reason: "Participation blocked", question: null,
    evidence: { field: null, quote: "Participation blocked", url: null, checkedAt: "2026-11-22" },
  };
  const partial: Restriction = { ...fullBlock, ruleId: "partial", effect: "personal_payment_block", restricted_item: "rent", reason: "Rent payment restricted" };
  const out = restrictionVerdict([fullBlock, partial], "target", "current"); // 두 Restriction 은 테스트 안에서 직접 만든다
  expect(out.availability).toBe("blocked");
  expect(out.reasons.map(r => r.code)).toEqual(expect.arrayContaining(["PARTICIPATION_CONFLICT", "PARTIAL_RESTRICTION"]));
});
