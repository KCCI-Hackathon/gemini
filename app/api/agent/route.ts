import { makeAiClient } from "@/lib/ai/client";
import { NextResponse } from "next/server";
import { handleAgent } from "@/lib/agent/run";

export const runtime = "nodejs";
export const maxDuration = 120;

// 상담 에이전트: 가상 인물 번호만 받는다. 사용자 프로필은 받지 않는다.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못됐습니다." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const out = await handleAgent(body, { env: process.env, ip, now: new Date(), makeClient: () => makeAiClient(process.env) });
  return NextResponse.json(out.body, { status: out.status });
}
