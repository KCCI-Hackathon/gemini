// 최종 리뷰 C2·I12·I13 재현 테스트
import { beforeEach, describe, expect, test } from "vitest";
import { handleAgent, resetAgentState } from "@/lib/agent/run";
import { guardResponse } from "@/lib/agent/guard";
import { loadSnapshot } from "@/lib/data/snapshot";
import { handleVerify, resetVerifyState } from "@/lib/verify/handler";
import type { AnthropicLike } from "@/lib/verify/run";
import { scriptedClient } from "../verify/helpers";

const NOW = new Date("2026-11-24T12:00:00+09:00");
const CHALLENGE = "20250122005400110346";
const env = { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k" };
const okTurn = [{ name: "finish_cards", input: { summary: "확인 순서", cards: [{ policy_id: CHALLENGE, check_next: ["실제 수료일 확인"], rationale: "수료 후 6개월 조건" }] } }];

function throwingClient(): AnthropicLike & { calls: number } {
  const c = { calls: 0, beta: { messages: { create: async () => { c.calls++; throw Object.assign(new Error("overloaded"), { status: 529 }); } } } };
  return c as unknown as AnthropicLike & { calls: number };
}

beforeEach(() => {
  resetVerifyState();
  resetAgentState();
});

describe("C2: 상담 에이전트 실패 처리와 호출 제한", () => {
  test("API가 실패하면 500이 아니라 코드가 조립한 카드", async () => {
    const r = await handleAgent({ personaId: "demo-1" }, { env, ip: "1.1.1.1", now: NOW, makeClient: () => throwingClient() });
    expect(r.status).toBe(200);
    expect(r.body.fallback).toBe(true);
    expect(r.body.cards?.length).toBeGreaterThan(0);
  });

  test("같은 날 같은 인물은 결과를 재사용해 다시 부르지 않는다", async () => {
    const client = scriptedClient([okTurn]);
    await handleAgent({ personaId: "demo-1" }, { env, ip: "1.1.1.1", now: NOW, makeClient: () => client });
    const again = await handleAgent({ personaId: "demo-1" }, { env, ip: "2.2.2.2", now: NOW, makeClient: () => client });
    expect(client.calls).toBe(1);
    expect(again.body.fallback).toBe(false);
  });

  test("같은 IP에서 20회를 넘어도 앱 자체 제한으로 AI를 차단하지 않는다", async () => {
    const client = throwingClient();
    for (let i = 0; i < 25; i++) await handleAgent({ personaId: "demo-1" }, { env, ip: "1.1.1.1", now: NOW, makeClient: () => client });
    expect(client.calls).toBe(25);
  });

  test("서로 다른 IP의 요청이 하루 200회를 넘어도 앱 전체 제한으로 차단하지 않는다", async () => {
    const client = throwingClient();
    for (let i = 0; i < 205; i++) {
      const r = await handleAgent({ personaId: "demo-1" }, { env, ip: `ip-${i}`, now: NOW, makeClient: () => client });
      expect(r.status).toBe(200);
    }
    expect(client.calls).toBe(205);
  });
});

describe("검증 요청에는 상담 요청 횟수 제한이 적용되지 않는다", () => {
  const notFound = [[{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }]];
  const vctx = (client: AnthropicLike, ip = "1.1.1.1") => ({ env, ip, now: NOW, makeClient: () => client, saved: {} });

  test("없는 정책 번호는 한도를 쓰지 않는다", async () => {
    const client = scriptedClient(notFound);
    for (let i = 0; i < 25; i++) expect((await handleVerify({ policyId: `2099${String(i).padStart(16, "0")}` }, vctx(client))).status).toBe(404);
    expect((await handleVerify({ policyId: "20260928005400113623" }, vctx(client))).status).toBe(200);
  });

  test("같은 정책을 동시에 요청하면 한 번만 실행한다", async () => {
    const client = scriptedClient(notFound);
    const id = "20261113005400214853";
    const [a, b] = await Promise.all([handleVerify({ policyId: id }, vctx(client)), handleVerify({ policyId: id }, vctx(client))]);
    expect(a).toMatchObject({ status: 200, body: { source: "live" } });
    expect(b).toMatchObject({ status: 200, body: { source: "cache" } });
    expect(client.calls).toBe(0); // 이 정책은 공고 URL이 없어 AI 모델을 호출하지 않는다.
  });

  test("상담 요청이 20회를 넘어도 검증 API는 앱 횟수 제한에 걸리지 않는다", async () => {
    const client = throwingClient();
    for (let i = 0; i < 21; i++) {
      await handleAgent({ personaId: "demo-1" }, { env, ip: "shared-ip", now: NOW, makeClient: () => client });
    }
    const verifyClient = scriptedClient(notFound);
    const result = await handleVerify({ policyId: "20261113005400214853" }, vctx(verifyClient, "shared-ip"));
    expect(result.status).not.toBe(429);
  });

  test("서비스 전체에서 20건을 넘어도 실제 정책 검증은 계속 진행한다", async () => {
    const client = scriptedClient(notFound);
    const ids = loadSnapshot().policies.slice(0, 21).map((p) => p.id);
    let last = 0;
    for (const [i, id] of ids.entries()) last = (await handleVerify({ policyId: id }, vctx(client, `ip-${i}`))).status;
    expect(last).toBe(200);
  });
});

describe("I12: 응답 검사", () => {
  const ids = new Set([CHALLENGE]);
  test("활용형 금지 표현도 막는다", () => {
    expect(guardResponse("선정 가능성이 높습니다", ids).ok).toBe(false);
    expect(guardResponse("취업을 미루는 편이 낫습니다", ids).ok).toBe(false);
    expect(guardResponse("지원금을 받을 수 있어요", ids).ok).toBe(false);
    expect(guardResponse("취업이 유리한 선택입니다", ids).ok).toBe(false);
  });
  test("선정 기준 안내는 허용", () => {
    expect(guardResponse("선정 기준을 공고에서 확인하세요", ids).ok).toBe(true);
  });
  test("모르는 정책 카드가 섞이면 응답 전체를 버린다", async () => {
    const client = scriptedClient([[{ name: "finish_cards", input: { summary: "x", cards: [...okTurn[0].input.cards, { policy_id: "20990101005400000000", check_next: ["a"], rationale: "b" }] } }]]);
    const r = await handleAgent({ personaId: "demo-1" }, { env, ip: "1.1.1.1", now: NOW, makeClient: () => client });
    expect(r.body.fallback).toBe(true);
  });
});
