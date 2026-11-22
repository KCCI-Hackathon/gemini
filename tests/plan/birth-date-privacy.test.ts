import { expect, test } from "vitest";
import { summarizeForAI } from "@/lib/plan/summary";
import { PERSONA_A } from "@/lib/judge/personas";

test("AI receives exact-age summary without the user's exact birth date", () => {
  const birthDate = "1999-08-17";
  const session = { profile: { ...PERSONA_A, birthYm: "1999-08", birthDate, events: [] }, plan: {}, answers: {} };
  const summary = JSON.stringify(summarizeForAI(session, new Date("2026-11-23T12:00:00+09:00")));
  expect(summary).not.toContain(birthDate);
  expect(summary).toContain("만 27세");
});
