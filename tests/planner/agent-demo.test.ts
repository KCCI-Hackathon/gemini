import { expect, test } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import { parseScheduleCommand } from "@/lib/planner/commands";
import { AGENT_EXAMPLES, PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import { personaPlan } from "@/lib/planner/plan-request";

const today = "2026-11-22";

test("A-3: the demo schedule has an employment date, so the schedule example changes it instead of asking for a year", () => {
  const command = parseScheduleCommand(AGENT_EXAMPLES[0], PERSONA_DEMO_EVENTS);
  const employment = PERSONA_DEMO_EVENTS.find(event => event.type === "employment");
  expect(command).toEqual({ type: "update_event", eventId: employment?.id, date: "2027-02-19" });
});

test("A-3: the demo schedule and the example's result both stay usable for the AI plan", () => {
  expect(personaPlan(PERSONA_DEMO_EVENTS, PERSONA_A, today)).toEqual({ employAfterMonths: 1, businessAfterMonths: null, move: null });
  const moved = PERSONA_DEMO_EVENTS.map(event => event.type === "employment" ? { ...event, date: "2027-02-19" } : event);
  expect(personaPlan(moved, PERSONA_A, today)?.employAfterMonths).toBe(2);
});

test("A-3: the explain example is read as a question, not a schedule change", () => {
  expect(parseScheduleCommand(AGENT_EXAMPLES[1], PERSONA_DEMO_EVENTS).type).toBe("explain");
  expect(parseScheduleCommand(AGENT_EXAMPLES[2], PERSONA_DEMO_EVENTS).type).toBe("recommend");
});
