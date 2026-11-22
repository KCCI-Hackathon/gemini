import { beforeAll, expect, it } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import { evaluateRequest } from "@/lib/planner/catalog";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import type { PlannerInput } from "@/lib/planner/types";

// 계정 API는 한 경로(/api/account/...)에서만 처리한다. 같은 저장소를 쓰는지 요청 흐름 전체로 확인한다.
let routeAccount: typeof import("@/lib/account/router").routeAccount;
beforeAll(async () => {
  process.env.ACCOUNT_DB_PATH = ":memory:";
  ({ routeAccount } = await import("@/lib/account/router"));
});

const base = "http://localhost:3000/api/account/";
let cookie = "";
async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await routeAccount(new Request(base + path, {
    method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }), ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }), path.split("?")[0].split("/"));
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, body: await res.json() };
}

it("가입한 세션으로 계획·알림·설정을 같은 경로에서 처리하고, 없는 경로와 방식은 거부한다", async () => {
  expect((await call("GET", "me")).body).toEqual({ mode: "guest" });
  expect((await call("GET", "plans")).status).toBe(401);
  expect((await call("POST", "signup", { email: "r@example.com", password: "testpass123" })).status).toBe(201);
  expect((await call("GET", "me")).body).toMatchObject({ mode: "account", displayName: "r" });
  expect((await call("GET", "plans")).body).toEqual({ plans: [], nextCursor: null });

  const now = new Date();
  const profile = { ...PERSONA_A, events: [] };
  const input: PlannerInput = { revision: 1, events: PERSONA_DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" };
  const evaluation = evaluateRequest(profile, input, now);
  const card = evaluation.cards.find(c => c.availability === "eligible")!;
  const saved = await call("POST", "plans", { name: "라우터 계획", source: "manual", profileSnapshot: profile, input: { ...input, choices: [{ offeringId: card.offeringId, stageId: card.stageId }] } }, { "idempotency-key": "router-key-01" });
  expect(saved.status).toBe(201);
  expect((await call("GET", `plans/${saved.body.planId}`)).body).toMatchObject({ name: "라우터 계획" });
  expect((await call("GET", "plans")).body.plans).toHaveLength(1);
  expect((await call("GET", "notifications")).status).toBe(200);
  expect((await call("POST", "notifications/read", { all: true })).status).toBe(200);
  expect((await call("PUT", "notification-settings", { deadline: false, noticeChange: true, newPolicy: true })).body).toEqual({ deadline: false, noticeChange: true, newPolicy: true });

  expect((await call("GET", "nothing")).status).toBe(404);
  expect((await call("GET", "plans/a/b")).status).toBe(404);
  expect((await call("DELETE", "me")).status).toBe(405);
  expect((await call("GET", "login")).status).toBe(405);
  expect((await call("GET", "cron/notifications")).status).toBe(503);
  expect((await call("POST", "plans", { name: "x" }, { origin: "https://evil.example", "idempotency-key": "router-key-02" })).status).toBe(403);

  expect((await call("POST", "logout", {})).body).toEqual({ mode: "guest" });
  expect((await call("GET", "plans")).status).toBe(401);
}, 30_000);
