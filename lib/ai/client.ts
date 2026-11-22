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
