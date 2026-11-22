import { expect, test } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import { pickExplainTarget } from "@/lib/planner/commands";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { DEMO_EVENTS, DEMO_PROFILE, demoCatalog, PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import type { Card, Evaluation } from "@/lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const earlier = (c: Card) => !!c.personalWindow?.end && !!c.official.end && c.personalWindow.end < c.official.end;

function demoData(): Evaluation {
  const out = handleJudge({ profile: { ...PERSONA_A, events: [] }, plannerV2: { revision: 1, events: PERSONA_DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" } }, now);
  if (!("plannerV2" in out.body)) throw new Error("no evaluation");
  return out.body.plannerV2 as Evaluation;
}

test("A-5: on the real demo data with nothing chosen, the example picks a card whose own deadline is earlier than the notice", () => {
  const target = pickExplainTarget(demoData(), []);
  expect(target).not.toBeNull();
  expect(earlier(target!)).toBe(true);
  expect(target!.availability).not.toBe("blocked");
});

test("A-5: an open detail is explained first", () => {
  const ev = evaluatePlanner(DEMO_PROFILE, { revision: 1, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, demoCatalog(), now);
  const other = ev.cards.find(c => c.offeringId === "demo-housing")!;
  expect(pickExplainTarget(ev, [], other)).toBe(other);
});

test("A-5: among chosen cards, one with an earlier own deadline wins over the first chosen", () => {
  const ev = evaluatePlanner(DEMO_PROFILE, { revision: 1, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, demoCatalog(), now);
  const early = ev.cards.find(c => earlier(c) && c.availability !== "blocked")!;
  const plain = ev.cards.find(c => !earlier(c) && c.offeringId !== early.offeringId)!;
  const choices = [{ offeringId: plain.offeringId, stageId: plain.stageId }, { offeringId: early.offeringId, stageId: early.stageId }];
  expect(pickExplainTarget(ev, choices)).toBe(early);
});

test("A-5: with no candidate at all it returns null", () => {
  const ev = evaluatePlanner(DEMO_PROFILE, { revision: 1, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, demoCatalog(), now);
  expect(pickExplainTarget({ ...ev, cards: [] }, [])).toBeNull();
});
