// 통합 설계 6장: 계획 에이전트
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import { handlePlan, resetPlanState } from "@/lib/plan/handler";
import { summarizeForAI } from "@/lib/plan/summary";
import { scriptedClient } from "../verify/helpers";
import * as overlap from "@/lib/data/overlap";
import { rule, SOURCE, TARGET } from "../overlap/runtime-fixture";

const NOW = new Date("2026-11-18T12:00:00+09:00");
const KNEWDEAL = "20260714005400113258";
const USER: Profile = { ...PERSONA_A, source: "user", examDate: "2026-10-01", events: [{ type: "training_completion", date: "2027-02-18", status: "scheduled" }] };
const session = (profile: Profile) => ({ profile, plan: { employAfterMonths: 3 }, answers: {} });
const ON = { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k" };
const ctx = (env: Record<string, string>, client: ReturnType<typeof scriptedClient>) => ({ env, ip: "1.1.1.1", now: NOW, makeClient: () => client });

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
afterEach(() => vi.restoreAllMocks());

describe("summarizeForAI: AI로 가는 것은 요약뿐", () => {
  test("생년월일·시군구 코드·날짜·응시일이 없고 만 나이·시군구 이름·N개월 뒤만 있다", () => {
    const s = JSON.stringify(summarizeForAI(session(USER), NOW));
    expect(s).not.toContain("1999-03");
    expect(s).not.toContain("28185");
    expect(s).not.toMatch(ISO_DATE);
    expect(s).toContain("인천 연수구");
    expect(s).toContain("27");
    expect(s).toContain("3개월 뒤");
  });
});

describe("handlePlan: 실제 사용자는 스위치와 동의가 있어야", () => {
  beforeEach(() => resetPlanState());

  test("PLAN_AI_FOR_USERS가 꺼져 있으면(기본) 실제 사용자 요청은 AI를 부르지 않는다", async () => {
    const client = scriptedClient([]);
    const out = await handlePlan({ mode: "replan", persona: false, consent: true, session: session(USER) }, ctx(ON, client));
    expect(out.status).toBe(403);
    expect(out.body.disabled).toBe(true);
    expect(client.calls).toBe(0);
  });

  test("스위치가 켜져도 실제 사용자의 자유 입력(기타 글)은 받지 않는다", async () => {
    const client = scriptedClient([]);
    const out = await handlePlan({ mode: "answer", persona: false, consent: true, session: session(USER), otherText: "병원 때문에 3월쯤 취업" }, ctx({ ...ON, PLAN_AI_FOR_USERS: "true" }, client));
    expect(out.status).toBe(400);
    expect(client.calls).toBe(0);
  });

  test("외부 AI가 꺼져 있으면 503", async () => {
    const client = scriptedClient([]);
    const out = await handlePlan({ mode: "replan", persona: true, session: session(PERSONA_A) }, ctx({}, client));
    expect(out.status).toBe(503);
  });

  test("실제 사용자 요청 전체에 생년월일·시군구 코드·날짜가 없다", async () => {
    const client = scriptedClient([[{ name: "finish_plan", input: { summary: "정리", stations: [{ label: "지금", items: [{ policy_id: KNEWDEAL, why: "개시일 전 수료 여부를 먼저 확인" }] }] } }]]);
    const out = await handlePlan({ mode: "replan", persona: false, consent: true, session: session(USER) }, ctx({ ...ON, PLAN_AI_FOR_USERS: "true" }, client));
    expect(out.status).toBe(200);
    const sent = JSON.stringify(client.requests);
    expect(sent).not.toContain("1999-03");
    expect(sent).not.toContain("28185");
    expect(sent).not.toContain("2026-10-01");
    expect(sent).not.toContain("2027-02-18");
  });

  test("내부 판정과 자료 버전이 달라지면 캐시를 구분하고 수혜 사실을 AI에 전송하지 않는다", async () => {
    vi.spyOn(overlap, "loadOverlap").mockReturnValue(new Map([[TARGET, [rule({ condition_type: "within_months_after_end", condition_params: { months: 6 } })]]]));
    const version = vi.spyOn(overlap, "overlapDataVersion").mockReturnValue("version1");
    const client = scriptedClient(Array.from({ length: 3 }, () => [
      { name: "get_route", input: {} },
    ]).flatMap(c => [c, [{ name: "finish_plan", input: { summary: "계획", stations: [] } }]]));
    const req = async (lastPaymentDate: string) => handlePlan({ mode: "replan", persona: false, consent: true, session: {
      ...session({ ...USER, sigungu: "00000" }), benefits: [{ policyId: SOURCE, status: "ended", lastPaymentDate, monthlyPayment: { month: "2026-03", amountWon: 1234598 } }],
    } }, ctx({ ...ON, PLAN_AI_FOR_USERS: "true" }, client));
    expect((await req("2026-08-07")).body.fallback).toBe(false);
    await req("2026-08-07");
    expect(client.calls).toBe(2);
    expect((await req("2026-03-08")).body.fallback).toBe(false);
    expect(client.calls).toBe(4);
    version.mockReturnValue("version2");
    await req("2026-03-08");
    expect(client.calls).toBe(6);
    expect(JSON.stringify(client.requests)).not.toMatch(/lastPaymentDate|monthlyPayment|2026-08-07|2026-03-08|1234598/);
  });
});

describe("계획 에이전트(가상 인물)", () => {
  beforeEach(() => resetPlanState());

  test("finish_plan: 아는 정책·정거장이면 계획을 돌려준다", async () => {
    const client = scriptedClient([
      [{ name: "get_route", input: {} }],
      [{ name: "finish_plan", input: { summary: "수료 전후로 확인할 정책을 정리했어요", stations: [{ label: "지금", items: [{ policy_id: KNEWDEAL, why: "개시일 전 수료 여부 확인" }] }] } }],
    ]);
    const out = await handlePlan({ mode: "replan", persona: true, session: session(PERSONA_A) }, ctx(ON, client));
    expect(out.body.fallback).toBe(false);
    expect(out.body.plan!.stations[0].items[0]).toMatchObject({ policyId: KNEWDEAL, name: "K-뉴딜 아카데미" });
  });

  test("모르는 정책 번호가 있으면 계획 전체를 버린다", async () => {
    const client = scriptedClient([[{ name: "finish_plan", input: { summary: "s", stations: [{ label: "지금", items: [{ policy_id: "29990101000000000000", why: "x" }] }] } }]]);
    const out = await handlePlan({ mode: "replan", persona: true, session: session(PERSONA_A) }, ctx(ON, client));
    expect(out.body.fallback).toBe(true);
    expect(out.body.plan).toBeUndefined();
  });

  test("금지 표현(권유)이 있으면 버린다", async () => {
    const client = scriptedClient([[{ name: "finish_plan", input: { summary: "취업을 미루면 받을 수 있어요", stations: [] } }]]);
    const out = await handlePlan({ mode: "replan", persona: true, session: session(PERSONA_A) }, ctx(ON, client));
    expect(out.body.fallback).toBe(true);
  });

  test("기타 글 해석: 정해진 형식의 값만 받고, 확인 전 값으로 돌려준다", async () => {
    const client = scriptedClient([[{ name: "parse_other_answer", input: { key: "employ", value: "6" } }]]);
    const out = await handlePlan({ mode: "answer", persona: true, session: session(PERSONA_A), otherText: "반년쯤 뒤에 취업할래요" }, ctx(ON, client));
    expect(out.body.parsed).toEqual({ key: "employ", value: "6", label: "취업 6개월 뒤", needsConfirm: true });
  });

  test("기타 글 해석: 모르는 질문 key나 형식 밖 값은 거절", async () => {
    const client = scriptedClient([[{ name: "parse_other_answer", input: { key: "income", value: "300" } }], [{ name: "parse_other_answer", input: { key: "employ", value: "99" } }], [{ name: "no_more_questions", input: {} }]]);
    const out = await handlePlan({ mode: "answer", persona: true, session: session(PERSONA_A), otherText: "x" }, ctx(ON, client));
    expect(out.body.parsed).toBeUndefined();
  });

  test("ask_user: 코드가 고른 질문 후보 중에서만, 선택지는 코드가 붙인다", async () => {
    const client = scriptedClient([[{ name: "ask_user", input: { key: "participating_national_employment_support", text: "국민취업지원제도에 참여하고 계신가요?" } }]]);
    const out = await handlePlan({ mode: "answer", persona: true, session: session(PERSONA_A) }, ctx(ON, client));
    expect(out.body.question).toEqual({ key: "participating_national_employment_support", text: "국민취업지원제도에 참여하고 계신가요?", options: ["예", "아니오", "모름"] });
  });
});
