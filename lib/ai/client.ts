// AI 제공자 선택: AI_PROVIDER=gemini면 Gemini 어댑터, 아니면 Anthropic SDK.
import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicLike } from "@/lib/verify/run";
import { geminiClient } from "./gemini";
import { openaiClient } from "./openai";

type Env = Record<string, string | undefined>;

export const isGemini = (env: Env) => env.AI_PROVIDER === "gemini";

/** 외부 AI 스위치가 켜져 있고, 고른 제공자의 키가 있는가 */
export function aiConfigured(env: Env): boolean {
  if (env.EXTERNAL_AI_ENABLED !== "true") return false;
  return isGemini(env) ? !!env.GEMINI_API_KEY : !!env.ANTHROPIC_API_KEY;
}

// 상담 · 추천 에이전트(/api/plan version 2)만 공급자를 따로 고른다. 검증 · 중복수혜 에이전트는 AI_PROVIDER 그대로.
export const planProvider = (env: Env) => env.PLAN_AI_PROVIDER || env.AI_PROVIDER || "anthropic";
/** 상담 · 추천 모델. "추천해줘"만 OPENAI_RECOMMEND_MODEL 을 따로 고를 수 있다. 코드 기본값은 두지 않는다. */
export function planModel(env: Env, action: "recommend" | "message"): string | undefined {
  return action === "recommend" ? env.OPENAI_RECOMMEND_MODEL || env.OPENAI_MODEL : env.OPENAI_MODEL;
}
export function planAiConfigured(env: Env, action: "recommend" | "message" = "message"): boolean {
  if (env.EXTERNAL_AI_ENABLED !== "true") return false;
  const p = planProvider(env);
  if (p === "openai") return !!env.OPENAI_API_KEY && !!planModel(env, action);
  return p === "gemini" ? !!env.GEMINI_API_KEY : !!env.ANTHROPIC_API_KEY;
}
export function makePlanClient(env: Env, action: "recommend" | "message"): AnthropicLike {
  if (planProvider(env) === "openai") return openaiClient({ apiKey: env.OPENAI_API_KEY!, model: planModel(env, action)! });
  if (planProvider(env) === "gemini") return geminiClient({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || "gemini-3.5-flash" });
  return new Anthropic() as unknown as AnthropicLike;
}

export function makeAiClient(env: Env): AnthropicLike {
  if (isGemini(env)) return geminiClient({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || "gemini-3.5-flash" });
  return new Anthropic() as unknown as AnthropicLike;
}

// 임시: Gemini 요청 한도 때문에 시연용으로 검증 에이전트를 GPT(OpenAI)로 돌린다. VERIFY_AI_PROVIDER 로 직접 고를 수도 있다.
// 상담 · 추천이 openai 면 추가 설정 없이 openai, 아니면 AI_PROVIDER 그대로. 중복수혜 · 상담 에이전트는 영향 없음.
export const verifyProvider = (env: Env) => env.VERIFY_AI_PROVIDER || (env.PLAN_AI_PROVIDER === "openai" ? "openai" : env.AI_PROVIDER);
const verifyModel = (env: Env) => env.OPENAI_VERIFY_MODEL || env.OPENAI_MODEL;
/** 검증 에이전트: 외부 AI 스위치가 켜져 있고, 고른 공급자의 키(openai 는 모델까지)가 있는가 */
export function verifyAiConfigured(env: Env): boolean {
  if (env.EXTERNAL_AI_ENABLED !== "true") return false;
  const p = verifyProvider(env);
  if (p === "openai") return !!env.OPENAI_API_KEY && !!verifyModel(env);
  return p === "gemini" ? !!env.GEMINI_API_KEY : !!env.ANTHROPIC_API_KEY;
}
/** 검증 에이전트용 클라이언트 */
export function makeVerifyClient(env: Env): AnthropicLike {
  const p = verifyProvider(env);
  if (p === "openai") return openaiClient({ apiKey: env.OPENAI_API_KEY!, model: verifyModel(env)! });
  if (p === "gemini") return geminiClient({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || "gemini-3.5-flash" });
  return new Anthropic() as unknown as AnthropicLike;
}
