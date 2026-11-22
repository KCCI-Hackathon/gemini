import { expect, test } from "vitest";
import { selectBoardCards } from "@/lib/planner/board-cards";

const stages = ["current", "course", "job"].map(stageId => ({ stageId }));
function card(offeringId: string, stageId: string, availability: "eligible" | "needs_check" | "blocked" = "eligible", selectedStageId: string | null = null) {
  return { offeringId, stageId, availability, selectedStageId };
}

test("the board shows continuing policies once and places newly available policies in the stage where they open", () => {
  const current = card("open", "current");
  const continuing = card("open", "course");
  const blocked = card("new", "current", "blocked");
  const opened = card("new", "course", "needs_check");
  const after = card("new", "job");
  const unavailable = card("closed", "course", "blocked");
  expect(selectBoardCards(stages, [after, continuing, current, blocked, opened, unavailable]))
    .toEqual([current, blocked, opened]);
});

test("a separate round, a reopened policy and an explicitly selected later card stay visible", () => {
  const initial = card("policy:1", "current", "eligible", "course");
  const selected = card("policy:1", "course", "eligible", "course");
  const nextRound = card("policy:2", "course");
  const beforeGap = card("reopens", "current");
  const gap = card("reopens", "course", "blocked");
  const reopened = card("reopens", "job");
  expect(selectBoardCards(stages, [initial, selected, nextRound, beforeGap, gap, reopened]))
    .toEqual([initial, selected, nextRound, beforeGap, reopened]);
});
