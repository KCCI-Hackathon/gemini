import { context, reply } from "@/lib/account/http";
import { getPlan } from "@/lib/account/plans";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = context(req);
  return reply(getPlan(ctx.user(), (await params).id, ctx));
}
