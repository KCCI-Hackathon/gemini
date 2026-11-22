// /api/verify 처리. 요청은 정책 번호 하나만 받는다(설계 7장 서버 격리).
import { verifyAiConfigured, verifyProvider } from "@/lib/ai/client";
import { DeadlineExceeded } from "@/lib/ai/deadline";
import { toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { loadDeadLinks } from "@/lib/data/dead-links";
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

function verificationFailure(error: unknown): Out {
  if (error instanceof DeadlineExceeded) {
    return { status: 504, body: { error: "공고 확인 제한 시간을 넘겼습니다. 같은 공고를 다시 확인해 주세요.", retryable: true } };
  }
  return { status: 502, body: { error: "AI 검증 중 오류가 났습니다. 잠시 뒤 다시 시도해 주세요." } };
}

/** 공고 링크가 끊긴 정책은 AI 없이 notice_not_found 로 답한다 */
function deadLinkResult(policyId: string, now: Date): VerifyResult {
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, pagesOpened: 0 };
  const trail = [{ step: 1, action: "stop" as const, target: "", reason: "공고 링크가 없어졌어요(HTTP 404)" }];
  return { policyId, mode: "agent", outcome: "notice_not_found", noticeUrl: null, findings: [], mismatches: [], fieldChecks: [], notice: null, checkedAt: toKstDate(now), trail, usage };
}

export async function handleVerify(body: unknown, ctx: Ctx): Promise<Out> {
  const startedAt = Date.now();
  if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "요청 형식이 잘못됐습니다." } };
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "policyId") return { status: 400, body: { error: "정책 번호(policyId)만 보낼 수 있습니다." } };
  const policyId = (body as { policyId: unknown }).policyId;
  if (typeof policyId !== "string" || !/^\d{20}$/.test(policyId)) return { status: 400, body: { error: "정책 번호 형식이 잘못됐습니다." } };

  const policy = loadSnapshot().policies.find((p) => p.id === policyId);
  if (!policy) return { status: 404, body: { error: "정책을 찾을 수 없습니다." } };
  if (loadDeadLinks().has(policyId)) return { status: 200, body: { source: "saved", result: deadLinkResult(policyId, ctx.now) } };
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
  if (!verifyAiConfigured(ctx.env)) {
    return needsReview
      ? { status: 409, body: { error: VERIFY_RECHECK } }
      : { status: 503, body: { error: "AI 검증이 꺼져 있습니다. 저장된 결과가 있는 정책만 볼 수 있습니다." } };
  }

  // 같은 버전을 이미 실행 중이면 그 결과를 함께 기다린다(중복 실행·중복 과금 방지)
  const running = inflight.get(key);
  if (running) {
    try {
      return { status: 200, body: { source: "cache", result: await running } };
    } catch (error) {
      return verificationFailure(error);
    }
  }

  if (!takeQuota(ctx.env, ctx.ip, ctx.now)) return { status: 429, body: { error: "오늘의 AI 검증 한도에 도달했습니다." } };

  const configuredMs = Number(ctx.env.VERIFY_DEADLINE_MS);
  const p = runVerification(policyId, {
    client: ctx.makeClient(),
    web: createWeb({ fetchFn: ctx.fetchFn, extraHosts: policyHosts(policy) }),
    now: ctx.now,
    // Gemini는 함수 호출과 웹 검색을 함께 쓸 수 없고 OpenAI 어댑터는 서버 검색 도구를 버려서, 검색 없이 공식 링크로만 탐색한다
    enableSearch: !["gemini", "openai"].includes(verifyProvider(ctx.env) ?? ""),
    startedAt,
    // 배포 실행 한도(300초) 전에 재시도 안내를 응답할 시간을 남긴다.
    deadlineMs: configuredMs > 0 ? Math.min(configuredMs, 290_000) : undefined,
  });
  inflight.set(key, p);
  try {
    const result = await p;
    cache.set(key, result);
    return { status: 200, body: { source: "live", result } };
  } catch (error) {
    return verificationFailure(error);
  } finally {
    inflight.delete(key);
  }
}
