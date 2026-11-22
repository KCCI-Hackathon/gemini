import type { Card, Category, Choice, Evaluation, RecommendationChoice, Stage } from "./types";

/** 추천 요청에서 사용자가 좁힌 범위. 비어 있으면 전체 시점 · 전체 분야. */
export type RecommendScope = { stageIds?: string[]; categories?: Category[] };

const CATEGORY_WORDS: [Category, RegExp][] = [
  ["job", /취업|일자리|구직|채용|인턴|일\s?경험|직무|취직/],
  ["startup", /창업/],
  ["housing", /주거|월세|전세|임대|주택|집/],
  ["edu", /교육|훈련|자격증|학습|강의|공부/],
  ["life", /생활|복지|건강|문화|금융|돌봄/],
];
const NOW = /현재|지금|당장|요즘/;

/** "현재 시점에서 취업 위주로 추천해줘" 같은 문장에서 시점과 분야를 뽑는다. "취업 후"는 분야가 아니라 시점이다. */
export function parseRecommendScope(text: string, stages: Stage[]): RecommendScope {
  let rest = text;
  const stageIds: string[] = [];
  for (const stage of stages) {
    if (stage.stageId === "current") {
      if (NOW.test(rest)) { stageIds.push(stage.stageId); rest = rest.replace(new RegExp(NOW.source, "g"), " "); }
      continue;
    }
    const names = [...stage.label.matchAll(/(\S+) 후/g)].map(m => m[1]);
    for (const name of names) {
      const re = new RegExp(`${name}\\s*(?:한\\s*)?(?:후|이후|뒤|하고\\s*나서|다음)`, "g");
      if (re.test(rest)) { if (!stageIds.includes(stage.stageId)) stageIds.push(stage.stageId); rest = rest.replace(re, " "); }
    }
  }
  const categories = CATEGORY_WORDS
    .map(([cat, re]) => ({ cat, at: rest.search(re) }))
    .filter(x => x.at >= 0).sort((a, b) => a.at - b.at).map(x => x.cat);
  return { ...(stageIds.length ? { stageIds: stages.filter(s => stageIds.includes(s.stageId)).map(s => s.stageId) } : {}), ...(categories.length ? { categories } : {}) };
}

export function scopeIsEmpty(scope: RecommendScope | undefined): boolean {
  return !scope?.stageIds?.length && !scope?.categories?.length;
}
export function inScope(card: Pick<Card, "stageId" | "category">, scope: RecommendScope | undefined): boolean {
  return (!scope?.stageIds?.length || scope.stageIds.includes(card.stageId)) && (!scope?.categories?.length || scope.categories.includes(card.category));
}

// 정형 데이터에는 없고 공고 본문에만 있는 대상 조건. 코드 판정이 '신청 가능'이어도 실제로는 대상이 아닐 수 있다.
const BODY_TARGETS = ["박사", "교원", "위험군", "장병", "군인", "한부모", "장애인", "수급자", "차상위", "임산부", "다문화", "북한이탈", "자립준비", "보호연장", "농업인", "어업인", "소상공인", "고령자"];
export function bodyOnlyTarget(card: Pick<Card, "title" | "summary">): string | null {
  const text = `${card.title} ${card.summary}`;
  return BODY_TARGETS.find(w => text.includes(w)) ?? null;
}

function confirmationFor(card: Card): string | undefined {
  const target = bodyOnlyTarget(card);
  if (target) return `공고 본문의 대상 조건(${target})을 확인해 주세요`;
  if (card.eligibility === "needs_check") return card.reasons[0]?.message ?? (card.eligibilityReason || "확인 필요");
  return undefined;
}
function rank(a: Card, b: Card) {
  return Number(!!bodyOnlyTarget(a)) - Number(!!bodyOnlyTarget(b))
    || Number(b.eligibility === "eligible") - Number(a.eligibility === "eligible")
    || a.reasons.length - b.reasons.length
    || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity);
}

/** AI 에게 알려 줄 범위 문장. 예: "현재 시점, 취업·일자리 분야" */
export function scopeLabel(scope: RecommendScope | undefined, stages: Stage[]): string {
  const names: Record<Category, string> = { job: "취업·일자리", startup: "창업", housing: "주거", edu: "교육·학습", life: "생활·복지" };
  const parts = [
    scope?.stageIds?.length ? `${stages.filter(s => scope.stageIds!.includes(s.stageId)).map(s => s.label).join(" · ")} 시점` : "",
    scope?.categories?.length ? `${scope.categories.map(c => names[c]).join(" · ")} 분야` : "",
  ].filter(Boolean);
  return parts.join(", ");
}

/** 범위 밖 시점 · 카드를 지운 평가. 질문 후보 · AI 후보 · 규칙 추천이 모두 이 범위만 본다. */
export function applyScope(ev: Evaluation, scope: RecommendScope | undefined): Evaluation {
  if (scopeIsEmpty(scope)) return ev;
  const stages = scope!.stageIds?.length ? ev.stages.filter(s => scope!.stageIds!.includes(s.stageId)) : ev.stages;
  const scoped = { ...ev, stages, cards: ev.cards.filter(c => inScope(c, scope) && stages.some(s => s.stageId === c.stageId)) };
  return { ...scoped, recommendations: scopedRecommendations(scoped, scope) };
}

const MIN_PER_STAGE = 2, MAX_PER_STAGE = 3;
/**
 * 범위 안에서 시점마다 2~3개. 먼저 `keep`(AI가 고른 카드)을 두고, 2개가 안 되면 같은 범위에서 순위대로 채운다.
 * 범위 밖 시점 · 분야는 채우지 않고, 범위 안 카드가 모자라면 있는 만큼만.
 */
export function scopedRecommendations(ev: Evaluation, scope: RecommendScope | undefined, keep: Choice[] = []): RecommendationChoice[] {
  const open = ev.cards.filter(c => c.eligibility !== "blocked" && inScope(c, scope));
  const used = new Set<string>();
  const out: RecommendationChoice[] = [];
  const push = (c: Card) => { used.add(c.offeringId); const confirmation = confirmationFor(c); out.push({ offeringId: c.offeringId, stageId: c.stageId, ...(confirmation ? { confirmation } : {}) }); };
  for (const stage of ev.stages) {
    const here = open.filter(c => c.stageId === stage.stageId);
    if (!here.length) continue;
    let count = 0;
    for (const k of keep) {
      const c = here.find(x => x.offeringId === k.offeringId);
      if (!c || used.has(c.offeringId) || count >= MAX_PER_STAGE) continue;
      push(c); count++;
    }
    for (const c of [...here].sort(rank)) {
      if (count >= MIN_PER_STAGE) break;
      if (used.has(c.offeringId)) continue;
      push(c); count++;
    }
  }
  return out;
}
