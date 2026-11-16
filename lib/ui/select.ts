import { addMonths, toKstDate } from "@/lib/date";

/** 기본으로 펼칠 정책: 검증 정책 ∪ 상태 변화로 바뀐 정책 ∪ 30일 안에 마감되는 정책(설계 5장 ⑥) */
export function selectDefaultVisible(
  items: { id: string; verified: boolean; change: string | null; deadline: string | null }[],
  now: Date,
): string[] {
  const today = toKstDate(now);
  const in30 = addMonths(today, 1);
  return items
    .filter((i) => i.verified || (i.change && i.change !== "변화 없음") || (i.deadline && i.deadline >= today && i.deadline <= in30))
    .map((i) => i.id);
}
