import { describe, expect, it, vi } from "vitest";
import snapshot from "@/data/snapshot/current.json";
import { batchFields, selectFields, selectRegion } from "@/scripts/overlap/select";
import { extract, extractPair } from "@/scripts/overlap/extract";
import { linkMentions } from "@/scripts/overlap/link";
import { verifyClaims } from "@/scripts/overlap/verify";
import { decide } from "@/scripts/overlap/decide";
import type { Ask, PublicField } from "@/scripts/overlap/types";

const b = "10000000000000000001", a = "10000000000000000002";
const model = "gemini-3.6-flash", other = "gemini-3-flash-preview";
const text = "○ 동시참여 불가\n  다른    사업 참여 중인 자\n○ 첨부 지침 참조";
const field: PublicField = { b_policy_id: b, name: "내 사업", field: "ptcpPrpTrgtCn", text };
const raw = { b_policy_id: b, field: field.field, kind: "blocks", quote: "다른 사업 참여 중인 자", mentions: [{ text: "다른 사업", org: null, type: "program" }], effect_type: "participation_block", condition_type: "receiving", condition_params: {}, exception: null, period_text: null, restricted_item: null };
const policies = [{ plcyNo: b, plcyNm: "내 사업", ptcpPrpTrgtCn: text, aplyPrdSeCd: "0057002" }, { plcyNo: a, plcyNm: "다른 사업" }];
const ask: Ask = async req => ({ model: req.model ?? model, hash: String(req.pass).repeat(64), text: JSON.stringify([raw]) });
const run = { run_id: "run", startedAt: "2026-11-20T10:00:00Z" };
describe("중복수혜 에이전트 단계", () => {
  it("자르지 않은 세 종류의 필드를 정책번호 순으로 보낸다", () => {
    const fields = selectFields(snapshot.records);
    expect(selectRegion(snapshot.records)).toHaveLength(1127);
    expect(["ptcpPrpTrgtCn", "addAplyQlfcCndCn", "plcySprtCn"].map(k => fields.filter(f => f.field === k).length)).toEqual([246, 447, 93]);
    expect(batchFields(fields).flat()).toEqual(fields);
    const long = { ...field, text: "자".repeat(6001) };
    expect(batchFields([field, long, field])).toEqual([[field], [long], [field]]);
  });
  it("공백을 원문으로 복구하고 다른 필드·없는 인용·누락된 일부 항목을 재질문한다", async () => {
    const invalid = [{ ...raw, quote: "없는 말" }, { ...raw, field: "plcySprtCn" }, { ...raw, kind: "partial" }];
    const post = vi.fn<Ask>(async req => ({ model, hash: String(req.repair), text: JSON.stringify([raw, ...invalid]) }));
    const out = await extract([field], 1, post);
    expect(post).toHaveBeenCalledTimes(2);
    expect(out.complete).toBe(false);
    expect(out.failures.length).toBeGreaterThanOrEqual(3);
    expect(out.clauses.map(c => c.quote)).toEqual(["다른    사업 참여 중인 자"]);
  });
  it("중간에 모델이 바뀐 묶음만 두 표를 같은 모델로 얻는다", async () => {
    const post = vi.fn<Ask>(async req => ({ model: req.pass === 2 ? other : req.model ?? model, hash: (req.model ?? model) + req.pass, text: JSON.stringify([raw]) }));
    const pair = await extractPair([field], post);
    expect(pair.map(x => x.model)).toEqual([other, other]);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it("정확한 단독 연결에는 모델 호출이 없고 일곱 조건을 만족해야 확정한다", async () => {
    const pair = await extractPair([field], ask), noCall = vi.fn<Ask>();
    const [first, second] = await Promise.all(pair.map(x => linkMentions(x.clauses, policies, noCall)));
    expect(noCall).not.toHaveBeenCalled();
    const checks = [...first, ...second].map(m => ({ claimId: m.id, counterexample: null, model, verdict: "supported" as const, verify_quote: m.clause.quote, reason: "원문 일치", validQuote: true, response_hash: "c".repeat(64) } as const));
    const result = decide(first, second, checks, policies, run);
    expect(result.rules.map(r => r.judgement)).toEqual(["blocked"]);
    expect(result.evidence[0].quote_text).toBe("다른    사업 참여 중인 자");
    expect(decide(first, [], checks, policies, run).rules[0].judgement).toBe("needs_check");
    expect(decide(first, second, [], policies, run).rules[0].judgement).toBe("needs_check");
  });
  it("검증 응답의 누락·중복 index는 전체 실행을 멈춘다", async () => {
    const post: Ask = async () => ({ model, hash: "c".repeat(64), text: '[{"index":1},{"index":1}]' });
    await expect(verifyClaims([], selectFields(snapshot.records), post)).rejects.toThrow();
  });
});
