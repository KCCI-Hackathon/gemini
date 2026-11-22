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
  // 금액 질문의 '안 받아요'는 그 달 0원이다. 금액 규칙은 그 달 기록이 있어야 닫힌다(J-1).
  const saidNo = q.answerKind === "monthly_amount" && a.kind === "not_receiving" && !!q.month;
  if (saidNo) a = { kind: "monthly_amount", month: q.month!, amountWon: 0 };
  if (a.kind === "monthly_amount") {
    const month = a.month;
    // 다른 달의 지급 기록은 남긴다. 같은 달 기록과 상태만 있는 줄만 바꾼다.
    const keep = benefits.filter(b => b.policyId !== policyId || (b.monthlyPayment && b.monthlyPayment.month !== month));
    const paidElsewhere = keep.some(b => b.policyId === policyId && (b.monthlyPayment?.amountWon ?? 0) > 0);
    // '수급 중'은 실제 지급이 있을 때만. 0원을 수급 중으로 두면 같은 출처의 일반 '수급 중' 규칙이 다른 카드를 막는다.
    // '안 받아요'는 미수급으로 둔다(다른 달 지급 기록이 있으면 상태는 비워 둔다 — 미수급과 지급 기록은 함께 둘 수 없다).
    // 0원 입력만으로는 수급 여부를 모른다. 사용자가 앞서 직접 답한 상태가 있으면 그대로 둔다.
    const stated = benefits.find(b => b.policyId === policyId && !keep.includes(b) && b.status)?.status;
    const status = a.amountWon > 0 ? "receiving" as const : saidNo ? (paidElsewhere ? undefined : "eligible_unpaid" as const) : stated;
    const rows = status === "eligible_unpaid" ? keep.map(b => b.policyId === policyId ? { ...b, status: undefined } : b) : keep;
    return [...rows, { policyId, ...(status && { status }), monthlyPayment: { month, amountWon: a.amountWon } }];
  }
  const row: Benefit = a.kind === "ended"
    ? { policyId, status: "ended", lastPaymentDate: a.lastPaymentDate }
    : { policyId, status: a.kind === "not_receiving" || a.kind === "not_selected" ? "eligible_unpaid" : a.kind };
  return [...benefits.filter(benefit => benefit.policyId !== policyId), row];
}
