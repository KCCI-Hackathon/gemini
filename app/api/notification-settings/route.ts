import { context, jsonBody, rejectCrossSite, reply } from "@/lib/account/http";
import { getSettings, putSettings } from "@/lib/account/notifications";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = context(req);
  return reply(getSettings(ctx.user(), ctx.store));
}

export async function PUT(req: Request) {
  const blocked = rejectCrossSite(req); if (blocked) return blocked;
  const body = await jsonBody(req); if (!body.ok) return body.res;
  const ctx = context(req);
  return reply(putSettings(ctx.user(), body.body, ctx.store));
}
