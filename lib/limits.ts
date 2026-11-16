// 외부 AI 호출 한도: 접속 주소당 하루 20회, 서비스 전체 하루 AGENT_DAILY_LIMIT회(설계 5장).
// 검증 에이전트와 상담 에이전트가 같은 카운터를 쓴다. 인스턴스 메모리라 서버리스에서는 인스턴스별로 센다.
import { toKstDate } from "@/lib/date";

export const PER_IP_DAILY = 20;
const counts = new Map<string, number>();
let globalCount = { day: "", n: 0 };

export function resetLimits() {
  counts.clear();
  globalCount = { day: "", n: 0 };
}

export function dailyLimit(env: Record<string, string | undefined>): number {
  const n = Number(env.AGENT_DAILY_LIMIT);
  return env.AGENT_DAILY_LIMIT && Number.isFinite(n) && n >= 0 ? n : 200;
}

/** 한도 안이면 1회를 쓰고 true */
export function takeQuota(env: Record<string, string | undefined>, ip: string, now: Date): boolean {
  const day = toKstDate(now);
  if (globalCount.day !== day) globalCount = { day, n: 0 };
  const key = `${day}:${ip}`;
  const mine = counts.get(key) ?? 0;
  if (mine >= PER_IP_DAILY || globalCount.n >= dailyLimit(env)) return false;
  counts.set(key, mine + 1);
  globalCount.n++;
  return true;
}
