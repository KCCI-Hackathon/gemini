import { addMonths } from "@/lib/date";

const AFTER_LAST_EVENT_MONTHS = 12;
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * 저장 계획 로드맵의 날짜축. 이번 달부터 마지막 상태 변화(수료 · 취업 · 이사 …) 뒤 1년까지 한 화면에 담는다.
 * 일정이 없으면 이번 달부터 1년. 기간이 길수록 눈금 간격을 넓힌다(1 · 2 · 3 · 6개월).
 */
export function roadmapRange(today: string, eventDates: string[]): { start: string; end: string; step: number; ticks: string[] } {
  const start = `${today.slice(0, 7)}-01`;
  const last = eventDates.filter(d => d >= start).sort().at(-1) ?? start;
  const span = monthsBetween(start, last) + 1 + AFTER_LAST_EVENT_MONTHS;
  const end = addMonths(start, span);
  const step = span <= 13 ? 1 : span <= 24 ? 2 : span <= 36 ? 3 : 6;
  const ticks = Array.from({ length: Math.ceil(span / step) }, (_, i) => addMonths(start, i * step));
  return { start, end, step, ticks };
}
