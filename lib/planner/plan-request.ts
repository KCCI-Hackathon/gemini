import { groupPlanPicks } from "@/app/planner/shared";
import { addMonths, monthsBetween } from "@/lib/date";
import { findRegisteredPersona, PERSONAS } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import type { AiRecommendation, Evaluation, PlanEvent } from "./types";

export function toLegacyPlan(events: PlanEvent[], today: string) {
  const scheduled = events.filter(event => event.status === "scheduled").sort((a, b) => a.date.localeCompare(b.date));
  const first = (type: PlanEvent["type"]) => scheduled.find(event => event.type === type);
  const base = first("training_completion")?.date ?? today;
  const offset = (from: string, to: string) => Math.max(0, Math.min(12, monthsBetween(from, to)));
  const afterCompletion = (event?: PlanEvent) => event ? offset(base, event.date) : null;
  const move = first("relocation");
  return {
    employAfterMonths: afterCompletion(first("employment")),
    businessAfterMonths: afterCompletion(first("business_registration")),
    move: move?.sigungu ? { sigungu: move.sigungu, afterMonths: offset(today, move.date) } : null,
  };
}

function registeredPersona(profile: Profile) {
  if (profile.events.length) return findRegisteredPersona(profile);
  // The workspace stores schedule changes in PlannerInput, outside the profile.
  return Object.values(PERSONAS).find(base => findRegisteredPersona({ ...profile, events: base.events }) === base);
}

export function canUseAi(profile: Profile) { return registeredPersona(profile) !== undefined; }

type Stations = Parameters<typeof groupPlanPicks>[0];

function stationMonth(label: string, evaluation: Evaluation) {
  if (label === "지금") return evaluation.today.slice(0, 7);
  const explicit = label.match(/\b\d{4}-\d{2}\b/);
  if (explicit) return explicit[0];
  const offset = label.match(/(\d+)개월 뒤/);
  const name = label.split("(")[0].trim();
  const stage = evaluation.stages.find(stage => stage.label.split(" · ").includes(name)
    && (!offset || monthsBetween(evaluation.today, stage.start) === Number(offset[1])));
  return stage?.start.slice(0, 7) ?? (offset ? addMonths(evaluation.today, Number(offset[1])).slice(0, 7) : undefined);
}

export function attachPicks(stations: Stations, evaluation: Evaluation): AiRecommendation {
  const picks = new Map<string, AiRecommendation["picks"][number]>();
  const stages = [...evaluation.stages].sort((a, b) => a.start.localeCompare(b.start));
  let notice = null;
  for (const [policyId, group] of Object.entries(groupPlanPicks(stations)).sort((a, b) => a[1].rank - b[1].rank)) {
    const cards = evaluation.cards.filter(card => card.policyId === policyId);
    const ordered = stages.flatMap(stage => cards.filter(card => card.stageId === stage.stageId));
    for (const { station, why } of group.reasons) {
      const month = stationMonth(station, evaluation);
      const sameMonth = new Set(stages.filter(stage => stage.start.slice(0, 7) === month).map(stage => stage.stageId));
      const matching = ordered.filter(card => sameMonth.has(card.stageId));
      const card = (matching.length ? matching : ordered).find(card => card.availability !== "blocked");
      if (!card) {
        notice = "AI 추천 일부가 지금 일정과 맞지 않아요";
        continue;
      }
      // A saved plan accepts one stage per offering. Keep its first pick and all station reasons.
      const pick = picks.get(card.offeringId) ?? { offeringId: card.offeringId, stageId: card.stageId, why: [] };
      pick.why.push(`${station} · ${why}`);
      picks.set(card.offeringId, pick);
    }
  }
  return { source: "ai", summary: "", picks: [...picks.values()], notice };
}

type RequestArgs = {
  profile: Profile; events: PlanEvent[]; evaluation: Evaluation; seq: number; currentSeq: () => number;
  fetcher?: typeof fetch; timeoutMs?: number;
};

export async function requestAiRecommendation({ profile, events, evaluation, seq, currentSeq, fetcher = fetch, timeoutMs = 60_000 }: RequestArgs): Promise<AiRecommendation | null> {
  const generic = "AI 설명을 불러오지 못해 조건 기준 경로를 표시해요";
  const privateProfile = "실제 정보로는 AI 계획을 쓰지 않아요. 조건 기준 경로를 표시해요.";
  const fallback = (notice: string): AiRecommendation => ({
    source: "rule", summary: "", picks: evaluation.recommendations.map(choice => ({ ...choice, why: [] })), notice,
  });
  if (seq !== currentSeq()) return null;
  const persona = registeredPersona(profile);
  if (!persona) return fallback(privateProfile);
  const plan = toLegacyPlan(events, evaluation.today);
  const interest = plan.businessAfterMonths !== null && plan.employAfterMonths === null ? "startup" : "job";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result: AiRecommendation;
  try {
    const response = await fetcher("/api/plan", {
      method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({ mode: "replan", persona: true, session: {
        profile: { ...persona, interest, examDate: profile.examDate }, plan, answers: {}, benefits: profile.benefits ?? [],
      } }),
    });
    if (response.status === 503) result = fallback("AI가 꺼져 있어 조건 기준 경로를 표시해요");
    else if (response.status === 403) result = fallback(privateProfile);
    else if (!response.ok) result = fallback(generic);
    else {
      const body = await response.json();
      result = body.plan
        ? { ...attachPicks(body.plan.stations, evaluation), summary: body.plan.summary }
        : fallback(body.timedOut ? "AI 계획 정리 제한 시간을 넘겼어요. 조건 기준 경로를 표시해요." : generic);
    }
  } catch {
    result = fallback(generic);
  } finally {
    clearTimeout(timer);
  }
  return seq === currentSeq() ? result : null;
}
