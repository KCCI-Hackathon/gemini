import { loadOverlap } from "@/lib/data/overlap";
import { loadSnapshot } from "@/lib/data/snapshot";

export function GET() {
  const ids = new Set<string>();
  const amountIds = new Set<string>();
  for (const rules of loadOverlap().values()) {
    for (const rule of rules) {
      ids.add(rule.source_policy_id);
      const params = rule.condition_params ?? {};
      if (rule.condition_type === "receiving" && ("min_amount_won" in params || "payment_month" in params)) amountIds.add(rule.source_policy_id);
    }
  }
  const names = new Map(loadSnapshot().policies.map(policy => [policy.id, policy.name]));
  const sources = Array.from(ids, policyId => ({ policyId, name: names.get(policyId) ?? policyId, asksAmount: amountIds.has(policyId) }));
  return Response.json({ sources: sources.sort((a, b) => a.name.localeCompare(b.name, "ko")) });
}
