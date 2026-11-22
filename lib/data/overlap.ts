import bundle from "@/data/overlap/approved.json";
import manifest from "@/data/release/manifest.json";
import { ApprovedRuleSchema, ApprovedSchema, NoticeSchema, PolicyIdSchema, type ApprovedRule } from "./overlap-schema";

function addRule(rules: Map<string, ApprovedRule[]>, row: ApprovedRule) {
  const rows = rules.get(row.target_policy_id);
  if (rows) rows.push(row);
  else rules.set(row.target_policy_id, [row]);
}
function addNotice(notices: Map<string, string[]>, b: string, quote: string) {
  const quotes = notices.get(b);
  if (!quotes) notices.set(b, [quote]);
  else if (!quotes.includes(quote)) quotes.push(quote);
}

export function indexOverlap(input: unknown) {
  const approved = ApprovedSchema.parse(input);
  const rules = new Map<string, ApprovedRule[]>();
  const notices = new Map<string, string[]>();
  for (const row of approved.rules) addRule(rules, row);
  for (const { b, quote } of approved.notices ?? []) addNotice(notices, b, quote);
  return { rules, notices };
}
export function indexOverlapSafely(input: unknown) {
  const parsed = ApprovedSchema.safeParse(input);
  if (parsed.success) return { ...indexOverlap(parsed.data), invalidTargets: new Set<string>(), globalIssue: false };
  const rules = new Map<string, ApprovedRule[]>(), notices = new Map<string, string[]>(), invalidTargets = new Set<string>();
  const root = input && typeof input === "object" ? input as Record<string, unknown> : null;
  let globalIssue = !root || !ApprovedSchema.shape.snapshotId.safeParse(root.snapshotId).success || !Array.isArray(root.rules) || !Array.isArray(root.notices ?? []);
  for (const raw of Array.isArray(root?.rules) ? root.rules : []) {
    const row = ApprovedRuleSchema.safeParse(raw);
    if (row.success) { addRule(rules, row.data); continue; }
    const target = raw && typeof raw === "object" ? (raw as Record<string, unknown>).target_policy_id : undefined;
    if (typeof target === "string" && PolicyIdSchema.safeParse(target).success) invalidTargets.add(target);
    else globalIssue = true;
  }
  for (const raw of Array.isArray(root?.notices) ? root.notices : []) {
    const notice = NoticeSchema.safeParse(raw);
    if (notice.success) addNotice(notices, notice.data.b, notice.data.quote);
    else {
      const target = raw && typeof raw === "object" ? (raw as Record<string, unknown>).b : undefined;
      if (typeof target === "string" && PolicyIdSchema.safeParse(target).success) invalidTargets.add(target);
      else globalIssue = true;
    }
  }
  return { rules, notices, invalidTargets, globalIssue };
}
const index = indexOverlapSafely(bundle);
export const loadOverlap = () => index.rules;
export const loadOverlapNotices = (policyId: string) => index.notices.get(policyId) ?? [];
export const hasOverlapIssue = (policyId: string) => index.globalIssue || index.invalidTargets.has(policyId);
export const overlapDataVersion = () => manifest.dataVersion;
