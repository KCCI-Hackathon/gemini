import type { Field, Kind, Effect, Condition } from "@/lib/data/overlap-schema";
import { VerdictSchema } from "@/lib/data/overlap-schema";
import { indexedRows, locate, type Ask, type Counterexample, type LinkedMention, type ModelId, type PublicField, type Verification } from "./types";

type Claim = {
  id: string; counterexample: Counterexample | null; b: string; field: Field; quote: string; mention: string;
  org: string | null; kind: Kind; effect_type: Effect | null; condition_type: Condition | null;
  condition_params: Record<string, unknown>; exception: string | null; restricted_item: string | null; period_text: string | null;
};
const base = { org: null, kind: "blocks", condition_type: "receiving", condition_params: {}, exception: null, restricted_item: null, period_text: null } as const;
const controls: Claim[] = [
  { ...base, id: "deduction", counterexample: "deduction", b: "20260406005400212464", field: "plcySprtCn", quote: "전월(20일)에 지급한 주거급여를 차감하고 지급", mention: "주거급여", effect_type: "apply_block" },
  { ...base, id: "allowed", counterexample: "allowed", b: "20260406005400212442", field: "ptcpPrpTrgtCn", quote: "금융위원회 청년도약계좌, 청년희망적금", mention: "청년도약계좌", effect_type: "participation_block" },
  { ...base, id: "exception", counterexample: "exception", b: "20250122005400110346", field: "ptcpPrpTrgtCn", quote: "구직급여 수급자격을 갖춘 경우라도 구직급여를 수급하지 않으면 참여 가능", mention: "구직급여 수급자격", effect_type: "participation_block" },
];
const fieldKey = (id: string, f: Field) => id + "|" + f;
export async function verifyClaims(claims: LinkedMention[], fields: PublicField[], ask: Ask): Promise<Verification[]> {
  const source = new Map(fields.map(f => [fieldKey(f.b_policy_id, f.field), f]));
  for (const c of controls) {
    if (!locate(source.get(fieldKey(c.b, c.field))?.text ?? "", c.quote)) throw Error("반례 원문 불일치: " + c.id);
  }
  const all = claims.map(({ id, clause: c, mention }): Claim => ({
    id, counterexample: null, b: c.b_policy_id, field: c.field, quote: c.quote, mention: mention.text, org: mention.org,
    kind: c.kind, effect_type: c.effect_type, condition_type: c.condition_type, condition_params: c.condition_params,
    exception: c.exception, restricted_item: c.restricted_item, period_text: c.period_text,
  }));
  const output: Verification[] = [];
  const tested = new Set<ModelId>();
  let model: ModelId | undefined;
  async function send(real: Claim[], withControls: boolean, preferred?: ModelId) {
    const batch = (withControls ? [...real, ...controls] : [...real]).sort((a, b) => (a.b + a.quote).localeCompare(b.b + b.quote));
    const sources = [...new Set(batch.map(c => fieldKey(c.b, c.field)))].map(key => {
      const f = source.get(key);
      if (!f) throw Error("검증 원문 누락: " + key);
      return { b: f.b_policy_id, name: f.name, field: f.field, text: f.text };
    });
    const assertions = batch.map(({ id: _id, counterexample: _control, ...c }, i) => {
      void _id; void _control;
      return { index: i + 1, ...c };
    });
    const prompt = "다른 분석가의 판정을 독립 검토하십시오. 첨부한 공개 정책 원문만 근거로 사업과 조건·예외·효과·제한 항목 전체가 맞으면 supported, 반대이면 contradicted, 부족하면 insufficient입니다. 근거를 원문에서 그대로 복사하세요. JSON 배열 [{index,verdict,reason,evidence_quote}]를 빠짐없이 반환하세요.\n" + JSON.stringify({ sources, assertions });
    const saved = await ask({ stage: "verify", pass: 1, repair: 0, model: preferred, prompt });
    const rows = indexedRows(saved.text, batch.length);
    const checks = rows.map((r, i): Verification => {
      const c = batch[i], verdict = VerdictSchema.parse(r.verdict);
      if (typeof r.reason !== "string" || !r.reason.trim() || typeof r.evidence_quote !== "string") throw Error("검증 응답 필수 항목 누락: " + (i + 1));
      const matched = locate(source.get(fieldKey(c.b, c.field))!.text, r.evidence_quote);
      return {
        claimId: c.id, counterexample: c.counterexample, verdict, reason: r.reason.trim(), verify_quote: matched?.quote ?? "",
        validQuote: !!matched, model: saved.model, response_hash: saved.hash
      };
    });
    return { model: saved.model, checks };
  }
  for (let start = 0; start < Math.max(1, all.length); start += 37) {
    const batch = all.slice(start, start + 37);
    const include = model === undefined || !tested.has(model);
    let result = await send(batch, include, model);
    if (!include && !tested.has(result.model)) result = await send(batch, true, result.model);
    const previous = tested.has(result.model);
    output.push(...result.checks.filter(c => !c.counterexample || !previous));
    tested.add(result.model); model = result.model;
  }
  return output;
}
