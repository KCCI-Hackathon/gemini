import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Agent } from "@/app/workspace/Agent";
import { ProfileForm } from "@/app/workspace/Dialogs";
import { loadOverlap } from "@/lib/data/overlap";
import { evaluateRules } from "@/lib/judge/overlap";
import { PERSONA_A } from "@/lib/judge/personas";
import { applyAnswer } from "@/lib/planner/answers";
import type { BenefitQuestion } from "@/lib/planner/types";

const RENT_SRC = "20250617005400110952", RENT_YEONSU = "20260406005400212400";
const rules = loadOverlap().get(RENT_YEONSU)!.filter(r => r.source_policy_id === RENT_SRC);
const amountAsk = (benefits: Parameters<typeof evaluateRules>[1], now: Date) =>
  evaluateRules(rules, benefits, [], now).current_restrictions.find(r => r.need === "monthly_amount");

test("F-3: the question shown, the answer stored and the re-judgement all use the question's month; other months stay open", () => {
  const nov = new Date("2026-11-22T12:00:00+09:00"), dec = new Date("2026-12-22T12:00:00+09:00");
  const receiving = [{ policyId: RENT_SRC, status: "receiving" as const }];
  const ask = amountAsk(receiving, nov)!;
  expect(ask.month).toBe("2026-11");
  expect(ask.question).toBe("11월에 실제로 지급받은 금액은 얼마인가요?");
  const q: BenefitQuestion = { policyId: RENT_YEONSU, sourcePolicyId: RENT_SRC, sourceName: "청년월세", ruleId: ask.ruleId, question: ask.question!, answerKind: "monthly_amount", month: ask.month };
  const saved = applyAnswer(receiving, q, { kind: "monthly_amount", month: q.month!, amountWon: 0 });
  // 앞서 "받고 있어요"라고 한 상태는 0원 입력으로 지우지 않는다
  expect(saved).toEqual([{ policyId: RENT_SRC, status: "receiving", monthlyPayment: { month: "2026-11", amountWon: 0 } }]);
  expect(amountAsk(saved, nov)).toBeUndefined();
  // 12월은 따로 묻는다. 11월 답이 12월을 덮지 않고, 12월 답이 11월을 지우지 않는다.
  expect(amountAsk(saved, dec)?.month).toBe("2026-12");
  const both = applyAnswer(saved, { ...q, month: "2026-12" }, { kind: "monthly_amount", month: "2026-12", amountWon: 0 });
  expect(both.filter(b => b.monthlyPayment).map(b => b.monthlyPayment!.month).sort()).toEqual(["2026-11", "2026-12"]);
  expect(amountAsk(both, dec)).toBeUndefined();
});

test("F-3: the agent's amount input names the question's month, not the browser's month", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, today: "2026-11-22",
    questions: [{ policyId: "t", sourcePolicyId: RENT_SRC, sourceName: "청년월세", ruleId: "r", question: "12월에 실제로 지급받은 금액은 얼마인가요?", answerKind: "monthly_amount", month: "2026-12" }] }));
  expect(html).toContain("12월에 받은 금액(원)");
  expect(html).not.toContain("이번 달 받은 금액");
});

test("F-4: the privacy line matches each mode's real data path", () => {
  const user = renderToStaticMarkup(React.createElement(ProfileForm, { onSave: () => {} }));
  expect(user).toContain("외부 AI로 보내지 않아요");
  const demo = renderToStaticMarkup(React.createElement(ProfileForm, { onSave: () => {}, initial: { ...PERSONA_A, events: [] } }));
  expect(demo).not.toContain("입력 정보는 외부 AI로 보내지 않아요");
  expect(demo).toContain("시연 인물");
  expect(demo).toContain("수혜 입력은 판정에만");
});
