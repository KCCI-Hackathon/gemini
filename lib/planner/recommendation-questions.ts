import { REASON, type Profile } from "@/lib/judge/types";
import type { CounselTarget } from "./counsel-target";
import type { Evaluation, PlannerInput } from "./types";

export type RecommendationQuestion = { text: string; target: CounselTarget };
const MAX_RECOMMENDATION_QUESTIONS = 15;

export function recommendationQuestionKey(target: CounselTarget): string {
  return target.kind === "benefit" ? [target.kind, target.policyId, target.answer, target.month ?? ""].join("|") : target.kind;
}

export function rankRecommendationQuestions(profile: Profile, input: PlannerInput, evaluation: Evaluation): RecommendationQuestion[] {
  const unresolved = evaluation.cards.filter(card => card.eligibility === "needs_check");
  const candidates = new Map<string, { question: RecommendationQuestion; offerings: Set<string> }>();
  function add(question: RecommendationQuestion, offeringId: string) {
    const key = recommendationQuestionKey(question.target);
    const candidate = candidates.get(key) ?? { question, offerings: new Set<string>() };
    candidate.offerings.add(offeringId);
    candidates.set(key, candidate);
  }
  const statusUnknown = !profile.currentStatus.length || input.mutedKeys.includes("status");
  for (const card of unresolved) {
    if (statusUnknown && card.reasons.some(reason => reason.message === REASON.statusUnknown
      || (input.mutedKeys.includes("status") && reason.code === "MUTED_CONDITION"))) {
      add({ text: "지금 상태는 어떤가요?", target: { kind: "status" } }, card.offeringId);
    }
    if (!profile.recentHistory && card.reasons.some(reason => /취업·훈련 이력 확인 필요/.test(reason.message))) {
      add({ text: "최근에 취업하거나 훈련받은 이력이 있나요?", target: { kind: "recent_history" } }, card.offeringId);
    }
  }
  for (const item of evaluation.questions) {
    const target = { kind: "benefit", policyId: item.sourcePolicyId, answer: item.answerKind, ...(item.month && { month: item.month }) } as const;
    const text = item.question.replace(/^해당 사업/, item.sourceName);
    for (const card of unresolved) {
      if (card.policyId === item.policyId) add({ text, target }, card.offeringId);
    }
  }
  return [...candidates.values()].sort((a, b) => b.offerings.size - a.offerings.size).map(candidate => candidate.question);
}

export function nextRecommendationQuestion(profile: Profile, input: PlannerInput, evaluation: Evaluation, answered: ReadonlySet<string>): RecommendationQuestion | undefined {
  if (answered.size >= MAX_RECOMMENDATION_QUESTIONS) return;
  const next = rankRecommendationQuestions(profile, input, evaluation).find(question => !answered.has(recommendationQuestionKey(question.target)));
  return next ?? (answered.size === 0 ? { text: "어떤 분야의 정책을 먼저 추천해 드릴까요?", target: { kind: "preferred_category" } } : undefined);
}
