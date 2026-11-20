import { expect, test } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { DEMO_EVENTS, DEMO_PROFILE } from "@/lib/planner/fixtures";
const now = new Date("2026-11-21T12:00:00+09:00");
const plannerV2 = { revision: 7, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" };
test("judge retains legacy fields and adds server-owned synthetic demo evaluation", () => {
  const out = handleJudge({ profile: DEMO_PROFILE, plannerV2 }, now);
  expect(out.status).toBe(200);
  expect(out.body).toHaveProperty("roadmap");
  expect(out.body).toHaveProperty("items");
  expect(out.body).toHaveProperty("plannerV2.today", "2026-11-19");
  expect(out.body).toHaveProperty("plannerV2.revision", 7);
}, 60000);
test("malformed v2 dates are rejected with field information", () => {
  const out = handleJudge({ profile: DEMO_PROFILE, plannerV2: { ...plannerV2, events: [{ ...DEMO_EVENTS[0], date: "2027-02-30" }] } }, now);
  expect(out.status).toBe(400);
  expect(out.body).toHaveProperty("field");
});
