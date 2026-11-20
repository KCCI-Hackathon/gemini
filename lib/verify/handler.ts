// /api/verify 처리. 요청은 정책 번호 하나만 받는다(설계 7장 서버 격리).
import { aiConfigured, isGemini } from "@/lib/ai/client";
import { toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { pickRound } from "@/lib/judge/rules";
import { resetLimits, takeQuota } from "@/lib/limits";
import { runVerification, policyHosts, type AnthropicLike, type VerifyResult } from "./run";
import { lookupSaved, VERIFY_RECHECK } from "./saved";
import { verificationKey, verificationVersion } from "./version";
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

type Out = { status: number; body: { source?: "saved" | "cache" | "live"; result?: VerifyResult; error?: string; retryable?: boolean } };

export async function handleVerify(body: unknown, ctx: Ctx): Promise<Out> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "요청 형식이 잘못됐습니다." } };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "policyId") return { status: 400, body: { error: "정책 번호(policyId)만 보낼 수 있습니다." } };
  const policyId = (body as { policyId: unknown }).policyId;
  if (typeof policyId !== "string" || !/^\d{20}$/.test(policyId)) return { status: 400, body: { error: "정책 번호 형식이 잘못됐습니다." } };

  const policy = loadSnapshot().policies.find((p) => p.id === policyId);
  if (!policy) return { status: 404, body: { error: "정책을 찾을 수 없습니다." } };
  const v = loadVerified().get(policyId);
  const date = toKstDate(ctx.now);
  const version = verificationVersion(policy, v, date);
  if (version.roundKey === null) return { status: 409, body: { error: VERIFY_RECHECK } };
  const key = verificationKey(policyId, version);
  const { result, needsReview } = lookupSaved(ctx.saved, policyId, version);
  if (result) return { status: 200, body: { source: "saved", result } };
  const cached = cache.get(key);
  if (cached) return { status: 200, body: { source: "cache", result: cached } };

  // 그 회차에 승인된 규칙이 있으면 사람이 확인한 근거로 판정한다: 실시간 AI 대조로 덮지 않는다(5.4)
  if (v?.rounds?.length && pickRound(v.rounds, date).state === "approved") {
    return { status: 409, body: { error: needsReview ? VERIFY_RECHECK : "승인된 공고 규칙이 있는 정책은 실시간 AI 대조를 하지 않습니다." } };
  }
  if (!aiConfigured(ctx.env)) {
    return needsReview
      ? { status: 409, body: { error: VERIFY_RECHECK } }
      : { status: 503, body: { error: "AI 검증이 꺼져 있습니다. 저장된 결과가 있는 정책만 볼 수 있습니다." } };
  }

  // 같은 정책을 이미 실행 중이면 그 결과를 함께 기다린다(중복 실행·중복 과금 방지)
  const running = inflight.get(key);
  if (running) return { status: 200, body: { source: "cache", result: await running } };

  if (!takeQuota(ctx.env, ctx.ip, ctx.now)) return { status: 429, body: { error: "오늘의 AI 검증 한도에 도달했습니다." } };

  const p = runVerification(policyId, {
    client: ctx.makeClient(),
    web: createWeb({ fetchFn: ctx.fetchFn, extraHosts: policyHosts(policy) }),
    now: ctx.now,
    // Gemini는 함수 호출과 웹 검색을 함께 쓸 수 없어 검색 없이 공식 링크로만 탐색한다
    enableSearch: !isGemini(ctx.env),
    // Gemini는 한 번 부르는 데 오래 걸려(실측 1건 195초) 시간 한도를 환경 변수로 늘릴 수 있게 한다
    deadlineMs: Number(ctx.env.VERIFY_DEADLINE_MS) || undefined,
  });
  inflight.set(key, p);
  try {
    const result = await p;
    cache.set(key, result);
    return { status: 200, body: { source: "live", result } };
  } catch {
    return { status: 502, body: { error: "AI 검증 중 오류가 났습니다. 잠시 뒤 다시 시도해 주세요." } };
  } finally {
    inflight.delete(key);
  }
}
