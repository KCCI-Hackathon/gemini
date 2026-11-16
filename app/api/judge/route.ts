import { NextResponse } from "next/server";
import { handleJudge } from "@/lib/judge/handler";

export const runtime = "nodejs";

// 판정은 서버 코드가 한다. 외부 AI를 부르지 않으며 요청 내용을 저장하거나 로그에 남기지 않는다.
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 잘못됐습니다." }, { status: 400 });
  }
  const out = handleJudge(body, new Date());
  return NextResponse.json(out.body, { status: out.status });
}
