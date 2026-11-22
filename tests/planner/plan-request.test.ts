import { expect, test, vi } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import { attachPicks, canUseAi, requestAiRecommendation, toLegacyPlan } from "@/lib/planner/plan-request";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { demoCatalog, DEMO_EVENTS, DEMO_PROFILE } from "@/lib/planner/fixtures";
import type { PlanEvent } from "@/lib/planner/types";

const evaluation = evaluatePlanner(DEMO_PROFILE, { revision: 1, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, demoCatalog(), new Date("2026-11-22T12:00:00+09:00"));
// 서버는 시연 원본 수료일(2026-12-19)에 개월 수를 더해 취업일을 만든다. 그 격자 위에 있는 일정.
const ALIGNED: PlanEvent[] = [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }, { id: "ev-job", type: "employment", date: "2027-01-19", status: "scheduled" }];
const args = { profile: { ...PERSONA_A, events: [] }, evaluation, events: ALIGNED, seq: 1, currentSeq: () => 1 };
const sentPlan = (fetcher: ReturnType<typeof vi.fn>) => JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string).session.plan;
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
const ok = () => vi.fn(async () => Response.json({ plan: { summary: "요약", stations: [] } }));
test("A-1: offsets are counted from the persona's own completion date, as the server does", async () => {
  const fetcher = ok();
  await requestAiRecommendation({ ...args, fetcher, events: [ALIGNED[0], { ...ALIGNED[1], date: "2027-04-19" }] });
  expect(sentPlan(fetcher).employAfterMonths).toBe(4);
});
test("A-1: a completion date moved on screen falls back to rules without calling AI", async () => {
  const fetcher = ok();
  const result = await requestAiRecommendation({ ...args, fetcher, events: [{ ...ALIGNED[0], date: "2027-02-15" }, { ...ALIGNED[1], date: "2027-06-15" }] });
  expect(fetcher).not.toHaveBeenCalled();
  expect(result?.source).toBe("rule");
  expect(result?.notice).toBe("화면 일정이 AI 계획 기준과 달라 조건 기준 경로를 표시해요");
});
test("A-1: an employment date between whole months falls back instead of being rounded", async () => {
  const fetcher = ok();
  const result = await requestAiRecommendation({ ...args, fetcher, events: [ALIGNED[0], { ...ALIGNED[1], date: "2027-01-20" }] });
  expect(fetcher).not.toHaveBeenCalled();
  expect(result?.source).toBe("rule");
});
test("A-1: removing the completion event on screen also falls back", async () => {
  const fetcher = ok();
  await requestAiRecommendation({ ...args, fetcher, events: [{ ...ALIGNED[1], date: "2027-03-19" }] });
  expect(fetcher).not.toHaveBeenCalled();
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
