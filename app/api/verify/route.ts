import { makeAiClient } from "@/lib/ai/client";
import { NextResponse } from "next/server";
import saved from "@/data/verify-results/index.json";
import { handleVerify } from "@/lib/verify/handler";
import type { VerifyResult } from "@/lib/verify/run";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못됐습니다." }, { status: 400 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const out = await handleVerify(body, {
    env: process.env,
    ip,
    now: new Date(),
    makeClient: () => makeAiClient(process.env),
    saved: saved as unknown as Record<string, VerifyResult>,
  });
  return NextResponse.json(out.body, { status: out.status });
}
