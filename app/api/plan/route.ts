import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { handlePlan } from "@/lib/plan/handler";
import type { AnthropicLike } from "@/lib/verify/run";

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
  const out = await handlePlan(body, { env: process.env, ip, now: new Date(), makeClient: () => new Anthropic() as unknown as AnthropicLike });
  return NextResponse.json(out.body, { status: out.status });
}
