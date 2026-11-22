import { logout } from "@/lib/account/auth";
import { context, rejectCrossSite, reply, sessionToken } from "@/lib/account/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const blocked = rejectCrossSite(req); if (blocked) return blocked;
  return reply(logout(sessionToken(req), context(req)));
}
