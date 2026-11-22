import type { Benefit } from "@/lib/judge/types";
import type { BenefitQuestion } from "./types";

export type BenefitAnswer =
  | { kind: "receiving" }
  | { kind: "not_receiving" }
  | { kind: "selected" }
  | { kind: "not_selected" }
  | { kind: "ended"; lastPaymentDate: string };

export function applyAnswer(benefits: Benefit[], q: BenefitQuestion, a: BenefitAnswer): Benefit[] {
  const policyId = q.sourcePolicyId;
  const row: Benefit = a.kind === "ended"
    ? { policyId, status: "ended", lastPaymentDate: a.lastPaymentDate }
    : { policyId, status: a.kind === "not_receiving" || a.kind === "not_selected" ? "eligible_unpaid" : a.kind };
  return [...benefits.filter(benefit => benefit.policyId !== policyId), row];
}
