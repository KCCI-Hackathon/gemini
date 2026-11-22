import { expect, test } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import { DEMO_EVENTS, PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
const now = new Date("2026-11-22T12:00:00+09:00");
const plannerV2 = { revision: 7, events: PERSONA_DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" };
test("demo entry uses real data with the registered persona", () => {
  const out = handleJudge({ profile: { ...PERSONA_A, events: [] }, plannerV2 }, now);
  expect(out.status).toBe(200);
  expect(out.body).toHaveProperty("plannerV2.today", "2026-11-22");
  expect(out.body).toHaveProperty("plannerV2.demo", true);
  const evaluation = "plannerV2" in out.body ? out.body.plannerV2 : undefined;
  expect(evaluation?.cards.some(c => c.offeringId.startsWith("demo-"))).toBe(false);
});
test("malformed v2 dates are rejected with field information", () => {
  const out = handleJudge({ profile: PERSONA_A, plannerV2: { ...plannerV2, events: [{ ...DEMO_EVENTS[0], date: "2027-02-30" }] } }, now);
  expect(out.status).toBe(400);
  expect(out.body).toHaveProperty("field");
});
