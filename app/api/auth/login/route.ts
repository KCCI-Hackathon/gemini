import { login } from "@/lib/account/auth";
import { context, jsonBody, rejectCrossSite, reply } from "@/lib/account/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = rejectCrossSite(req); if (blocked) return blocked;
  const body = await jsonBody(req); if (!body.ok) return body.res;
  return reply(await login(body.body, context(req)));
}
