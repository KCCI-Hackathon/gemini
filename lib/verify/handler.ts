// /api/verify 처리. 요청은 정책 번호 하나만 받는다(설계 7장 서버 격리).
import { loadSnapshot } from "@/lib/data/snapshot";
import { resetLimits, takeQuota } from "@/lib/limits";
import { runVerification, policyHosts, type AnthropicLike, type VerifyResult } from "./run";
import { createWeb } from "./web";

const cache = new Map<string, VerifyResult>();
const inflight = new Map<string, Promise<VerifyResult>>();

export function resetVerifyState() {
  cache.clear();
  inflight.clear();
  resetLimits();
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

  const policy = loadSnapshot().policies.find((p) => p.id === policyId);
  if (!policy) return { status: 404, body: { error: "정책을 찾을 수 없습니다." } };

  // 같은 정책을 이미 실행 중이면 그 결과를 함께 기다린다(중복 실행·중복 과금 방지)
  const running = inflight.get(policyId);
  if (running) return { status: 200, body: { source: "cache", result: await running } };

  if (!takeQuota(ctx.env, ctx.ip, ctx.now)) return { status: 429, body: { error: "오늘의 AI 검증 한도에 도달했습니다." } };

  const p = runVerification(policyId, {
    client: ctx.makeClient(),
    web: createWeb({ fetchFn: ctx.fetchFn, extraHosts: policyHosts(policy) }),
    now: ctx.now,
    enableSearch: true,
  });
  inflight.set(policyId, p);
  try {
    const result = await p;
    cache.set(policyId, result);
    return { status: 200, body: { source: "live", result } };
  } catch {
    return { status: 502, body: { error: "AI 검증 중 오류가 났습니다. 잠시 뒤 다시 시도해 주세요." } };
  } finally {
    inflight.delete(policyId);
  }
}
