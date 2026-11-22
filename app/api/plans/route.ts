import { context, jsonBody, rejectCrossSite, reply } from "@/lib/account/http";
import { createPlan, listPlans } from "@/lib/account/plans";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = rejectCrossSite(req); if (blocked) return blocked;
  const body = await jsonBody(req); if (!body.ok) return body.res;
  const ctx = context(req);
  return reply(createPlan(ctx.user(), req.headers.get("idempotency-key"), body.body, ctx));
}

export async function GET(req: Request) {
  const ctx = context(req);
  return reply(listPlans(ctx.user(), new URL(req.url).searchParams.get("cursor"), ctx));
}
