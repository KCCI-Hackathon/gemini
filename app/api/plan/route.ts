import { makeAiClient, makePlanClient } from "@/lib/ai/client";
import { openaiModeration } from "@/lib/ai/moderation";
import { NextResponse } from "next/server";
import { handlePlan } from "@/lib/plan/handler";
import { handleCounsel } from "@/lib/plan/counsel";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못됐습니다." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const env = process.env;
  // 새 화면의 상담 · 추천 에이전트는 version: 2. 옛 형식(legacy 화면)은 그대로 받는다.
  if (body && typeof body === "object" && (body as { version?: unknown }).version === 2) {
    const moderate = env.OPENAI_API_KEY && env.MODERATION_MODEL ? openaiModeration({ apiKey: env.OPENAI_API_KEY, model: env.MODERATION_MODEL }) : undefined;
    const out = await handleCounsel(body, { env, ip, now: new Date(), makeClient: action => makePlanClient(env, action), moderate });
    return NextResponse.json(out.body, { status: out.status });
  }
  const out = await handlePlan(body, { env, ip, now: new Date(), makeClient: () => makeAiClient(env) });
  return NextResponse.json(out.body, { status: out.status });
}
