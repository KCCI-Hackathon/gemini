/**
 * 상담 응답이 추천 경로(보드 위 요약 · 길잡이 추천 블록)를 바꿀지 정한다.
 * ‘추천해줘’만 추천 경로를 새로 띄우고, 자유 질문 · 후속 호출은
 * 이미 추천을 보고 있을 때 AI 추천으로 조용히 바꾸기만 한다(조건 기준 대체 추천은 무시).
 */
export function recommendationUpdate(action: "message" | "recommend" | "followup", kind: "plan" | "fallback", showing: boolean): { set: boolean; open: boolean } {
  if (action === "recommend") return { set: true, open: true };
  return { set: kind === "plan" && showing, open: false };
}
