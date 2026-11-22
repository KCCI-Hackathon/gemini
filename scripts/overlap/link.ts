import type { RawPolicy } from "@/lib/data/types";
import { looksLocalGov, sidoOfOrg } from "@/lib/data/regions";
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
// Only records with the same full title are the same program; parentheses often name a different sub-program.
const title = (p: RawPolicy) => p.plcyNm.replace(/\s/g, "");
const orgText = (p: RawPolicy) => [p.rgtrHghrkInstCdNm, p.sprvsnInstCdNm].filter(n => typeof n === "string").join(" ");
// Same-name records differ only by region and round: prefer B's region, then the latest national record.
// Another region's local record is never preferred over the model's own pick.
export function preferredRecord(records: RawPolicy[], b: RawPolicy, chosen: RawPolicy): RawPolicy {
  const sido = sidoOfOrg(orgText(b));
  const national = (p: RawPolicy) => {
    const org = String(p.sprvsnInstCdNm ?? "");
    return !looksLocalGov(org) && /^[가-힣]+(?:부|처|청|위원회)(?:\s|$)/.test(org);
  };
  const latest = (list: RawPolicy[]) => [...list].sort((x, y) => y.plcyNo.localeCompare(x.plcyNo))[0];
  const local = sido ? records.filter(p => sidoOfOrg(orgText(p)) === sido) : [];
  return latest(local) ?? latest(records.filter(national)) ?? chosen;
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
    // One slot per program title, so regional copies of one program cannot crowd out other programs.
    const byTitle = new Map<string, { policies: RawPolicy[]; score: number }>();
    for (const r of index) {
      if (r.name === own || !isNamedRound(mention, clause, r.policy, b)) continue;
      const score = r.name === name ? 1 : dice(ngrams, r.grams);
      if (!score) continue;
      const entry = byTitle.get(title(r.policy)) ?? { policies: [], score };
      entry.policies.push(r.policy); byTitle.set(title(r.policy), entry);
    }
    const candidates = [...byTitle.values()].map(e => ({ policy: preferredRecord(e.policies, b, e.policies[0]), score: e.score }))
      .sort((x, y) => y.score - x.score || y.policy.plcyNo.localeCompare(x.policy.plcyNo)).slice(0, 8).map(r => r.policy);
    if (candidates.length) pending.push({ link, candidates });
  }
  for (let start = 0; start < pending.length; start += 40) {
    const batch = pending.slice(start, start + 40);
    const input = batch.map(({ link, candidates }, i) => ({
      index: i + 1, b: { id: link.clause.b_policy_id, name: policies.get(link.clause.b_policy_id)!.plcyNm, org: policies.get(link.clause.b_policy_id)!.sprvsnInstCdNm },
      quote: link.clause.quote, mention: link.mention,
      candidates: candidates.map(p => ({ id: p.plcyNo, name: p.plcyNm, org: p.sprvsnInstCdNm, registry: p.rgtrHghrkInstCdNm, application: p.aplyYmd }))
    }));
    const prompt = "자료에 적힌 사업·기관·회차를 확인하세요. 동일한 사업이 후보에 있으면 하나를 고르세요. 이름이 비슷하기만 한 다른 사업은 고르지 마세요. 같은 이름이 여러 지역에 있으면 B와 같은 지역이나 전국 사업을 고르세요. 없거나 판단할 수 없으면 none. JSON 배열 [{index,policy_id}]만 답하세요.\n" + JSON.stringify(input);
    const saved = await ask({ stage: "link", pass: batch[0].link.clause.pass, repair: 0, prompt });
    indexedRows(saved.text, batch.length).forEach((row, i) => {
      const { link, candidates } = batch[i];
      link.link_hash = saved.hash;
      if (row.policy_id === "none") return;
      const chosen = candidates.find(p => p.plcyNo === row.policy_id);
      if (!chosen) {
        link.link_issue = "후보 밖 정책번호";
        return;
      }
      const group = groups.get(candidateName(chosen.plcyNm)) ?? [chosen];
      const b = policies.get(link.clause.b_policy_id)!, fits = orgMatches(link.mention.org, chosen);
      const picked = preferredRecord(group.filter(p => p === chosen || (title(p) === title(chosen) &&
        isNamedRound(link.mention, link.clause, p, b) && orgMatches(link.mention.org, p) === fits)), b, chosen);
      link.method = "ai"; link.a = picked.plcyNo; link.orgMatches = fits;
      link.a_group_ids = group.map(p => p.plcyNo).filter(id => id !== picked.plcyNo).sort();
    });
  }
  return result;
}
