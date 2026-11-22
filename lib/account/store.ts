// 계정·계획·알림 저장소. 운영 DB가 정해지기 전까지 SQLite 한 가지 구현만 둔다.
// 화면과 API 처리기는 AccountStore 인터페이스만 쓰므로, 운영 DB를 정하면 같은 메서드를 가진 구현을 하나 더 만들면 된다.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SavedPlan } from "@/lib/planner/types";

export type User = { id: string; email: string; displayName: string; passwordHash: string; createdAt: string };
export type PlanRecord = { id: string; ownerId: string; idempotencyKey: string; requestHash: string; plan: SavedPlan };
export type NotificationKind = "deadline" | "notice_change" | "new_policy";
export type Notification = {
  id: string; userId: string; kind: NotificationKind; planId: string | null; policyId: string | null;
  title: string; body: string; createdAt: string; readAt: string | null;
};
export type NotificationSettings = { deadline: boolean; noticeChange: boolean; newPolicy: boolean };
export const DEFAULT_SETTINGS: NotificationSettings = { deadline: true, noticeChange: true, newPolicy: true };
export type PlanCursor = { createdAt: string; id: string };
/** 목록용 요약. 저장 계획 본문(판정 결과 포함 수 MB)은 열 때만 읽는다 */
export type PlanSummary = { planId: string; name: string; source: string; createdAt: string; dataVersion: string; choiceCount: number };

export interface AccountStore {
  /** 이메일이 이미 있으면 null */
  createUser(user: User): User | null;
  findUserByEmail(email: string): User | null;
  findUser(id: string): User | null;
  /** 만료된 세션을 지운 뒤 새 세션을 만든다 */
  createSession(tokenHash: string, userId: string, expiresAt: string, now: string): void;
  /** 만료되지 않은 세션의 사용자 */
  findSessionUser(tokenHash: string, now: string): User | null;
  deleteSession(tokenHash: string): void;
  /** 같은 (소유자, 재시도 키)가 이미 있으면 새로 쓰지 않고 기존 기록을 돌려준다 */
  insertPlan(record: PlanRecord): { record: PlanRecord; created: boolean };
  listPlans(ownerId: string, limit: number, after?: PlanCursor): PlanSummary[];
  getPlan(ownerId: string, id: string): PlanRecord | null;
  countPlans(ownerId: string): number;
  planByKey(ownerId: string, idempotencyKey: string): PlanRecord | null;
  /** 정기 알림 작업용: 가장 오래 확인하지 않은 계획부터 ID만 */
  plansToCheck(limit: number): string[];
  planById(id: string): PlanRecord | null;
  markChecked(id: string, at: string): void;
  /** 같은 (사용자, dedupeKey)는 한 번만 쌓는다. 새로 쌓았으면 true */
  addNotification(n: Notification, dedupeKey: string): boolean;
  listNotifications(userId: string, limit: number): Notification[];
  unreadCount(userId: string): number;
  markRead(userId: string, ids: string[] | "all", now: string): number;
  getSettings(userId: string): NotificationSettings;
  putSettings(userId: string, settings: NotificationSettings): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, source TEXT NOT NULL,
  schema_version INTEGER NOT NULL, snapshot_json TEXT NOT NULL, data_version TEXT NOT NULL, created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, checked_at TEXT, UNIQUE(owner_id, idempotency_key)
) STRICT;
CREATE INDEX IF NOT EXISTS plans_to_check ON plans(checked_at, created_at);
CREATE INDEX IF NOT EXISTS plans_by_owner ON plans(owner_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  plan_id TEXT, policy_id TEXT, title TEXT NOT NULL, body TEXT NOT NULL, dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL, read_at TEXT, UNIQUE(user_id, dedupe_key)
) STRICT;
CREATE INDEX IF NOT EXISTS notifications_by_user ON notifications(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, deadline INTEGER NOT NULL, notice_change INTEGER NOT NULL, new_policy INTEGER NOT NULL
) STRICT;`;

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v);
const toUser = (r: Row): User => ({ id: str(r.id), email: str(r.email), displayName: str(r.display_name), passwordHash: str(r.password_hash), createdAt: str(r.created_at) });
const toPlan = (r: Row): PlanRecord => ({ id: str(r.id), ownerId: str(r.owner_id), idempotencyKey: str(r.idempotency_key), requestHash: str(r.request_hash), plan: JSON.parse(str(r.snapshot_json)) });
const toSummary = (r: Row): PlanSummary => ({ planId: str(r.id), name: str(r.name), source: str(r.source), createdAt: str(r.created_at), dataVersion: str(r.data_version), choiceCount: Number(r.choice_count) });
const SUMMARY = "SELECT id, name, source, created_at, data_version, json_array_length(snapshot_json, '$.input.choices') AS choice_count FROM plans";
const toNotification = (r: Row): Notification => ({
  id: str(r.id), userId: str(r.user_id), kind: str(r.kind) as NotificationKind, planId: r.plan_id == null ? null : str(r.plan_id),
  policyId: r.policy_id == null ? null : str(r.policy_id), title: str(r.title), body: str(r.body), createdAt: str(r.created_at), readAt: r.read_at == null ? null : str(r.read_at),
});

export function sqliteStore(path: string): AccountStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(SCHEMA);
  const one = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args) as Row[];
  const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);
  return {
    createUser(u) {
      const r = run("INSERT OR IGNORE INTO users VALUES (?,?,?,?,?)", u.id, u.email, u.displayName, u.passwordHash, u.createdAt);
      return r.changes ? u : null;
    },
    findUserByEmail(email) { const r = one("SELECT * FROM users WHERE email=?", email); return r ? toUser(r) : null; },
    findUser(id) { const r = one("SELECT * FROM users WHERE id=?", id); return r ? toUser(r) : null; },
    createSession(tokenHash, userId, expiresAt, now) {
      run("DELETE FROM sessions WHERE expires_at<=?", now);
      run("INSERT INTO sessions VALUES (?,?,?)", tokenHash, userId, expiresAt);
    },
    findSessionUser(tokenHash, now) {
      const r = one("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?", tokenHash, now);
      return r ? toUser(r) : null;
    },
    deleteSession(tokenHash) { run("DELETE FROM sessions WHERE token_hash=?", tokenHash); },
    insertPlan(rec) {
      const p = rec.plan;
      const r = run("INSERT OR IGNORE INTO plans VALUES (?,?,?,?,?,?,?,?,?,?,NULL)", rec.id, rec.ownerId, p.name, p.source, p.schemaVersion,
        JSON.stringify(p), p.savedEvaluation.dataVersion, p.createdAt, rec.idempotencyKey, rec.requestHash);
      if (r.changes) return { record: rec, created: true };
      return { record: toPlan(one("SELECT * FROM plans WHERE owner_id=? AND idempotency_key=?", rec.ownerId, rec.idempotencyKey)!), created: false };
    },
    listPlans(ownerId, limit, after) {
      return (after
        ? all(`${SUMMARY} WHERE owner_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC, id DESC LIMIT ?`, ownerId, after.createdAt, after.createdAt, after.id, limit)
        : all(`${SUMMARY} WHERE owner_id=? ORDER BY created_at DESC, id DESC LIMIT ?`, ownerId, limit)).map(toSummary);
    },
    getPlan(ownerId, id) { const r = one("SELECT * FROM plans WHERE owner_id=? AND id=?", ownerId, id); return r ? toPlan(r) : null; },
    planByKey(ownerId, key) { const r = one("SELECT * FROM plans WHERE owner_id=? AND idempotency_key=?", ownerId, key); return r ? toPlan(r) : null; },
    countPlans(ownerId) { return Number(one("SELECT count(*) AS n FROM plans WHERE owner_id=?", ownerId)!.n); },
    // 확인한 적 없는 계획 먼저, 그다음 가장 오래전에 확인한 계획. 시간 안에 못 끝낸 계획이 다음 실행에서 앞에 온다.
    plansToCheck(limit) { return all("SELECT id FROM plans ORDER BY checked_at IS NOT NULL, checked_at, created_at LIMIT ?", limit).map(r => str(r.id)); },
    planById(id) { const r = one("SELECT * FROM plans WHERE id=?", id); return r ? toPlan(r) : null; },
    markChecked(id, at) { run("UPDATE plans SET checked_at=? WHERE id=?", at, id); },
    addNotification(n, dedupeKey) {
      return !!run("INSERT OR IGNORE INTO notifications VALUES (?,?,?,?,?,?,?,?,?,?)", n.id, n.userId, n.kind, n.planId, n.policyId, n.title, n.body, dedupeKey, n.createdAt, n.readAt).changes;
    },
    listNotifications(userId, limit) { return all("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?", userId, limit).map(toNotification); },
    unreadCount(userId) { return Number(one("SELECT count(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL", userId)!.n); },
    markRead(userId, ids, now) {
      if (ids === "all") return Number(run("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL", now, userId).changes);
      let n = 0;
      for (const id of ids) n += Number(run("UPDATE notifications SET read_at=? WHERE user_id=? AND id=? AND read_at IS NULL", now, userId, id).changes);
      return n;
    },
    getSettings(userId) {
      const r = one("SELECT * FROM notification_settings WHERE user_id=?", userId);
      return r ? { deadline: !!r.deadline, noticeChange: !!r.notice_change, newPolicy: !!r.new_policy } : { ...DEFAULT_SETTINGS };
    },
    putSettings(userId, s) {
      run("INSERT INTO notification_settings VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET deadline=excluded.deadline, notice_change=excluded.notice_change, new_policy=excluded.new_policy",
        userId, Number(s.deadline), Number(s.noticeChange), Number(s.newPolicy));
    },
  };
}

let shared: AccountStore | undefined;
/**
 * 서버 전체에서 쓰는 저장소.
 * shortcut: Vercel 함수의 /tmp는 인스턴스가 바뀌면 사라진다. 운영 DB를 정하면 그 구현으로 바꾼다.
 */
export function accountStore(env: Record<string, string | undefined> = process.env): AccountStore {
  shared ??= sqliteStore(env.ACCOUNT_DB_PATH || (env.VERCEL ? "/tmp/pathfinder-accounts.sqlite" : "data/db/accounts.sqlite"));
  return shared;
}
/** 영구 저장인지. 화면이 "다른 기기에서 열기"를 약속해도 되는지 판단한다 */
export function storageDurable(env: Record<string, string | undefined> = process.env) {
  return !env.VERCEL;
}
