import { context, reply } from "@/lib/account/http";
import { listNotifications } from "@/lib/account/notifications";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const ctx = context(req);
  return reply(listNotifications(ctx.user(), ctx.store));
}
