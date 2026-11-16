// 모든 날짜 계산은 한국 시간(Asia/Seoul) 기준. 서버 시간대와 무관해야 한다.

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const hmFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 한국 시간 기준 날짜 "YYYY-MM-DD" */
export function toKstDate(d: Date): string {
  return ymdFormatter.format(d);
}

function toKstTime(d: Date): string {
  return hmFormatter.format(d);
}

export type OpenState = "open" | "upcoming" | "closed" | "unknown";

/**
 * 모집 상태. 종료 시각이 없으면 종료일 당일 24시까지 모집 중.
 * 종료 시각("HH:MM")이 있으면 그 시각이 되는 순간 마감.
 */
export function isOpenAt(
  now: Date,
  start: string | null,
  end: string | null,
  endTime?: string,
): OpenState {
  if (!start && !end) return "unknown";
  const today = toKstDate(now);
  if (start && today < start) return "upcoming";
  if (!end) return "open";
  if (today < end) return "open";
  if (today > end) return "closed";
  if (!endTime) return "open";
  return toKstTime(now) < endTime ? "open" : "closed";
}

function parse(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

/** 달력 기준으로 꽉 찬 개월 수(일이 모자라면 한 달 덜 셈) */
export function monthsBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = parse(fromYmd);
  const [ty, tm, td] = parse(toYmd);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

export function addMonths(ymd: string, n: number): string {
  const [y, m, d] = parse(ymd);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}
