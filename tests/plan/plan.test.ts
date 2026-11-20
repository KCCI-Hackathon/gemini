// 통합 설계 6장: 계획 에이전트
import { beforeEach, describe, expect, test } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import { handlePlan, resetPlanState } from "@/lib/plan/handler";
import { summarizeForAI } from "@/lib/plan/summary";
import { scriptedClient } from "../verify/helpers";

const NOW = new Date("2026-11-18T12:00:00+09:00");
const KNEWDEAL = "20260714005400113258";
const USER: Profile = { ...PERSONA_A, source: "user", examDate: "2026-10-01", events: [{ type: "training_completion", date: "2027-02-18", status: "scheduled" }] };
const session = (profile: Profile) => ({ profile, plan: { employAfterMonths: 3 }, answers: {} });
const ON = { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "k" };
const ctx = (env: Record<string, string>, client: ReturnType<typeof scriptedClient>) => ({ env, ip: "1.1.1.1", now: NOW, makeClient: () => client });

const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

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
});

describe("계획 에이전트(가상 인물)", () => {
  beforeEach(() => resetPlanState());

  test("수강 제한의 근거에 맞춰 날짜 비교와 수료 후의 가정을 안내한다", async () => {
    const item = { policy_id: KNEWDEAL, why: "신청 자격을 확인하세요." };
    const client = scriptedClient([[{ name: "finish_plan", input: { summary: "계획", stations: [
      { label: "지금", items: [item] }, { label: "수료 후(1개월 뒤)", items: [item] },
    ] } }]]);
    const out = await handlePlan({ mode: "replan", persona: true, session: session(PERSONA_A) }, {
      ...ctx(ON, client), now: new Date("2026-11-19T12:00:00+09:00"),
    });
    const why = out.body.plan!.stations.map((s) => s.items[0].why);
    expect(why[0]).toMatch(/수료.*과정 시작일/);
    expect(why[1]).toMatch(/예정대로 수료하면.*증빙/);
  });

  test("K-뉴딜은 지금과 수료 후의 판정 및 사유를 따로 전달한다", async () => {
    const client = scriptedClient([
      [{ name: "get_route", input: {} }],
      [{ name: "finish_plan", input: { summary: "정리", stations: [] } }],
    ]);
    await handlePlan({ mode: "replan", persona: true, session: session(PERSONA_A) }, {
      ...ctx(ON, client), now: new Date("2026-11-19T12:00:00+09:00"),
    });
    const request = client.requests[1] as { messages: { content: { content: string }[] }[] };
    const route = JSON.parse(request.messages.at(-1)!.content[0].content);
    const target = (p: { policy_id: string }) => p.policy_id === KNEWDEAL;
    const now = route.stations.find((s: { label: string }) => s.label === "지금");
    const after = route.stations.find((s: { label: string }) => s.label === "수료 후(1개월 뒤)");
    expect(now.policies.find(target)).toMatchObject({
      status: "확인 필요", reasons: expect.arrayContaining([expect.stringContaining("개시일 전")]),
    });
    expect(after.changed_policies.find(target)).toMatchObject({ status: "조건 충족", reasons: [] });
  });

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
