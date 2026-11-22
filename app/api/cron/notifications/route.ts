// 하루 한 번 알림 작업. Vercel Cron은 Authorization: Bearer <CRON_SECRET>을 붙여 부른다.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDailyNotifications } from "@/lib/account/notifications";
import { accountStore } from "@/lib/account/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았어요." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: "권한이 없어요." }, { status: 401 });
  return NextResponse.json(runDailyNotifications(accountStore(), new Date()));
}
