// AI 상담이 답을 못 받았을 때: 이유별 안내 · 재시도 여부 · ‘조건 기준 추천’과 구분
import { beforeEach, expect, test, vi } from "vitest";
import { counselFailure, requestCounsel } from "@/lib/planner/counsel-client";
import { handleCounsel, resetCounselState, type CounselCtx } from "@/lib/plan/counsel";
import { PERSONA_A } from "@/lib/judge/personas";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import type { Draft, PlannerInput } from "@/lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const env = { EXTERNAL_AI_ENABLED: "true", PLAN_AI_PROVIDER: "openai", OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-test" };
const input: PlannerInput = { revision: 0, events: structuredClone(PERSONA_DEMO_EVENTS), choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" };
const demo = { version: 2 as const, action: "message" as const, message: "청년도약계좌 설명해줘", profile: { ...PERSONA_A, events: [] }, input, history: [], outOfScopeStreak: 0 };
const user = { ...demo, profile: { ...PERSONA_A, events: [], source: "user" as const }, input: { ...input, demoId: undefined }, consent: true };
const ctx = (over: Partial<CounselCtx> = {}): CounselCtx => ({ env, ip: `ip-${Math.random()}`, now, makeClient: () => ({ beta: { messages: { create: async () => { throw new Error("OpenAI 429"); } } } }) as never, ...over });
vi.setConfig({ testTimeout: 30_000 });
beforeEach(() => { resetCounselState(); });

test("서버: 운영 스위치 · 제공자 설정 · 동의 · 제공자 429 · 예상 못 한 오류를 구분한다", async () => {
  expect((await handleCounsel(user, ctx())).body).toMatchObject({ failure: "users_off", retryable: false });
  expect((await handleCounsel(user, ctx({ env: { ...env, PLAN_AI_FOR_USERS: "true" } }))).body).toMatchObject({ kind: "fallback", failure: "provider", retryable: true });
  expect((await handleCounsel({ ...user, consent: false }, ctx({ env: { ...env, PLAN_AI_FOR_USERS: "true" } }))).body).toMatchObject({ failure: "consent" });
  const off = await handleCounsel(demo, ctx({ env: { ...env, EXTERNAL_AI_ENABLED: "false" } }));
  expect(off).toMatchObject({ status: 503, body: { failure: "not_configured", retryable: false } });
  let providerCalls = 0;
  const provider429 = await handleCounsel(demo, ctx({
    env: { ...env, AGENT_DAILY_LIMIT: "0" },
    makeClient: () => ({ beta: { messages: { create: async () => { providerCalls++; throw Object.assign(new Error("rate limit"), { status: 429 }); } } } }) as never,
  }));
  expect(providerCalls).toBe(1);
  expect(provider429).toMatchObject({ status: 200, body: { kind: "fallback", failure: "provider", retryable: true } });
  // 코드 버그 같은 예상 못 한 오류도 500 대신 이유를 준다
  const crash = await handleCounsel(demo, ctx({ makeClient: () => { throw new TypeError("boom"); } }));
  expect(crash).toMatchObject({ status: 502, body: { kind: "fallback", source: "rule", failure: "provider", retryable: true } });
});

test("같은 IP의 상담 요청도 하루 20회를 넘겨 제공자 호출까지 도달한다", async () => {
  let calls = 0;
  const sharedIp = "same-ip";
  for (let i = 0; i < 21; i++) {
    const out = await handleCounsel(demo, ctx({ ip: sharedIp, makeClient: () => ({ beta: { messages: { create: async () => { calls++; throw Object.assign(new Error("provider rate limit"), { status: 429 }); } } } }) as never }));
    expect(out.body.failure).toBe("provider");
  }
  expect(calls).toBe(21);
});

const draft = { draftId: "d1", profileSnapshot: demo.profile, input, evaluation: {} } as unknown as Draft;
const call = (fetcher: typeof fetch, timeoutMs?: number) => requestCounsel({ draft, action: "message", message: "질문", history: [], consent: true, outOfScopeStreak: 0, fetcher, timeoutMs });

test("브라우저: 연결 실패 · 기다리다 끊음 · JSON 이 아닌 응답을 구분한다", async () => {
  expect(await call(async () => { throw new TypeError("Failed to fetch"); })).toMatchObject({ status: 0, failure: "network", retryable: true });
  const slow = call((_url, init) => new Promise((_ok, fail) => init?.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")))), 10);
  expect(await slow).toMatchObject({ status: 0, failure: "client_timeout", retryable: true });
  expect(await call(async () => new Response("<html>502</html>", { status: 502 }))).toMatchObject({ status: 502, failure: "bad_response", retryable: true });
  expect(await call(async () => Response.json({ kind: "answer", text: "답" }))).toEqual({ kind: "answer", text: "답", status: 200 });
});

test("화면 안내: 재시도할 수 있는 실패에만 ‘다시 시도’를 안내하고, 정상 응답 · 동의 부족은 실패로 보지 않는다", () => {
  expect(counselFailure({ kind: "fallback", source: "rule", status: 200, failure: "timeout", retryable: true })).toMatchObject({ failure: "timeout", retryable: true, text: expect.stringContaining("다시 시도") });
  expect(counselFailure({ kind: "fallback", source: "rule", status: 502, failure: "provider", retryable: true })?.text).toContain("다시 시도");
  expect(counselFailure({ kind: "fallback", source: "rule", status: 502, failure: "provider", retryable: true })?.text).not.toContain("오늘의 AI 사용 한도");
  expect(counselFailure({ kind: "none", status: 403, failure: "users_off", retryable: false })?.text).toContain("운영 설정");
  expect(counselFailure({ kind: "none", status: 503 })).toMatchObject({ failure: "bad_response" });
  expect(counselFailure({ kind: "none", status: 403, failure: "consent" })).toBeNull();
  expect(counselFailure({ kind: "fallback", source: "rule", status: 200 })).toBeNull(); // AI 가 스스로 조건 기준 추천을 고른 경우
  expect(counselFailure({ kind: "answer", text: "답", status: 200 })).toBeNull();
});
