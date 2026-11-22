// 화면 안 알림(벨). 하루 한 번 저장 계획을 지금 기준으로 다시 판정해 쌓는다. 이메일·카카오 발송은 하지 않는다.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateRequest } from "@/lib/planner/catalog";
import type { Card, Evaluation } from "@/lib/planner/types";
import type { Result } from "./auth";
import type { AccountStore, Notification, NotificationKind, NotificationSettings, User } from "./store";

const DEADLINE_DAYS = 7;
const NEW_PER_PLAN = 3;
const chosen = (e: Evaluation) => e.cards.filter(c => c.selectedStageId === c.stageId);
const key = (c: Card) => `${c.stageId}|${c.offeringId}`;
const deadlineOf = (c: Card) => c.personalWindow?.end ?? c.official.end;

type Draft = { kind: NotificationKind; policyId: string | null; title: string; body: string; dedupe: string };

/** 저장 계획 하나에서 나올 알림. 저장 당시 판정과 지금 판정을 비교한다. */
export function planNotifications(planId: string, name: string, saved: Evaluation, now: Evaluation, settings: NotificationSettings): Draft[] {
  const out: Draft[] = [];
  const mine = chosen(now);
  if (settings.deadline) for (const c of mine) {
    if (c.availability === "blocked" || c.daysLeft === null || c.daysLeft < 0 || c.daysLeft > DEADLINE_DAYS) continue;
    const end = deadlineOf(c);
    out.push({ kind: "deadline", policyId: c.policyId, dedupe: `deadline:${planId}:${c.offeringId}:${end}`,
      title: `${c.title} ${c.daysLeft === 0 ? "오늘 마감" : `마감 ${c.daysLeft}일 전`}`,
      body: `‘${name}’에 담은 정책의 ${c.deadlineKind === "personal_estimate" ? "내 예상 기한" : "신청 기한"}이 ${end}이에요.` });
  }
  // 공고가 바뀐 경우만: 데이터 기준일이 달라졌을 때 담은 정책의 판정이나 마감이 바뀌면 알린다. 시간이 흘러 바뀐 것은 마감 알림이 맡는다.
  if (settings.noticeChange && saved.asOf !== now.asOf) {
    const before = new Map(chosen(saved).map(c => [c.offeringId, c]));
    const after = new Map(mine.map(c => [c.offeringId, c]));
    for (const [offeringId, old] of before) {
      const cur = after.get(offeringId);
      const changed = !cur ? "최신 공고에서 이 회차를 찾을 수 없어요." : cur.availability !== old.availability || cur.official.end !== old.official.end
        ? `공고 마감 ${old.official.end ?? "미정"} → ${cur.official.end ?? "미정"}, 판정 ${label(old)} → ${label(cur)}` : null;
      if (changed) out.push({ kind: "notice_change", policyId: old.policyId, dedupe: `change:${planId}:${now.asOf}:${offeringId}`,
        title: `${old.title} 공고가 바뀌었어요`, body: `‘${name}’ · ${changed}` });
    }
  }
  if (settings.newPolicy) {
    const was = new Map(saved.cards.map(c => [key(c), c.availability]));
    const picked = new Set(mine.map(c => c.offeringId));
    now.cards
      .filter(c => c.availability === "eligible" && was.get(key(c)) !== "eligible" && !picked.has(c.offeringId))
      .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))
      .slice(0, NEW_PER_PLAN)
      .forEach(c => out.push({ kind: "new_policy", policyId: c.policyId, dedupe: `new:${planId}:${key(c)}`,
        title: `새로 신청할 수 있는 정책: ${c.title}`, body: `‘${name}’ 계획의 같은 시점에 신청 가능해졌어요.` }));
  }
  return out;
}
const label = (c: Card) => c.availability === "eligible" ? "수혜 가능" : c.availability === "blocked" ? "수혜 불가능" : "확인 필요";

/**
 * 하루 한 번 도는 작업. 가장 오래 확인하지 않은 계획부터 하나씩 읽어(계획 하나가 약 3MB) 시간 안에서만 처리한다.
 * 못 끝낸 계획은 다음 실행에서 먼저 처리된다. 같은 알림은 dedupe 키로 한 번만 쌓인다.
 */
export function runDailyNotifications(store: AccountStore, at: Date, budgetMs = 45_000, clock = () => Date.now()) {
  const started = clock(), ids = store.plansToCheck(10_000);
  let plans = 0, created = 0, failed = 0, stopped = false;
  for (const id of ids) {
    if (clock() - started > budgetMs) { stopped = true; break; }
    const rec = store.planById(id);
    if (!rec) continue;
    plans++;
    try {
      const fresh = evaluateRequest(rec.plan.profileSnapshot, rec.plan.input, at);
      for (const d of planNotifications(rec.id, rec.plan.name, rec.plan.savedEvaluation, fresh, store.getSettings(rec.ownerId))) {
        const n: Notification = { id: randomUUID(), userId: rec.ownerId, kind: d.kind, planId: rec.id, policyId: d.policyId,
          title: d.title, body: d.body, createdAt: at.toISOString(), readAt: null };
        if (store.addNotification(n, d.dedupe)) created++;
      }
    } catch { failed++; } // 한 계획이 깨져도 다른 사용자의 알림은 만든다
    store.markChecked(id, at.toISOString());
  }
  return { plans, created, failed, complete: !stopped && ids.length < 10_000 };
}

export function listNotifications(user: User | null, store: AccountStore): Result {
  if (!user) return { status: 401, body: { error: "로그인이 필요해요." } };
  return { status: 200, body: { notifications: store.listNotifications(user.id, 50).map(n => ({ id: n.id, kind: n.kind, planId: n.planId, policyId: n.policyId, title: n.title, body: n.body, createdAt: n.createdAt, readAt: n.readAt })), unread: store.unreadCount(user.id) } };
}

const ReadSchema = z.union([z.object({ all: z.literal(true) }), z.object({ ids: z.array(z.string().uuid()).min(1).max(100) })]);
export function markRead(user: User | null, body: unknown, store: AccountStore, now: Date): Result {
  if (!user) return { status: 401, body: { error: "로그인이 필요해요." } };
  const parsed = ReadSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "읽음 처리할 알림을 지정해 주세요." } };
  const updated = store.markRead(user.id, "all" in parsed.data ? "all" : parsed.data.ids, now.toISOString());
  return { status: 200, body: { updated, unread: store.unreadCount(user.id) } };
}

const SettingsSchema = z.object({ deadline: z.boolean(), noticeChange: z.boolean(), newPolicy: z.boolean() });
export function getSettings(user: User | null, store: AccountStore): Result {
  if (!user) return { status: 401, body: { error: "로그인이 필요해요." } };
  return { status: 200, body: store.getSettings(user.id) };
}
export function putSettings(user: User | null, body: unknown, store: AccountStore): Result {
  if (!user) return { status: 401, body: { error: "로그인이 필요해요." } };
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "알림 설정 형식이 잘못됐어요." } };
  store.putSettings(user.id, parsed.data);
  return { status: 200, body: parsed.data };
}
