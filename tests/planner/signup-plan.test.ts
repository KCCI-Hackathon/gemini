import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ProfileForm } from "@/app/workspace/Dialogs";
import { startInput } from "@/app/workspace/Entry";
import { screenOf } from "@/app/workspace/Nav";
import { PERSONA_A } from "@/lib/judge/personas";
import { evaluateRequest } from "@/lib/planner/catalog";
import { EMPTY_PLAN, planFromAnswers, type PlanAnswers } from "@/lib/planner/plan-answers";
import { PlannerInputSchema } from "@/lib/planner/schema";

const today = "2026-11-23";
const none: PlanAnswers = { ...EMPTY_PLAN, training: false, job: "none", move: false, startup: false };

test("1. 계획이 모두 없으면 일정 없이 현재 상태는 모름", () => {
  expect(planFromAnswers(none, today)).toEqual({ ok: true, events: [], currentStatus: [] });
});
test("2. 직업 훈련 중이면 수료 일정과 수강 중 · 미취업 상태", () => {
  const r = planFromAnswers({ ...none, training: true, courseEnd: "2026-12-19" }, today);
  expect(r).toMatchObject({ ok: true, currentStatus: ["in_training", "unemployed"], events: [{ type: "training_completion", date: "2026-12-19" }] });
});
test("3. 취업 계획이 있으면 취업 일정과 미취업 상태", () => {
  expect(planFromAnswers({ ...none, job: "plan", jobDate: "2027-02-19" }, today)).toMatchObject({ ok: true, currentStatus: ["unemployed"], events: [{ type: "employment", date: "2027-02-19" }] });
});
test("4. 이사 계획은 날짜와 지역을 함께 일정으로", () => {
  expect(planFromAnswers({ ...none, move: true, moveDate: "2027-03-01", moveTo: "11110" }, today)).toMatchObject({ ok: true, events: [{ type: "relocation", date: "2027-03-01", sigungu: "11110" }] });
});
test("5. 창업 계획은 사업자 등록 일정으로", () => {
  expect(planFromAnswers({ ...none, startup: true, startupDate: "2027-05-02" }, today)).toMatchObject({ ok: true, events: [{ type: "business_registration", date: "2027-05-02" }] });
});
test("6. 답하지 않은 질문이 있으면 그 칸을 알려 준다", () => {
  expect(planFromAnswers({ ...none, training: null }, today)).toMatchObject({ ok: false, field: "training" });
  expect(planFromAnswers({ ...none, startup: null }, today)).toMatchObject({ ok: false, field: "startup" });
});
test("7. 오늘보다 앞선 날짜와 빈 날짜는 받지 않는다", () => {
  expect(planFromAnswers({ ...none, job: "plan", jobDate: "2026-11-01" }, today)).toMatchObject({ ok: false, field: "jobDate", message: expect.stringContaining("오늘(2026-11-23) 이후") });
  expect(planFromAnswers({ ...none, training: true, courseEnd: "" }, today)).toMatchObject({ ok: false, field: "courseEnd" });
});
test("8. 이사 지역을 고르지 않으면 받지 않는다", () => {
  expect(planFromAnswers({ ...none, move: true, moveDate: "2027-03-01" }, today)).toMatchObject({ ok: false, field: "moveTo" });
});
test("9. 계획 일정이 첫 판정 입력과 정책 보드의 시점 열이 된다", () => {
  const plan = planFromAnswers({ training: true, courseEnd: "2026-12-19", job: "plan", jobDate: "2027-02-19", move: true, moveDate: "2027-03-01", moveTo: "11110", startup: true, startupDate: "2027-05-02" }, today);
  if (!plan.ok) throw new Error(plan.message);
  const profile = { ...PERSONA_A, source: "user" as const, events: [], currentStatus: plan.currentStatus };
  const input = startInput(profile, false, [], plan.events);
  expect(PlannerInputSchema.safeParse(input).success).toBe(true);
  expect(input.events).toHaveLength(4);
  const evaluation = evaluateRequest(profile, input, new Date(`${today}T10:00:00+09:00`));
  expect(evaluation.stages.length).toBeGreaterThanOrEqual(5); // 현재 + 수료 · 취업 · 이사 · 창업
}, 30_000);
test("10. 회원가입 내 정보에는 현재 상태가 없고, 계획 화면 주소가 있다", () => {
  const signup = renderToStaticMarkup(React.createElement(ProfileForm, { onSave: () => {}, showStatus: false }));
  expect(signup).not.toContain("현재 상태");
  expect(renderToStaticMarkup(React.createElement(ProfileForm, { onSave: () => {} }))).toContain("현재 상태");
  expect(screenOf("#planning")).toBe("planning");
});
