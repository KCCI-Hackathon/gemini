import { beforeEach, describe, expect, test } from "vitest";
import { handleAgent, resetAgentState } from "@/lib/agent/run";
import { resetLimits } from "@/lib/limits";
import { scriptedClient } from "../verify/helpers";

beforeEach(() => {
  resetAgentState();
  resetLimits();
});

const NOW = new Date("2026-11-24T12:00:00+09:00");
const CHALLENGE = "20250122005400110346";
const env = { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k" };

function textTurn(text: string) {
  // scriptedClient는 tool_use만 만들므로, 최종 답은 finish_cards 도구로 받는다
  return [{ name: "finish_cards", input: { summary: text, cards: [{ policy_id: CHALLENGE, check_next: ["실제 수료일 확인"], rationale: "수료 후 6개월 조건" }] } }];
}

describe("handleAgent (상담 에이전트, 가상 인물 전용)", () => {
  test("가상 인물 번호와 선택지 외 필드가 있으면 400, 호출 0회", async () => {
    const client = scriptedClient([textTurn("x")]);
    const r = await handleAgent({ personaId: "demo-1", birthYm: "1999-03" }, { env, now: NOW, makeClient: () => client });
    expect(r.status).toBe(400);
    expect(client.calls).toBe(0);
  });

  test("도구로 질문 후보와 원문을 확인한 뒤 카드를 만든다", async () => {
    const client = scriptedClient([
      [{ name: "rank_open_questions", input: {} }],
      [{ name: "get_policy_evidence", input: { policy_id: CHALLENGE } }],
      textTurn("국민취업지원제도 참여 여부를 먼저 확인하세요."),
    ]);
    const r = await handleAgent({ personaId: "demo-1" }, { env, now: NOW, makeClient: () => client });
    expect(r.status).toBe(200);
    expect(r.body.fallback).toBe(false);
    expect(r.body.log?.map((l) => l.tool)).toEqual(["rank_open_questions", "get_policy_evidence", "finish_cards"]);
    expect(r.body.cards?.[0].policyId).toBe(CHALLENGE);
  });

  test("금지 표현이 나오면 버리고 코드가 조립한 카드로 대체한다", async () => {
    const client = scriptedClient([textTurn("6월 취업이 더 유리합니다")]);
    const r = await handleAgent({ personaId: "demo-1" }, { env, now: NOW, makeClient: () => client });
    expect(r.body.fallback).toBe(true);
    expect(r.body.cards?.length).toBeGreaterThan(0);
  });

  test("스위치가 꺼져 있으면 호출 없이 대체 카드", async () => {
    const client = scriptedClient([textTurn("x")]);
    const r = await handleAgent({ personaId: "demo-1" }, { env: { EXTERNAL_AI_ENABLED: "false" }, now: NOW, makeClient: () => client });
    expect(client.calls).toBe(0);
    expect(r.body.fallback).toBe(true);
  });

  test("Claude에 가는 요청에 인물의 생년월·시군구가 없다", async () => {
    const client = scriptedClient([textTurn("확인 순서를 정리했습니다.")]);
    await handleAgent({ personaId: "demo-1" }, { env, now: NOW, makeClient: () => client });
    const body = JSON.stringify(client.requests);
    expect(body).not.toContain("1999-03");
    expect(body).not.toContain("28185");
    expect(body).not.toContain("연수구");
  });
});
