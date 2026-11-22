import { fieldCheckEffect } from "@/lib/verify/downgrade";
import { savedResult, VERIFY_RECHECK } from "@/lib/verify/saved";
import { isOpenAt, monthsBetween, toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadOverlap, loadOverlapNotices } from "@/lib/data/overlap";
import type { Policy } from "@/lib/data/types";
import { loadVerified, type VerifiedPolicy } from "@/lib/data/verified";
import { loadDeadLinks } from "@/lib/data/dead-links";
import { effectiveStatus, judgePersonal } from "./personal";
import { blocksParticipation, evaluateRules } from "./overlap";
import { pickRound } from "./rules";
import { REASON, type Axes, type JudgeOpts, type Layer, type Profile } from "./types";

export * from "./types";

function recruitment(p: Policy, v: VerifiedPolicy | undefined, now: Date): Axes["recruitment"] {
  if (v) {
    if (v.rounds?.length) {
      const today = toKstDate(now);
      const pick = pickRound(v.rounds, today);
      if (pick.state === "under_review" && !pick.round) return "unknown";
      if (pick.state !== "outside" && pick.round) {
        const { applyStart, applyEnd } = pick.round.notice;
        if (v.apply.type === "always" && !applyStart && !applyEnd) return "always";
        // 정책의 마감 시각은 동일 신청 기간에만 적용한다.
        const endTime = v.apply.start === applyStart && v.apply.end === applyEnd ? v.apply.endTime : null;
        return isOpenAt(now, applyStart, applyEnd, endTime ?? undefined);
      }
      return v.rounds.some(({ notice }) => notice.applyStart && notice.applyStart > today) ? "upcoming" : "closed";
    }
    if (v.apply.type === "always") return "always";
    return isOpenAt(now, v.apply.start, v.apply.end, v.apply.endTime ?? undefined);
  }
  if (p.applyPeriodType === "closed") return "closed";
  if (p.applyPeriodType === "always") {
    if (p.bizEnd && p.bizEnd < toKstDate(now)) return "unknown";
    return "always";
  }
  return isOpenAt(now, p.applyStart, p.applyEnd);
}

function timeAxis(v: VerifiedPolicy | undefined, profile: Profile, now: Date): Axes["time"] {
  const today = toKstDate(now);
  const overdue = profile.events.find((e) => e.status === "scheduled" && e.type === "training_completion" && e.date < today);
  const note = overdue ? "수료 예정일이 지났습니다. 수료하셨다면 상태를 바꿔 주세요." : undefined;
  if (!v?.lookback) return { value: "na", note };
  const status = effectiveStatus(profile);
  if (status.has("in_training")) return { value: "unmet", note: note ?? "교육·훈련 수강 중" };
  const lastEvent = profile.events
    .filter((e) => e.status !== "scheduled" && (e.type === "training_completion" || e.type === "employment"))
    .sort((a, b) => a.date.localeCompare(b.date))
    .pop();
  const last = lastEvent?.date;
  // 이력이 하나도 없으면 "최근 N개월 이력 없음"을 확인할 수 없다(퇴사 직후일 수도 있다)
  if (!last) {
    // 상담 질문에 답했으면 그 답을 쓴다
    if (profile.recentHistory === "no") return { value: "met", note };
    if (profile.recentHistory === "yes") return { value: "unmet", note: note ?? `최근 ${v.lookback.months}개월 안에 취업·훈련 이력이 있어 기간 경과 후 재검토` };
    return { value: "needs_check", note: note ?? `최근 ${v.lookback.months}개월 취업·훈련 이력 확인 필요` };
  }
  const months = monthsBetween(last, today);
  if (months < v.lookback.months) return { value: "unmet", note: `${lastEvent?.type === "employment" ? "취업일" : "수료일"} 기준 ${v.lookback.months}개월 경과 후 재검토` };
  return { value: "met", note };
}

function legacyRestriction(p: Policy, v: VerifiedPolicy | undefined, profile: Profile): Axes["restriction"] {
  if (v) {
    const applies = v.restrictionQuotes.filter((q) => q.mentions?.some((id) => profile.participating.includes(id)));
    if (applies.length) return { value: "applies", quotes: applies.map((q) => q.text) };
    if (v.confirmedRelations.length) return { value: "confirmed_relation", quotes: v.confirmedRelations.map((r) => `${r.otherName}: ${r.quote.text}`) };
    if (v.restrictionQuotes.length) return { value: "official_quote", quotes: v.restrictionQuotes.map((q) => q.text) };
    return { value: "unknown", quotes: [] };
  }
  const m = /[^.\n]*(중복|유사\s?사업|동시\s?(수혜|참여))[^.\n]*/.exec(p.texts.excluded);
  return m ? { value: "official_quote", quotes: [m[0].trim()] } : { value: "unknown", quotes: [] };
}

function restrictionAxis(p: Policy, v: VerifiedPolicy | undefined, profile: Profile, now: Date): Axes["restriction"] {
  const roundId = v?.rounds?.length ? pickRound(v.rounds, toKstDate(now)).round?.id ?? null : null;
  const rules = (loadOverlap().get(p.id) ?? []).filter(rule => rule.target_round_id === null || rule.target_round_id === roundId);
  const notices = loadOverlapNotices(p.id);
  if (rules?.length) {
    const facts = profile.benefits ?? [];
    const result = evaluateRules(rules, facts, facts.filter(f => f.status === "planned" || f.plannedStart || f.plannedEnd), now);
    return { ...result, value: result.current_restrictions.some(r => r.state === "applies") ? "applies"
      : rules.some(r => r.judgement === "blocked") ? "confirmed_relation" : "official_quote",
      quotes: [...new Set([...rules.map(r => r.evidence.quote_text), ...notices])] };
  }
  const legacy = legacyRestriction(p, v, profile);
  if (notices.length) {
    if (legacy.value === "unknown") legacy.value = "official_quote";
    legacy.quotes = [...new Set([...legacy.quotes, ...notices])];
  }
  return legacy;
}

export function judgePolicy(
  p: Policy,
  v: VerifiedPolicy | undefined,
  profile: Profile,
  now: Date,
  opts: JudgeOpts = {},
): Axes {
  const personal = judgePersonal(p, v, profile, now, opts);
  const restriction = restrictionAxis(p, v, profile, now);
  const current = restriction.current_restrictions;
  const blocked = current?.find(blocksParticipation);
  if (!current && restriction.value === "applies" && personal.value === "eligible") {
    personal.value = "needs_check";
    personal.reasons.push(REASON.participating);
  }
  const time = timeAxis(v, profile, now);
  if (time.value === "needs_check" && personal.value === "eligible") {
    personal.value = "needs_check";
    personal.reasons.push(REASON.history);
  }
  // 기간 조건이 아직 남아 있으면 "조건상 해당"이라고 하지 않는다
  if (time.value === "unmet" && personal.value === "eligible") {
    personal.value = "needs_check";
    personal.reasons.push(REASON.period);
  }
  if (blocked) {
    personal.value = "ineligible";
    personal.reasons.push(blocked.reason);
  } else if (current?.some(r => r.state === "needs_info" && !r.restricted_item) && personal.value !== "ineligible") {
    personal.value = "needs_check";
    personal.reasons.push("중복수혜 제한 조건 확인 필요");
  }
  const axes: Axes = { personal, recruitment: recruitment(p, v, now), time, restriction };
  return applySavedFieldChecks(axes, p, v, now);
}

const RANK_V = { eligible: 0, code_met_unreviewed: 1, needs_check: 2, ineligible: 3 } as const;

/** 준비 단계 저장 결과의 항목별 대조를 반영한다. 낮추기만 한다(통합 설계 5.3-4) */
function applySavedFieldChecks(axes: Axes, p: Policy, v: VerifiedPolicy | undefined, now: Date): Axes {
  const { result: saved, needsReview } = savedResult(p, v, toKstDate(now));
  if (needsReview) axes.fieldNotes = [...(axes.fieldNotes ?? []), VERIFY_RECHECK];
  if (!saved || saved.outcome !== "verified_against_notice") return axes;
  const e = fieldCheckEffect(saved, p, v, toKstDate(now));
  const lower = (reason: string) => {
    if (RANK_V[axes.personal.value] < RANK_V.needs_check) axes.personal.value = "needs_check";
    if (!axes.personal.reasons.includes(reason)) axes.personal.reasons.push(reason);
  };
  if (e.newRound) {
    lower(REASON.roundReview);
    delete axes.personal.evidence;
  }
  for (const r of e.personal) lower(r);
  const notes = [...(e.recruitment ? [e.recruitment] : []), ...e.notes];
  if (e.recruitment && axes.recruitment !== "closed") axes.recruitment = "unknown";
  if (notes.length) axes.fieldNotes = notes;
  return axes;
}

const NON_INDIVIDUAL = /컨소시엄|운영|조성|센터|조사|위원회|의무제|설치|홍보|구축|활성화|협의체|포럼|축제|행사|기념|장려금|인프라/;
const NON_INDIVIDUAL_PROVISION = new Set(["0042001", "0042012"]); // 인프라 구축, 경제적 규제

export type JudgedPolicy = { policy: Policy; verified: boolean; layer: Layer; axes: Axes };

export function judgeAll(profile: Profile, now: Date, opts: JudgeOpts = {}): JudgedPolicy[] {
  const verified = loadVerified();
  const out: JudgedPolicy[] = [];
  const dead = loadDeadLinks();
  for (const p of loadSnapshot().policies) {
    if (dead.has(p.id)) continue;
    const v = verified.get(p.id);
    if (!v) {
      if (p.applyPeriodType === "closed") continue;
      if (NON_INDIVIDUAL.test(p.name) || (p.provisionCode && NON_INDIVIDUAL_PROVISION.has(p.provisionCode))) continue;
      if (!p.zipCodes.includes(profile.sigungu)) continue;
    }
    const axes = judgePolicy(p, v, profile, now, opts);
    const layer: Layer = v ? "verified" : axes.recruitment === "closed" ? "history" : "partial";
    out.push({ policy: p, verified: !!v, layer, axes });
  }
  return out;
}
