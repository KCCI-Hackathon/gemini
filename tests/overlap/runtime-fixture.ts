import type { ApprovedRule } from "@/lib/data/overlap-schema";

export const SOURCE = "20250122005400110369";
export const TARGET = "20250122005400110346";
export function rule(patch: Partial<ApprovedRule> = {}): ApprovedRule {
  return {
    rule_id: "receive", source_policy_id: SOURCE, target_policy_id: TARGET,
    target_round_id: null, evidence_id: "ev", kind: "blocks", effect_type: "participation_block",
    condition_type: "receiving", condition_params: {}, reference_event: "apply_date",
    exception: null, judgement: "blocked", needs_check_reason: null,
    source: "research", model: null, run_id: null, restricted_item: null, period_text: null,
    verify_verdict: null, verify_quote: null, a_group_ids: [],
    evidence: { evidence_id: "ev", policy_id: TARGET, round_id: null, source_kind: "api",
      source_field: "ptcpPrpTrgtCn", source_url: null, quote_text: "구직급여를 받고 있거나", checked_at: "2026-11-19" },
    ...patch,
  };
}
