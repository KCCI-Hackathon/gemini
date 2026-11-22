// The server owns eligibility, dates, conflicts and recommendations. No model calls.
import { toKstDate } from "@/lib/date";
import type { Profile } from "@/lib/judge/types";
import { effectiveStatus } from "@/lib/judge/personal";
import { addDays, dayNumber } from "./dates";
import { EVENT_NAMES, type Card, type Choice, type Evaluation, type Offering, type Period, type PlanEvent, type PlannerInput, type Reason, type Stage } from "./types";

export type BaseVerdict = { availability: Card["availability"]; reasons: Reason[] };
export type BaseEvaluator = (offering: Offering, profile: Profile, date: string) => BaseVerdict;
export function profileAt(profile: Profile, events: PlanEvent[], date: string): Profile {
  const copy = structuredClone(profile);
  const status = effectiveStatus(copy);
  copy.events = copy.events.filter(e => e.status !== "scheduled");
  for (const event of [...events].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (event.date > date) continue;
    if (event.type === "relocation") copy.sigungu = event.sigungu!;
    if (event.type === "training_completion") status.delete("in_training");
    if (event.type === "employment") { status.delete("unemployed"); status.add("employed"); status.add("health_insured_employee"); }
    if (event.type === "business_registration") { status.delete("unemployed"); status.add("business_registered"); }
    if (event.type !== "relocation") copy.events.push({ type: event.type, date: event.date, status: "completed" });
  }
  copy.currentStatus = [...status];
  return copy;
}

export function buildStages(events: PlanEvent[], today: string): Stage[] {
  const groups = new Map<string, PlanEvent[]>();
  for (const e of events.filter(e => e.date > today)) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  const stages: Stage[] = [{ stageId: "current", label: "현재", start: today, endExclusive: null, eventIds: [] }];
  for (const [date, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const ids = group.map(e => e.id).sort();
    stages[stages.length - 1].endExclusive = date;
    stages.push({ stageId: ids.join("+"), label: group.map(e => `${EVENT_NAMES[e.type]} 후`).join(" · "), start: date, endExclusive: null, eventIds: ids });
  }
  return stages;
}

function fixtureVerdict(o: Offering, profile: Profile): BaseVerdict {
  const status = new Set<string>(profile.currentStatus);
  if (profile.events.some(e => e.type === "training_completion" && e.status !== "scheduled")) status.add("trained");
  const reasons: Reason[] = [];
  let availability: Card["availability"] = o.reviewed ? "eligible" : "needs_check";
  if (!o.reviewed) reasons.push({ code: "UNREVIEWED", message: "일부 조건 충족 · 공고 확인 필요" });
  for (const rule of o.rules) {
    const hit = rule.kind === "requires" ? !status.has(rule.key) : status.has(rule.key);
    if (!rule.reviewed) { if (availability !== "blocked") availability = "needs_check"; reasons.push({ code: "UNREVIEWED_RULE", message: "공고 조건의 검토가 필요해요", evidenceId: rule.evidenceId }); }
    else if (hit) { availability = "blocked"; reasons.push({ code: "STATUS", message: `${rule.key === "trained" ? "수료" : rule.key === "unemployed" ? "미취업" : rule.key === "employed" ? "재직" : rule.key === "in_training" ? "교육 수강" : "사업자등록"} ${rule.kind === "requires" ? "조건이 필요해요" : "상태에서는 신청할 수 없어요"}`, evidenceId: rule.evidenceId }); }
  }
  if (o.regions?.length && !o.regions.includes(profile.sigungu)) { availability = "blocked"; reasons.push({ code: "RESIDENCE", message: "해당 지역 거주 조건이 맞지 않아요" }); }
  return { availability, reasons };
}

const maxDate = (a: string, b: string | null) => b && b > a ? b : a;
const minEnd = (a: string | null, b: string | null) => a && b ? (a < b ? a : b) : a ?? b;
function overlaps(a: Period, b: Period): boolean { return (!a.end || b.start <= a.end) && (!b.end || a.start <= b.end); }
export function restrictionBetween(a: Offering, b: Offering): { blocked: boolean; uncertain: boolean; evidenceId?: string } {
  const rules = [...a.restrictions.filter(r => r.otherId === b.offeringId || r.otherId === b.policyId), ...b.restrictions.filter(r => r.direction === "both" && (r.otherId === a.offeringId || r.otherId === a.policyId))];
  let uncertain = false;
  for (const rule of rules) {
    if (!rule.reviewed) { uncertain = true; continue; }
    if (rule.action === "benefit" && (!rule.period || !rule.otherPeriod)) { uncertain = true; continue; }
    if (rule.action === "benefit" && !overlaps(rule.period!, rule.otherPeriod!)) continue;
    if (rule.action === "application" && a.official.start && b.official.start && !overlaps({ start: a.official.start, end: a.official.end }, { start: b.official.start, end: b.official.end })) continue;
    return { blocked: true, uncertain, evidenceId: rule.evidenceId };
  }
  return { blocked: false, uncertain };
}
export function sortCards(a: Card, b: Card): number {
  const ae = a.personalWindow?.end ?? a.official.end;
  const be = b.personalWindow?.end ?? b.official.end;
  return (ae === null ? 1 : 0) - (be === null ? 1 : 0) || (ae ?? "").localeCompare(be ?? "") || (a.personalWindow?.start ?? "9999").localeCompare(b.personalWindow?.start ?? "9999") || a.title.localeCompare(b.title, "ko") || a.offeringId.localeCompare(b.offeringId);
}

export function evaluatePlanner(profile: Profile, input: PlannerInput, catalog: Offering[], now: Date, baseEvaluator?: BaseEvaluator, extraBoundaries: string[] = []): Evaluation {
  const today = toKstDate(now);
  const events = input.events ?? profile.events.filter(e => e.status === "scheduled").map((e, i) => ({ ...e, status: "scheduled" as const, id: `legacy-${i}` }));
  const stages = buildStages(events, today);
  const activeProfile = (date: string) => profileAt(profile, events, date);
  const selected = new Map(input.choices.map(c => [c.offeringId, c.stageId]));
  const cards: Card[] = [];
  for (const o of catalog) {
    type Segment = { stageId: string; window: Period | null; verdict: BaseVerdict };
    const segments: Segment[] = [];
    for (const stage of stages) {
      const start = maxDate(stage.start, o.official.start);
      const end = minEnd(stage.endExclusive ? addDays(stage.endExclusive, -1) : null, o.official.end);
      const cuts = [start, ...extraBoundaries.filter(d => d > start && (!end || d <= end) && (!stage.endExclusive || d < stage.endExclusive))].sort();
      if ((end && start > end) || (stage.endExclusive && start >= stage.endExclusive)) {
        segments.push({ stageId: stage.stageId, window: null, verdict: { availability: "blocked", reasons: [{ code: "NO_OVERLAP", message: `${stage.endExclusive ?? stage.start} 일정과 ${o.official.start ?? "미정"} 접수 시작이 겹치지 않아요` }] } });
        continue;
      }
      for (let n = 0; n < cuts.length; n++) {
        const pieceEnd = n + 1 < cuts.length ? addDays(cuts[n + 1], -1) : end;
        let verdict = baseEvaluator ? baseEvaluator(o, activeProfile(cuts[n]), cuts[n]) : fixtureVerdict(o, activeProfile(cuts[n]));
        const muted = input.mutedKeys;
        const deferred = (muted.includes("residence") && o.regions?.length) || muted.includes("status");
        if (deferred) {
          // Turning a known condition off means unknown, never satisfied.
          const mutedCodes = [...(muted.includes("residence") ? ["RESIDENCE"] : []), ...(muted.includes("status") ? ["STATUS"] : [])];
          const reasons = verdict.reasons.filter(r => !mutedCodes.includes(r.code));
          verdict = { availability: reasons.length && verdict.availability === "blocked" ? "blocked" : "needs_check", reasons: [...reasons, { code: "MUTED_CONDITION", message: "꺼진 프로필 조건을 다시 확인해 주세요" }] };
        }
        segments.push({ stageId: stage.stageId, window: { start: cuts[n], end: pieceEnd }, verdict });
      }
    }
    for (const stage of stages) {
      const own = segments.filter(s => s.stageId === stage.stageId);
      const piece = own.find(s => s.window && s.verdict.availability !== "blocked") ?? own[0];
      const stageWindow = piece.window && piece.verdict.availability !== "blocked" ? { ...piece.window } : null;
      const personalWindow = stageWindow ? { ...stageWindow } : null;
      if (personalWindow) {
        const index = segments.indexOf(piece);
        for (let n = index + 1; n < segments.length; n++) {
          const next = segments[n];
          if (!personalWindow.end || !next.window || next.verdict.availability !== piece.verdict.availability || addDays(personalWindow.end, 1) !== next.window.start) break;
          personalWindow.end = next.window.end;
        }
      }
      const applicationWindows: Period[] = [];
      for (const segment of own) {
        if (!segment.window || segment.verdict.availability === "blocked") continue;
        const window = { ...segment.window };
        for (let n = segments.indexOf(segment) + 1; n < segments.length; n++) {
          const next = segments[n];
          if (!window.end || !next.window || next.verdict.availability !== segment.verdict.availability || addDays(window.end, 1) !== next.window.start) break;
          window.end = next.window.end;
        }
        if (!applicationWindows.some(w => w.start <= window.start && (w.end === null || (window.end !== null && w.end >= window.end)))) applicationWindows.push(window);
      }
      const officialClosed = !!o.official.end && (o.official.end < today || (o.official.end === today && !!o.official.closeAt && now >= new Date(`${today}T${o.official.closeAt}:00+09:00`)));
      let availability = officialClosed ? "blocked" as const : piece.verdict.availability;
      const reasons = [...piece.verdict.reasons];
      if (officialClosed) reasons.unshift({ code: "CLOSED", message: "공식 접수가 마감되었어요" });
      if ((o.official.kind === "budget" || o.official.kind === "unknown") && availability !== "blocked") { availability = "needs_check"; reasons.push({ code: "UNKNOWN_PERIOD", message: o.official.kind === "budget" ? "예산 소진 여부를 확인해 주세요" : "공고 마감을 확인해 주세요" }); }
      if (personalWindow?.end && o.official.end !== personalWindow.end) {
        const event = events.find(e => e.date === addDays(personalWindow!.end!, 1));
        if (event) reasons.push({ code: "BEFORE_EVENT", eventId: event.id, message: `${EVENT_NAMES[event.type]} 예정일 ${event.date} 전날까지`, evidenceId: o.rules[0]?.evidenceId });
      }
      const end = personalWindow?.end ?? null;
      const deadlineKind: Card["deadlineKind"] = officialClosed ? "closed" : o.official.kind === "budget" || o.official.kind === "unknown" || (!o.reviewed && end !== o.official.end) ? "unknown" : end ? (end === o.official.end ? "official" : "personal_estimate") : o.official.kind === "rolling" ? "rolling" : "unknown";
      cards.push({ ...o, verifyLabel: o.verifyLabel ?? null, stageId: stage.stageId, personalWindow, stageWindow, applicationWindows, deadlineKind, daysLeft: end && availability !== "blocked" && deadlineKind !== "unknown" && !officialClosed ? dayNumber(end) - dayNumber(today) : null, availability, reasons, selectedStageId: selected.get(o.offeringId) ?? null, otherStageIds: [], conflicts: [], canReplace: false });
    }
  }
  for (const card of cards) card.otherStageIds = cards.filter(c => c.offeringId === card.offeringId && c.stageId !== card.stageId && c.availability !== "blocked").map(c => c.stageId);
  const applyConflicts = (card: Card, choices: Choice[]) => {
    const clone = { ...card, reasons: [...card.reasons], evidence: [...card.evidence], conflicts: [] as string[] };
    const originallyAllowed = clone.availability !== "blocked";
    let actualConflict = false;
    for (const target of catalog) {
      if (target.offeringId === card.offeringId) continue;
      const actual = profile.participating.includes(target.policyId) || profile.participating.includes(target.offeringId);
      const chosen = choices.some(c => c.offeringId === target.offeringId);
      if (!actual && !chosen) continue;
      const relation = restrictionBetween(card, target);
      if (relation.blocked) {
        const supportingEvidence = target.evidence.find(e => e.evidenceId === relation.evidenceId);
        if (supportingEvidence && !clone.evidence.some(e => e.evidenceId === supportingEvidence.evidenceId)) clone.evidence.push(supportingEvidence);
        clone.availability = "blocked";
        if (actual) actualConflict = true; else clone.conflicts.push(target.offeringId);
        clone.reasons.unshift({ code: actual ? "PARTICIPATION_CONFLICT" : "DRAFT_CONFLICT", message: `${actual ? "현재 수혜 중인" : "계획에 담은"} ${target.title}과 중복 불가`, relatedOfferingId: target.offeringId, evidenceId: relation.evidenceId });
      } else if (relation.uncertain && clone.availability !== "blocked") { clone.availability = "needs_check"; clone.reasons.push({ code: "UNCERTAIN_RESTRICTION", message: `${target.title}과 수혜 기간·제한 근거 확인 필요` }); }
    }
    if (input.mutedKeys.includes("participation") && !actualConflict && clone.availability !== "blocked") { clone.availability = "needs_check"; clone.reasons.push({ code: "MUTED_PARTICIPATION", message: "수혜 조건을 꺼두어 추가 확인이 필요해요" }); }
    clone.canReplace = originallyAllowed && !actualConflict && clone.conflicts.length > 0;
    return clone;
  };
  const recommended: Choice[] = [];
  for (const stage of stages) {
    let count = 0;
    const options = cards.filter(c => c.stageId === stage.stageId).sort((a, b) => Number(b.category === input.preferredCategory && !input.mutedKeys.includes("interest")) - Number(a.category === input.preferredCategory && !input.mutedKeys.includes("interest")) || sortCards(a, b));
    for (const card of options) {
      if (count === 2) break;
      if (recommended.some(c => c.offeringId === card.offeringId) || applyConflicts(card, recommended).availability !== "eligible") continue;
      recommended.push({ offeringId: card.offeringId, stageId: card.stageId }); count++;
    }
  }
  const evaluated = cards.map(c => applyConflicts(c, input.choices)).sort(sortCards);
  const choiceWarnings = input.choices.flatMap(choice => {
    const card = evaluated.find(c => c.offeringId === choice.offeringId && c.stageId === choice.stageId);
    if (card?.availability === "eligible") return [];
    return [{ ...choice, title: card?.title ?? catalog.find(o => o.offeringId === choice.offeringId)?.title ?? `공고 조회 불가 (${choice.offeringId})`, message: card ? `${card.availability === "blocked" ? "현재 일정으로 신청 불가" : "확인 필요"} · ${card.reasons.map(r => r.message).join(" · ")}` : "시점 다시 선택 · 저장한 시점 또는 회차를 찾을 수 없어요", otherStageIds: card?.otherStageIds ?? [] }];
  });
  return { revision: input.revision, today, asOf: catalog[0]?.dataVersion === "fixture-1" ? "2026-11-19" : (catalog[0]?.dataVersion ?? today), evaluatedAt: now.toISOString(), dataVersion: catalog[0]?.dataVersion ?? "empty", demo: input.demoId === "pathfinder-demo-2026", stages, cards: evaluated, choiceWarnings, recommendations: recommended };
}
