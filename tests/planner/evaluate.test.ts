import { describe, expect, test } from "vitest";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { DEMO_PROFILE, DEMO_EVENTS, demoCatalog } from "@/lib/planner/fixtures";
import { isDate, dayNumber } from "@/lib/planner/dates";
import { PlannerInputSchema } from "@/lib/planner/schema";
import type { PlannerInput, Offering } from "@/lib/planner/types";

const now = new Date("2026-11-19T12:00:00+09:00");
const input = (date = "2027-01-20"): PlannerInput => ({ revision: 1, events: DEMO_EVENTS.map(e => e.type === "employment" ? { ...e, date } : { ...e }), choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" });
const run = (date?: string, offerings = demoCatalog()) => evaluatePlanner(DEMO_PROFILE, input(date), offerings, now);
const search = (date?: string) => run(date).cards.find(c => c.offeringId === "demo-search-2027-01" && c.stageId === "ev-course")!;

describe("exact-day planner acceptance", () => {
  test("T01: completed-course support intersects Jan 5 application with Jan 19 eligibility", () => {
    expect(search().personalWindow).toEqual({ start: "2027-01-05", end: "2027-01-19" });
    expect(search().daysLeft).toBe(61);
    expect(search().official.end).toBe("2027-02-26");
    expect(run().cards.find(c => c.offeringId === search().offeringId && c.stageId === "current")?.availability).toBe("blocked");
  });
  test("T02–03: moving a stable event changes deadline and preserves invalid choices", () => {
    expect(search("2027-02-13").daysLeft).toBe(85);
    expect(search("2027-02-13").personalWindow?.end).toBe("2027-02-12");
    const i = input("2027-01-03");
    i.choices = [{ offeringId: "demo-search-2027-01", stageId: "ev-course" }];
    const out = evaluatePlanner(DEMO_PROFILE, i, demoCatalog(), now);
    expect(out.choiceWarnings[0].message).toContain("2027-01-03");
    expect(out.choiceWarnings[0].message).toContain("2027-01-05");
    expect(out.cards.find(c => c.offeringId === "demo-search-2027-01" && c.stageId === "ev-course")?.selectedStageId).toBe("ev-course");
  });
  test("T04: official closing date wins when earlier", () => {
    const offerings = demoCatalog().map(o => o.offeringId === "demo-search-2027-01" ? { ...o, official: { ...o.official, end: "2027-01-10" } } : o);
    expect(run(undefined, offerings).cards.find(c => c.offeringId === "demo-search-2027-01" && c.stageId === "ev-course")?.personalWindow?.end).toBe("2027-01-10");
  });
  test("T05: uninterrupted eligibility across stages keeps real deadline", () => {
    const o: Offering = { ...demoCatalog()[0], offeringId: "continuous", rules: [], official: { kind: "fixed", start: "2026-11-01", end: "2027-02-17", closeAt: null } };
    const cards = run(undefined, [o]).cards;
    expect(cards).toHaveLength(3);
    expect(cards.map(c => c.personalWindow?.end)).toEqual(["2027-02-17", "2027-02-17", "2027-02-17"]);
    expect(cards[1].stageWindow?.start).toBe("2026-12-19");
  });
  test("T07: same-day events form one stable composite stage", () => {
    const out = run("2026-12-19");
    expect(out.stages).toHaveLength(2);
    expect(out.stages[1].stageId).toBe("ev-course+ev-job");
    expect(out.stages[1].eventIds).toEqual(["ev-course", "ev-job"]);
  });
  test("T08: actual calendar validation and Seoul close time boundary", () => {
    expect(isDate("2028-02-29")).toBe(true);
    expect(isDate("2027-02-29")).toBe(false);
    expect(dayNumber("2027-01-01") - dayNumber("2026-12-31")).toBe(1);
    const o: Offering = { ...demoCatalog()[0], rules: [], official: { kind: "fixed", start: "2026-11-19", end: "2026-11-19", closeAt: "18:00" } };
    const before = evaluatePlanner(DEMO_PROFILE, input(), [o], new Date("2026-11-19T17:59:00+09:00"));
    const after = evaluatePlanner(DEMO_PROFILE, input(), [o], new Date("2026-11-19T18:00:00+09:00"));
    expect(before.cards[0].daysLeft).toBe(0);
    expect(after.cards[0].deadlineKind).toBe("closed");
    expect(after.cards[0].daysLeft).toBeNull();
  });
  test("T09: open-ended rolling offers never acquire the viewport end as deadline", () => {
    const o = { ...demoCatalog()[0], rules: [], official: { kind: "rolling" as const, start: null, end: null, closeAt: null } };
    const card = run(undefined, [o]).cards[2];
    expect(card.personalWindow?.end).toBeNull();
    expect(card.daysLeft).toBeNull();
    expect(card.deadlineKind).toBe("rolling");
  });
  test("T10–12: draft conflicts are replaceable, actual participation is not", () => {
    const i = input();
    i.choices = [{ offeringId: "demo-search-2027-01", stageId: "ev-course" }];
    const result = evaluatePlanner(DEMO_PROFILE, i, demoCatalog(), now);
    const card = result.cards.find(c => c.offeringId === "demo-job-voucher" && c.stageId === "ev-course")!;
    expect(card.conflicts).toContain("demo-search-2027-01");
    expect(card.canReplace).toBe(true);
    const active = evaluatePlanner({ ...DEMO_PROFILE, participating: ["demo-search"] }, input(), demoCatalog(), now);
    const blocked = active.cards.find(c => c.offeringId === "demo-job-voucher" && c.stageId === "ev-course")!;
    expect(blocked.canReplace).toBe(false);
    expect(blocked.reasons.some(r => r.code === "PARTICIPATION_CONFLICT")).toBe(true);
  });
  test("muted residence keeps policies as explicitly conditional recommendations", () => {
    const i = { ...input(), mutedKeys: ["status", "residence"] };
    const out = evaluatePlanner(DEMO_PROFILE, i, demoCatalog(), now);
    expect(out.cards.filter(c => c.offeringId === "demo-housing").every(c => c.availability === "needs_check")).toBe(true);
    expect(out.recommendations).toHaveLength(out.stages.length * 2);
    expect(out.recommendations.every(c => !!c.confirmation)).toBe(true);
  });
  test("confirmed cards take priority over model-preferred cards that still need confirmation", () => {
    const base = demoCatalog().find(o => o.offeringId === "demo-housing")!;
    const confirmed = { ...base, offeringId: "confirmed" };
    const conditional = { ...base, offeringId: "conditional", overlapAssessment: "unresolved" as const };
    const result = evaluatePlanner(DEMO_PROFILE, { ...input(), events: [] }, [conditional, confirmed], now, undefined, [], {
      preferredRecommendations: [{ offeringId: conditional.offeringId, stageId: "current" }],
    });
    expect(result.recommendations).toEqual([
      { offeringId: confirmed.offeringId, stageId: "current" },
      { offeringId: conditional.offeringId, stageId: "current", confirmation: expect.any(String) },
    ]);
  });
  test("muted conditions explain what the applicant can provide", () => {
    const out = evaluatePlanner(DEMO_PROFILE, { ...input(), mutedKeys: ["status", "participation"] }, demoCatalog(), now);
    const card = out.cards.find(c => c.offeringId === "demo-housing" && c.stageId === "current")!;
    expect(card.reasons).toEqual(expect.arrayContaining([
      { code: "MUTED_CONDITION", message: "현재 상태를 알려 주면 다시 판정해요" },
      { code: "MUTED_PARTICIPATION", message: "받고 있는 지원을 알려 주면 함께 받을 수 있는지 확인해요" },
    ]));
  });
  test("muting residence preserves a known disqualifying employment condition", () => {
    const o = { ...demoCatalog().find(o => o.offeringId === "demo-housing")!, rules: [{ key: "employed" as const, kind: "requires" as const, reviewed: true, evidenceId: "fixture-rule-1" }] };
    const out = evaluatePlanner(DEMO_PROFILE, { ...input(), mutedKeys: ["residence"] }, [o], now);
    expect(out.cards.find(c => c.stageId === "current")?.availability).toBe("blocked");
  });
  test("business registration ends unemployed eligibility", () => {
    const i = input(); i.events = [...(i.events ?? []), { id: "business", type: "business_registration", date: "2026-12-25", status: "scheduled" }];
    const result = evaluatePlanner(DEMO_PROFILE, i, demoCatalog(), now);
    expect(result.cards.find(c => c.offeringId === "demo-job-voucher" && c.stageId === "business")?.availability).toBe("blocked");
  });
  test("recommendation starts independently of the manual choices and never mutates input", () => {
    const i = input();
    i.choices = [{ offeringId: "demo-job-voucher", stageId: "ev-course" }];
    const clone = structuredClone(i);
    const out = evaluatePlanner(DEMO_PROFILE, i, demoCatalog(), now);
    expect(i).toEqual(clone);
    expect(out.recommendations).toEqual(run().recommendations);
    expect(new Set(out.recommendations.map(c => c.offeringId)).size).toBe(out.recommendations.length);
  });
  test("invalid date and conflicting same-day relocations fail input validation", () => {
    expect(PlannerInputSchema.safeParse({ ...input(), events: [{ id: "bad", type: "employment", date: "2027-02-30", status: "scheduled" }] }).success).toBe(false);
    const event = { type: "relocation", date: "2027-02-13", status: "scheduled" };
    expect(PlannerInputSchema.safeParse({ ...input(), events: [{ ...event, id: "a", sigungu: "11110" }, { ...event, id: "b", sigungu: "28185" }] }).success).toBe(false);
  });
  test("T06: an ineligible day separates application windows", () => {
    const o = { ...demoCatalog()[0], offeringId: "gapped", rules: [], official: { kind: "fixed" as const, start: "2026-11-01", end: "2027-02-17", closeAt: null } };
    const out = evaluatePlanner(DEMO_PROFILE, input(), [o], now, (_o, _p, date) => ({ availability: date === "2026-12-20" ? "blocked" : "eligible", reasons: [] }), ["2026-12-20", "2026-12-21"]);
    const current = out.cards.find(c => c.stageId === "current")!;
    expect(current.personalWindow?.end).toBe("2026-12-19");
    expect(current.personalWindow?.end).not.toBe("2027-02-17");
    const course = out.cards.find(c => c.stageId === "ev-course")!;
    expect(course.applicationWindows).toEqual([{ start: "2026-12-19", end: "2026-12-19" }, { start: "2026-12-21", end: "2027-02-17" }]);
  });
  test("T12–13: unreviewed or unknown benefit periods never block or recommend; disjoint benefits allow", () => {
    const catalog = demoCatalog();
    const b = catalog.find(o => o.offeringId === "demo-job-voucher")!;
    b.restrictions[0] = { ...b.restrictions[0], action: "benefit" };
    const i = input(); i.choices = [{ offeringId: "demo-search-2027-01", stageId: "ev-course" }];
    const unknown = evaluatePlanner(DEMO_PROFILE, i, catalog, now).cards.find(c => c.offeringId === b.offeringId && c.stageId === "ev-course")!;
    expect(unknown.availability).toBe("needs_check");
    expect(unknown.canReplace).toBe(false);
    b.restrictions[0].period = { start: "2027-01-01", end: "2027-01-31" };
    b.restrictions[0].otherPeriod = { start: "2027-02-01", end: "2027-02-28" };
    expect(evaluatePlanner(DEMO_PROFILE, i, catalog, now).cards.find(c => c.offeringId === b.offeringId && c.stageId === "ev-course")?.availability).toBe("eligible");
  });
  test("an unreviewed personal cutoff must not be presented as verified D-day", () => {
    const catalog = demoCatalog().map(o => ({ ...o, reviewed: false }));
    const card = run(undefined, catalog).cards.find(c => c.offeringId === "demo-search-2027-01" && c.stageId === "ev-course")!;
    expect(card.deadlineKind).toBe("unknown");
    expect(card.daysLeft).toBeNull();
  });
});
