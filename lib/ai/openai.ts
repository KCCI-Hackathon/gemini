// OpenAI 어댑터(상담 · 추천 에이전트 전용): 에이전트 코드가 쓰는 Anthropic 모양의 요청 · 응답을
// OpenAI Chat Completions 함수 호출로 바꾼다. 에이전트 루프 · 도구 · 검사 코드는 공급자를 모른다.
// - 모델 ID 는 환경 변수로만 받는다(코드 기본값 없음). 별칭이 아니라 버전까지 고정한 ID 를 쓴다.
// - Luna 계열은 Chat Completions 에서 reasoning_effort "none" 일 때만 함수 호출을 지원한다(설계 6장).
import type { AiRequestOptions, AnthropicLike } from "@/lib/verify/run";
import { setTimeout as delay } from "node:timers/promises";

const URL = "https://api.openai.com/v1/chat/completions";
type Block = { type: string; [k: string]: unknown };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
type OpenAiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Anthropic 모양 메시지 → OpenAI 메시지. tool_result 는 role "tool" 메시지 여러 개로 펼친다. */
export function toOpenAiMessages(system: string | undefined, messages: Msg[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content } as OpenAiMessage); continue; }
    if (m.role === "assistant") {
      const text = m.content.filter(b => b.type === "text").map(b => String(b.text ?? "")).join("\n");
      const calls = m.content.filter(b => b.type === "tool_use").map(b => ({ id: String(b.id), type: "function" as const, function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
      out.push({ role: "assistant", content: text || null, ...(calls.length && { tool_calls: calls }) });
      continue;
    }
    const text = m.content.filter(b => b.type === "text").map(b => String(b.text ?? "")).join("\n");
    for (const b of m.content.filter(b => b.type === "tool_result")) {
      const content = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      out.push({ role: "tool", tool_call_id: String(b.tool_use_id), content: b.is_error ? `오류: ${content}` : content });
    }
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

export function openaiClient(opts: { apiKey: string; model: string; fetchFn?: typeof fetch; retryDelayMs?: number }): AnthropicLike {
  const fetchFn = opts.fetchFn ?? fetch;
  const create = async (params: Record<string, unknown>, request: AiRequestOptions = {}) => {
    const tools = ((params.tools as Record<string, unknown>[] | undefined) ?? []).filter(t => t.input_schema);
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: toOpenAiMessages(typeof params.system === "string" ? params.system : undefined, (params.messages as Msg[]) ?? []),
      max_completion_tokens: Number(params.max_tokens ?? 1500),
    };
    if (tools.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));
    if (/luna/i.test(opts.model)) body.reasoning_effort = "none";

    let res!: Response;
    const maxRetries = request.maxRetries ?? 1;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      request.signal?.throwIfAborted();
      res = await fetchFn(URL, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` }, body: JSON.stringify(body), signal: request.signal });
      if (res.status !== 429 && res.status !== 503) break;
      if (attempt < maxRetries) await delay((opts.retryDelayMs ?? 1500) * (attempt + 1), undefined, { signal: request.signal });
    }
    type Choice = { message?: { content?: string | null; refusal?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string };
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string }; choices?: Choice[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    request.signal?.throwIfAborted();
    // 오류 문구에 키가 들어가지 않게 상태와 메시지만
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${String(data?.error?.message ?? "").slice(0, 200)}`);
    const choice = data.choices?.[0] ?? {};
    const content: Block[] = [];
    if (choice.message?.content) content.push({ type: "text", text: choice.message.content });
    for (const call of choice.message?.tool_calls ?? []) {
      let input: unknown = {};
      try { input = JSON.parse(call.function.arguments || "{}"); } catch { input = { _invalid_json: call.function.arguments }; }
      content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
    }
    const refused = !!choice.message?.refusal || choice.finish_reason === "content_filter";
    return {
      id: `openai_${Date.now()}`, type: "message", role: "assistant", model: opts.model, content,
      stop_reason: refused ? "refusal" : content.some(b => b.type === "tool_use") ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
      usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
    };
  };
  return { beta: { messages: { create } } } as unknown as AnthropicLike;
}
