import { describe, expect, test } from "vitest";
import { aiConfigured } from "@/lib/ai/client";
import { geminiClient, toGeminiSchema } from "@/lib/ai/gemini";

type Call = { url: string; headers: Record<string, string>; body: Record<string, any> };

function fakeGemini(responses: Record<string, unknown>[]) {
  const calls: Call[] = [];
  let i = 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(responses[Math.min(i++, responses.length - 1)]), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

const TOOLS = [
  {
    name: "finish",
    description: "끝낸다",
    input_schema: {
      type: "object",
      properties: { notice_url: { type: ["string", "null"] }, outcome: { type: "string", enum: ["a", "b"] }, items: { type: "array", items: { type: "object", properties: { q: { type: "string" } }, additionalProperties: false } } },
      required: ["outcome"],
      additionalProperties: false,
    },
  },
  { type: "web_search_20260209", name: "web_search", max_uses: 3 },
];

describe("toGeminiSchema: JSON Schema → Gemini 스키마", () => {
  test("additionalProperties를 빼고, null 허용 타입은 nullable로, 타입은 대문자로", () => {
    expect(toGeminiSchema(TOOLS[0].input_schema)).toEqual({
      type: "OBJECT",
      properties: {
        notice_url: { type: "STRING", nullable: true },
        outcome: { type: "STRING", enum: ["a", "b"] },
        items: { type: "ARRAY", items: { type: "OBJECT", properties: { q: { type: "STRING" } } } },
      },
      required: ["outcome"],
    });
  });
});

describe("geminiClient: Anthropic 모양의 요청·응답을 Gemini로 바꾼다", () => {
  test("요청: 시스템 문장, 함수 선언(서버 도구 제외), 역할, 도구 결과의 함수 이름", async () => {
    const { calls, fetchFn } = fakeGemini([{ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } }]);
    const client = geminiClient({ apiKey: "k", model: "gemini-flash-latest", fetchFn });
    await client.beta.messages.create({
      model: "ignored",
      max_tokens: 1000,
      system: "시스템",
      tools: TOOLS,
      messages: [
        { role: "user", content: "시작" },
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "open_page", input: { url: "https://a.go.kr" }, _gemini_sig: "SIG" }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "본문", is_error: true }, { type: "text", text: "더 하세요" }] },
      ],
    });
    const c = calls[0];
    expect(c.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    expect(c.headers["x-goog-api-key"]).toBe("k");
    expect(c.url).not.toContain("k=");
    expect(c.body.systemInstruction).toEqual({ parts: [{ text: "시스템" }] });
    expect(c.body.tools[0].functionDeclarations.map((f: { name: string }) => f.name)).toEqual(["finish"]);
    expect(c.body.contents).toEqual([
      { role: "user", parts: [{ text: "시작" }] },
      { role: "model", parts: [{ functionCall: { name: "open_page", args: { url: "https://a.go.kr" } }, thoughtSignature: "SIG" }] },
      { role: "user", parts: [{ functionResponse: { name: "open_page", response: { content: "본문", is_error: true } } }, { text: "더 하세요" }] },
    ]);
    expect(c.body.generationConfig.maxOutputTokens).toBe(1000);
  });

  test("응답: 함수 호출은 tool_use(서명 보존), 사용량, 멈춤 이유", async () => {
    const { fetchFn } = fakeGemini([
      {
        candidates: [{ content: { role: "model", parts: [{ text: "열어 볼게요" }, { functionCall: { name: "open_page", args: { url: "u" } }, thoughtSignature: "S1" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
      },
    ]);
    const r = await geminiClient({ apiKey: "k", model: "m", fetchFn }).beta.messages.create({ max_tokens: 10, messages: [{ role: "user", content: "x" }] });
    expect(r.stop_reason).toBe("tool_use");
    expect(r.usage).toMatchObject({ input_tokens: 100, output_tokens: 25 });
    expect(r.content[0]).toMatchObject({ type: "text", text: "열어 볼게요" });
    expect(r.content[1]).toMatchObject({ type: "tool_use", name: "open_page", input: { url: "u" }, _gemini_sig: "S1" });
  });

  test("안전 차단이면 refusal, 오류 응답이면 키 없이 예외", async () => {
    const { fetchFn } = fakeGemini([{ candidates: [{ finishReason: "SAFETY" }] }]);
    expect((await geminiClient({ apiKey: "k", model: "m", fetchFn }).beta.messages.create({ messages: [] })).stop_reason).toBe("refusal");
    const bad = (async () => new Response('{"error":{"message":"bad"}}', { status: 400 })) as unknown as typeof fetch;
    let tries = 0;
    const busy = (async () => (++tries < 3 ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }), { status: 200 }))) as unknown as typeof fetch;
    expect((await geminiClient({ apiKey: "k", model: "m", fetchFn: busy, retryDelayMs: 1 }).beta.messages.create({ messages: [] })).content[0]).toMatchObject({ text: "ok" });
    expect(tries).toBe(3);
    await expect(geminiClient({ apiKey: "secret-key", model: "m", fetchFn: bad }).beta.messages.create({ messages: [] })).rejects.toThrow(/Gemini 400/);
    await expect(geminiClient({ apiKey: "secret-key", model: "m", fetchFn: bad }).beta.messages.create({ messages: [] })).rejects.not.toThrow(/secret-key/);
  });
});

describe("aiConfigured: 제공자별 키", () => {
  test("gemini면 GEMINI_API_KEY, 아니면 ANTHROPIC_API_KEY", () => {
    expect(aiConfigured({ EXTERNAL_AI_ENABLED: "true", AI_PROVIDER: "gemini", GEMINI_API_KEY: "g" })).toBe(true);
    expect(aiConfigured({ EXTERNAL_AI_ENABLED: "true", AI_PROVIDER: "gemini", ANTHROPIC_API_KEY: "a" })).toBe(false);
    expect(aiConfigured({ EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "a" })).toBe(true);
    expect(aiConfigured({ EXTERNAL_AI_ENABLED: "false", AI_PROVIDER: "gemini", GEMINI_API_KEY: "g" })).toBe(false);
  });
});
