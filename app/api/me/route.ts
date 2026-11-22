import { getMe } from "@/lib/account/auth";
import { context, reply, sessionToken } from "@/lib/account/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return reply(getMe(sessionToken(req), context(req)));
}
