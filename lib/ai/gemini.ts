// Gemini 어댑터(로컬 gemini 브랜치 전용): 에이전트 코드가 쓰는 Anthropic 모양의 요청·응답을
// Gemini generateContent REST 호출로 바꾼다. 에이전트 루프·도구·검사 코드는 그대로 둔다.
// - 서버 도구(web_search)는 Gemini 함수 호출과 함께 쓸 수 없어 뺀다. 검색 없이 공식 링크로만 탐색한다.
// - Gemini가 함수 호출에 붙여 보낸 thoughtSignature는 다음 요청에 그대로 돌려줘야 해서 tool_use 블록에 보관한다.
import type { AnthropicLike } from "@/lib/verify/run";

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type Block = { type: string; [k: string]: unknown };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
type Part = Record<string, unknown>;

/** JSON Schema(도구 input_schema) → Gemini Schema. additionalProperties 제거, ["x","null"] → nullable, 타입은 대문자 */
export function toGeminiSchema(s: unknown): Record<string, unknown> {
  if (!s || typeof s !== "object") return {};
  const src = s as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let type = src.type;
  if (Array.isArray(type)) {
    const nonNull = type.filter((t) => t !== "null");
    if (nonNull.length < type.length) out.nullable = true;
    type = nonNull[0];
  }
  if (typeof type === "string") out.type = type.toUpperCase();
  if (typeof src.description === "string") out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum;
  if (src.properties && typeof src.properties === "object") {
    out.properties = Object.fromEntries(Object.entries(src.properties as Record<string, unknown>).map(([k, v]) => [k, toGeminiSchema(v)]));
  }
  if (src.items) out.items = toGeminiSchema(src.items);
  if (Array.isArray(src.required)) out.required = src.required;
  // 순서를 테스트와 같게: nullable은 type 뒤에
  if (out.nullable) {
    const { nullable, ...rest } = out;
    return { ...rest, nullable };
  }
  return out;
}

function toContents(messages: Msg[]): { role: string; parts: Part[] }[] {
  const names = new Map<string, string>();
  return messages.map((m) => {
    if (typeof m.content === "string") return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
    const parts: Part[] = [];
    for (const b of m.content) {
      if (b.type === "text") parts.push({ text: String(b.text ?? "") });
      else if (b.type === "tool_use") {
        names.set(String(b.id), String(b.name));
        parts.push({ functionCall: { name: b.name, args: b.input ?? {} }, ...(b._gemini_sig ? { thoughtSignature: b._gemini_sig } : {}) });
      } else if (b.type === "tool_result") {
        const content = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
        parts.push({ functionResponse: { name: names.get(String(b.tool_use_id)) ?? "tool", response: { content, ...(b.is_error ? { is_error: true } : {}) } } });
      }
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
}

export function geminiClient(opts: { apiKey: string; model: string; fetchFn?: typeof fetch; retryDelayMs?: number }): AnthropicLike {
  const fetchFn = opts.fetchFn ?? fetch;
  let n = 0;
  const create = async (params: Record<string, unknown>) => {
    const tools = ((params.tools as Record<string, unknown>[] | undefined) ?? []).filter((t) => t.input_schema);
    const body: Record<string, unknown> = {
      contents: toContents((params.messages as Msg[]) ?? []),
      // Gemini 3은 기본으로 오래 생각해 한 번에 1~5분이 걸린다. 에이전트 단계마다 생각을 짧게 한다
      generationConfig: { maxOutputTokens: Number(params.max_tokens ?? 8000), thinkingConfig: { thinkingLevel: "low" } },
    };
    if (typeof params.system === "string") body.systemInstruction = { parts: [{ text: params.system }] };
    if (tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description ?? "", parameters: toGeminiSchema(t.input_schema) })) }];

    // 과부하(429·503)는 잠시 뒤 두 번까지 다시 시도한다
    let res!: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetchFn(`${BASE}/${opts.model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
        body: JSON.stringify(body),
      });
      if (res.status !== 429 && res.status !== 503) break;
      if (attempt < 2) await new Promise((r) => setTimeout(r, (opts.retryDelayMs ?? 2000) * (attempt + 1)));
    }
    type GeminiResponse = {
      error?: { message?: string };
      candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const data = (await res.json().catch(() => ({}))) as GeminiResponse;
    // 오류 문구에 키가 들어가지 않게 상태와 메시지만
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${String(data?.error?.message ?? "").slice(0, 200)}`);

    const cand = data.candidates?.[0] ?? {};
    const finish = cand.finishReason ?? "";
    const parts: Part[] = cand.content?.parts ?? [];
    const content: Block[] = [];
    for (const p of parts) {
      if (p.thought) continue; // 생각 요약은 넘기지 않는다
      if (typeof p.text === "string" && p.text) content.push({ type: "text", text: p.text });
      if (p.functionCall) {
        const fc = p.functionCall as { name: string; args?: unknown };
        content.push({ type: "tool_use", id: `gm_${++n}`, name: fc.name, input: fc.args ?? {}, ...(p.thoughtSignature ? { _gemini_sig: p.thoughtSignature } : {}) });
      }
    }
    const refused = ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(finish) || !!data.promptFeedback?.blockReason;
    const u = data.usageMetadata ?? {};
    return {
      id: `gemini_${n}`,
      type: "message",
      role: "assistant",
      model: opts.model,
      content,
      stop_reason: refused ? "refusal" : content.some((b) => b.type === "tool_use") ? "tool_use" : finish === "MAX_TOKENS" ? "max_tokens" : "end_turn",
      usage: { input_tokens: u.promptTokenCount ?? 0, output_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) },
    };
  };
  return { beta: { messages: { create } } } as unknown as AnthropicLike;
}
