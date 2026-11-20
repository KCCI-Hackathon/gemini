import { expect, test } from "vitest";
import { createPlanRepository, readLegacyPolicies, readLegacySitePlans } from "@/lib/planner/storage";
import { createDraft, changeEvents, undoEvents, savedSnapshot, recommendationDiff, acceptRevision, applySavedRecheck, preserveMissingChoices } from "@/lib/planner/state";
import { parseScheduleCommand, parseScheduleTurn, findNamedCards } from "@/lib/planner/commands";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { DEMO_EVENTS, DEMO_PROFILE, demoCatalog } from "@/lib/planner/fixtures";

function draft() {
  return createDraft(DEMO_PROFILE, { revision: 0, events: structuredClone(DEMO_EVENTS), choices: [{ offeringId: "demo-search-2027-01", stageId: "ev-course" }], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" }, evaluatePlanner(DEMO_PROFILE, { revision: 0, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" }, demoCatalog(), new Date("2026-11-19T12:00:00+09:00")));
}
class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
test("T24: event-only undo preserves intervening choice/profile edits", () => {
  const original = draft();
  const first = changeEvents(original, DEMO_EVENTS.map(e => e.type === "employment" ? { ...e, date: "2027-02-13" } : e), []);
  const second = changeEvents(first.draft, DEMO_EVENTS.map(e => e.type === "employment" ? { ...e, date: "2027-01-03" } : e), first.history);
  second.draft.input.choices.push({ offeringId: "demo-life", stageId: "current" });
  const undone = undoEvents(second.draft, second.history);
  expect(undone.draft.input.events?.find(e => e.id === "ev-job")?.date).toBe("2027-02-13");
  expect(undone.draft.input.choices).toHaveLength(2);
  expect(original.input.events?.find(e => e.id === "ev-job")?.date).toBe("2027-01-20");
});
test("T17–18: saves have new IDs and immutable independent snapshots", () => {
  const storage = new MemoryStorage();
  const repo = createPlanRepository(storage);
  const d = draft();
  const a = repo.createPlan(savedSnapshot(d, "  첫 계획  ", "manual"));
  const b = repo.createPlan(savedSnapshot(d, "다른 계획", "manual"));
  d.input.events![1].date = "2027-02-13";
  expect(a.planId).not.toBe(b.planId);
  expect(repo.getPlan(a.planId)?.input.events?.[1].date).toBe("2027-01-20");
  expect(a.name).toBe("첫 계획");
  expect(repo.listPlans().plans).toHaveLength(2);
  expect(() => savedSnapshot({ ...d, input: { ...d.input, choices: [] } }, "빈 계획", "manual")).toThrow();
});
test("T22: corrupt records and storage failures preserve healthy plans and legacy data", () => {
  const storage = new MemoryStorage();
  const repo = createPlanRepository(storage);
  repo.createPlan(savedSnapshot(draft(), "정상 계획", "manual"));
  storage.setItem("pathfinder.plans.v2:broken", "{bad");
  storage.setItem("galimgil.mine.v1", '["old-id"]');
  expect(repo.listPlans().plans).toHaveLength(1);
  expect(repo.listPlans().unreadable).toBe(1);
  expect(readLegacyPolicies(storage)).toEqual(["old-id"]);
  expect(storage.getItem("galimgil.mine.v1")).toBe('["old-id"]');
  storage.setItem = () => { throw new Error("quota"); };
  expect(() => repo.createPlan(savedSnapshot(draft(), "실패", "manual"))).toThrow("quota");
});
test("a parseable but malformed saved card is unreadable, not a crashing plan", () => {
  const storage = new MemoryStorage();
  const snapshot = savedSnapshot(draft(), "깨진 카드", "manual");
  storage.setItem(`pathfinder.plans.v2:${snapshot.planId}`, JSON.stringify({ ...snapshot, savedEvaluation: { ...snapshot.savedEvaluation, cards: [{}] } }));
  expect(createPlanRepository(storage).listPlans()).toEqual({ plans: [], unreadable: 1 });
});
test("v1 site plans remain visible without inventing offering/stage mappings", () => {
  const storage = new MemoryStorage();
  const raw = '[{"id":"v1-a","name":"예전 계획","selected":["unknown-policy"],"events":[]}]';
  storage.setItem("pathfinder-selection-plans-v1", raw);
  expect(readLegacySitePlans(storage)).toEqual([{ sourceId: "v1-a", name: "예전 계획", needsReselection: true }]);
  expect(storage.getItem("pathfinder-selection-plans-v1")).toBe(raw);
});
test("recommendation diff includes moves and does not overwrite manual selections", () => {
  const diff = recommendationDiff([{ offeringId: "a", stageId: "s1" }, { offeringId: "b", stageId: "s1" }], [{ offeringId: "a", stageId: "s2" }, { offeringId: "c", stageId: "s2" }]);
  expect(diff).toEqual({ added: ["c"], removed: ["b"], moved: ["a"] });
});
test("T20: obsolete revision is rejected", () => {
  expect(acceptRevision(4, { revision: 3 })).toBe(false);
  expect(acceptRevision(4, { revision: 4 })).toBe(true);
});
test("saved plan A recheck arriving after selecting B is rejected", () => {
  const evaluation = draft().evaluation;
  expect(applySavedRecheck("plan-B", { planId: "plan-A", evaluation })).toBeNull();
  expect(applySavedRecheck("plan-A", { planId: "plan-A", evaluation })?.today).toBe("2026-11-19");
});
test("removed offerings retain their saved names with explicit unavailability", () => {
  const d = draft();
  const next = { ...d.evaluation, cards: [] };
  const result = preserveMissingChoices(d.evaluation, next, d.input.choices);
  expect(result.cards[0].title).toBe("수료생 구직 지원");
  expect(result.cards[0].availability).toBe("blocked");
  expect(result.choiceWarnings[0].message).toContain("공고 조회 불가");
});
test("T29: precise agent dates use existing event year; vague dates ask clarification", () => {
  expect(parseScheduleCommand("취업을 2월 13일로 옮겨줘", DEMO_EVENTS)).toEqual({ type: "update_event", eventId: "ev-job", date: "2027-02-13" });
  expect(parseScheduleCommand("취업을 다음 달 중순으로", DEMO_EVENTS).type).toBe("clarify");
  expect(parseScheduleCommand("3월 1일 서울로 이사해", DEMO_EVENTS).type).toBe("clarify");
  expect(parseScheduleCommand("이 정책 담아줘", DEMO_EVENTS).type).toBe("locate_card");
  expect(parseScheduleCommand("취업은 2월 30일", DEMO_EVENTS).type).toBe("clarify");
  expect(parseScheduleCommand("2027년 3월 1일 서울 강남구로 이사해", DEMO_EVENTS)).toEqual({ type: "add_event", eventType: "relocation", date: "2027-03-01", sigungu: "11680" });
});
test("relocation clarification preserves the date across year and district replies", () => {
  const first = parseScheduleTurn("3월 1일 서울로 이사해", DEMO_EVENTS);
  expect(first.command.type).toBe("clarify");
  const second = parseScheduleTurn("2027년", DEMO_EVENTS, first.pending);
  expect(second.command.type).toBe("clarify");
  const third = parseScheduleTurn("서울 강남구", DEMO_EVENTS, second.pending);
  expect(third.command).toEqual({ type: "add_event", eventType: "relocation", date: "2027-03-01", sigungu: "11680" });
  expect(third.pending).toBeNull();
});
test("repeated relocation command addresses the existing event instead of adding another", () => {
  expect(parseScheduleCommand("2027년 3월 1일 서울 강남구로 이사해", [...DEMO_EVENTS, { id: "move-1", type: "relocation", date: "2027-03-01", sigungu: "11680", status: "scheduled" }])).toEqual({ type: "update_event", eventId: "move-1", date: "2027-03-01" });
});
test("agent resolves the named policy within the displayed plan", () => {
  const d = draft();
  expect(findNamedCards("월세 지원 담아줘", d.evaluation, d.input.choices).map(c => c.offeringId)).toEqual(["demo-housing"]);
});
