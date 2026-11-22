import { z } from "zod";

export const FIELDS = ["ptcpPrpTrgtCn", "addAplyQlfcCndCn", "plcySprtCn"] as const;
export const KINDS = ["blocks", "partial", "history", "allowed", "org_decides", "not_restriction"] as const;
export const EFFECTS = ["participation_block", "personal_payment_block", "selection_excluded", "apply_block", "allowance_choice", "amount_deduction"] as const;
export const CONDITIONS = ["receiving", "within_months_after_end", "selected", "status_on_notice_date", "period_overlap"] as const;
export const VERDICTS = ["supported", "contradicted", "insufficient"] as const;
export const FieldSchema = z.enum(FIELDS);
export const KindSchema = z.enum(KINDS);
export const EffectSchema = z.enum(EFFECTS);
export const ConditionSchema = z.enum(CONDITIONS);
export const VerdictSchema = z.enum(VERDICTS);
export const JudgementSchema = z.enum(["blocked", "needs_check"]);
export type Field = z.infer<typeof FieldSchema>;
export type Kind = z.infer<typeof KindSchema>;
export type Effect = z.infer<typeof EffectSchema>;
export type Condition = z.infer<typeof ConditionSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type Judgement = z.infer<typeof JudgementSchema>;

export const PolicyIdSchema = z.string().regex(/^\d{20}$/);
const text = z.string().trim().min(1);
const quote = z.string().refine(s => s.trim().length > 0, "빈 인용");
const params = z.record(z.string(), z.unknown());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const url = z.httpUrl();

export const EvidenceRowSchema = z.strictObject({
  evidence_id: text, policy_id: PolicyIdSchema, round_id: text.nullable(),
  source_kind: z.enum(["api", "official"]), source_field: text.nullable(), source_url: url.nullable(),
  quote_text: quote, checked_at: z.iso.date(),
}).refine(e => e.source_kind === "api" ? !!e.source_field : !!e.source_url, "근거 출처 누락");
export type EvidenceRow = z.infer<typeof EvidenceRowSchema>;

export const RuleRowSchema = z.strictObject({
  rule_id: text, source_policy_id: PolicyIdSchema, target_policy_id: PolicyIdSchema, target_round_id: text.nullable(),
  evidence_id: text, kind: KindSchema, effect_type: EffectSchema.nullable(), condition_type: ConditionSchema.nullable(),
  condition_params: params, reference_event: text.nullable(), exception: quote.nullable(),
  judgement: JudgementSchema, needs_check_reason: text.nullable(), source: z.enum(["research", "agent"]),
  model: text.nullable(), run_id: text.nullable(), restricted_item: quote.nullable(), period_text: quote.nullable(),
  verify_verdict: VerdictSchema.nullable(), verify_quote: quote.nullable(), a_group_ids: z.array(PolicyIdSchema),
  research_basis: z.strictObject({source_row: text, url, conclusion: text}).optional(),
}).refine(r => r.source_policy_id !== r.target_policy_id, "자기 자신과의 규칙")
  .refine(r => r.source !== "agent" || (!!r.model && !!r.run_id), "에이전트 모델·실행 누락")
  .refine(r => r.source !== "research" || [r.model,r.run_id,r.verify_verdict,r.verify_quote].every(x=>x===null), "조사 규칙에 에이전트 실행 값이 있음")
  .refine(r => r.condition_params.months === undefined || (Number.isInteger(r.condition_params.months) && Number(r.condition_params.months)>0), "개월 수는 양의 정수")
  .refine(r => r.judgement !== "needs_check" || !!r.needs_check_reason, "확인 필요 사유 누락")
  .refine(r => r.kind !== "partial" || !!r.restricted_item, "제한 항목 누락")
  .refine(r => !["allowed", "not_restriction"].includes(r.kind), "허용·비제한 항목은 규칙으로 배포할 수 없음")
  .refine(r => r.source !== "agent" || r.judgement !== "blocked" || (r.kind === "blocks" && r.verify_verdict === "supported" && !!r.verify_quote && !r.a_group_ids.length), "검증되지 않은 에이전트 확정")
  .refine(r => new Set(r.a_group_ids).size === r.a_group_ids.length && !r.a_group_ids.includes(r.source_policy_id) && !r.a_group_ids.includes(r.target_policy_id), "잘못된 동명 그룹");
export type RuleRow = z.infer<typeof RuleRowSchema>;

export const ClauseRowSchema = z.strictObject({
  clause_id: text, run_id: text, b_policy_id: PolicyIdSchema, field: FieldSchema, pass: z.union([z.literal(1), z.literal(2)]), response_hash: hash,
  quote: quote.nullish(), mention: text.nullish(), a: PolicyIdSchema.nullish(), method: z.enum(["exact", "ai", "none"]).nullish(),
  kind: KindSchema.nullish(), effect_type: EffectSchema.nullish(), condition_type: ConditionSchema.nullish(), condition_params: params.nullish(),
  exception: quote.nullish(), restricted_item: quote.nullish(), period_text: quote.nullish(), verdict: VerdictSchema.nullish(),
  reason: text.nullish(), link_hash: hash.nullish(), verify_hash: hash.nullish(), model: text.nullish(), judgement: JudgementSchema.nullish(),
  mention_type: z.enum(["program", "category", "law"]).nullish(), valid_quote: z.boolean().nullish(),
  verify_quote: quote.nullish(), error_location: text.nullish(),
});
export type ClauseRow = z.infer<typeof ClauseRowSchema>;

export const CaseSchema = z.strictObject({
  b: PolicyIdSchema, a: PolicyIdSchema.optional(), mention: text.optional(), phrase: quote,
  condition: z.strictObject({type: ConditionSchema.nullable(), params, exception: z.boolean().optional()}).optional(),
  expect_kind: z.array(KindSchema).min(1), expect_effect: EffectSchema.optional(), expect_item: text.optional(),
  expect_link: z.literal("none").optional(), expect_judgement: JudgementSchema.optional(), source_row: text,
}).refine(c => !!c.a || !!c.mention, "A 또는 언급 필수");
export type Case = z.infer<typeof CaseSchema>;
export const ResearchSchema = z.strictObject({evidence: z.array(EvidenceRowSchema), rules: z.array(RuleRowSchema)});
export type Research = z.infer<typeof ResearchSchema>;
export const ApprovedRuleSchema = RuleRowSchema.safeExtend({evidence: EvidenceRowSchema})
  .refine(r => r.evidence_id === r.evidence.evidence_id && r.target_policy_id === r.evidence.policy_id, "규칙과 근거 불일치");
export type ApprovedRule = z.infer<typeof ApprovedRuleSchema>;
export const NoticeSchema = z.strictObject({b: PolicyIdSchema, field: FieldSchema, quote});
export const ApprovedSchema = z.strictObject({
  snapshotId: z.iso.date(), rules: z.array(ApprovedRuleSchema),
  notices: z.array(NoticeSchema).optional(),
});
export type Approved = z.infer<typeof ApprovedSchema>;
