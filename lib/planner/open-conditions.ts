// '확인 필요' 카드를 만든 조건을 모아 물을 순서를 정한다. 질문 순서는 이 파일에서만 계산한다(화면 · 서버 공통).
// 답해도 판정 코드가 바뀌지 않는 조건은 resolvable: false 로 두고 묻지 않는다.
import { policyFacts } from "@/lib/judge/conditions";
import { REASON, type Profile } from "@/lib/judge/types";
import type { CounselTarget } from "./counsel-target";
import type { Card, Evaluation, PlannerInput } from "./types";

export type ConditionKey = "status" | "history" | "benefit" | "income" | "marriage" | "tenure" | "special" | "household" | "text" | "other";
export type OpenCondition = {
  key: ConditionKey; id: string; label: string;
  /** 이 답으로 판정 코드가 바뀌는가. false 면 질문 후보로 쓰지 않는다. */
  resolvable: boolean;
  question?: { text: string; target: CounselTarget };
  /** 바뀔 수 있는 카드 수(같은 정책은 한 번) · 그중 이 조건만 남아 신청 가능으로 바뀔 수 있는 수 · 가장 가까운 마감까지 남은 일 */
  cards: number; eligibleCards: number; soonestDays: number | null;
  offeringIds: string[];
};
export type RecommendSession = { id: string; asked: number; skipped: number; skippedKeys?: string[] };

export const MAX_QUESTIONS = 15;
export const MAX_SKIPS = 2;

export function questionKey(target: CounselTarget): string {
  return target.kind === "benefit" ? [target.kind, target.policyId, target.answer, target.month ?? ""].join("|") : target.kind;
}

const QUESTIONS: Record<Exclude<ConditionKey, "benefit" | "household" | "text" | "other">, { label: string; text: string; target: CounselTarget }> = {
  status: { label: "현재 상태", text: "지금 재학 · 구직 · 재직 · 사업자 중 어디에 해당하세요?", target: { kind: "status" } },
  history: { label: "최근 취업 · 훈련 이력", text: "최근 6개월 안에 취업하거나 훈련을 받은 적이 있나요?", target: { kind: "recent_history" } },
  income: { label: "소득 구간", text: "가구 소득이 기준 중위소득 대비 어느 구간이세요?", target: { kind: "income_band" } },
  marriage: { label: "혼인 여부", text: "혼인 여부를 알려 주세요.", target: { kind: "marital" } },
  tenure: { label: "재직 기간", text: "지금 회사에 다닌 지 얼마나 됐나요?", target: { kind: "tenure_months" } },
  special: { label: "중소기업 여부", text: "다니는(다닐) 회사가 중소기업인가요?", target: { kind: "sme" } },
};
const LABELS: Record<ConditionKey, string> = { ...Object.fromEntries(Object.entries(QUESTIONS).map(([k, v]) => [k, v.label])) as Record<string, string>, benefit: "받고 있는 지원", household: "1인가구 등 별도 자격", text: "별도 자격 조건(본문)", other: "그 밖의 조건" } as Record<ConditionKey, string>;

type Found = { key: ConditionKey; id: string; resolvable: boolean; question?: { text: string; target: CounselTarget } };

/** 카드 하나의 사유를 조건 키로 바꾼다. 사유 문구는 lib/judge/types.ts REASON 이 원본이다. */
function conditionsOfCard(card: Card, profile: Profile, input: PlannerInput): Found[] {
  const facts = policyFacts(card.policyId);
  const statusUnknown = !profile.currentStatus.length || input.mutedKeys.includes("status");
  const found = new Map<string, Found>();
  const add = (key: ConditionKey, resolvable: boolean, id = key as string) => {
    const q = key in QUESTIONS ? QUESTIONS[key as keyof typeof QUESTIONS] : undefined;
    found.set(id, { key, id, resolvable, ...(resolvable && q ? { question: { text: q.text, target: q.target } } : {}) });
  };
  for (const r of card.reasons) {
    const m = r.message;
    if (statusUnknown && (m === REASON.statusUnknown || m === REASON.codeStatus || (input.mutedKeys.includes("status") && r.code === "MUTED_CONDITION"))) add("status", true);
    else if (/취업·훈련 이력 확인 필요/.test(m)) add("history", !profile.recentHistory);
    else if (m === REASON.income) add("income", profile.incomeBand === undefined && facts?.incomeLimit != null);
    else if (m === REASON.marriage) add("marriage", profile.marital === undefined && (facts?.marriageCode === "0055001" || facts?.marriageCode === "0055002"));
    else if (m === REASON.tenure) add("tenure", profile.tenureMonths === undefined && profile.currentStatus.includes("employed") && !!facts?.tenureSince);
    else if (m === REASON.special) add("special", profile.smeEmployee === undefined && !!facts?.specialCodes.includes("0014001"));
    else if (m === REASON.unreviewed) add(facts?.hasHouseholdText ? "household" : "text", false);
    else add("other", false);
  }
  return [...found.values()];
}

/** AI 에게 보내는 카드 요약용: 이 카드를 '확인 필요'로 만든 조건 키 */
export function cardConditionKeys(card: Card, profile: Profile, input: PlannerInput): ConditionKey[] {
  return card.eligibility === "needs_check" ? [...new Set(conditionsOfCard(card, profile, input).map(c => c.key))] : [];
}

/** 확인 필요 카드의 조건을 모아 순위를 매긴다. 바뀔 수 있는 카드가 많은 조건, 신청 가능으로 바뀔 카드가 많은 조건, 마감이 가까운 카드가 걸린 조건 순. */
export function collectOpenConditions(profile: Profile, input: PlannerInput, evaluation: Evaluation): OpenCondition[] {
  const groups = new Map<string, OpenCondition & { eligible: Set<string>; all: Set<string> }>();
  const bump = (g: { soonestDays: number | null }, days: number | null) => { if (days !== null && (g.soonestDays === null || days < g.soonestDays)) g.soonestDays = days; };
  const add = (c: Found, card: Card, onlyThis: boolean) => {
    const g = groups.get(c.id) ?? { ...c, label: LABELS[c.key], cards: 0, eligibleCards: 0, soonestDays: null, offeringIds: [], eligible: new Set<string>(), all: new Set<string>() };
    g.all.add(card.offeringId);
    if (onlyThis) g.eligible.add(card.offeringId);
    bump(g, card.daysLeft);
    groups.set(c.id, g);
  };
  for (const card of evaluation.cards) {
    if (card.eligibility !== "needs_check") continue;
    const own = conditionsOfCard(card, profile, input);
    const benefits: Found[] = evaluation.questions.filter(q => q.policyId === card.policyId).map(q => {
      const target = { kind: "benefit", policyId: q.sourcePolicyId, answer: q.answerKind, ...(q.month && { month: q.month }) } as CounselTarget;
      return { key: "benefit" as const, id: questionKey(target), resolvable: true, question: { text: q.question.replace(/^해당 사업/, q.sourceName), target } };
    });
    const all = [...own, ...benefits];
    const solo = all.every(c => c.resolvable);
    for (const c of all) add(c, card, solo);
  }
  return [...groups.values()].map(({ eligible, all, ...g }) => ({ ...g, cards: all.size, eligibleCards: eligible.size, offeringIds: [...all] }))
    .sort((a, b) => Number(b.resolvable) - Number(a.resolvable) || b.cards - a.cards || b.eligibleCards - a.eligibleCards
      || (a.soonestDays ?? Infinity) - (b.soonestDays ?? Infinity));
}

/** 지금 물을 수 있는 질문 후보(순위 순). 건너뛴 질문은 뺀다. */
export function askableConditions(conditions: OpenCondition[], session?: Pick<RecommendSession, "skippedKeys">): OpenCondition[] {
  const skipped = new Set(session?.skippedKeys ?? []);
  return conditions.filter(c => c.resolvable && c.question && !skipped.has(questionKey(c.question.target)));
}

const STOP_WORDS = /그만|바로\s*추천|지금\s*추천|더\s*안\s*물어|질문\s*(말고|그만|없이)/;
/** 사용자가 질문을 그만하고 바로 추천받겠다는 뜻으로 쓴 말인가 */
export function wantsImmediateRecommendation(text: string | undefined): boolean {
  return !!text && STOP_WORDS.test(text);
}

/** 추천(finish_plan)을 내도 되는가. 15번 물었거나, 바뀔 수 있는 카드가 없거나, 건너뛰기 2번 · 그만 이라고 했을 때. */
export function mayFinish(askable: OpenCondition[], session: Pick<RecommendSession, "asked" | "skipped">, message?: string): { allowed: boolean; reason?: "limit" | "nothing_left" | "skipped" | "user_stop" } {
  if (session.asked >= MAX_QUESTIONS) return { allowed: true, reason: "limit" };
  if (!askable.length) return { allowed: true, reason: "nothing_left" };
  if (session.skipped >= MAX_SKIPS) return { allowed: true, reason: "skipped" };
  if (wantsImmediateRecommendation(message)) return { allowed: true, reason: "user_stop" };
  return { allowed: false };
}

/** ask_user · parse_other_answer 의 target 이 질문 후보와 같은 종류인가. 수혜 질문은 정책 · 답 종류까지 같아야 한다. */
export function targetIsAskable(target: CounselTarget, askable: OpenCondition[]): boolean {
  return askable.some(c => c.question && (target.kind === "benefit" ? questionKey(c.question.target) === questionKey(target) : c.question.target.kind === target.kind));
}
