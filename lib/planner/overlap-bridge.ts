import { loadOverlap } from "@/lib/data/overlap";
import { blocksParticipation, type Benefit, type Restriction } from "@/lib/judge/overlap";
import type { BenefitQuestion, Card, Evidence, Reason } from "./types";

export function plannedFor(card: Card, chosen: Card[]): Benefit[] {
  return [card, ...chosen.filter(other => other.offeringId !== card.offeringId)].map(other => {
    const end = other.stageWindow?.end ?? other.official.end;
    return {
      policyId: other.policyId, status: "planned",
      ...(other.stageWindow && { plannedStart: other.stageWindow.start }),
      ...(end && { plannedEnd: end }),
    };
  });
}

export function restrictionVerdict(list: Restriction[], targetPolicyId: string, kind: "current" | "planned") {
  let availability: "blocked" | "needs_check" | null = null;
  const blocks: Reason[] = [];
  const reasons: Reason[] = [];
  const evidence: Evidence[] = [];
  const questions: BenefitQuestion[] = [];
  const rules = loadOverlap().get(targetPolicyId);
  for (const r of list) {
    if (r.state === "not_applies") continue;
    const evidenceId = `overlap:${r.ruleId}`;
    evidence.push({ evidenceId, title: `중복 수혜 제한 · ${r.sourceName}`, quote: r.evidence.quote,
      url: r.evidence.url, reviewedAt: r.evidence.checkedAt, reviewed: true });
    if (blocksParticipation(r)) {
      availability = "blocked";
      blocks.push({ code: kind === "current" ? "PARTICIPATION_CONFLICT" : "DRAFT_CONFLICT",
        message: `${kind === "current" ? "현재 수혜 중인" : "계획에 담은"} ${r.sourceName}과 중복 불가`, evidenceId });
    } else if (r.state === "applies") {
      reasons.push({ code: "PARTIAL_RESTRICTION", message: r.reason, evidenceId });
    } else {
      if (!r.restricted_item) availability ??= "needs_check";
      const rule = rules?.find(rule => rule.rule_id === r.ruleId);
      const condition = rule?.condition_type;
      const answerKind = condition === "within_months_after_end" ? "ended_date" : condition;
      let message = `기관 확인 필요 · ${r.reason}`;
      const asksForStatus = rule?.judgement === "blocked" && (
        r.reason === "실제 수급 여부 확인 필요" || r.reason === "선정 여부 확인 필요" ||
        r.reason === "지급 종료 여부 확인 필요" || r.reason === "마지막 지급일 확인 필요"
      );
      if (asksForStatus && r.question && (answerKind === "receiving" || answerKind === "selected" || answerKind === "ended_date")) {
        message = r.question;
        questions.push({ policyId: targetPolicyId, sourcePolicyId: r.sourceId, sourceName: r.sourceName,
          ruleId: r.ruleId, question: r.question, answerKind });
      }
      reasons.push({ code: "RESTRICTION_QUESTION", message, evidenceId });
    }
  }
  return { availability, reasons: [...blocks, ...reasons], evidence, questions };
}
