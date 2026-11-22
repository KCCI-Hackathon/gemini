import { addMonths } from "@/lib/date";

const MIN_MONTHS = 7, MAX_MONTHS = 48;
const monthsBetween = (a: string, b: string) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

/**
 * 저장 계획 로드맵의 날짜축. 이번 달부터 가장 먼 기한 · 일정의 다음 달까지(7~48개월) 한 화면에 담고,
 * 기간이 길수록 눈금 간격을 넓힌다(1 · 2 · 3 · 6개월).
 */
export function roadmapRange(today: string, dates: (string | null | undefined)[]): { start: string; end: string; step: number; ticks: string[] } {
  const start = `${today.slice(0, 7)}-01`;
  const latest = dates.filter((d): d is string => !!d && d >= start).sort().at(-1);
  const span = Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, latest ? monthsBetween(start, latest) + 1 : MIN_MONTHS));
  const end = addMonths(start, span);
  const step = span <= 12 ? 1 : span <= 24 ? 2 : span <= 36 ? 3 : 6;
  const ticks = Array.from({ length: Math.ceil(span / step) }, (_, i) => addMonths(start, i * step));
  return { start, end, step, ticks };
}
