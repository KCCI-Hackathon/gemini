import type { Card } from "./types";

export type EligibilityAssessment = "no_restriction_found" | "reviewed_rules" | "unresolved";
export const ELIGIBILITY_ORDER = ["blocked", "needs_check", "eligible"] as const;

export function hasOverlapLanguage(text: string) {
  return /중복|동시(?:에|\s?(?:수혜|신청|참여|지원))|유사\s?사업|미지급|차감|차액|택일|제한\s?기간|지원받은\s?(?:경우|이력)|재참여|재수혜|중복참여|동일.{0,15}(?:재참여|참여할 수 없|신청할 수 없)|다른\s?(?:사업|지원금|정책)/.test(text);
}

export function countEligibilityTabs(cards: Pick<Card, "offeringId" | "stageId" | "eligibility">[]) {
  const unique = [...new Map(cards.map(card => [`${card.stageId}|${card.offeringId}`, card])).values()];
  return {
    blocked: unique.filter(card => card.eligibility === "blocked").length,
    needs_check: unique.filter(card => card.eligibility === "needs_check").length,
    eligible: unique.filter(card => card.eligibility === "eligible").length,
  };
}

export function classifyEligibility(
  availability: Card["availability"],
  assessment: EligibilityAssessment | undefined,
  reasons: string[],
): { eligibility: Card["eligibility"]; reason: string } {
  if (availability === "blocked") return { eligibility: "blocked", reason: reasons[0] ?? "현재 기준에서 신청할 수 없어요." };
  if (availability === "needs_check") return { eligibility: "needs_check", reason: reasons[0] ?? "자격이나 신청 조건을 확인해 주세요." };
  if (!assessment || assessment === "unresolved") {
    return { eligibility: "needs_check", reason: reasons.find(reason => /중복수혜|중복 제한|적용 근거/.test(reason)) ?? "중복수혜 문구 또는 적용 근거를 확인해 주세요." };
  }
  if (assessment === "no_restriction_found") {
    return { eligibility: "eligible", reason: "입력 정보와 확인된 조건 기준으로 후보예요. 중복수혜 제한 정보 없음. 최종 선정·지급을 보장하지 않아요." };
  }
  const partial = reasons.find(reason => /미지급|차감|차액/.test(reason));
  return {
    eligibility: "eligible",
    reason: partial
      ? `기본 자격은 충족해요. ${partial} 신청 가능 여부와 지원 항목 제한은 별도예요.`
      : "입력한 수혜 사실과 확인된 중복 규칙에서 현재 적용되는 신청 제한을 찾지 못했어요. 최종 선정·지급을 보장하지 않아요.",
  };
}
