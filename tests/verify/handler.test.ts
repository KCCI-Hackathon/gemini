import { describe, expect, test } from "vitest";
import { handleVerify, resetVerifyState } from "@/lib/verify/handler";
import { scriptedClient } from "./helpers";
import { guardResponse } from "@/lib/agent/guard";

const ID = "20260406005400212445";
const finishNotFound = [[{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }]];

function ctx(over: Partial<Parameters<typeof handleVerify>[1]> = {}) {
  const client = scriptedClient(finishNotFound);
  let made = 0;
  return {
    client,
    made: () => made,
    c: {
      env: { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k", AGENT_DAILY_LIMIT: "100" },
      ip: "1.1.1.1",
      now: new Date("2026-11-24T12:00:00+09:00"),
      makeClient: () => {
        made++;
        return client;
      },
      saved: {},
      ...over,
    },
  };
}

describe("handleVerify", () => {
  test("정책 번호 외 필드가 있으면 400이고 클라이언트를 만들지 않는다", async () => {
    resetVerifyState();
    const t = ctx();
    const r = await handleVerify({ policyId: ID, sigungu: "28185" }, t.c);
    expect(r.status).toBe(400);
    expect(t.made()).toBe(0);
  });

  test("형식이 틀린 정책 번호는 400", async () => {
    resetVerifyState();
    const t = ctx();
    expect((await handleVerify({ policyId: "abc" }, t.c)).status).toBe(400);
  });

  test("저장된 실행 결과가 있으면 AI를 부르지 않고 그것을 돌려준다", async () => {
    resetVerifyState();
    const saved = { [ID]: { policyId: ID, mode: "agent", outcome: "notice_not_found", noticeUrl: null, findings: [], mismatches: [], trail: [], usage: { calls: 0, inputTokens: 0, outputTokens: 0, pagesOpened: 0 } } };
    const t = ctx({ saved: saved as never });
    const r = await handleVerify({ policyId: ID }, t.c);
    expect(r.status).toBe(200);
    expect(r.body.source).toBe("saved");
    expect(t.made()).toBe(0);
  });

  test("외부 AI 스위치가 꺼져 있으면 503이고 호출 0회", async () => {
    resetVerifyState();
    const t = ctx({ env: { EXTERNAL_AI_ENABLED: "false", ANTHROPIC_API_KEY: "k", AGENT_DAILY_LIMIT: "100" } });
    const r = await handleVerify({ policyId: ID }, t.c);
    expect(r.status).toBe(503);
    expect(t.made()).toBe(0);
  });

  test("실시간 실행 후 결과를 캐시해 두 번째는 다시 부르지 않는다", async () => {
    resetVerifyState();
    const t = ctx();
    const a = await handleVerify({ policyId: ID }, t.c);
    expect(a.status).toBe(200);
    expect(a.body.source).toBe("live");
    const b = await handleVerify({ policyId: ID }, t.c);
    expect(b.body.source).toBe("cache");
    expect(t.client.calls).toBe(1);
  });

  test("접속 주소당 하루 한도를 넘으면 429", async () => {
    resetVerifyState();
    const t = ctx({ env: { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k", AGENT_DAILY_LIMIT: "100" } });
    const ids = Array.from({ length: 21 }, (_, i) => `2026${String(i).padStart(16, "0")}`);
    let last = 0;
    for (const id of ids) last = (await handleVerify({ policyId: id }, t.c)).status;
    expect(last).toBe(429);
  });
});

describe("guardResponse", () => {
  test("우열·권유 표현과 모르는 정책 번호를 막는다", () => {
    const ids = new Set([ID]);
    expect(guardResponse("6월 취업이 더 유리합니다", ids).ok).toBe(false);
    expect(guardResponse("취업을 미루세요", ids).ok).toBe(false);
    expect(guardResponse("20990101005400000000 정책", ids).ok).toBe(false);
    expect(guardResponse(`${ID}는 응시일 기준입니다`, ids).ok).toBe(true);
  });
});
