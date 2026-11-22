import { expect, test, vi } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import { attachPicks, canUseAi, requestAiRecommendation, toLegacyPlan } from "@/lib/planner/plan-request";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { demoCatalog, DEMO_EVENTS, DEMO_PROFILE } from "@/lib/planner/fixtures";

const evaluation = evaluatePlanner(DEMO_PROFILE, { revision: 1, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, demoCatalog(), new Date("2026-11-22T12:00:00+09:00"));
const args = { profile: { ...PERSONA_A, events: [] }, evaluation, events: DEMO_EVENTS, seq: 1, currentSeq: () => 1 };
test("dates become legacy month offsets", () => {
  expect(toLegacyPlan([{ id: "c", type: "training_completion", date: "2026-12-19", status: "scheduled" }, { id: "e", type: "employment", date: "2027-06-20", status: "scheduled" }], "2026-11-22")).toEqual({ employAfterMonths: 6, businessAfterMonths: null, move: null });
  expect(toLegacyPlan([{ id: "e", type: "employment", date: "2028-06-01", status: "scheduled" }], "2026-11-22").employAfterMonths).toBe(12);
});
test("persona gate", () => {
  expect(canUseAi({ ...PERSONA_A, events: [] })).toBe(true);
  expect(canUseAi({ ...PERSONA_A, birthYm: "2000-01", events: [] })).toBe(false);
});

test("blocked AI pick is dropped with a notice", () => {
  const blocked = evaluation.cards.find(card => card.availability === "blocked")!;
  const result = attachPicks([{ label: "지금", items: [{ policyId: blocked.policyId, why: "추천 이유" }] }], { ...evaluation, cards: [blocked] });
  expect(result.picks).toEqual([]);
  expect(result.notice).toBe("AI 추천 일부가 지금 일정과 맞지 않아요");
});
test("non-persona never calls plan api", async () => {
  const fetcher = vi.fn();
  const result = await requestAiRecommendation({ ...args, profile: { ...args.profile, birthYm: "2000-01" }, fetcher });
  expect(fetcher).not.toHaveBeenCalled();
  expect(result?.source).toBe("rule");
});
test("stale plan response is dropped", async () => {
  let seq = 1;
  let respond!: (response: Response) => void;
  const fetcher = vi.fn(() => new Promise<Response>(resolve => { respond = resolve; }));
  const pending = requestAiRecommendation({ ...args, fetcher, currentSeq: () => seq });
  expect(fetcher).toHaveBeenCalledTimes(1);
  seq = 2;
  respond(Response.json({ plan: { summary: "이전 일정", stations: [] } }));
  expect(await pending).toBeNull();
});
