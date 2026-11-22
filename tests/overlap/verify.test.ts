import { expect, it, vi } from "vitest";
import snapshot from "@/data/snapshot/current.json";
import { verifyClaims } from "@/scripts/overlap/verify";
import { selectFields } from "@/scripts/overlap/select";
import type { Ask, LinkedMention } from "@/scripts/overlap/types";
const fields = selectFields(snapshot.records);
const model = "gemini-3.6-flash", alt = "gemini-3-flash-preview";
const f = fields.find(f => f.b_policy_id === "20260406005400212442" && f.field === "ptcpPrpTrgtCn")!;
function claims(n: number): LinkedMention[] {
  const mention = { text: "청년희망적금", org: null, type: "program" as const };
  return Array.from({ length: n }, (_, i) => ({
    id: "id" + i, a: null, method: "none", orgMatches: false, a_group_ids: [], link_hash: null, mention,
    clause: { b_policy_id: f.b_policy_id, field: f.field, quote: "청년희망적금", mentions: [mention], kind: "allowed", effect_type: null, condition_type: null, condition_params: {}, period_text: null, exception: null, restricted_item: null, start: 0, end: 0, occurrences: 1, model, pass: 1, response_hash: "a".repeat(64) }
  }));
}
it("검증 모델이 바뀌면 세 반례 모두 검증하고 반례 표지를 보내지 않는다", async () => {
  let i = 0;
  const ask = vi.fn<Ask>(async req => {
    expect(req.prompt).not.toMatch(/counterexample|synth|expected|response_hash/);
    const data = JSON.parse(req.prompt.slice(req.prompt.indexOf("\n") + 1)) as { assertions: { index: number; quote: string }[] };
    const picked = i++ === 0 ? model : alt;
    return { model: picked, hash: "b".repeat(64), text: JSON.stringify(data.assertions.map(c => ({ index: c.index, verdict: "contradicted", reason: "원문", evidence_quote: c.quote }))) };
  });
  const out = await verifyClaims(claims(39), fields, ask);
  expect(out.filter(c => !c.counterexample)).toHaveLength(39);
  for (const m of [model, alt]) {
    const controls = out.filter(c => c.counterexample && c.model === m);
    expect(new Set(controls.map(c => c.counterexample)).size).toBe(3);
    expect(controls.every(c => c.validQuote)).toBe(true);
  }
  expect(ask).toHaveBeenCalledTimes(3);
});
it("다른 필드 또는 지어낸 검증 인용은 채택하지 않는다", async () => {
  const ask: Ask = async () => ({ model, hash: "c".repeat(64), text: JSON.stringify([1, 2, 3].map(index => ({ index, verdict: "supported", reason: "원문", evidence_quote: "지어낸 인용" }))) });
  const out = await verifyClaims([], fields, ask);
  expect(out.every(c => !c.validQuote && !c.verify_quote)).toBe(true);
});
