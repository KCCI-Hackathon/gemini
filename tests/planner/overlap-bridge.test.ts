import { expect, test } from "vitest";
import { PERSONA_A } from "../../lib/judge/personas";
import { evaluateRequest } from "../../lib/planner/catalog";
import type { Benefit, Restriction } from "../../lib/judge/overlap";
import { restrictionVerdict } from "../../lib/planner/overlap-bridge";
import type { Evaluation, PlannerInput } from "../../lib/planner/types";
import { evaluatePlanner } from "../../lib/planner/evaluate";
import { demoCatalog, DEMO_EVENTS, DEMO_PROFILE } from "../../lib/planner/fixtures";

const now = new Date("2026-11-22T12:00:00+09:00");
const input = { revision: 0, events: [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }], choices: [], mutedKeys: [], preferredCategory: "all" } as const satisfies PlannerInput;
const run = (benefits?: Benefit[]) => evaluateRequest({ ...PERSONA_A, events: [], ...(benefits ? { benefits } : {}) }, structuredClone(input) as PlannerInput, now);
const card = (ev: Evaluation, policyId: string, stageId = "ev-course") => ev.cards.find(c => c.policyId === policyId && c.stageId === stageId)!;
const CHALLENGE = "20250122005400110346", NATIONAL = "20260710005400113256", JOBSEEK = "20250122005400110369";
const RENT_SRC = "20250617005400110952", RENT_YEONSU = "20260406005400212400"; // 승인 규칙 personal_payment_block · restricted_item "해당 월 청년월세 지급액"
test("I1 receiving national program blocks challenge support", () => {
  const c = card(run([{ policyId: NATIONAL, status: "receiving" }]), CHALLENGE);
  expect(c.availability).toBe("blocked");
  expect(c.eligibility).toBe("blocked");
  expect(c.reasons[0]).toMatchObject({ code: "PARTICIPATION_CONFLICT" });
  expect(c.reasons[0].message).toContain("국민취업지원제도");
  expect(c.evidence.find(e => e.evidenceId === c.reasons[0].evidenceId)?.quote).toBeTruthy();
});
test("I2 partial restriction does not lower the verdict", () => {
  // J-4: 실데이터의 연수구 청년월세 카드는 어느 날짜에도 막혀 있어(blocked == blocked) 아무것도 입증하지 못했다.
  // 열려 있는 가상 카드로, 부분 제한이 사유만 더하고 판정은 그대로인지 본다.
  const partial: Restriction = {
    ruleId: "partial", sourceId: RENT_SRC, sourceName: "청년월세 지원", effect: "personal_payment_block",
    restricted_item: "해당 월 청년월세 지급액", state: "applies", reason: "해당 월 청년월세 지급액 미지급 · 조사 메모", question: null,
    summary: "해당 월 청년월세 지급액 미지급", evidence: { field: null, quote: "인용", url: null, checkedAt: "2026-11-22" },
  };
  const verdict = restrictionVerdict([partial], "virtual", "current");
  expect(verdict.availability).toBeNull();
  const catalog = demoCatalog().map(o => o.offeringId === "demo-housing" ? { ...o, overlapAssessment: "reviewed_rules" as const } : o);
  const ev = evaluatePlanner(DEMO_PROFILE, { revision: 0, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, catalog, now,
    o => o.offeringId === "demo-housing" ? { ...verdict, availability: verdict.availability ?? "eligible" } : { availability: "eligible", reasons: [] });
  const before = evaluatePlanner(DEMO_PROFILE, { revision: 0, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, catalog, now, () => ({ availability: "eligible", reasons: [] }));
  const pick = (e: Evaluation) => e.cards.find(c => c.offeringId === "demo-housing" && c.stageId === "current")!;
  expect(pick(before).availability).toBe("eligible");
  expect(pick(ev).availability).toBe(pick(before).availability);
  expect(pick(ev).eligibility).toBe("eligible");
  expect(pick(ev).eligibilityReason).toContain("미지급");
  expect(pick(ev).reasons).toContainEqual(expect.objectContaining({ code: "PARTIAL_RESTRICTION", message: "청년월세 지원 수혜 시 해당 월 청년월세 지급액 미지급" }));
  expect(pick(ev).reasons.some(r => r.message.includes("조사 메모"))).toBe(false);
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
  expect(card(unknown, RENT_YEONSU, "current").reasons.some(r => r.code === "PARTIAL_RESTRICTION")).toBe(false);
  expect(card(unknown, RENT_YEONSU, "current").reasons).toContainEqual(expect.objectContaining({
    code: "RESTRICTION_QUESTION", message: "11월에 실제로 지급받은 금액은 얼마인가요?",
  }));
  // J-2: 이 카드는 접수 마감으로 막혀 있어 답해도 판정이 안 바뀐다. 질문 목록에는 올리지 않는다.
  expect(card(unknown, RENT_YEONSU, "current").availability).toBe("blocked");
  expect(unknown.questions.some(q => q.policyId === RENT_YEONSU)).toBe(false);
});
test("I5 unknown benefit produces an answerable question", () => {
  const ev = run();
  expect(card(ev, CHALLENGE).availability).toBe("needs_check");
  expect(card(ev, CHALLENGE).eligibility).toBe("needs_check");
  const evidence = card(ev, CHALLENGE).evidence.find(e => e.overlapReview?.source === "agent");
  if (evidence?.overlapReview?.verdict === "supported") expect(card(ev, CHALLENGE).eligibility).toBe("needs_check"); // 조항 근거가 supported여도 수혜 사실이 비면 사용자 분류는 확인 필요
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
