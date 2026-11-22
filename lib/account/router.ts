// 계정 API 전체를 한 경로(/api/account/...)에서 나눠 처리한다.
// Vercel은 설정이 다른 API 경로를 서로 다른 함수로 올리고, 함수마다 /tmp 저장소가 따로다.
// 경로가 갈라지면 로그인한 세션을 계획 API가 모르게 되므로, 계정 기능은 반드시 이 한 함수에서만 처리한다.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getMe, login, logout, signup } from "./auth";
import { context, jsonBody, rejectCrossSite, reply, sessionToken } from "./http";
import { getSettings, listNotifications, markRead, putSettings, refreshUserNotifications, runDailyNotifications } from "./notifications";
import { createPlan, getPlan, listPlans } from "./plans";

const notFound = () => NextResponse.json({ error: "없는 요청이에요." }, { status: 404 });
const notAllowed = () => NextResponse.json({ error: "지원하지 않는 요청 방식이에요." }, { status: 405 });

function cronAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았어요." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected) ? null : NextResponse.json({ error: "권한이 없어요." }, { status: 401 });
}

export async function routeAccount(req: Request, path: string[]): Promise<Response> {
  const [head, ...rest] = path, method = req.method;
  // 쓰기 요청은 같은 출처의 JSON만 받는다(CSRF). 정기 작업은 GET이라 해당 없음
  const write = async () => {
    const blocked = rejectCrossSite(req); if (blocked) return { res: blocked };
    const body = await jsonBody(req); return body.ok ? { body: body.body } : { res: body.res };
  };
  const ctx = context(req);
  switch (head) {
    case "me":
      if (rest.length) return notFound();
      return method === "GET" ? reply(getMe(sessionToken(req), ctx)) : notAllowed();
    case "signup": case "login": case "logout": {
      if (rest.length) return notFound();
      if (method !== "POST") return notAllowed();
      if (head === "logout") { const blocked = rejectCrossSite(req); return blocked ?? reply(logout(sessionToken(req), ctx)); }
      const w = await write(); if (w.res) return w.res;
      return reply(head === "signup" ? await signup(w.body, ctx) : await login(w.body, ctx));
    }
    case "plans":
      if (rest.length === 1) return method === "GET" ? reply(getPlan(ctx.user(), rest[0], ctx)) : notAllowed();
      if (rest.length) return notFound();
      if (method === "GET") return reply(listPlans(ctx.user(), new URL(req.url).searchParams.get("cursor"), ctx));
      if (method === "POST") { const w = await write(); if (w.res) return w.res; return reply(createPlan(ctx.user(), req.headers.get("idempotency-key"), w.body, ctx)); }
      return notAllowed();
    case "notifications": {
      const user = ctx.user();
      if (!rest.length) {
        if (method !== "GET") return notAllowed();
        // 정기 작업이 없어도 알림이 쌓이도록, 목록을 열 때 이 사용자의 오래된 계획을 먼저 확인한다
        if (user) refreshUserNotifications(ctx.store, user.id, ctx.now);
        return reply(listNotifications(user, ctx.store));
      }
      if (rest.length === 1 && rest[0] === "read") {
        if (method !== "POST") return notAllowed();
        const w = await write(); if (w.res) return w.res;
        return reply(markRead(user, w.body, ctx.store, ctx.now));
      }
      return notFound();
    }
    case "notification-settings":
      if (rest.length) return notFound();
      if (method === "GET") return reply(getSettings(ctx.user(), ctx.store));
      if (method === "PUT") { const w = await write(); if (w.res) return w.res; return reply(putSettings(ctx.user(), w.body, ctx.store)); }
      return notAllowed();
    case "cron":
      if (rest.join("/") !== "notifications") return notFound();
      if (method !== "GET") return notAllowed();
      return cronAuthorized(req) ?? NextResponse.json(runDailyNotifications(ctx.store, ctx.now));
    default:
      return notFound();
  }
}
