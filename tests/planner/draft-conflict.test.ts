import { expect, test } from "vitest";
import { backendDraftConflict } from "@/lib/planner/catalog";
import type { Card } from "@/lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const window = { start: "2027-01-01", end: "2027-03-31" };
function card(policyId: string, title: string): Card {
  return {
    policyId, offeringId: policyId + ":2027", title, roundLabel: "2027", category: "life",
    summary: "", support: "", org: "", official: { ...window, kind: "fixed", closeAt: null },
    rules: [], evidence: [], restrictions: [], reviewed: true, dataVersion: "test", verifyLabel: null,
    stageId: "current", personalWindow: window, stageWindow: window, applicationWindows: [window],
    deadlineKind: "official", daysLeft: null, availability: "eligible", reasons: [],
    selectedStageId: null, otherStageIds: [], conflicts: [], canReplace: false,
  };
}
const dream = card("20260406005400212442", "드림For 청년통장");
const welfare = card("20260406005400212410", "재직청년 복지포인트");

test("I4 overlapping planned windows conflict through backend rules", () => {
  const out = backendDraftConflict(now)(dream, [welfare]);
  expect(out.blocked || out.uncertain).toBe(true);
  expect(out.reasons[0].code).toMatch(/DRAFT_CONFLICT|RESTRICTION_QUESTION/);
});
test("non-overlapping windows do not conflict", () => {
  const out = backendDraftConflict(now)(dream, [{ ...welfare, stageWindow: { start: "2027-06-01", end: "2027-06-30" } }]);
  expect(out.blocked).toBe(false);
});
test("open-ended window is not blocked", () => {
  const out = backendDraftConflict(now)(dream, [{ ...welfare, stageWindow: { start: "2027-01-01", end: null }, official: { ...welfare.official, end: null } }]);
  expect(out.blocked).toBe(false);
});
