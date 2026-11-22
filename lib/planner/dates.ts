const DAY = 86_400_000;
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const stamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2200-12-31";
}
export const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
export const addDays = (date: string, days: number) => new Date((dayNumber(date) + days) * DAY).toISOString().slice(0, 10);
export function dateLabel(date: string | null, today?: string): string {
  if (!date) return "미정";
  const [year, month, day] = date.split("-").map(Number);
  return `${today && date.slice(0, 4) !== today.slice(0, 4) ? `${year}년 ` : ""}${month}월 ${day}일`;
}
export const fullDate = (date: string) => date.replaceAll("-", ".");
export function axisPosition(date: string, start: string, endExclusive: string): number {
  return Math.max(0, Math.min(1, (dayNumber(date) - dayNumber(start)) / (dayNumber(endExclusive) - dayNumber(start))));
}
