// 욕설 · 혐오 · 자해 관련 글 검사(설계 7.1). 보내기 전에 OpenAI Moderation API 로 검사한다.
// 실패하면 닫힌 쪽(보내지 않음)으로 처리하도록 호출하는 쪽이 { error } 를 받는다.
export type ModerationResult = { flagged: boolean; selfHarm: boolean } | { error: true };
export type Moderate = (text: string) => Promise<ModerationResult>;

export function openaiModeration(opts: { apiKey: string; model: string; fetchFn?: typeof fetch }): Moderate {
  const fetchFn = opts.fetchFn ?? fetch;
  return async (text) => {
    try {
      const res = await fetchFn("https://api.openai.com/v1/moderations", {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
        body: JSON.stringify({ model: opts.model, input: text }),
      });
      if (!res.ok) return { error: true };
      const data = (await res.json()) as { results?: { flagged?: boolean; categories?: Record<string, boolean> }[] };
      const r = data.results?.[0];
      if (!r) return { error: true };
      const c = r.categories ?? {};
      return { flagged: !!r.flagged, selfHarm: !!(c["self-harm"] || c["self-harm/intent"] || c["self-harm/instructions"]) };
    } catch { return { error: true }; }
  };
}
