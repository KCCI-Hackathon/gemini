import { expect, test } from "vitest";
import { createPlanRepository, DRAFT_KEY, parseDraft } from "@/lib/planner/storage";
import { createDraft, savedSnapshot } from "@/lib/planner/state";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { DEMO_EVENTS, DEMO_PROFILE, demoCatalog, PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import { evaluateRequest } from "@/lib/planner/catalog";
import { PERSONA_A } from "@/lib/judge/personas";

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
const now = new Date("2026-11-19T12:00:00+09:00");
function current() {
  const input = { revision: 0, events: structuredClone(DEMO_EVENTS), choices: [{ offeringId: "demo-search-2027-01", stageId: "ev-course" }], mutedKeys: [], preferredCategory: "all" as const };
  return createDraft(DEMO_PROFILE, input, evaluatePlanner(DEMO_PROFILE, input, demoCatalog(), now));
}
/** 이 브랜치 이전 저장 형식: 카드에 verifyLabel 키가 아예 없다 */
function stripVerifyLabel<T>(value: T): T {
  const copy = structuredClone(value) as { cards?: Record<string, unknown>[] };
  for (const card of copy.cards ?? []) delete card.verifyLabel;
  return copy as T;
}
function stripEligibilityFields<T>(value: T): T {
  const copy = structuredClone(value) as { cards?: Record<string, unknown>[] };
  for (const card of copy.cards ?? []) {
    delete card.eligibility;
    delete card.eligibilityReason;
    delete card.overlapAssessment;
    delete card.roundId;
  }
  return copy as T;
}

test("F-1: a plan saved before verifyLabel existed opens with its name, choices and dates, and no badge", () => {
  const storage = new MemoryStorage();
  const plan = savedSnapshot(current(), "옛 계획", "manual");
  const old = { ...plan, savedEvaluation: stripVerifyLabel(plan.savedEvaluation) };
  storage.setItem(`pathfinder.plans.v2:${old.planId}`, JSON.stringify(old));
  const repo = createPlanRepository(storage);
  const { plans, unreadable } = repo.listPlans();
  expect(unreadable).toBe(0);
  expect(plans.map(p => p.name)).toEqual(["옛 계획"]);
  const opened = repo.getPlan(old.planId)!;
  expect(opened.input.choices).toEqual(plan.input.choices);
  expect(opened.input.events).toEqual(plan.input.events);
  expect(opened.savedEvaluation.cards.every(c => c.verifyLabel === null)).toBe(true);
});

test("old saved plan cards restore with cautious tab defaults instead of disappearing", () => {
  const storage = new MemoryStorage();
  const plan = savedSnapshot(current(), "분류 이전 계획", "manual");
  const old = { ...plan, savedEvaluation: stripEligibilityFields(plan.savedEvaluation) };
  storage.setItem(`pathfinder.plans.v2:${old.planId}`, JSON.stringify(old));
  const opened = createPlanRepository(storage).getPlan(old.planId)!;
  expect(opened.input.choices).toEqual(plan.input.choices);
  expect(opened.savedEvaluation.cards).toHaveLength(plan.savedEvaluation.cards.length);
  expect(opened.savedEvaluation.cards.every(card => card.eligibility === "needs_check")).toBe(true);
});

test("F-1: a tab draft saved before verifyLabel existed is restored after refresh", () => {
  const storage = new MemoryStorage();
  const d = current();
  storage.setItem(DRAFT_KEY, JSON.stringify({ ...d, evaluation: stripVerifyLabel(d.evaluation) }));
  const restored = parseDraft(storage.getItem(DRAFT_KEY));
  expect(restored).not.toBeNull();
  expect(restored!.input.choices).toEqual(d.input.choices);
  expect(restored!.input.events).toEqual(d.input.events);
  expect(restored!.evaluation.cards.every(c => c.verifyLabel === null)).toBe(true);
});

test("F-1: a new record keeps its verifyLabel (string stays, null stays)", () => {
  const storage = new MemoryStorage();
  const plan = savedSnapshot(current(), "새 계획", "manual");
  plan.savedEvaluation.cards[0].verifyLabel = "근거 확인 대기";
  storage.setItem(`pathfinder.plans.v2:${plan.planId}`, JSON.stringify(plan));
  const opened = createPlanRepository(storage).getPlan(plan.planId)!;
  expect(opened.savedEvaluation.cards[0].verifyLabel).toBe("근거 확인 대기");
  expect(opened.savedEvaluation.cards[1].verifyLabel).toBeNull();
});

test("F-1: a draft and plan made from the real demo data (incl. placeholder '0001-01-01' dates) can be stored and restored", () => {
  const input = { revision: 0, events: structuredClone(PERSONA_DEMO_EVENTS), choices: [], mutedKeys: [], preferredCategory: "all" as const, demoId: "pathfinder-demo-2026" as const };
  const evaluation = evaluateRequest({ ...PERSONA_A, events: [] }, input, new Date("2026-11-22T12:00:00+09:00"));
  const pick = evaluation.cards.find(c => c.availability !== "blocked")!;
  const d = createDraft({ ...PERSONA_A, events: [] }, { ...input, choices: [{ offeringId: pick.offeringId, stageId: pick.stageId }] }, evaluation);
  expect(parseDraft(JSON.stringify({ ...d, evaluation: stripVerifyLabel(d.evaluation) }))?.input.choices).toHaveLength(1);
  const storage = new MemoryStorage();
  const plan = savedSnapshot(d, "실데이터 계획", "manual");
  storage.setItem(`pathfinder.plans.v2:${plan.planId}`, JSON.stringify({ ...plan, savedEvaluation: stripVerifyLabel(plan.savedEvaluation) }));
  expect(createPlanRepository(storage).listPlans()).toMatchObject({ unreadable: 0, plans: [{ name: "실데이터 계획" }] });
});

test("F-1: an old healthy plan and a broken record together — the healthy one opens, the broken one is counted", () => {
  const storage = new MemoryStorage();
  const plan = savedSnapshot(current(), "옛 계획", "manual");
  storage.setItem(`pathfinder.plans.v2:${plan.planId}`, JSON.stringify({ ...plan, savedEvaluation: stripVerifyLabel(plan.savedEvaluation) }));
  storage.setItem("pathfinder.plans.v2:broken", "{not json");
  storage.setItem("pathfinder.plans.v2:wrong", JSON.stringify({ ...plan, planId: "wrong", input: { revision: -1 } }));
  const { plans, unreadable } = createPlanRepository(storage).listPlans();
  expect(plans).toHaveLength(1);
  expect(unreadable).toBe(2);
  expect(parseDraft("{not json")).toBeNull();
  expect(parseDraft(null)).toBeNull();
});
