import { expect, it, vi } from "vitest";
import snapshot from "@/data/snapshot/current.json";
import { linkMentions, candidateName } from "@/scripts/overlap/link";
import { selectRegion } from "@/scripts/overlap/select";
import type { Ask, Clause } from "@/scripts/overlap/types";
const region = selectRegion(snapshot.records), b = "20260406005400212442";
function clause(text: string, change: Partial<Clause> = {}): Clause {
  return {
    b_policy_id: b, field: "ptcpPrpTrgtCn", pass: 1, model: "gemini-3.6-flash", response_hash: "a".repeat(64), mentions: [{ text, org: null, type: "program" }], quote: text, start: 0, end: text.length, occurrences: 1,
    kind: "blocks", effect_type: "participation_block", condition_type: "receiving", condition_params: {}, exception: null, restricted_item: null, period_text: null, ...change
  };
}
const choose = (id: string): Ask => async () => ({ model: "gemini-3.6-flash", hash: "c".repeat(64), text: JSON.stringify([{ index: 1, policy_id: id }]) });
it("정규화 충돌을 보존하고 모호한 이름은 AI가 골라도 exact가 아니다", async () => {
  const names = new Map<string, number>();
  region.forEach(p => { const k = candidateName(p.plcyNm); names.set(k, (names.get(k) ?? 0) + 1); });
  expect(names.size).toBe(974);
  expect([...names.values()].filter(n => n > 1).length).toBe(129);
  const name = "청년내일저축계좌", group = region.filter(p => candidateName(p.plcyNm) === name).map(p => p.plcyNo).sort();
  const current = "20260406005400212495";
  const [match] = await linkMentions([clause(name)], region, choose(current));
  expect(match).toMatchObject({ a: current, method: "ai", a_group_ids: group.filter(id => id !== current) });
  const short = await linkMentions([clause("재직청년 복지")], region, choose("20260406005400212410"));
  expect(short[0].method).toBe("ai");
});
it("법·사업군·본인·같은 안내는 연결하지 않는다", async () => {
  const ask = vi.fn<Ask>();
  for (const c of [clause("법", { mentions: [{ text: "법", org: null, type: "law" }] }), clause("사업군", { mentions: [{ text: "사업군", org: null, type: "category" }] }), clause("드림For 청년통장"), clause("인천시 청년월세 지원사업", { b_policy_id: "20260406005400212400" })]) {
    expect((await linkMentions([c], region, ask))[0].a).toBeNull();
  }
  expect(ask).not.toHaveBeenCalled();
});
it("없는 후보 및 2025년 B에서 2026년 장학금 연결은 거부한다", async () => {
  const c = clause("국가근로장학생", { b_policy_id: "20250516005400210832" });
  const ask = vi.fn<Ask>(choose("none"));
  expect((await linkMentions([c], region, ask))[0].a).toBeNull();
  if (ask.mock.calls.length) expect(ask.mock.calls[0][0].prompt).not.toContain("20260821005400113348");
  await expect(linkMentions([clause("복지포인트")], region, choose("10000000000000000000"))).rejects.toThrow(/후보 밖/);
});
