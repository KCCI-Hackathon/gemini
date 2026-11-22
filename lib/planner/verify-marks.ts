/** 정책별 공고 확인 표시: ai = AI 대조 끝, human = 사람이 공고를 직접 확인함 */
export type VerifyMark = { state: "ai" | "human"; at: string };
export type VerifyMarks = Record<string, VerifyMark>;

export const VERIFY_MARKS_KEY = "pathfinder.verifyMarks.v1";
const UNVERIFIED = "미검증(API)";

// 저장된 표시를 읽는다(접근 실패 · 깨진 값은 빈 값)
export function readVerifyMarks(): VerifyMarks {
  try {
    const raw = JSON.parse(localStorage.getItem(VERIFY_MARKS_KEY) ?? "{}");
    return raw && typeof raw === "object" ? raw as VerifyMarks : {};
  } catch { return {}; }
}

// 표시를 저장한다(실패해도 화면 상태는 유지)
export function writeVerifyMarks(marks: VerifyMarks): void {
  try { localStorage.setItem(VERIFY_MARKS_KEY, JSON.stringify(marks)); } catch { /* 저장 공간을 쓸 수 없음 */ }
}

// 화면에 보일 배지 문구. 서버 판정은 두고 "미검증(API)" 만 표시 상태로 덮어쓴다
export function labelWithMark(label: string | null, mark?: VerifyMark): string | null {
  if (label !== UNVERIFIED || !mark) return label;
  return mark.state === "human" ? "공고 항목 확인됨" : "AI 대조(사람 미확인)";
}
