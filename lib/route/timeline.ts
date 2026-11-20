// 기간 기준 타임라인: 앞으로 12개월 동안 정책마다 "신청할 수 있는 구간"이 언제 열리고 닫히는지 계산한다.
// 대전제는 상태 변화(수료·취업·사업자등록)이고, 그 시점을 개월 수로 조절해 다시 계산할 수 있다.
// 현재 공고 기준의 계산이며 이후의 새 공고·변경은 반영되지 않는다. 언제 취업·창업하는 것이 낫다는 판단을 하지 않는다.
// 외부 호출 없음, 입력 프로필은 바꾸지 않는다.
import { addMonths, toKstDate } from "@/lib/date";
import { regionLabel } from "@/lib/data/regions";
import { loadVerified } from "@/lib/data/verified";
import { loadOverlap } from "@/lib/data/overlap";
import { judgeAll, type EventType, type JudgedPolicy, type PersonalValue, type Profile } from "@/lib/judge";
import { baselineOpts, effectiveStatus } from "@/lib/judge/personal";
import type { Evidence } from "@/lib/judge/rules";
import { weighPolicy } from "./weight";

/** move: 이사 예정(대상 시군구, 오늘부터 몇 개월 뒤). 그 날부터 지역 판정을 새 시군구로 한다 */
export type TimelinePlan = { employAfterMonths?: number | null; businessAfterMonths?: number | null; move?: { sigungu: string; afterMonths: number } | null };

/** ok: 조건 충족, check: 확인할 것이 남음, wait: 기간 조건이 남음, closed: 모집 기간 아님, no: 조건상 비해당 */
export type CellState = "ok" | "check" | "wait" | "closed" | "no";

export type TimelineEvent = { type: EventType; date: string; label: string; assumed: true; sigungu?: string };

export type TimelineRow = {
  /** 신청 구간이 시작되는 순서. 기간 안에 구간이 없으면 null */
  order: number | null;
  policyId: string;
  name: string;
  verified: boolean;
  /** 달마다 한 칸(months와 같은 길이) */
  cells: CellState[];
  firstAvailable: string | null;
  lastAvailable: string | null;
  personalAtStart: PersonalValue | null;
  /** 가정한 사건으로 신청 구간 안에서 판정 사유가 바뀌는 날(그날부터 다시 확인) */
  breaks: string[];
  /** 경계: 가정한 사건으로 판정이 바뀌는 날(구간이 열리거나 닫히거나 사유가 바뀜). 그 달은 선후 확인 필요 */
  boundaries: string[];
  /** 신청 구간이 시작되는 시점의 조건별 근거(회차별 규칙이 있는 정책만) */
  evidence: Evidence[];
  /** 중복·유사사업 제한 문구(API 또는 공고). 상대 정책을 특정할 수 없는 일반 문구 */
  restrictionQuote: string | null;
  /** 신청 구간이 시작되는 시점의 판정 사유. 구간이 없으면 없는 이유 하나 */
  reasons: string[];
  summary: string;
};

/** 그날 일어나는 일: 삶의 사건(가정) 또는 정책 신청 구간의 열림·닫힘 */
export type Moment = { date: string; kind: "life" | "open" | "close"; text: string; policyId: string | null };

export type Timeline = {
  months: string[];
  /** 달마다 그때의 상태 이름(months와 같은 길이) */
  stateLabels: string[];
  baseDate: string;
  baseLabel: string;
  events: TimelineEvent[];
  rows: TimelineRow[];
  moments: Moment[];
  notice: string;
};

const HORIZON = 12;
const EVENT_LABEL: Record<EventType, string> = { training_completion: "수료", employment: "취업", business_registration: "사업자등록", relocation: "이사" };

const NOTICE =
  "가정한 날짜에 따라 달라지는 신청 구간을 현재 공고 기준으로 계산한 것입니다. 데이터 기준일 이후의 새 공고와 변경은 반영되지 않습니다. 언제 취업하거나 창업하는 것이 낫다는 뜻이 아니며, 신청 결과를 예측하지 않습니다.";

function addDays(ymd: string, n: number): string {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)) + n));
  return d.toISOString().slice(0, 10);
}
const at = (ymd: string) => new Date(`${ymd}T12:00:00+09:00`);

export function stateOf(r: JudgedPolicy): CellState {
  if (r.axes.personal.value === "ineligible") return "no";
  if (r.axes.recruitment !== "open" && r.axes.recruitment !== "always") return "closed";
  if (r.axes.time.value === "unmet") return "wait";
  return r.axes.personal.value === "needs_check" ? "check" : "ok";
}
const CELL_ORDER: CellState[] = ["ok", "check", "wait", "closed", "no"];
const available = (s: CellState | undefined) => s === "ok" || s === "check";

/** 가정한 사건 목록: 수료 예정일은 그대로, 취업·사업자등록은 기준일로부터 개월 수 */
function plannedEvents(profile: Profile, today: string, plan: TimelinePlan): { base: string; baseLabel: string; events: TimelineEvent[] } {
  const status = effectiveStatus(profile);
  const events: TimelineEvent[] = [];
  let base = today;
  let baseLabel = "오늘";
  if (status.has("in_training")) {
    const scheduled = profile.events.find((e) => e.type === "training_completion" && e.status === "scheduled" && e.date >= today);
    if (scheduled) {
      events.push({ type: "training_completion", date: scheduled.date, label: `수료(${scheduled.date})`, assumed: true });
      base = scheduled.date;
      baseLabel = "수료일";
    }
  }
  const add = (type: EventType, months: number | null | undefined, skip: boolean) => {
    if (months == null || skip) return;
    const date = addMonths(base, months);
    events.push({ type, date, label: `${EVENT_LABEL[type]}(${date}, ${baseLabel}${months === 0 ? " 당일" : `부터 ${months}개월 뒤`})`, assumed: true });
  };
  add("employment", plan.employAfterMonths, status.has("employed"));
  add("business_registration", plan.businessAfterMonths, status.has("business_registered"));
  if (plan.move && plan.move.sigungu !== profile.sigungu) {
    const date = addMonths(today, plan.move.afterMonths);
    events.push({ type: "relocation", date, label: `이사(${regionLabel(plan.move.sigungu)}, ${date}, 오늘부터 ${plan.move.afterMonths}개월 뒤)`, assumed: true, sigungu: plan.move.sigungu });
  }
  events.sort((a, b) => a.date.localeCompare(b.date));
  return { base, baseLabel, events };
}

/** 그 날짜까지 일어난 가정 사건을 반영한 프로필 */
function profileAt(origin: Profile, events: TimelineEvent[], ymd: string, upto = Infinity): Profile {
  const p = structuredClone(origin);
  const applied = events.filter((e) => e.date <= ymd).slice(0, upto);
  for (const e of applied) {
    if (e.type === "relocation") {
      p.sigungu = e.sigungu!;
      continue;
    }
    p.events = p.events.filter((x) => !(x.type === e.type && x.status !== "completed"));
    p.events.push({ type: e.type, date: e.date, status: "simulated" });
  }
  return p;
}

export type StationObserver = (date: string, policies: ReadonlyMap<string, JudgedPolicy>) => void;

export function buildTimeline(profile: Profile, now: Date, plan: TimelinePlan, onStation?: StationObserver): Timeline {
  const origin = structuredClone(profile);
  const today = toKstDate(now);
  const { base, baseLabel, events } = plannedEvents(origin, today, plan);
  const months = Array.from({ length: HORIZON + 1 }, (_, k) => addMonths(today, k));
  const end = months[months.length - 1];

  // 계산 지점: 달마다 + 사건이 일어나는 날 + 기간 조건이 풀리는 날 + 검증 정책의 마감일과 그다음 날
  const verified = loadVerified();
  const lookbacks = new Set([...verified.values()].flatMap((v) => (v.lookback ? [v.lookback.months] : [])));
  const points = new Set<string>(months);
  if (profile.benefits?.length) {
    for (const rules of loadOverlap().values()) {
      for (const rule of rules) {
        const months = rule.condition_params.months;
        if (rule.condition_type !== "within_months_after_end" || typeof months !== "number" || !Number.isSafeInteger(months) || months < 1) continue;
        const last = profile.benefits.find(f => f.policyId === rule.source_policy_id && f.lastPaymentDate)?.lastPaymentDate;
        if (last) points.add(addMonths(last, months));
      }
    }
  }
  for (const e of events) {
    points.add(e.date);
    for (const m of lookbacks) points.add(addMonths(e.date, m));
  }
  for (const v of verified.values()) {
    if (v.apply.end) {
      points.add(v.apply.end);
      points.add(addDays(v.apply.end, 1));
    }
    if (v.apply.start) points.add(v.apply.start);
    for (const { notice } of v.rounds ?? []) {
      if (notice.applyStart) points.add(notice.applyStart);
      if (notice.applyEnd) {
        points.add(notice.applyEnd);
        points.add(addDays(notice.applyEnd, 1));
      }
    }
  }
  const samples = [...points].filter((d) => d >= today && d <= end).sort();

  // 지점마다 전체 판정
  const perSample = samples.map((ymd) => {
    const applied = events.filter((e) => e.date <= ymd).length;
    const p = profileAt(origin, events, ymd);
    const opts = applied ? baselineOpts(origin, profileAt(origin, events, ymd, applied - 1)) : {};
    const policies = new Map(judgeAll(p, at(ymd), opts).map((r) => [r.policy.id, r] as const));
    if (onStation && (ymd === today || events.some((e) => e.date === ymd))) onStation(ymd, policies);
    return policies;
  });
  const stateAt = (id: string, i: number): CellState | undefined => {
    const r = perSample[i].get(id);
    return r ? stateOf(r) : undefined;
  };

  // 사건이 일어난 날 판정 사유가 달라지면, 열려 있어도 같은 구간으로 잇지 않는다
  const eventDates = new Set(events.map((e) => e.date));
  const keyAt = (id: string, i: number) => {
    const r = perSample[i].get(id);
    return r ? `${stateOf(r)}|${r.axes.personal.reasons.join("|")}` : "";
  };
  const breaksAt = (id: string, i: number) => i > 0 && eventDates.has(samples[i]) && keyAt(id, i) !== keyAt(id, i - 1);

  type Draft = Omit<TimelineRow, "order"> & { score: number; closeDate: string | null; closeText: string };
  const drafts: Draft[] = [];
  // 이사로 지역이 바뀌면 나중 시점에만 보이는 정책도 있다: 모든 시점의 정책을 모은다
  const allIds = new Set(perSample.flatMap((m) => [...m.keys()]));
  for (const id of allIds) {
    const states = samples.map((_, i) => stateAt(id, i));
    const first = states.findIndex(available);
    const r0 = perSample.find((m) => m.has(id))!.get(id)!;
    if (first === -1 && !r0.verified) continue;
    let last = first;
    while (last !== -1 && last + 1 < states.length && available(states[last + 1])) last++;
    // 구간은 이어지지만 가정한 사건으로 판정 사유가 바뀌는 날
    const boundaries = samples.filter((_, i) => breaksAt(id, i) && (available(states[i]) || available(states[i - 1])));
    const breaks = first === -1 ? [] : samples.filter((_, i) => i > first && i <= last && breaksAt(id, i));

    const startRow = first === -1 ? null : perSample[first].get(id)!;
    let summary: string;
    let lastAvailable: string | null = null;
    let closeDate: string | null = null;
    let closeText = "";
    if (first === -1 || !startRow) {
      summary = `이 기간에는 신청 구간이 없습니다(${whyNot(perSample[perSample.length - 1].get(id) ?? r0)}).`;
    } else {
      const startEvent = events.find((e) => e.date === samples[first]);
      const before = first > 0 ? states[first - 1] : undefined;
      const startWhy = first === 0 ? "오늘부터" : `${samples[first]}부터(${startEvent ? EVENT_LABEL[startEvent.type] : before === "wait" ? "기간 조건 충족" : before === "closed" ? "모집 시작" : "조건 변화"})`;
      let endText: string;
      if (last === states.length - 1) endText = "이후 계속(현재 공고 기준)";
      else {
        const next = samples[last + 1];
        const endEvent = events.find((e) => e.date === next);
        const nextState = states[last + 1];
        if (nextState === "closed") {
          lastAvailable = samples[last];
          endText = `${samples[last]} 모집 마감`;
          closeDate = samples[last];
          closeText = "모집 마감";
        } else if (endEvent) {
          lastAvailable = addDays(next, -1);
          endText = `${next} ${EVENT_LABEL[endEvent.type]}으로 상태가 바뀌어 다시 확인`;
          closeDate = next;
          closeText = `${EVENT_LABEL[endEvent.type]}으로 상태가 바뀌어 신청 구간이 끝남(다시 확인 필요)`;
        } else {
          lastAvailable = samples[last];
          endText = `${next}부터 조건이 달라짐`;
          closeDate = next;
          closeText = "조건이 달라져 신청 구간이 끝남";
        }
      }
      const check = stateOf(startRow) === "check" ? ` · 확인할 사항 ${startRow.axes.personal.reasons.length}개` : "";
      const changes = breaks.map((b) => ` · ${b} ${EVENT_LABEL[events.find((e) => e.date === b)!.type]} 후 다시 확인`).join("");
      summary = `${startWhy} · ${endText}${check}${changes}`;
    }

    drafts.push({
      policyId: id,
      name: verified.get(id)?.name ?? r0.policy.name,
      verified: r0.verified,
      // 한 칸은 그 달 시작부터 다음 달 시작 전까지: 그 안에서 가장 열린 상태를 보여준다
      cells: months.map((m, k) => {
        const until = months[k + 1] ?? "9999";
        const inMonth = samples.flatMap((d, i) => (d >= m && d < until ? [states[i] ?? "no"] : []));
        return CELL_ORDER.find((s) => inMonth.includes(s)) ?? "no";
      }),
      firstAvailable: first === -1 ? null : samples[first],
      lastAvailable,
      closeDate,
      closeText,
      personalAtStart: startRow?.axes.personal.value ?? null,
      breaks,
      boundaries,
      restrictionQuote: (startRow ?? r0).axes.restriction.quotes[0] ?? null,
      evidence: (startRow ?? r0).axes.personal.evidence ?? [],
      reasons: startRow ? startRow.axes.personal.reasons : [whyNot(perSample[perSample.length - 1].get(id) ?? r0)],
      summary,
      score: startRow ? weighPolicy(startRow, { interest: origin.interest, now: at(samples[first]) }).score : 0,
    });
  }

  // 줄: 사람이 확인한 정책은 모두, 나머지는 이 기간에 신청 구간이 있는 정책 모두.
  // 구간이 시작되는 순서, 같은 날이면 사람 확인 → "먼저 확인할 순서" 점수 순
  const chosen = drafts
    .filter((d) => d.verified || d.firstAvailable)
    .sort(
      (a, b) =>
        (a.firstAvailable ?? "9999").localeCompare(b.firstAvailable ?? "9999") ||
        Number(b.verified) - Number(a.verified) ||
        b.score - a.score ||
        a.policyId.localeCompare(b.policyId),
    );
  let order = 1;
  const rows: TimelineRow[] = chosen.map((d) => ({
    order: d.firstAvailable ? order++ : null,
    policyId: d.policyId,
    name: d.name,
    verified: d.verified,
    cells: d.cells,
    firstAvailable: d.firstAvailable,
    lastAvailable: d.lastAvailable,
    personalAtStart: d.personalAtStart,
    breaks: d.breaks,
    boundaries: d.boundaries,
    restrictionQuote: d.restrictionQuote,
    evidence: d.evidence,
    reasons: d.reasons,
    summary: d.summary,
  }));

  // 그날 일어나는 일: 삶의 사건이 먼저, 그다음 정책의 열림·닫힘
  const moments: Moment[] = events.map((e) => ({ date: e.date, kind: "life" as const, text: `${EVENT_LABEL[e.type]}했다고 가정`, policyId: null }));
  for (const d of chosen) {
    if (d.firstAvailable && d.firstAvailable > today) moments.push({ date: d.firstAvailable, kind: "open", text: `${d.name}: 신청 구간 시작`, policyId: d.policyId });
    if (d.closeDate) moments.push({ date: d.closeDate, kind: "close", text: `${d.name}: ${d.closeText}`, policyId: d.policyId });
  }
  const KIND = { life: 0, open: 1, close: 2 } as const;
  moments.sort((a, b) => a.date.localeCompare(b.date) || KIND[a.kind] - KIND[b.kind] || a.text.localeCompare(b.text));

  const STATE_NAME: Record<string, string> = { in_training: "교육·훈련 수강 중", unemployed: "미취업", employed: "재직", business_registered: "사업자등록" };
  const stateLabels = months.map((m) => {
    const s = effectiveStatus(profileAt(origin, events, m));
    return Object.keys(STATE_NAME).filter((k) => s.has(k as never)).map((k) => STATE_NAME[k]).join(" · ") || "상태 미입력";
  });

  return { months, stateLabels, baseDate: base, baseLabel, events, rows, moments, notice: NOTICE };
}

function whyNot(r: JudgedPolicy): string {
  const s = stateOf(r);
  if (s === "closed") return "모집 기간이 아님";
  if (s === "wait") return r.axes.time.note ?? "기간 조건이 남음";
  return r.axes.personal.reasons[0] ?? "조건상 비해당";
}
