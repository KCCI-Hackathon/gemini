import { addMonths, toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { loadOverlap } from "@/lib/data/overlap";
import { blocksParticipation, evaluateRules, type Benefit } from "@/lib/judge/overlap";
import { judgePolicy, type Profile } from "@/lib/judge";
import { categoryOf, policyNotice } from "@/lib/route/roadmap";
import { evaluatePlanner, type BaseEvaluator, type DraftConflictEvaluator } from "./evaluate";
import { plannedFor, restrictionVerdict } from "./overlap-bridge";
import { DEMO_PROFILE, demoCatalog } from "./fixtures";
import type { Evaluation, Offering, PlanEvent, PlannerInput } from "./types";

export function backendDraftConflict(now: Date, benefits: Benefit[] = []): DraftConflictEvaluator {
  const approved = loadOverlap();
  return (card, chosen) => {
    const rules = approved.get(card.policyId);
    if (!rules) return { blocked: false, uncertain: false, reasons: [], evidence: [], conflicts: [] };
    const { planned_conflicts } = evaluateRules(rules, benefits, plannedFor(card, chosen), now);
    const verdict = restrictionVerdict(planned_conflicts, card.policyId, "planned");
    const sources = new Set(planned_conflicts.filter(blocksParticipation).map(r => r.sourceId));
    return {
      blocked: verdict.availability === "blocked", uncertain: verdict.availability === "needs_check",
      reasons: verdict.reasons.map(r => r.code === "DRAFT_CONFLICT" ? { ...r, message: r.message + " · 예정 기간 기준" } : r),
      evidence: verdict.evidence,
      conflicts: chosen.filter(other => other.offeringId !== card.offeringId && sources.has(other.policyId)).map(other => other.offeringId),
    };
  };
}

export function evaluateRequest(profile: Profile, input: PlannerInput, now: Date, legacyPlan?: { employAfterMonths?: number | null; businessAfterMonths?: number | null; move?: { sigungu: string; afterMonths: number } | null }): Evaluation {
  if (input.demoId === "pathfinder-demo-2026") {
    // The fixed clock and synthetic catalog are selected by a server-owned demo ID,
    // never merely by the user-controlled profile.source marker.
    return evaluatePlanner({ ...structuredClone(DEMO_PROFILE), ...profile }, input, demoCatalog(), new Date("2026-11-19T12:00:00+09:00"));
  }
  const today = toKstDate(now);
  if (input.events === undefined) {
    const events: PlanEvent[] = profile.events.filter(e => e.status === "scheduled" && e.type !== "relocation").map((e, i) => ({ ...e, id: `legacy-${i}`, status: "scheduled" }));
    const base = events.find(e => e.type === "training_completion")?.date ?? today;
    if (legacyPlan?.employAfterMonths != null && !events.some(e => e.type === "employment")) events.push({ id: "legacy-employment", type: "employment", date: addMonths(base, legacyPlan.employAfterMonths), status: "scheduled" });
    if (legacyPlan?.businessAfterMonths != null && !events.some(e => e.type === "business_registration")) events.push({ id: "legacy-business", type: "business_registration", date: addMonths(base, legacyPlan.businessAfterMonths), status: "scheduled" });
    if (legacyPlan?.move) events.push({ id: "legacy-move", type: "relocation", date: addMonths(today, legacyPlan.move.afterMonths), sigungu: legacyPlan.move.sigungu, status: "scheduled" });
    input = { ...input, events };
  }
  const snapshot = loadSnapshot();
  const verified = loadVerified();
  const regions = new Set([profile.sigungu, ...(input.events ?? []).flatMap(e => e.sigungu ? [e.sigungu] : [])]);
  const policies = snapshot.policies.filter(p => verified.has(p.id) || (p.applyPeriodType !== "closed" && p.zipCodes.some(c => regions.has(c)) && !/컨소시엄|조성|센터|조사|위원회|인프라|협의체/.test(p.name)));
  const policyMap = new Map(policies.map(p => [p.id, p]));
  const catalog: Offering[] = policies.flatMap(p => {
    const v = verified.get(p.id);
    const rounds = v?.rounds?.length ? v.rounds : [null];
    return rounds.map(round => ({
      policyId: p.id, offeringId: `${p.id}:${round?.id ?? `${(v?.apply.start ?? p.applyStart ?? today).slice(0, 4)}-current`}`, roundLabel: round?.notice.title ?? "현재 수집된 공고", title: v?.name ?? p.name,
      verifyLabel: policyNotice(p, v, round?.notice.applyStart ?? today).verifyLabel,
      category: categoryOf(p.category), summary: p.texts.description || p.texts.support, support: p.texts.support, org: p.supervisingOrg,
      official: { kind: v?.apply.type === "always" || (!v && p.applyPeriodType === "always") ? "rolling" as const : (round?.notice.applyEnd ?? v?.apply.end ?? p.applyEnd) ? "fixed" as const : "unknown" as const, start: round ? round.notice.applyStart : v ? v.apply.start : p.applyStart, end: round ? round.notice.applyEnd : v ? v.apply.end : p.applyEnd, closeAt: v?.apply.endTime ?? null },
      rules: [], regions: p.zipCodes, restrictions: (v?.confirmedRelations ?? []).flatMap(r => r.otherId ? [{ otherId: r.otherId, reviewed: true, action: "benefit" as const, direction: "both" as const, period: null, otherPeriod: null, evidenceId: `restriction:${p.id}:${r.otherId}` }] : []),
      reviewed: !!round && round.status === "approved" && round.conditions.every(c => !!c.supportsConfirmed), dataVersion: snapshot.asOf,
      evidence: [...(round?.conditions.map((c, i) => ({ evidenceId: `${round.id}:${i}`, title: round.notice.title, quote: c.quote.text, url: c.quote.url ?? round.notice.url, reviewedAt: c.supportsConfirmed?.at ?? round.notice.checkedAt, reviewed: !!c.supportsConfirmed })) ?? v?.statusConditions.quotes.map((q, i) => ({ evidenceId: `${p.id}:${i}`, title: v.name, quote: q.text, url: q.url ?? v.sources[0].url, reviewedAt: v.sources[0].checkedAt, reviewed: false })) ?? []), ...(v?.confirmedRelations.flatMap(r => r.otherId ? [{ evidenceId: `restriction:${p.id}:${r.otherId}`, title: `중복 수혜 제한 · ${r.otherName}`, quote: r.quote.text, url: r.quote.url ?? v.sources[0].url, reviewedAt: v.sources[0].checkedAt, reviewed: true }] : []) ?? [])],
    }));
  });
  const baseEvaluator: BaseEvaluator = (o, atProfile, date) => {
    const p = policyMap.get(o.policyId)!;
    const v = verified.get(p.id);
    const axes = judgePolicy(p, v, atProfile, new Date(`${date}T12:00:00+09:00`));
    let availability = axes.personal.value === "ineligible" ? "blocked" as const : axes.personal.value === "eligible" ? "eligible" as const : "needs_check" as const;
    const overlap = restrictionVerdict(axes.restriction.current_restrictions ?? [], p.id, "current");
    const personalReasons = axes.personal.reasons.filter(message => message !== "중복수혜 제한 조건 확인 필요");
    const reasons = [...personalReasons, ...(axes.fieldNotes ?? []), ...(axes.time.note ? [axes.time.note] : [])].map(message => ({ code: message.includes("지역") ? "RESIDENCE" : message.includes("취업") || message.includes("수강") ? "STATUS" : "BASE_CONDITION", message }));
    if (axes.personal.value === "code_met_unreviewed") reasons.unshift({ code: "UNREVIEWED", message: "일부 조건 충족 · 공고 확인 필요" });
    if (axes.recruitment === "unknown" && availability !== "blocked") { availability = "needs_check"; reasons.push({ code: "UNKNOWN_RECRUITMENT", message: "최신 공고의 접수 기간 확인 필요" }); }
    if (availability !== "blocked" && overlap.availability) availability = overlap.availability;
    return { ...overlap, availability, reasons: [...overlap.reasons, ...reasons] };
  };
  const boundaries = [...verified.values()].flatMap(v => v.lookback ? [...profile.events, ...(input.events ?? [])].filter(e => e.type === "training_completion" || e.type === "employment").map(e => addMonths(e.date, v.lookback!.months)) : []);
  const evaluation = evaluatePlanner(profile, input, catalog, now, baseEvaluator, [...new Set(boundaries)], {
    backendOverlap: true, draftConflict: backendDraftConflict(now, profile.benefits),
  });
  evaluation.asOf = snapshot.asOf;
  return evaluation;
}
