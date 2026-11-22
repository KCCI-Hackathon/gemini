import type { RawPolicy } from "@/lib/data/types";
import { normalizeSpace } from "@/lib/verify/web";
import { digest, indexedRows, type Ask, type Clause, type LinkedMention, type Mention } from "./types";

export function candidateName(value: string): string {
  return normalizeSpace(value).replace(/^\d{4}년\s*/, "").replace(/\([^)]*\)|\[[^\]]*\]|[「」'"]/g, "").replace(/[\s·.,-]/g, "");
}
function grams(name: string) {
  const set = new Set<string>();
  for (let i = 1; i < name.length; i++) set.add(name.slice(i - 1, i + 1));
  return set;
}
function dice(a: Set<string>, b: Set<string>) {
  let common = 0;
  for (const x of a) if (b.has(x)) common++;
  return common ? 2 * common / (a.size + b.size) : 0;
}
function explicitYear(text: string): Set<number> {
  return new Set([...text.matchAll(/(?:(?<!\d)(20\d\d)(?!\d)|['’\u0060](\d\d)|(?:^|\s)(\d\d)(?=년))/g)].map(m => m[1] ? Number(m[1]) : 2000 + Number(m[2] ?? m[3])));
}
export function policyYears(p: RawPolicy) {
  const dates = [...String(p.aplyYmd ?? "").matchAll(/(20\d\d)(?:[.-]?\d{2}){2}/g)].map(m => Number(m[1]));
  return new Set([...dates, ...explicitYear(p.plcyNm)]);
}
function isNamedRound(mention: Mention, clause: Clause, p: RawPolicy, target: RawPolicy): boolean {
  const years = explicitYear(mention.text + " " + (clause.period_text ?? ""));
  const actual = policyYears(p);
  if (years.size) return !actual.size || [...years].some(y => actual.has(y));
  if ([p, target].some(r => String(r.aplyPrdSeCd).trim() === "0057002")) return true;
  const current = policyYears(target);
  return !current.size || !actual.size || [...current].some(y => actual.has(y));
}
function orgMatches(org: string | null, policy: RawPolicy): boolean {
  if (!org) return true;
  const compact = (s: string) => s.replace(/\s/g, "");
  const names = [policy.sprvsnInstCdNm, policy.rgtrHghrkInstCdNm];
  return names.some(n => typeof n === "string" && compact(n).includes(compact(org)));
}
export async function linkMentions(clauses: Clause[], region: RawPolicy[], ask: Ask): Promise<LinkedMention[]> {
  const policies = new Map(region.map(p => [p.plcyNo, p]));
  const groups = new Map<string, RawPolicy[]>();
  const index = region.map(policy => {
    const name = candidateName(policy.plcyNm);
    const group = groups.get(name) ?? [];
    group.push(policy); groups.set(name, group);
    return { policy, name, grams: grams(name) };
  });
  const result: LinkedMention[] = [];
  type Pending = { link: LinkedMention; candidates: RawPolicy[] };
  const pending: Pending[] = [];
  for (const clause of clauses) for (const [indexInClause, mention] of clause.mentions.entries()) {
    const id = digest(clause.response_hash, clause.pass, clause.b_policy_id, clause.field, clause.start, clause.kind, clause.effect_type, clause.condition_type, clause.condition_params, clause.restricted_item, clause.exception, clause.period_text, mention, indexInClause);
    const link: LinkedMention = { id, clause, mention, a: null, method: "none", a_group_ids: [], orgMatches: false, link_hash: null };
    result.push(link);
    if (mention.type !== "program") continue;
    const name = candidateName(mention.text);
    const b = policies.get(clause.b_policy_id);
    if (!b) throw Error("지역 밖 B: " + clause.b_policy_id);
    const own = candidateName(b.plcyNm);
    if (!name || name === own) continue;
    const group = groups.get(name) ?? [];
    const exact = group.length === 1 && group[0];
    if (exact && normalizeSpace(exact.plcyNm) === normalizeSpace(mention.text) && orgMatches(mention.org, exact) && isNamedRound(mention, clause, exact, b)) {
      Object.assign(link, { a: exact.plcyNo, method: "exact", orgMatches: true }); continue;
    }
    const ngrams = grams(name);
    const candidates = index.filter(r => r.name !== own && isNamedRound(mention, clause, r.policy, b))
      .map(r => ({ policy: r.policy, score: r.name === name ? 1 : dice(ngrams, r.grams) }))
      .filter(r => r.score > 0).sort((a, b) => b.score - a.score || a.policy.plcyNo.localeCompare(b.policy.plcyNo)).slice(0, 5).map(r => r.policy);
    if (candidates.length) pending.push({ link, candidates });
  }
  for (let start = 0; start < pending.length; start += 40) {
    const batch = pending.slice(start, start + 40);
    const input = batch.map(({ link, candidates }, i) => ({
      index: i + 1, b: link.clause.b_policy_id, quote: link.clause.quote, mention: link.mention,
      candidates: candidates.map(p => ({ id: p.plcyNo, name: p.plcyNm, org: p.sprvsnInstCdNm, registry: p.rgtrHghrkInstCdNm, application: p.aplyYmd }))
    }));
    const prompt = "자료에 적힌 사업·기관·회차를 확인하세요. 동일한 사업이 후보에 있으면 하나를 고르고 없거나 판단할 수 없으면 none. JSON 배열 [{index,policy_id}]만 답하세요.\n" + JSON.stringify(input);
    const saved = await ask({ stage: "link", pass: batch[0].link.clause.pass, repair: 0, prompt });
    indexedRows(saved.text, batch.length).forEach((row, i) => {
      const { link, candidates } = batch[i];
      link.link_hash = saved.hash;
      if (row.policy_id === "none") return;
      const picked = candidates.find(p => p.plcyNo === row.policy_id);
      if (!picked) {
        link.link_issue = "후보 밖 정책번호";
        return;
      }
      link.method = "ai"; link.a = picked.plcyNo; link.orgMatches = orgMatches(link.mention.org, picked);
      link.a_group_ids = (groups.get(candidateName(picked.plcyNm)) ?? []).map(p => p.plcyNo).filter(id => id !== picked.plcyNo).sort();
    });
  }
  return result;
}
