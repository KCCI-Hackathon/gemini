import { beforeEach, expect, test } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import { handlePlan, resetPlanState } from "@/lib/plan/handler";
import { scriptedClient } from "../verify/helpers";

const KNEWDEAL = "20260714005400113258";
const EXAM = "20260406005400212445";
const NOW = new Date("2026-11-19T12:00:00+09:00");
const demo = { mode: "replan", persona: true, session: { profile: PERSONA_A, plan: { employAfterMonths: 3 } } };
const finish = (input: Record<string, unknown>) => [{ name: "finish_plan", input }];
const context = (client: ReturnType<typeof scriptedClient>) => ({
  env: { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k", PLAN_AI_FOR_USERS: "true" },
  ip: "127.0.0.1", now: NOW, makeClient: () => client,
});

beforeEach(() => resetPlanState());

test("형식이 깨진 추천을 받으면 예외 없이 기본 로드맵으로 돌아간다", async () => {
  for (const item of [null, { policy_id: KNEWDEAL }]) {
    const client = scriptedClient([finish({ summary: "정리", stations: [{ label: "지금", items: [item] }] })]);
    const out = await handlePlan(demo, context(client));
    expect(out).toMatchObject({ status: 200, body: { fallback: true } });
    expect(out.body.plan).toBeUndefined();
    expect(client.calls).toBe(1);
  }
});

test("실제 정책을 추천 대상이 아닌 정거장에 배치한 응답을 버린다", async () => {
  const client = scriptedClient([finish({ summary: "정리", stations: [{ label: "취업 후(4개월 뒤)", items: [{ policy_id: KNEWDEAL, why: "신청 조건 확인" }] }] })]);
  const out = await handlePlan(demo, context(client));
  expect(out.body.fallback).toBe(true);
});

test("올바른 조합은 유지하되 모델이 추가한 금액과 날짜를 표시하지 않는다", async () => {
  const client = scriptedClient([finish({ summary: "777억 원을 지원합니다", stations: [{ label: "지금", items: [
    { policy_id: KNEWDEAL, why: "2040-05-21에 999억 원을 지급합니다." },
    { policy_id: EXAM, why: "2041-06-22에 팔백만 원을 지급합니다." },
  ] }] })]);
  const out = await handlePlan(demo, context(client));
  expect(out.body.plan?.stations[0].items.map(({ policyId }) => policyId)).toEqual([KNEWDEAL, EXAM]);
  expect(JSON.stringify(out.body.plan)).not.toMatch(/777|2040|999|2041|팔백만/);
});

test("응시일이 취업일 경계를 넘으면 계획을 새로 계산하고 같은 결과는 재사용한다", async () => {
  const request = (examDate: string) => {
    const profile: Profile = {
      ...PERSONA_A, source: "user", currentStatus: ["unemployed"],
      events: [{ type: "employment", date: "2026-10-15", status: "simulated" }], examDate,
    };
    return { mode: "replan", persona: false, consent: true, session: { profile } };
  };
  const before = request("2026-10-01");
  const after = request("2026-11-01");
  const decision = (req: typeof before) => {
    const { body } = handleJudge(req.session, NOW);
    if (!("items" in body)) throw new Error(body.error);
    return body.items.find((item) => item.id === EXAM)?.personal;
  };
  expect(decision(before)).toBe("needs_check");
  expect(decision(after)).toBe("ineligible");
  const client = scriptedClient([
    finish({ summary: "정리", stations: [{ label: "지금", items: [{ policy_id: EXAM, why: "응시일 기준 확인" }] }] }),
    finish({ summary: "정리", stations: [{ label: "지금", items: [] }] }),
  ]);
  const first = await handlePlan(before, context(client));
  const second = await handlePlan(after, context(client));
  const third = await handlePlan(after, context(client));
  expect(first.body.plan?.stations[0]?.items[0]?.policyId).toBe(EXAM);
  expect(second.body.plan?.stations[0]?.items).toEqual([]);
  expect(third).toEqual(second);
  expect(client.calls).toBe(2);
}, 20_000);
