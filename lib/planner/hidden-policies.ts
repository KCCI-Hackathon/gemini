/** 공고 링크가 없어져(404/410) 이 브라우저에서 숨긴 정책. policyId -> 정책명 · 사유 · 시각 */
export type HiddenPolicy = { title: string; reason: string; at: string };
export type HiddenPolicies = Record<string, HiddenPolicy>;

export const HIDDEN_POLICIES_KEY = "pathfinder.hiddenPolicies.v1";

// 저장된 숨김 목록을 읽는다(접근 실패 · 깨진 값은 빈 값)
export function readHiddenPolicies(): HiddenPolicies {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_POLICIES_KEY) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as HiddenPolicies : {};
  } catch { return {}; }
}

// 숨김 목록을 저장한다(실패해도 화면 상태는 유지)
export function writeHiddenPolicies(hidden: HiddenPolicies): void {
  try { localStorage.setItem(HIDDEN_POLICIES_KEY, JSON.stringify(hidden)); } catch { /* 저장 공간을 쓸 수 없음 */ }
}

// 검증 결과가 공고 링크 404/410 때문에 못 찾은 것인지 trail 의 stop 사유로 판단한다
export function isNoticeGone(result: { outcome?: string; trail?: { action: string; reason: string }[] }): boolean {
  if (result.outcome !== "notice_not_found") return false;
  return (result.trail ?? []).some(step => step.action === "stop" && /HTTP (404|410)/.test(step.reason));
}

// 숨김 정책을 뺀 목록(화면에서만 거르고 서버 판정은 바꾸지 않는다). policyIdOf 로 항목의 policyId 를 얻는다
export function withoutHidden<T>(items: T[], hidden: HiddenPolicies, policyIdOf: (item: T) => string | undefined): T[] {
  return items.some(item => hidden[policyIdOf(item) ?? ""]) ? items.filter(item => !hidden[policyIdOf(item) ?? ""]) : items;
}
