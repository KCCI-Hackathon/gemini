import type { AiRecommendation, Card, RecommendationPick } from "@/lib/planner/types";

/**
 * 상담 응답이 추천 경로(보드 위 요약 · 길잡이 추천 블록)를 바꿀지 정한다.
 * ‘추천해줘’와 그 질문에 대한 후속 호출은 추천 경로를 표시한다. 일반 상담은
 * 이미 추천을 보고 있을 때 AI 추천으로 조용히 바꾸기만 한다(조건 기준 대체 추천은 무시).
 */
export function recommendationUpdate(action: "message" | "recommend" | "followup", kind: "plan" | "fallback", showing: boolean, continuingRecommendation = false): { set: boolean; open: boolean } {
  if (action === "recommend" || (action === "followup" && continuingRecommendation)) return { set: true, open: true };
  return { set: kind === "plan" && showing, open: false };
}

export type RecommendationViewState = { open: boolean; expanded: boolean };

/** A fresh recommendation always reopens and expands the board summary, even if it was already open. */
export function revealRecommendationView(): RecommendationViewState {
  return { open: true, expanded: true };
}

/** Chat and board must resolve recommendations against the same offering and stage. */
export function recommendationEntries(recommendation: AiRecommendation | null | undefined, cards: Card[]) {
  return (recommendation?.picks ?? []).flatMap((pick: RecommendationPick) => {
    const card = cards.find(item => item.offeringId === pick.offeringId && item.stageId === pick.stageId);
    return card ? [{ pick, card }] : [];
  });
}

/** Keep the summary and caveat identical in the chat and board surfaces. */
export function recommendationMessage(recommendation: AiRecommendation | null | undefined): string {
  return [recommendation?.summary, recommendation?.notice].map(part => part?.trim()).filter((part): part is string => !!part).join(" ");
}
