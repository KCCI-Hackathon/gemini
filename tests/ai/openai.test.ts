// G9: OpenAI 어댑터 — 도구 호출 요청 · 응답 변환 (실호출 없음)
import { expect, test, vi } from "vitest";
import { openaiClient, toOpenAiMessages } from "@/lib/ai/openai";
import { planAiConfigured, planModel, planProvider } from "@/lib/ai/client";
import { scrubPII, validateAnswer } from "@/lib/planner/counsel-target";

test("G9: Anthropic-shaped history becomes OpenAI messages with tool_calls and tool results", () => {
  const out = toOpenAiMessages("시스템", [
    { role: "user", content: "추천해줘" },
    { role: "assistant", content: [{ type: "text", text: "볼게요" }, { type: "tool_use", id: "c1", name: "get_evaluation", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "{\"cards\":[]}" }] },
  ]);
  expect(out).toEqual([
    { role: "system", content: "시스템" },
    { role: "user", content: "추천해줘" },
    { role: "assistant", content: "볼게요", tool_calls: [{ id: "c1", type: "function", function: { name: "get_evaluation", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "{\"cards\":[]}" },
  ]);
});

test("G9: request carries function tools, the configured model, and reasoning_effort none for Luna; response becomes tool_use blocks", async () => {
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("gpt-6-luna");
    expect(body.reasoning_effort).toBe("none");
    expect(body.tools[0]).toEqual({ type: "function", function: { name: "get_evaluation", description: "d", parameters: { type: "object", properties: {} } } });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: "x", function: { name: "finish_plan", arguments: "{\"summary\":\"s\",\"picks\":[]}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 3, completion_tokens: 4 } });
  });
  const client = openaiClient({ apiKey: "k", model: "gpt-6-luna", fetchFn: fetchFn as unknown as typeof fetch });
  const res = await client.beta.messages.create({ model: "x", max_tokens: 100, messages: [{ role: "user", content: "hi" }], tools: [{ name: "get_evaluation", description: "d", input_schema: { type: "object", properties: {} } }] } as never);
  expect(res.stop_reason).toBe("tool_use");
  expect(res.content).toEqual([{ type: "tool_use", id: "x", name: "finish_plan", input: { summary: "s", picks: [] } }]);
});

test("G9: non-Luna models don't get reasoning_effort; errors don't leak the key; 429 retries once then throws", async () => {
  let n = 0;
  const fetchFn = vi.fn(async (_u: string, init: RequestInit) => { n++; expect(JSON.parse(String(init.body)).reasoning_effort).toBeUndefined(); return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }); });
  const client = openaiClient({ apiKey: "secret-key", model: "gpt-6.1-terra", fetchFn: fetchFn as unknown as typeof fetch, retryDelayMs: 0 });
  await expect(client.beta.messages.create({ model: "x", max_tokens: 10, messages: [] } as never)).rejects.toThrow(/^OpenAI 429: rate limited$/);
  expect(n).toBe(2);
});

test("provider and model come only from env; recommend may use its own model; no code default", () => {
  expect(planProvider({ AI_PROVIDER: "gemini", PLAN_AI_PROVIDER: "openai" })).toBe("openai");
  expect(planModel({ OPENAI_MODEL: "a", OPENAI_RECOMMEND_MODEL: "b" }, "recommend")).toBe("b");
  expect(planModel({ OPENAI_MODEL: "a" }, "recommend")).toBe("a");
  expect(planAiConfigured({ EXTERNAL_AI_ENABLED: "true", PLAN_AI_PROVIDER: "openai", OPENAI_API_KEY: "k" })).toBe(false);
});

test("PII scrubbing keeps dates and policy ids, removes phone / RRN / email / account", () => {
  const r = scrubPII("010-1234-5678, 990101-1234567, a@b.co, 110-123-456789, 1234567890123, 2026-12-19, 20250122005400110346");
  expect(r.redacted).toBe(true);
  expect(r.text).toBe("[개인정보], [개인정보], [개인정보], [개인정보], [개인정보], 2026-12-19, 20250122005400110346");
  expect(scrubPII("수료는 12월 19일이에요").redacted).toBe(false);
});

test("answer validation (7.1): dates within 3 years, amounts 0..10,000,000 integers", () => {
  const today = "2026-11-22";
  expect(validateAnswer({ kind: "event", event: "employment" }, "2027-02-30", today).ok).toBe(false);
  expect(validateAnswer({ kind: "event", event: "employment" }, "2030-01-01", today).ok).toBe(false);
  expect(validateAnswer({ kind: "event", event: "employment" }, "2027-02-19", today).ok).toBe(true);
  const amount = { kind: "benefit" as const, policyId: "1".repeat(20), answer: "monthly_amount" as const, month: "2026-11" };
  expect(validateAnswer(amount, "-5", today).ok).toBe(false);
  expect(validateAnswer(amount, "20000000", today).ok).toBe(false);
  expect(validateAnswer(amount, "0", today).ok).toBe(true);
});
