import { context, jsonBody, rejectCrossSite, reply } from "@/lib/account/http";
import { markRead } from "@/lib/account/notifications";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = rejectCrossSite(req); if (blocked) return blocked;
  const body = await jsonBody(req); if (!body.ok) return body.res;
  const ctx = context(req);
  return reply(markRead(ctx.user(), body.body, ctx.store, ctx.now));
}
