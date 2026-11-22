// 계정 API 라우트의 공통 경계: 세션 쿠키 읽기, 다른 사이트에서 온 쓰기 요청 거부, 결과를 응답으로 바꾸기.
import { NextResponse } from "next/server";
import { SESSION_COOKIE, currentUser, type Result } from "./auth";
import { accountStore, storageDurable } from "./store";

export function sessionToken(req: Request): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE && rest.length) return rest.join("=") || null;
  }
  return null;
}

/** 쿠키 인증 쓰기 요청은 같은 출처에서 JSON으로 온 것만 받는다(CSRF 방지). */
export function rejectCrossSite(req: Request): NextResponse | null {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return NextResponse.json({ error: "다른 사이트에서 온 요청이에요." }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "JSON 요청만 받아요." }, { status: 415 });
  return null;
}

export async function jsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  try { return { ok: true, body: await req.json() }; }
  catch { return { ok: false, res: NextResponse.json({ error: "요청 형식이 잘못됐어요." }, { status: 400 }) }; }
}

export function reply(r: Result): NextResponse {
  const res = NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
  if (r.setCookie) res.headers.append("set-cookie", r.setCookie);
  return res;
}

export function context(req: Request) {
  const store = accountStore(), now = new Date();
  return {
    store, now, secure: process.env.NODE_ENV === "production", durable: storageDurable(),
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    user: () => currentUser(sessionToken(req), { store, now }),
  };
}
