import { addMonths, toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { hasOverlapIssue, loadOverlap, loadOverlapNotices } from "@/lib/data/overlap";
import { blocksParticipation, evaluateRules, type Benefit } from "@/lib/judge/overlap";
import { judgePolicy, type Profile } from "@/lib/judge";
import { categoryOf, policyNotice } from "@/lib/route/roadmap";
import { isDate } from "./dates";
import { evaluatePlanner, type BaseEvaluator, type DraftConflictEvaluator } from "./evaluate";
import { plannedFor, restrictionVerdict } from "./overlap-bridge";
import { hasOverlapLanguage } from "./eligibility";
import type { Evaluation, Offering, PlanEvent, PlannerInput } from "./types";

/**
 * 공고 데이터의 자리표시 날짜(예: "0001-01-01")는 "모름"이다. 날짜로 두면 저장 스키마가 평가 전체를 거부해
 * 실데이터로 만든 탭 초안과 저장 계획을 다시 열 수 없다. 읽는 경계에서 null 로 바꾸고, 마감이 없으면 기간 종류도 맞춘다.
 */
function officialPeriod(rolling: boolean, start: string | null | undefined, end: string | null | undefined, closeAt: string | null) {
  const date = (value: string | null | undefined) => value && isDate(value) ? value : null;
  const s = date(start), e = date(end);
  return { kind: rolling ? "rolling" as const : e ? "fixed" as const : "unknown" as const, start: s, end: e, closeAt };
}

export function backendDraftConflict(now: Date, benefits: Benefit[] = []): DraftConflictEvaluator {
  const approved = loadOverlap();
  return (card, chosen) => {
    const rules = approved.get(card.policyId)?.filter(rule => rule.target_round_id === null || rule.target_round_id === (card.roundId ?? null));
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
    const overlapRules = loadOverlap().get(p.id) ?? [];
    const overlapNotices = loadOverlapNotices(p.id);
    const restrictionText = [p.texts.addQualification, p.texts.excluded, p.texts.income, p.texts.support, p.texts.description,
      v?.notes, ...(v?.restrictionQuotes.map(q => q.text) ?? []), ...(v?.confirmedRelations.map(r => r.quote.text) ?? []),
      ...(v?.statusConditions.quotes.map(q => q.text) ?? []), ...(v?.rounds?.flatMap(r => r.conditions.map(c => c.quote.text)) ?? [])]
      .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const hasRestrictionLanguage = hasOverlapLanguage(restrictionText);
    return rounds.map(round => {
      const roundRules = overlapRules.filter(rule => rule.target_round_id === null || rule.target_round_id === (round?.id ?? null));
      const invalidRoundRule = overlapRules.some(rule => rule.target_round_id !== null && !v?.rounds?.some(item => item.id === rule.target_round_id));
      const missingSourcePolicy = overlapRules.some(rule => !policyMap.has(rule.source_policy_id));
      const overlapAssessment = hasOverlapIssue(p.id) || missingSourcePolicy || invalidRoundRule
        ? "unresolved" as const
        : roundRules.length
          ? "reviewed_rules" as const
          : overlapRules.length || overlapNotices.length || v?.restrictionQuotes.length || v?.confirmedRelations.length || hasRestrictionLanguage || !restrictionText
            ? "unresolved" as const
            : "no_restriction_found" as const;
      return {
      policyId: p.id, offeringId: `${p.id}:${round?.id ?? `${(v?.apply.start ?? p.applyStart ?? today).slice(0, 4)}-current`}`, roundId: round?.id ?? null, roundLabel: round?.notice.title ?? "현재 수집된 공고", title: v?.name ?? p.name,
      verifyLabel: policyNotice(p, v, round?.notice.applyStart ?? today).verifyLabel,
      category: categoryOf(p.category), summary: p.texts.description || p.texts.support, support: p.texts.support, org: p.supervisingOrg,
      official: officialPeriod(v?.apply.type === "always" || (!v && p.applyPeriodType === "always"), round ? round.notice.applyStart : v ? v.apply.start : p.applyStart, round ? round.notice.applyEnd : v ? v.apply.end : p.applyEnd, v?.apply.endTime ?? null),
      rules: [], regions: p.zipCodes, restrictions: (v?.confirmedRelations ?? []).flatMap(r => r.otherId ? [{ otherId: r.otherId, reviewed: true, action: "benefit" as const, direction: "both" as const, period: null, otherPeriod: null, evidenceId: `restriction:${p.id}:${r.otherId}` }] : []), overlapAssessment,
      reviewed: !!round && round.status === "approved" && round.conditions.every(c => !!c.supportsConfirmed), dataVersion: snapshot.asOf,
      evidence: [...(round?.conditions.map((c, i) => ({ evidenceId: `${round.id}:${i}`, title: round.notice.title, quote: c.quote.text, url: c.quote.url ?? round.notice.url, reviewedAt: c.supportsConfirmed?.at ?? round.notice.checkedAt, reviewed: !!c.supportsConfirmed })) ?? v?.statusConditions.quotes.map((q, i) => ({ evidenceId: `${p.id}:${i}`, title: v.name, quote: q.text, url: q.url ?? v.sources[0].url, reviewedAt: v.sources[0].checkedAt, reviewed: false })) ?? []), ...(v?.confirmedRelations.flatMap(r => r.otherId ? [{ evidenceId: `restriction:${p.id}:${r.otherId}`, title: `중복 수혜 제한 · ${r.otherName}`, quote: r.quote.text, url: r.quote.url ?? v.sources[0].url, reviewedAt: v.sources[0].checkedAt, reviewed: true }] : []) ?? [])],
    }; });
  });
  const baseEvaluator: BaseEvaluator = (o, atProfile, date) => {
    const p = policyMap.get(o.policyId)!;
    const v = verified.get(p.id);
    const axes = judgePolicy(p, v, atProfile, new Date(`${date}T12:00:00+09:00`));
    // 이력 기간 조건이 아직 남은 날짜는 막는다. 시점 경계(boundaries)로 기간이 지나는 날부터 다시 판정한다(J-9).
    // 입력 정보로 확인할 수 있는 코드 조건(나이 · 지역 · 상태 · 학력)을 모두 충족하면 공고와 대조하지 않았어도 신청 가능으로 본다.
    // 본문에 별도 자격 조건 · 소득 · 특화 조건이 있으면 judgePolicy 가 needs_check 로 올리므로 그대로 확인 필요가 된다.
    let availability = axes.personal.value === "ineligible" || axes.time.value === "unmet" ? "blocked" as const
      : axes.personal.value === "eligible" || axes.personal.value === "code_met_unreviewed" ? "eligible" as const : "needs_check" as const;
    const overlap = restrictionVerdict(axes.restriction.current_restrictions ?? [], p.id, "current");
    // 중복수혜 사유는 overlap 쪽에서 한 번만 보여 준다. judgePolicy 가 같은 사유를 personal 에도 넣으므로 뺀다(J-3).
    const overlapTexts = new Set((axes.restriction.current_restrictions ?? []).map(r => r.reason));
    const personalReasons = axes.personal.reasons.filter(message => message !== "중복수혜 제한 조건 확인 필요" && !overlapTexts.has(message));
    const reasons = [...personalReasons, ...(axes.fieldNotes ?? []), ...(axes.time.note ? [axes.time.note] : [])].map(message => ({ code: axes.time.value === "unmet" && (message === axes.time.note || message === "기간 경과 후 재검토") ? "PERIOD" : message.includes("지역") ? "RESIDENCE" : message.includes("취업") || message.includes("수강") ? "STATUS" : "BASE_CONDITION", message }));
    if (axes.personal.value === "code_met_unreviewed") reasons.unshift({ code: "UNREVIEWED", message: "입력 정보 기준 조건 충족 · 공고 본문 확인 권장" });
    if (axes.recruitment === "unknown" && availability !== "blocked") { availability = "needs_check"; reasons.push({ code: "UNKNOWN_RECRUITMENT", message: "최신 공고의 접수 기간 확인 필요" }); }
    if (availability !== "blocked" && overlap.availability) availability = overlap.availability;
    if (o.overlapAssessment === "unresolved" && availability !== "blocked") reasons.push({ code: "UNRESOLVED_OVERLAP", message: "중복수혜 문구 또는 적용 근거를 확인해 주세요" });
    return { ...overlap, availability, reasons: [...overlap.reasons, ...reasons] };
  };
  const boundaries = [...verified.values()].flatMap(v => v.lookback ? [...profile.events, ...(input.events ?? [])].filter(e => e.type === "training_completion" || e.type === "employment").map(e => addMonths(e.date, v.lookback!.months)) : []);
  const evaluation = evaluatePlanner(profile, input, catalog, now, baseEvaluator, [...new Set(boundaries)], {
    backendOverlap: true, draftConflict: backendDraftConflict(now, profile.benefits),
  });
  evaluation.asOf = snapshot.asOf;
  return evaluation;
}
