import { blocksParticipation, type Benefit, type Need, type Restriction } from "@/lib/judge/overlap";
import type { AnswerKind, BenefitQuestion, Card, Evidence, Reason } from "./types";

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

/** 받침이 있으면 '과', 없으면 '와' (한글이 아닌 끝 글자는 '과') */
export function withWa(word: string) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (code >= 0 && code < 11172 && code % 28 === 0 ? "와" : "과");
}

// 백엔드가 구조화해 내보내는 질문 종류만 묻는다(J-7). 답이 Benefit 칸에 담기는 것들이다.
const ANSWER_KIND: Record<Need, AnswerKind> = {
  receiving: "receiving", selected: "selected", ended: "ended_date", last_payment: "ended_date", monthly_amount: "monthly_amount",
};

function blockMessage(r: Restriction, kind: "current" | "planned") {
  const name = withWa(r.sourceName);
  if (kind === "planned") return `계획에 담은 ${name} 중복 불가`;
  // 수혜 상태에 맞는 문구(J-6)
  if (r.reason.startsWith("지급 종료 후")) return `지급이 끝난 뒤 제한 기간 안인 ${name} 중복 불가`;
  if (r.reason.includes("선정")) return `선정된 ${name} 중복 불가`;
  return `현재 수혜 중인 ${name} 중복 불가`;
}

export function restrictionVerdict(list: Restriction[], targetPolicyId: string, kind: "current" | "planned") {
  let availability: "blocked" | "needs_check" | null = null;
  const blocks: Reason[] = [];
  const reasons: Reason[] = [];
  const evidence: Evidence[] = [];
  const questions: BenefitQuestion[] = [];
  for (const r of list) {
    if (r.state === "not_applies") continue;
    const evidenceId = `overlap:${r.ruleId}`;
    evidence.push({ evidenceId, title: `중복 수혜 제한 · ${r.sourceName}`, quote: r.evidence.quote,
      url: r.evidence.url, reviewedAt: r.evidence.checkedAt, reviewed: true,
      ...(r.review && { overlapReview: r.review }) });
    if (blocksParticipation(r)) {
      availability = "blocked";
      blocks.push({ code: kind === "current" ? "PARTICIPATION_CONFLICT" : "DRAFT_CONFLICT", message: blockMessage(r, kind), evidenceId });
    } else if (r.state === "applies") {
      // 화면에는 제한 항목만. 조사 결론 문장은 근거(evidence) 쪽에 둔다(J-3).
      reasons.push({ code: "PARTIAL_RESTRICTION", message: `${r.sourceName} 수혜 시 ${r.summary ?? r.reason}`, evidenceId });
    } else {
      if (!r.restricted_item) availability ??= "needs_check";
      if (r.need && r.question) {
        questions.push({ policyId: targetPolicyId, sourcePolicyId: r.sourceId, sourceName: r.sourceName,
          ruleId: r.ruleId, question: r.question, answerKind: ANSWER_KIND[r.need], ...(r.month && { month: r.month }) });
        reasons.push({ code: "RESTRICTION_QUESTION", message: r.question, evidenceId });
      } else {
        reasons.push({ code: "RESTRICTION_QUESTION", message: `기관 확인 필요 · ${withWa(r.sourceName)}의 중복 조건 (${r.summary ?? r.reason})`, evidenceId });
      }
    }
  }
  return { availability, reasons: [...blocks, ...reasons], evidence, questions };
}
