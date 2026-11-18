// AI 제공자 선택: AI_PROVIDER=gemini면 Gemini 어댑터, 아니면 Anthropic SDK.
import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicLike } from "@/lib/verify/run";
import { geminiClient } from "./gemini";

type Env = Record<string, string | undefined>;

export const isGemini = (env: Env) => env.AI_PROVIDER === "gemini";

/** 외부 AI 스위치가 켜져 있고, 고른 제공자의 키가 있는가 */
export function aiConfigured(env: Env): boolean {
  if (env.EXTERNAL_AI_ENABLED !== "true") return false;
  return isGemini(env) ? !!env.GEMINI_API_KEY : !!env.ANTHROPIC_API_KEY;
}

export function makeAiClient(env: Env): AnthropicLike {
  if (isGemini(env)) return geminiClient({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL || "gemini-3.5-flash" });
  return new Anthropic() as unknown as AnthropicLike;
}
