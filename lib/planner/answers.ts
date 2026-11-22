import type { Benefit } from "@/lib/judge/types";
import type { BenefitQuestion } from "./types";

export type BenefitAnswer =
  | { kind: "receiving" }
  | { kind: "not_receiving" }
  | { kind: "selected" }
  | { kind: "not_selected" }
  | { kind: "ended"; lastPaymentDate: string }
  | { kind: "monthly_amount"; month: string; amountWon: number };

export function applyAnswer(benefits: Benefit[], q: BenefitQuestion, a: BenefitAnswer): Benefit[] {
  const policyId = q.sourcePolicyId;
  // 금액 질문의 '안 받아요'는 그 달 0원이다. 미수급 상태로 두면 금액 규칙이 닫히지 않는다(J-1).
  if (q.answerKind === "monthly_amount" && a.kind === "not_receiving" && q.month) a = { kind: "monthly_amount", month: q.month, amountWon: 0 };
  if (a.kind === "monthly_amount") {
    const month = a.month;
    // 다른 달의 지급 기록은 남긴다. 같은 달 기록과 미수급 상태 줄만 바꾼다.
    const keep = benefits.filter(b => b.policyId !== policyId || (b.monthlyPayment && b.monthlyPayment.month !== month));
    return [...keep, { policyId, status: "receiving", monthlyPayment: { month, amountWon: a.amountWon } }];
  }
  const row: Benefit = a.kind === "ended"
    ? { policyId, status: "ended", lastPaymentDate: a.lastPaymentDate }
    : { policyId, status: a.kind === "not_receiving" || a.kind === "not_selected" ? "eligible_unpaid" : a.kind };
  return [...benefits.filter(benefit => benefit.policyId !== policyId), row];
}
