import { expect, test } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Benefit, Restriction } from "@/lib/judge/overlap";
import { applyAnswer } from "@/lib/planner/answers";
import { evaluateRequest } from "@/lib/planner/catalog";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { demoCatalog, DEMO_EVENTS, DEMO_PROFILE } from "@/lib/planner/fixtures";
import { restrictionVerdict } from "@/lib/planner/overlap-bridge";
import type { BenefitQuestion, PlannerInput } from "@/lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const input = { revision: 0, events: [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }, { id: "ev-job", type: "employment", date: "2027-01-19", status: "scheduled" }], choices: [], mutedKeys: [], preferredCategory: "all" } as const satisfies PlannerInput;
const run = (benefits?: Benefit[], at = now) => evaluateRequest({ ...PERSONA_A, events: [], ...(benefits ? { benefits } : {}) }, structuredClone(input) as PlannerInput, at);
const R = (over: Partial<Restriction>): Restriction => ({
  ruleId: "r", sourceId: "20260710005400113256", sourceName: "국민취업지원제도", effect: "participation_block", restricted_item: null,
  state: "applies", reason: "현재 해당 사업 수급 중", question: null, evidence: { field: null, quote: "인용", url: null, checkedAt: "2026-11-22" }, ...over,
});

// J-1 — 금액 질문은 어느 달인지 싣고, 답은 그 달로 저장돼 같은 질문이 다시 나오지 않는다
test("J-1: a monthly amount question carries its month and is only asked for a month the user can answer", () => {
  const ev = run();
  const monthly = ev.questions.filter(q => q.answerKind === "monthly_amount");
  for (const q of monthly) expect(q.month).toBe("2026-11");
});
test("J-1: answering 0 won for the asked month closes that question", () => {
  const q: BenefitQuestion = { policyId: "t", sourcePolicyId: "20250617005400110952", sourceName: "청년월세", ruleId: "rr", question: "해당 월에 실제로 지급받은 금액은 얼마인가요?", answerKind: "monthly_amount", month: "2026-12" };
  const saved = applyAnswer([], q, { kind: "monthly_amount", month: "2026-12", amountWon: 0 });
  expect(saved).toContainEqual({ policyId: q.sourcePolicyId, status: "receiving", monthlyPayment: { month: "2026-12", amountWon: 0 } });
});
test("J-1: '안 받아요' on a monthly question is saved as 0 won for that month, which closes the amount rule", () => {
  const q: BenefitQuestion = { policyId: "t", sourcePolicyId: "20250617005400110952", sourceName: "청년월세", ruleId: "rr", question: "q", answerKind: "monthly_amount", month: "2026-11" };
  expect(applyAnswer([], q, { kind: "not_receiving" })).toEqual([{ policyId: q.sourcePolicyId, status: "receiving", monthlyPayment: { month: "2026-11", amountWon: 0 } }]);
});
test("J-1: answering another month keeps the month already answered", () => {
  const q: BenefitQuestion = { policyId: "t", sourcePolicyId: "20250617005400110952", sourceName: "청년월세", ruleId: "rr", question: "q", answerKind: "monthly_amount", month: "2026-12" };
  const first = [{ policyId: q.sourcePolicyId, status: "receiving" as const, monthlyPayment: { month: "2026-11", amountWon: 0 } }];
  expect(applyAnswer(first, q, { kind: "monthly_amount", month: "2026-12", amountWon: 0 })).toHaveLength(2);
});

// J-2 — 막힌 카드에서는 질문을 모으지 않는다
test("J-2: questions only come from cards that are not blocked", () => {
  const ev = run();
  for (const q of ev.questions) expect(ev.cards.some(c => c.policyId === q.policyId && c.availability !== "blocked")).toBe(true);
});

// J-3 — 같은 사유는 한 번만, 조사 메모 문장은 화면 사유에 나오지 않는다
test("J-3: a card never shows the same reason twice", () => {
  for (const c of run([{ policyId: "20260710005400113256", status: "receiving" }]).cards) {
    const keys = c.reasons.map(r => r.code + r.message);
    expect(new Set(keys).size).toBe(keys.length);
  }
});
test("J-3: research memo sentences are not shown as card reasons", () => {
  for (const c of run().cards) for (const r of c.reasons) expect(r.message).not.toMatch(/(한다|않는다)\.(\s|$)/);
});
test("J-3: the blocking reason from the backend verdict is not repeated as a STATUS/RESIDENCE reason", () => {
  const c = run([{ policyId: "20260710005400113256", status: "receiving" }]).cards.find(c => c.policyId === "20250122005400110346" && c.stageId === "ev-course")!;
  expect(c.reasons.filter(r => r.message.includes("수급 중")).map(r => r.code)).not.toContain("STATUS");
});

// J-5 — 받침에 맞는 조사
test("J-5: '와/과' follows the final consonant of the program name", () => {
  expect(restrictionVerdict([R({})], "t", "current").reasons[0].message).toContain("국민취업지원제도와 중복 불가");
  expect(restrictionVerdict([R({ sourceName: "구직급여" })], "t", "current").reasons[0].message).toContain("구직급여와 중복 불가");
  expect(restrictionVerdict([R({ sourceName: "청년수당" })], "t", "current").reasons[0].message).toContain("청년수당과 중복 불가");
});

// J-6 — 지급이 끝난 경우는 '현재 수혜 중' 이 아니다
test("J-6: a block from an ended payment does not say 'currently receiving'", () => {
  const msg = restrictionVerdict([R({ reason: "지급 종료 후 제한 기간 이내", sourceName: "구직급여" })], "t", "current").reasons[0].message;
  expect(msg).not.toContain("현재 수혜 중");
  expect(msg).toContain("지급이 끝난 뒤 제한 기간");
});

// J-7 — 질문 여부는 문구가 아니라 구조화된 칸으로 정한다
test("J-7: a question is shown from the structured need, even if the reason text changes", () => {
  const out = restrictionVerdict([R({ state: "needs_info", reason: "바뀐 문구", question: "해당 사업의 지원금을 현재 받고 있나요?", need: "receiving" })], "t", "current");
  expect(out.questions).toEqual([expect.objectContaining({ answerKind: "receiving", question: "해당 사업의 지원금을 현재 받고 있나요?" })]);
});
test("J-7: without a structured need there is no question, only an agency check", () => {
  const out = restrictionVerdict([R({ state: "needs_info", reason: "실제 수급 여부 확인 필요", question: "이번 회차의 제한이 확인됐나요?" })], "t", "current");
  expect(out.questions).toEqual([]);
  expect(out.reasons[0].message).toMatch(/^기관 확인 필요/);
});

// J-9 — 이력 기간 조건이 아직 안 지났으면 그 구간은 막는다 (설계: 기간 판정은 지금 계산 그대로)
test("J-9: a policy whose lookback period is still running is blocked in that stage", () => {
  const ev = evaluatePlanner(DEMO_PROFILE, { revision: 0, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, demoCatalog(), now);
  expect(ev.cards.length).toBeGreaterThan(0);
  const lookback = run().cards.filter(c => c.reasons.some(r => r.code === "PERIOD"));
  for (const c of lookback) expect(c.availability).toBe("blocked");
  expect(lookback.length).toBeGreaterThan(0);
});
