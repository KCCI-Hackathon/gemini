import bundle from "@/data/overlap/approved.json";
import manifest from "@/data/release/manifest.json";
import { ApprovedSchema, type ApprovedRule } from "./overlap-schema";

export function indexOverlap(input: unknown) {
  const approved = ApprovedSchema.parse(input);
  const rules = new Map<string, ApprovedRule[]>();
  const notices = new Map<string, string[]>();
  for (const row of approved.rules) {
    const rows = rules.get(row.target_policy_id);
    if (rows) rows.push(row);
    else rules.set(row.target_policy_id, [row]);
  }
  for (const { b, quote } of approved.notices ?? []) {
    const quotes = notices.get(b);
    if (!quotes) notices.set(b, [quote]);
    else if (!quotes.includes(quote)) quotes.push(quote);
  }
  return { rules, notices };
}
const index = indexOverlap(bundle);
export const loadOverlap = () => index.rules;
export const loadOverlapNotices = (policyId: string) => index.notices.get(policyId) ?? [];
export const overlapDataVersion = () => manifest.dataVersion;
