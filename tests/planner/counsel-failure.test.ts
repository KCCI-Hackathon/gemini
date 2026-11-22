// AI 상담이 답을 못 받았을 때: 이유별 안내 · 재시도 여부 · ‘조건 기준 추천’과 구분
import { beforeEach, expect, test, vi } from "vitest";
import { counselFailure, requestCounsel } from "@/lib/planner/counsel-client";
import { handleCounsel, resetCounselState, type CounselCtx } from "@/lib/plan/counsel";
import { PERSONA_A } from "@/lib/judge/personas";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import { resetLimits } from "@/lib/limits";
import type { Draft, PlannerInput } from "@/lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const env = { EXTERNAL_AI_ENABLED: "true", PLAN_AI_PROVIDER: "openai", OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-test" };
const input: PlannerInput = { revision: 0, events: structuredClone(PERSONA_DEMO_EVENTS), choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" };
const demo = { version: 2 as const, action: "message" as const, message: "청년도약계좌 설명해줘", profile: { ...PERSONA_A, events: [] }, input, history: [], outOfScopeStreak: 0 };
const user = { ...demo, profile: { ...PERSONA_A, events: [], source: "user" as const }, input: { ...input, demoId: undefined }, consent: true };
const ctx = (over: Partial<CounselCtx> = {}): CounselCtx => ({ env, ip: `ip-${Math.random()}`, now, makeClient: () => ({ beta: { messages: { create: async () => { throw new Error("OpenAI 429"); } } } }) as never, ...over });
vi.setConfig({ testTimeout: 30_000 });
beforeEach(() => { resetCounselState(); resetLimits?.(); });

test("서버: 운영 스위치 · 제공자 설정 · 사용 한도 · 제공자 오류 · 예상 못 한 오류를 이유와 재시도 여부로 돌려준다", async () => {
  expect((await handleCounsel(user, ctx())).body).toMatchObject({ failure: "users_off", retryable: false });
  expect((await handleCounsel(user, ctx({ env: { ...env, PLAN_AI_FOR_USERS: "true" } }))).body).toMatchObject({ kind: "fallback", failure: "provider", retryable: true });
  expect((await handleCounsel({ ...user, consent: false }, ctx({ env: { ...env, PLAN_AI_FOR_USERS: "true" } }))).body).toMatchObject({ failure: "consent" });
  const off = await handleCounsel(demo, ctx({ env: { ...env, EXTERNAL_AI_ENABLED: "false" } }));
  expect(off).toMatchObject({ status: 503, body: { failure: "not_configured", retryable: false } });
  const quota = await handleCounsel(demo, ctx({ env: { ...env, AGENT_DAILY_LIMIT: "0" } }));
  expect(quota).toMatchObject({ status: 429, body: { failure: "quota", retryable: false } });
  // 코드 버그 같은 예상 못 한 오류도 500 대신 이유를 준다
  const crash = await handleCounsel(demo, ctx({ makeClient: () => { throw new TypeError("boom"); } }));
  expect(crash).toMatchObject({ status: 502, body: { kind: "fallback", source: "rule", failure: "provider", retryable: true } });
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
  expect(counselFailure({ kind: "fallback", source: "rule", status: 429, failure: "quota", retryable: false })?.text).not.toContain("다시 시도");
  expect(counselFailure({ kind: "none", status: 403, failure: "users_off", retryable: false })?.text).toContain("운영 설정");
  expect(counselFailure({ kind: "none", status: 503 })).toMatchObject({ failure: "bad_response" });
  expect(counselFailure({ kind: "none", status: 403, failure: "consent" })).toBeNull();
  expect(counselFailure({ kind: "fallback", source: "rule", status: 200 })).toBeNull(); // AI 가 스스로 조건 기준 추천을 고른 경우
  expect(counselFailure({ kind: "answer", text: "답", status: 200 })).toBeNull();
});
