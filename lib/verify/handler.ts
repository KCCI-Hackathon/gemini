// /api/verify 처리. 요청은 정책 번호 하나만 받는다(설계 7장 서버 격리).
import { toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { runVerification, policyHosts, type AnthropicLike, type VerifyResult } from "./run";
import { createWeb } from "./web";

const PER_IP_DAILY = 20;
const cache = new Map<string, VerifyResult>();
const counts = new Map<string, number>();
let globalCount = { day: "", n: 0 };

export function resetVerifyState() {
  cache.clear();
  counts.clear();
  globalCount = { day: "", n: 0 };
}

type Ctx = {
  env: Record<string, string | undefined>;
  ip: string;
  now: Date;
  makeClient: () => AnthropicLike;
  saved: Record<string, VerifyResult>;
  fetchFn?: typeof fetch;
};

type Out = { status: number; body: { source?: "saved" | "cache" | "live"; result?: VerifyResult; error?: string } };

export async function handleVerify(body: unknown, ctx: Ctx): Promise<Out> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "요청 형식이 잘못됐습니다." } };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "policyId") return { status: 400, body: { error: "정책 번호(policyId)만 보낼 수 있습니다." } };
  const policyId = (body as { policyId: unknown }).policyId;
  if (typeof policyId !== "string" || !/^\d{20}$/.test(policyId)) return { status: 400, body: { error: "정책 번호 형식이 잘못됐습니다." } };

  if (ctx.saved[policyId]) return { status: 200, body: { source: "saved", result: ctx.saved[policyId] } };
  if (cache.has(policyId)) return { status: 200, body: { source: "cache", result: cache.get(policyId)! } };
  if (ctx.env.EXTERNAL_AI_ENABLED !== "true" || !ctx.env.ANTHROPIC_API_KEY) {
    return { status: 503, body: { error: "AI 검증이 꺼져 있습니다. 저장된 결과가 있는 정책만 볼 수 있습니다." } };
  }

  const day = toKstDate(ctx.now);
  if (globalCount.day !== day) globalCount = { day, n: 0 };
  const ipKey = `${day}:${ctx.ip}`;
  const mine = counts.get(ipKey) ?? 0;
  const dailyLimit = Number(ctx.env.AGENT_DAILY_LIMIT ?? "200");
  if (mine >= PER_IP_DAILY || globalCount.n >= dailyLimit) return { status: 429, body: { error: "오늘의 AI 검증 한도에 도달했습니다." } };
  counts.set(ipKey, mine + 1);
  globalCount.n++;

  const policy = loadSnapshot().policies.find((p) => p.id === policyId);
  if (!policy) return { status: 404, body: { error: "정책을 찾을 수 없습니다." } };

  const result = await runVerification(policyId, {
    client: ctx.makeClient(),
    web: createWeb({ fetchFn: ctx.fetchFn, extraHosts: policyHosts(policy) }),
    now: ctx.now,
    enableSearch: true,
  });
  cache.set(policyId, result);
  return { status: 200, body: { source: "live", result } };
}
