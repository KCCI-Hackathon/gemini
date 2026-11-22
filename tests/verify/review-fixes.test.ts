// 최종 리뷰 I5·I6·I7·I9 재현 테스트
import { beforeEach, describe, expect, test } from "vitest";
import { handleVerify, resetVerifyState } from "@/lib/verify/handler";
import { runVerification, type AnthropicLike } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";
import { fakeFetch, scriptedClient } from "./helpers";

const NOW = new Date("2026-11-16T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const LUNCH = "20260921005400113480";
const BIO = "20260928005400113623";
const INCHEON_URL = "https://youth.incheon.go.kr/youthpolicy/youthPolicyInfoDetail.do?poly_seq=412";
const ATFIS = "https://www.atfis.or.kr/lunch";
const BIO_URL = "https://www.biocamp.kr/board/?tb_nm=notice&m_mode=view&menu=bbs&pds_no=2026011210245137526&category=";

const deps = (client: AnthropicLike, extraHosts: string[] = []) => ({ client, web: createWeb({ fetchFn: fakeFetch, extraHosts }), now: NOW });
const open = (url: string) => [{ name: "open_page", input: { url } }];
const judgeLunch = [{ name: "record_judgement", input: { url: ATFIS, verdict: "matching_notice", reason: "aT 점심밥", quote: "시범사업 수행 지자체" } }];
const finishLunch = [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: ATFIS, findings: [], mismatches: [] } }];

beforeEach(() => resetVerifyState());

describe("I5: 모델이 형식이 틀린 입력을 줘도 죽지 않는다", () => {
  test("quote가 빠진 발견·배열이 아닌 불일치는 버리고 끝낸다", async () => {
    const client = scriptedClient([
      open(INCHEON_URL),
      [{ name: "record_judgement", input: { url: INCHEON_URL, verdict: "matching_notice", reason: "일치", quote: "응시일 현재 미취업자" } }],
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: INCHEON_URL, findings: [{ kind: "age", text: "x" }, "문자열"], mismatches: "없음" } }],
    ]);
    const r = await runVerification(INCHEON, deps(client));
    expect(r.outcome).toBe("verified_against_notice");
    expect(r.findings).toEqual([]);
    expect(r.mismatches).toEqual([]);
  });

  test("알 수 없는 판단 값은 거부한다", async () => {
    const client = scriptedClient([
      open(INCHEON_URL),
      [{ name: "record_judgement", input: { url: INCHEON_URL, verdict: "looks_good", reason: "x" } }],
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: INCHEON_URL, findings: [], mismatches: [] } }],
      [{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }],
    ]);
    const r = await runVerification(INCHEON, deps(client));
    expect(r.outcome).toBe("notice_not_found");
    expect(r.trail.some((s) => s.action === "reject" && s.reason.includes("판단 값"))).toBe(true);
  });

  test("AI 호출이 실패하면 500이 아니라 502 JSON", async () => {
    const failing = { beta: { messages: { create: async () => { throw new Error("529 overloaded"); } } } } as unknown as AnthropicLike;
    const r = await handleVerify({ policyId: BIO }, { env: { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k" }, ip: "1.1.1.1", now: NOW, makeClient: () => failing, saved: {} });
    expect(r.status).toBe(502);
    expect(r.body.error).toBeTruthy();
  });
});

describe("I6: 한도에 닿아도 이미 찾은 공고는 버리지 않는다", () => {
  test("6번째 페이지를 공고로 판단한 뒤 7번째를 열려다 한도에 걸려도 finish할 수 있다", async () => {
    const client = scriptedClient([open(ATFIS), open(ATFIS), open(ATFIS), open(ATFIS), open(ATFIS), open(ATFIS), judgeLunch, open(ATFIS), finishLunch]);
    const r = await runVerification(LUNCH, deps(client));
    expect(r.outcome).toBe("verified_against_notice");
    expect(r.noticeUrl).toBe(ATFIS);
  });

  test("여섯 쪽을 열고 하나씩 판단해도 finish할 차례가 남는다", async () => {
    const turns = [];
    for (let i = 0; i < 6; i++) turns.push(open(ATFIS), judgeLunch);
    turns.push(finishLunch);
    const r = await runVerification(LUNCH, deps(scriptedClient(turns)));
    expect(r.outcome).toBe("verified_against_notice");
  });
});

describe("I7: 공고를 못 찾았으면 다른 페이지의 인용을 발견으로 내보내지 않는다", () => {
  test("notice_not_found면 findings는 빈다", async () => {
    const client = scriptedClient([
      open(BIO_URL),
      [{ name: "record_judgement", input: { url: BIO_URL, verdict: "different_program", reason: "하위 과정", quote: "의약바이오 취업캠프" } }],
      [{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [{ kind: "status_condition", text: "취업캠프 대상", quote: "의약바이오 취업캠프" }], mismatches: [] } }],
    ]);
    const r = await runVerification(BIO, deps(client, ["www.biocamp.kr"]));
    expect(r.outcome).toBe("notice_not_found");
    expect(r.findings).toEqual([]);
  });
});

describe("I9: 검색 3회와 시간 한도를 코드가 강제한다", () => {
  function searchingClient() {
    const requests: { tools: { name: string; max_uses?: number }[] }[] = [];
    let i = 0;
    const client = {
      requests,
      beta: {
        messages: {
          create: async (params: unknown) => {
            requests.push(JSON.parse(JSON.stringify(params)));
            i++;
            const search = (k: number) => ({ type: "server_tool_use", id: `st_${i}_${k}`, name: "web_search", input: { query: "q" } });
            const content = i <= 2 ? [search(0), search(1), { type: "tool_use", id: `tu_${i}`, name: "open_page", input: { url: ATFIS } }] : [{ type: "tool_use", id: `tu_${i}`, name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }];
            return { id: `m${i}`, role: "assistant", stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content };
          },
        },
      },
    };
    return client as unknown as AnthropicLike & { requests: typeof requests };
  }

  test("검색을 쓴 만큼 다음 요청의 한도를 줄이고, 다 쓰면 검색 도구를 뺀다", async () => {
    const client = searchingClient();
    await runVerification(LUNCH, { ...deps(client), enableSearch: true });
    const searchTool = (n: number) => client.requests[n].tools.find((t) => t.name === "web_search");
    expect(searchTool(0)?.max_uses).toBe(3);
    expect(searchTool(1)?.max_uses).toBe(1);
    expect(searchTool(2)).toBeUndefined();
  });

  test("시간 한도를 넘기면 더 부르지 않고 재시도할 수 있는 오류로 끝난다", async () => {
    const client = scriptedClient([open(ATFIS)]);
    let t = 0;
    await expect(runVerification(LUNCH, { ...deps(client), clock: () => (t += 25_000) })).rejects.toThrow("시간 한도");
    expect(client.calls).toBeLessThanOrEqual(3);
  });
});
