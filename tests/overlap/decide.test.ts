import { expect, it } from "vitest";
import snapshot from "@/data/snapshot/current.json";
import { decide } from "@/scripts/overlap/decide";
import { locate, type Clause, type LinkedMention, type Verification } from "@/scripts/overlap/types";
import type { RawPolicy } from "@/lib/data/types";
import { EvidenceRowSchema, RuleRowSchema, ClauseRowSchema } from "@/lib/data/overlap-schema";

const policies = snapshot.records as RawPolicy[];
const run = { run_id: "real-input-offline-test", startedAt: "2026-11-19T15:20:00Z" };
const bid = "20260406005400212442", aid = "20260406005400212410";
function votes(b = bid, a = aid, field: Clause["field"] = "ptcpPrpTrgtCn", quote = "인천 재직청년 복지포인트", change: Partial<Clause> = {}) {
  const policy = policies.find(p => p.plcyNo === b)!;
  const pos = locate(String(policy[field]), quote)!;
  const mention = { text: String(policies.find(p => p.plcyNo === a)!.plcyNm), org: null, type: "program" as const };
  return ([1, 2] as const).map((pass): LinkedMention => {
    const c: Clause = {
      ...pos, b_policy_id: b, field, pass, mentions: [mention], kind: "blocks", effect_type: "participation_block", condition_type: "receiving", condition_params: {},
      restricted_item: null, period_text: null, exception: null, model: "gemini-3.6-flash", response_hash: String(pass).repeat(64), ...change
    };
    return { id: "claim" + pass, clause: c, a, method: "exact", a_group_ids: [], orgMatches: true, mention, link_hash: null };
  });
}
const checks = (votes: LinkedMention[]): Verification[] => votes.map(v => ({ claimId: v.id, counterexample: null, verdict: "supported", reason: "공고 원문 일치", verify_quote: v.clause.quote, validQuote: true, model: v.clause.model, response_hash: "f".repeat(64) }));
function result(ms: LinkedMention[], v = checks(ms), region = policies) { return decide([ms[0]], ms.slice(1), v, region, run); }
it("실제 복지포인트 항목은 다른 제목의 공고문과 분리하고 스키마를 왕복한다", () => {
  const out = result(votes());
  expect(out.rules).toHaveLength(1);
  expect(RuleRowSchema.parse(out.rules[0]).judgement).toBe("blocked");
  expect(EvidenceRowSchema.parse(out.evidence[0]).checked_at).toBe("2026-11-20");
  out.clauses.forEach(c => ClauseRowSchema.parse(c));
});
it("같은 제목으로 반복된 원문에서 종료 후 정확히 6개월만 확정한다", () => {
  const q = "구직급여의 지급이 끝난 날부터 6개월이 지나지 아니한 자";
  const ms = votes("20250122005400110346", "20250122005400110369", "ptcpPrpTrgtCn", q, { condition_type: "within_months_after_end", period_text: "지급이 끝난 날부터 6개월", condition_params: { months: 6 } });
  expect(result(ms).rules[0].judgement).toBe("blocked");
  for (const params of [{ months: 5 }, { months: 6 }]) {
    const changed = ms.map(m => ({ ...m, clause: { ...m.clause, condition_params: params, period_text: params.months === 5 ? "지급이 끝난 날부터 6개월" : "6개월" } }));
    expect(result(changed).rules[0].judgement).toBe("needs_check");
  }
});
it("동명이인·AI 연결·기관·다른 모델·같은 해시·연도·참조어·검증 오류마다 보류한다", () => {
  for (const patch of [{ a_group_ids: ["20260710005400113256"] }, { method: "ai" as const }, { orgMatches: false }]) {
    const ms = votes(); Object.assign(ms[1], patch);
    expect(result(ms).rules[0].judgement).toBe("needs_check");
  }
  for (const patch of [{ model: "gemini-3-flash-preview" }, { response_hash: "1".repeat(64) }, { condition_type: "selected" }]) {
    const ms = votes(); Object.assign(ms[1].clause, patch);
    expect(result(ms).rules.every(r => r.judgement === "needs_check")).toBe(true);
  }
  const ms = votes(), cs = checks(ms);
  for (const change of [{ aplyYmd: "" }, { aplyYmd: "20250501 ~ 20250510" }, { plcyNm: "2025년 재직청년 복지포인트" }]) {
    const r = policies.map(p => p.plcyNo === aid ? { ...p, ...change } : p);
    expect(result(ms, cs, r).rules[0].judgement).toBe("needs_check");
  }
  for (const text of ["○ 상세내용 공고문 확인\n인천 재직청년 복지포인트", "○ 불가\n인천 재직청년 복지포인트\n○ 예외\n인천 재직청년 복지포인트"]) {
    const r = policies.map(p => p.plcyNo === bid ? { ...p, ptcpPrpTrgtCn: text } : p);
    expect(result(ms, cs, r).rules[0].judgement).toBe("needs_check");
  }
  const shortened=policies.map(p=>p.plcyNo===bid?{...p,ptcpPrpTrgtCn:"○ 중복제한\n인천 재직청년 복지포인트 지급 종료 후 12개월 이내"}:p);
  expect(result(ms,cs,shortened).rules[0].judgement).toBe("needs_check");
  expect(result(ms, cs.map(c => ({ ...c, verify_quote: "없는 인용" }))).rules[0].judgement).toBe("needs_check");
  expect(result(ms, cs.map(c => ({ ...c, verdict: "contradicted" }))).rules).toEqual([]);
});
it("부분 제한·허용·사업군·틀린 인용은 전체 차단으로 승격하지 않는다", () => {
  const partial = votes(bid, aid, "ptcpPrpTrgtCn", "인천 재직청년 복지포인트", { kind: "partial", restricted_item: "복지포인트", effect_type: "personal_payment_block" });
  expect(result(partial).rules[0]).toMatchObject({ judgement: "needs_check", restricted_item: "복지포인트" });
  for (const change of [{ kind: "allowed" as const }, { kind: "not_restriction" as const }, { quote: "원문에 없는 말" }]) {
    const ms = votes().map(m => ({ ...m, clause: { ...m.clause, ...change } })), out = result(ms);
    expect(out.rules).toEqual([]); expect(out.evidence).toEqual([]); expect(out.clauses).toHaveLength(2);
  }
  expect(result(votes().map(m => ({ ...m, a: null }))).rules).toEqual([]);
});
it("실제 인용에 없는 사업명과 차감 문구를 두 모델 응답이 전체 차단으로 읽어도 확정하지 않는다", () => {
  const ms = votes().map(m => ({ ...m, mention: { ...m.mention, text: "원문에 없는 사업" } }));
  expect(result(ms).rules[0].judgement).toBe("needs_check");
  const changed = votes("20260406005400212464", "20250617005400110952", "plcySprtCn", "전월(20일)에 지급한 주거급여를 차감하고 지급");
  changed.forEach(m => { m.mention.text = "주거급여"; });
  expect(result(changed).rules[0].judgement).toBe("needs_check");
});
