import { beforeEach, describe, expect, it } from "vitest";
import { getMe, login, logout, resetLoginLimits, signup, SESSION_COOKIE } from "@/lib/account/auth";
import { rejectCrossSite, sessionToken } from "@/lib/account/http";
import { getSettings, listNotifications, markRead, planNotifications, putSettings, runDailyNotifications } from "@/lib/account/notifications";
import { createPlan, getPlan, listPlans, MAX_PLANS, resetSaveLimits } from "@/lib/account/plans";
import { sqliteStore, type AccountStore, type User } from "@/lib/account/store";
import { PERSONA_A } from "@/lib/judge/personas";
import { evaluateRequest } from "@/lib/planner/catalog";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import type { Evaluation, PlannerInput } from "@/lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const profile = { ...PERSONA_A, events: [] };
const baseInput: PlannerInput = { revision: 1, events: PERSONA_DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" };
const base = evaluateRequest(profile, baseInput, now);
const pick = base.cards.find(c => c.availability === "eligible" && c.stageId === base.stages[0].stageId)!;
const input: PlannerInput = { ...baseInput, choices: [{ offeringId: pick.offeringId, stageId: pick.stageId }] };
const planBody = { name: " 내 계획 ", source: "manual", profileSnapshot: profile, input };

let store: AccountStore;
const ctx = () => ({ store, now, secure: false, ip: "1.2.3.4", durable: true });
const tokenOf = (cookie?: string) => cookie!.split(";")[0].split("=")[1];
async function account(email = "a@example.com") {
  const r = await signup({ email, password: "password123" }, ctx());
  const token = tokenOf(r.setCookie);
  return { token, user: store.findUserByEmail(email)! as User };
}

beforeEach(() => { store = sqliteStore(":memory:"); resetLoginLimits(); resetSaveLimits(); });

describe("계정", () => {
  it("가입하면 세션이 생기고, 같은 이메일은 다시 가입할 수 없다", async () => {
    const r = await signup({ email: " A@Example.com ", password: "password123", displayName: "하우" }, ctx());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ mode: "account", displayName: "하우" });
    expect(r.setCookie).toMatch(/^pf_session=[\w-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    expect(store.findUserByEmail("a@example.com")!.passwordHash).toMatch(/^scrypt\$/);
    expect((await signup({ email: "a@example.com", password: "password456" }, ctx())).status).toBe(409);
    expect((await signup({ email: "b@example.com", password: "short" }, ctx())).status).toBe(400);
  });
  it("로그인·로그아웃과 /api/me", async () => {
    await account();
    expect((await login({ email: "a@example.com", password: "wrong-pass" }, ctx())).status).toBe(401);
    expect((await login({ email: "none@example.com", password: "password123" }, ctx())).status).toBe(401);
    const ok = await login({ email: "A@example.com", password: "password123" }, ctx());
    expect(ok.status).toBe(200);
    const token = tokenOf(ok.setCookie);
    expect(getMe(token, ctx()).body).toMatchObject({ mode: "account", displayName: "a", durable: true });
    expect(getMe(null, ctx()).body).toEqual({ mode: "guest" });
    expect(logout(token, ctx()).setCookie).toContain("Max-Age=0");
    expect(getMe(token, ctx()).body).toEqual({ mode: "guest" });
    expect(getMe(token, { ...ctx(), now: new Date("2027-01-01") }).body).toEqual({ mode: "guest" });
  });
  it("같은 주소에서 10번 틀리면 15분 동안 막는다", async () => {
    await account();
    for (let i = 0; i < 10; i++) expect((await login({ email: "a@example.com", password: "nope-nope" }, ctx())).status).toBe(401);
    expect((await login({ email: "a@example.com", password: "password123" }, ctx())).status).toBe(429);
    expect((await login({ email: "a@example.com", password: "password123" }, { ...ctx(), now: new Date(now.getTime() + 16 * 60_000) })).status).toBe(200);
  });
});

describe("계정 저장 계획", () => {
  it("로그인과 재시도 키가 필요하고, 서버가 다시 판정해 저장한다", async () => {
    const { user } = await account();
    expect(createPlan(null, "key-00000001", planBody, ctx()).status).toBe(401);
    expect(createPlan(user, null, planBody, ctx()).status).toBe(400);
    expect(createPlan(user, "key-00000001", { ...planBody, input: baseInput }, ctx()).status).toBe(400);
    const r = createPlan(user, "key-00000001", planBody, ctx());
    expect(r.status).toBe(201);
    const { planId } = r.body as { planId: string };
    const saved = getPlan(user, planId, ctx()).body as { name: string; savedEvaluation: Evaluation };
    expect(saved.name).toBe("내 계획");
    expect(saved.savedEvaluation.cards.some(c => c.offeringId === pick.offeringId && c.selectedStageId === pick.stageId)).toBe(true);
  });
  it("같은 키·같은 내용은 기존 결과, 같은 키·다른 내용은 409", async () => {
    const { user } = await account();
    const first = createPlan(user, "key-00000002", planBody, ctx());
    const again = createPlan(user, "key-00000002", { ...planBody, name: "내 계획" }, ctx());
    expect(again).toMatchObject({ status: 200, body: first.body });
    expect(createPlan(user, "key-00000002", { ...planBody, name: "다른 이름" }, ctx()).status).toBe(409);
  });
  it("목록은 내 계획만 생성일 역순으로, 다른 사람 계획은 404", async () => {
    const a = await account("a@example.com"), b = await account("b@example.com");
    const ids: string[] = [];
    for (let i = 0; i < 22; i++) ids.push((createPlan(a.user, `key-a-${String(i).padStart(4, "0")}`, planBody, { store, now: new Date(now.getTime() + i * 7000) }).body as { planId: string }).planId);
    createPlan(b.user, "key-b-000001", planBody, ctx());
    const page1 = listPlans(a.user, null, ctx()).body as { plans: { planId: string }[]; nextCursor: string };
    expect(page1.plans.map(p => p.planId)).toEqual(ids.slice(2).reverse());
    expect(page1.plans[0]).toEqual({ planId: ids[21], name: "내 계획", source: "manual", createdAt: expect.any(String), dataVersion: expect.any(String), choiceCount: 1 });
    const page2 = listPlans(a.user, page1.nextCursor, ctx()).body as { plans: { planId: string }[]; nextCursor: string | null };
    expect(page2).toEqual({ plans: [expect.objectContaining({ planId: ids[1] }), expect.objectContaining({ planId: ids[0] })], nextCursor: null });
    expect(getPlan(b.user, ids[0], ctx()).status).toBe(404);
    expect(listPlans(null, null, ctx()).status).toBe(401);
    expect(listPlans(a.user, "garbage", ctx()).status).toBe(400);
  }, 30_000); // 저장마다 서버가 전체 판정을 다시 돌린다
});

describe("저장 한도", () => {
  it("분당 10번, 사용자당 50개, 본문 크기를 넘으면 거부하고 재시도는 세지 않는다", async () => {
    const { user } = await account();
    for (let i = 0; i < 10; i++) expect(createPlan(user, `key-rate-${i}0000`, { ...planBody, name: `계획 ${i}` }, ctx()).status).toBe(201);
    expect(createPlan(user, "key-rate-overflow", planBody, ctx()).status).toBe(429);
    expect(createPlan(user, "key-rate-00000", { ...planBody, name: "계획 0" }, ctx()).status).toBe(200);
    expect(createPlan(user, "key-rate-later", planBody, { store, now: new Date(now.getTime() + 61_000) }).status).toBe(201);
    const full = { ...store, countPlans: () => MAX_PLANS };
    expect(createPlan(user, "key-full-0001", planBody, { store: full, now: new Date(now.getTime() + 200_000) }).status).toBe(409);
    expect(createPlan(user, "key-rate-later", planBody, { store: full, now }).status).toBe(200);
    const huge = { ...planBody, profileSnapshot: { ...profile, participating: Array(30_000).fill("20250101005400000000") } };
    expect(createPlan(user, "key-huge-0001", huge, ctx()).status).toBe(413);
  }, 30_000);
});

describe("알림", () => {
  const settings = { deadline: true, noticeChange: true, newPolicy: true };
  const saved = evaluateRequest(profile, input, now);
  const mine = saved.cards.find(c => c.selectedStageId === c.stageId)!;
  const withCard = (e: Evaluation, patch: Partial<typeof mine>, extra: Partial<Evaluation> = {}): Evaluation =>
    ({ ...e, ...extra, cards: e.cards.map(c => c === mine || (c.offeringId === mine.offeringId && c.stageId === mine.stageId) ? { ...c, ...patch } : c) });

  it("담은 정책이 7일 안에 마감되면 마감 알림", () => {
    const soon = withCard(saved, { daysLeft: 3, official: { ...mine.official, end: "2026-11-25" }, personalWindow: null, deadlineKind: "official" });
    const out = planNotifications("p1", "계획", saved, soon, settings);
    expect(out.filter(n => n.kind === "deadline")).toEqual([expect.objectContaining({ title: `${mine.title} 마감 3일 전`, dedupe: `deadline:p1:${mine.offeringId}:2026-11-25` })]);
    expect(planNotifications("p1", "계획", saved, withCard(saved, { daysLeft: 8 }), settings).filter(n => n.kind === "deadline")).toEqual([]);
    expect(planNotifications("p1", "계획", saved, soon, { ...settings, deadline: false }).filter(n => n.kind === "deadline")).toEqual([]);
  });
  it("공고 기준일이 바뀌고 담은 정책 판정이 바뀌면 공고 변경 알림, 기준일이 같으면 없음", () => {
    const changed = withCard(saved, { availability: "blocked" }, { asOf: "2026-12-01" });
    expect(planNotifications("p1", "계획", saved, changed, settings).filter(n => n.kind === "notice_change"))
      .toEqual([expect.objectContaining({ body: expect.stringContaining("판정 수혜 가능 → 수혜 불가능") })]);
    expect(planNotifications("p1", "계획", saved, withCard(saved, { availability: "blocked" }), settings).filter(n => n.kind === "notice_change")).toEqual([]);
  });
  it("새로 신청 가능해진 정책은 계획마다 3개까지", () => {
    const before: Evaluation = { ...saved, cards: saved.cards.map(c => c === mine ? c : { ...c, availability: "needs_check" }) };
    const out = planNotifications("p1", "계획", before, saved, settings).filter(n => n.kind === "new_policy");
    expect(out.length).toBe(Math.min(3, saved.cards.filter(c => c.availability === "eligible" && c !== mine).length));
    expect(out.every(n => n.policyId !== mine.policyId || n.dedupe.includes(mine.stageId) === false)).toBe(true);
  });
  it("정기 작업은 같은 알림을 두 번 쌓지 않고, 읽음·설정을 사용자별로 다룬다", async () => {
    const a = await account("a@example.com"), b = await account("b@example.com");
    createPlan(a.user, "key-notify-1", planBody, ctx());
    const later = new Date("2026-12-20T09:00:00+09:00");
    const first = runDailyNotifications(store, later);
    expect(first).toMatchObject({ plans: 1, failed: 0, complete: true });
    expect(runDailyNotifications(store, later).created).toBe(0);
    const list = listNotifications(a.user, store).body as { notifications: { id: string }[]; unread: number };
    expect(list.unread).toBe(first.created);
    expect(listNotifications(b.user, store).body).toEqual({ notifications: [], unread: 0 });
    expect(list.notifications.length).toBeGreaterThan(0);
    expect(markRead(b.user, { ids: [list.notifications[0].id] }, store, later).body).toMatchObject({ updated: 0 });
    expect(markRead(a.user, { all: true }, store, later).body).toMatchObject({ unread: 0 });
    expect(markRead(a.user, {}, store, later).status).toBe(400);
    expect(getSettings(a.user, store).body).toEqual(settings);
    expect(putSettings(a.user, { deadline: false, noticeChange: true, newPolicy: false }, store).status).toBe(200);
    expect(getSettings(a.user, store).body).toEqual({ deadline: false, noticeChange: true, newPolicy: false });
    expect(getSettings(b.user, store).body).toEqual(settings);
    expect(listNotifications(null, store).status).toBe(401);
  });
});

describe("정기 작업 시간 한도", () => {
  it("시간을 넘기면 멈추고, 다음 실행은 확인하지 못한 계획부터 처리한다", async () => {
    const { user } = await account();
    const first = (createPlan(user, "key-queue-0001", planBody, ctx()).body as { planId: string }).planId;
    const second = (createPlan(user, "key-queue-0002", { ...planBody, name: "두 번째" }, { store, now: new Date(now.getTime() + 7000) }).body as { planId: string }).planId;
    let t = 0;
    const clock = () => (t += 1000);
    const at = new Date("2026-12-20T09:00:00+09:00");
    expect(runDailyNotifications(store, at, 1500, clock)).toMatchObject({ plans: 1, complete: false });
    expect(store.plansToCheck(10)).toEqual([second, first]);
  }, 30_000);
});

describe("HTTP 경계", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/plans", { method: "POST", headers });
  it("다른 출처나 JSON이 아닌 쓰기 요청은 거부한다", () => {
    expect(rejectCrossSite(req({ origin: "https://evil.example", "content-type": "application/json" }))?.status).toBe(403);
    expect(rejectCrossSite(req({ "content-type": "text/plain" }))?.status).toBe(415);
    expect(rejectCrossSite(req({ origin: "http://localhost:3000", "content-type": "application/json; charset=utf-8" }))).toBeNull();
  });
  it("세션 쿠키만 읽는다", () => {
    expect(sessionToken(req({ cookie: `a=1; ${SESSION_COOKIE}=abc_DEF-1; b=2` }))).toBe("abc_DEF-1");
    expect(sessionToken(req({ cookie: "a=1" }))).toBeNull();
  });
});
