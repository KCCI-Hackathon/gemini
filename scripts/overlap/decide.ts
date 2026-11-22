import type { ClauseRow, EvidenceRow, RuleRow } from "@/lib/data/overlap-schema";
import type { RawPolicy } from "@/lib/data/types";
import { toKstDate } from "@/lib/date";
import { normalizeSpace } from "@/lib/verify/web";
import { policyYears } from "./link";
import { isScanModel, reviewModel } from "./gemini";
import { digest, locate, type Clause, type LinkedMention, type Verification } from "./types";

export type RunContext = { run_id: string; startedAt: string };
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
function voteKey(m: LinkedMention) {
  const c = m.clause;
  return digest(c.b_policy_id, m.a, normalizeSpace(m.mention.text), m.mention.org, c.field, c.kind, c.effect_type, c.condition_type, canonical(c.condition_params),
    !!c.exception, c.kind === "partial" ? c.restricted_item : null);
}
function compatibleYear(a: RawPolicy, b: RawPolicy) {
  if ([a, b].some(p => String(p.aplyPrdSeCd).trim() === "0057002")) return true;
  const ay = policyYears(a), by = policyYears(b);
  return ay.size === 1 && by.size === 1 && [...ay][0] === [...by][0];
}

function contexts(text: string, quote: string) {
  const results: { heading: string; section: string; lines: string }[] = [];
  let offset = 0;
  while (offset < text.length) {
    const location = locate(text.slice(offset), quote);
    if (!location) break;
    const start = offset + location.start, end = offset + location.end;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = text.indexOf("\n", end);
    const lines = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const heading = [...text.slice(0, end).split("\n")].reverse().find(line => /^\s*["']?\s*[○□■]/.test(line)) ?? "";
    // A condition bullet (○) may belong to a named benefit section (□ or ■).
    const section = (text.slice(0, lineStart) + lines.split("\n")[0]).split("\n").reverse()
      .find(line => /^\s*["']?\s*[□■]/.test(line)) ?? "";
    results.push({
      heading: normalizeSpace(heading.replace(/^\s*["']/, "")),
      section: normalizeSpace(section.replace(/^\s*["']?\s*[□■]\s*/, "")),
      lines: normalizeSpace(lines),
    });
    offset = end;
  }
  return results;
}
const benefitTitle = /^[^:：]{0,40}(?:수당|장려금|지원금|보조금|바우처)\s*[:：]?$/;
function itemScopes(source: string, quote: string, policyName: string) {
  const normalizedName = normalizeSpace(policyName).replace(/\s/g, "");
  return contexts(source, quote).map(({ section }) => {
    const title = section.replace(/[:：]\s*$/, "").trim();
    return benefitTitle.test(section) && title.replace(/\s/g, "") !== normalizedName ? title : null;
  });
}
const referenceWords = /별표|첨부|공고문|지침|상세\s*내용/;
const timing = /\d+\s*(?:개?월|년|회(?:를|까지|째)|일(?:간|까지))|['’\u0060]\d{2}|(?:참여|수급|지급|가입|종료|수혜|신청|선정|이용)(?:한|하기|받은|한\s*날)?\s*(?:이전|이후|후|뒤|전에|전부터)|선후\s*관계/;
function periodOK(c: Clause, source: string): boolean {
  const items = contexts(source, c.quote);
  if (!items.length || new Set(items.map(v => v.heading + "|" + v.lines)).size !== 1) return false;
  const { heading, lines } = items[0];
  if (referenceWords.test(heading + " " + lines)) return false;
  const quote = normalizeSpace(c.quote);
  // Inspect the full alternative containing the quote, e.g. current receipt OR a post-payment interval.
  const parts = lines.split(/(?<=거나)\s+|\s+(?:또는|혹은)\s+/);
  const branch = parts.find(part => part.includes(quote)) ?? lines;
  const relevant = heading === lines ? branch : heading + " " + branch;
  if (!c.period_text) return c.condition_type !== "within_months_after_end" && !timing.test(relevant);
  const period = normalizeSpace(c.period_text);
  if (!normalizeSpace(heading + " " + lines).includes(period) || c.condition_type !== "within_months_after_end") return false;
  const relative = /(?:지급|수급)(?:이|가|을|의)?\s*(?:끝난|종료된|종료|종료한|끝나는)\s*(?:날|일)?\s*(?:부터|후|이후|로부터)\s*(\d+)\s*개월/;
  const parsed = relative.exec(period);
  if (!parsed || Number(parsed[1]) !== c.condition_params.months) return false;
  return !timing.test(period.replace(relative, "")) && !timing.test(relevant.replace(period, ""));
}
function candidateReason(m: LinkedMention) {
  const namedInQuote = normalizeSpace(m.clause.quote).includes(normalizeSpace(m.mention.text));
  return namedInQuote && m.method === "exact" && !m.a_group_ids.length && m.orgMatches && m.mention.type === "program" ? null : "사업 이름·기관이 단독으로 일치하는지 확인 필요";
}
export function needsReview(vote: LinkedMention, source?: string) {
  const c = vote.clause;
  if (c.kind === "allowed" || c.kind === "not_restriction") return false;
  return c.kind !== "partial" || !!candidateReason(vote) || !c.condition_type || !!c.exception ||
    !!c.period_text || (source !== undefined && !periodOK(c, source));
}

export function decide(first: LinkedMention[], second: LinkedMention[], checks: Verification[], region: RawPolicy[], run: RunContext, singleScan = false) {
  const rules = new Map<string, RuleRow>(), evidence = new Map<string, EvidenceRow>(), traces = new Map<string, ClauseRow>();
  const policies = new Map(region.map(p => [p.plcyNo, p]));
  const verified = new Map(checks.filter(c => !c.counterexample).map(c => [c.claimId, c]));
  const checkedAt = toKstDate(new Date(run.startedAt));
  const available = new Map<string, LinkedMention[]>();
  for (const m of second) {
    const key = voteKey(m), group = available.get(key) ?? [];
    group.push(m); available.set(key, group);
  }
  const pairs: [LinkedMention, LinkedMention?][] = [];
  for (const m of first) pairs.push([m, available.get(voteKey(m))?.shift()]);
  for (const group of available.values()) for (const m of group) pairs.push([m]);
  for (const [m, pair] of pairs) {
    const c = m.clause, b = policies.get(c.b_policy_id), a = m.a ? policies.get(m.a) : undefined;
    const isTraceOnly = !a || !b || m.a === c.b_policy_id || c.kind === "allowed" || c.kind === "not_restriction";
    const reasons = new Set<string>();
    const scopes = new Set<string | null>();
    let contradicted = false, hasBadQuote = false;
    for (const vote of pair ? [m, pair] : [m]) {
      const v = vote.clause, source = String(b?.[v.field] ?? ""), check = verified.get(vote.id);
      const quote = locate(source, v.quote), validVerify = !!(check?.validQuote && locate(source, check.verify_quote));
      if (!quote) {
        hasBadQuote = true;
        traces.set(vote.id, {
          clause_id: vote.id, run_id: run.run_id, b_policy_id: v.b_policy_id, field: v.field,
          pass: v.pass, response_hash: v.response_hash, valid_quote: false, error_location: "quote"
        });
        continue;
      }
      if (check?.verdict === "contradicted") contradicted = true;
      const nameReason = candidateReason(vote);
      if (nameReason) reasons.add(nameReason);
      if (!periodOK(v, source)) reasons.add("해당 항목의 기간·회차 또는 참조 공고 확인 필요");
      if (v.kind === "blocks" && b) {
        const items = itemScopes(source, v.quote, b.plcyNm);
        items.forEach(item => scopes.add(item));
        if (items.some(Boolean)) reasons.add("수당·지원 항목의 제한을 사업 전체에 적용할 수 있는지 확인 필요");
      }
      if (v.kind === "blocks" && /차감|차액|감액|중복\s*(신청\s*)?가능/.test(v.quote)) reasons.add("원문의 금액 조정·중복 가능 문구와 전체 제한이 일치하는지 확인 필요");
      if ((!check && vote === m) || (check && (check.verdict !== "supported" || !validVerify))) reasons.add("검증 근거가 불충분하거나 일치하지 않음");
      traces.set(vote.id, {
        clause_id: vote.id, run_id: run.run_id, b_policy_id: v.b_policy_id, field: v.field, pass: v.pass, response_hash: v.response_hash,
        quote: quote?.quote ?? null, valid_quote: !!quote, mention: vote.mention.text, mention_type: vote.mention.type, a: vote.a, method: vote.method,
        kind: v.kind, effect_type: v.effect_type, condition_type: v.condition_type, condition_params: v.condition_params, exception: v.exception,
        restricted_item: v.restricted_item, period_text: v.period_text, verdict: check?.verdict ?? null, verify_quote: validVerify ? check!.verify_quote : null,
        reason: check?.reason ?? null, link_hash: vote.link_hash, verify_hash: check?.response_hash ?? null, model: v.model,
      });
    }
    if (hasBadQuote || contradicted || isTraceOnly || !a || !b) continue;
    if (c.kind !== "blocks" || c.restricted_item || !["participation_block", "apply_block", "selection_excluded"].includes(c.effect_type ?? "")) {
      reasons.add(c.kind === "partial" ? "일부 지원 항목만 제한될 수 있음" : "전체 수혜 제한 여부 확인 필요");
    }
    if (!compatibleYear(a, b)) reasons.add("신청 연도 또는 모집 회차 확인 필요");
    if (singleScan) {
      if (!isScanModel(c.model) || verified.get(m.id)?.model !== reviewModel)
        reasons.add("지정된 독립 재검증 모델의 근거 확인 필요");
    } else if (!pair || m.clause.pass !== 1 || pair.clause.pass !== 2 || pair.clause.model !== c.model || pair.clause.response_hash === c.response_hash) {
      reasons.add("같은 모델의 독립된 두 추출이 일치하지 않음");
    }
    const judgement = reasons.size ? "needs_check" : "blocked", reason = [...reasons].join(" · ") || null;
    const item = c.restricted_item ?? (scopes.size === 1 ? [...scopes][0] : null);
    for (const v of pair ? [m, pair] : [m]) {
      const row = traces.get(v.id)!;
      row.judgement = judgement;
      if (item) row.restricted_item = item;
      if (reason) row.reason = reason;
    }
    const check = verified.get(m.id);
    const quote = locate(String(b[c.field]), c.quote)!.quote;
    const eid = "e-" + digest(b.plcyNo, c.field, quote);
    evidence.set(eid, { evidence_id: eid, policy_id: b.plcyNo, round_id: null, source_kind: "api", source_field: c.field, source_url: null, quote_text: quote, checked_at: checkedAt });
    const rid = "r-" + digest(a.plcyNo, eid, c.kind, c.effect_type, c.condition_type, canonical(c.condition_params), c.exception, item, c.period_text);
    const rule: RuleRow = {
      rule_id: rid, source_policy_id: a.plcyNo, target_policy_id: b.plcyNo, target_round_id: null, evidence_id: eid, kind: c.kind, effect_type: c.effect_type,
      condition_type: c.condition_type, condition_params: c.condition_params, reference_event: c.condition_type === "status_on_notice_date" ? "notice_date" : "apply_date", exception: c.exception,
      judgement, needs_check_reason: reason, source: "agent", model: c.model, run_id: run.run_id, restricted_item: item, period_text: c.period_text,
      verify_verdict: check?.verdict ?? null, verify_quote: traces.get(m.id)?.verify_quote ?? null, a_group_ids: m.a_group_ids,
    };
    // Preserve the more cautious conclusion when duplicate clauses describe the same rule.
    if (rules.get(rid)?.judgement !== "needs_check") rules.set(rid, rule);
  }
  return { rules: [...rules.values()], evidence: [...evidence.values()], clauses: [...traces.values()] };
}
