import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Agent } from "@/app/workspace/Agent";
import { pickQuestion, questionKey } from "@/lib/planner/questions";
import type { BenefitQuestion } from "@/lib/planner/types";

const q = (ruleId: string, policyId = "p"): BenefitQuestion => ({ question: `${ruleId} 질문`, policyId, sourcePolicyId: "s", sourceName: "출처", ruleId, answerKind: "receiving" });
const qs = [q("r1"), q("r2"), q("r3")];

test("A-2: with nothing skipped the first question is shown with its position", () => {
  expect(pickQuestion(qs, new Set())).toEqual({ question: qs[0], index: 1, total: 3, skipped: 0 });
});
test("A-2: a skipped question moves to the next one instead of blocking the rest", () => {
  expect(pickQuestion(qs, new Set([questionKey(qs[0])]))).toEqual({ question: qs[1], index: 2, total: 3, skipped: 1 });
});
test("A-2: the same rule asked for two policies is two separate questions", () => {
  const twin = [q("r1", "a"), q("r1", "b")];
  expect(pickQuestion(twin, new Set([questionKey(twin[0])]))?.question).toBe(twin[1]);
});
test("A-2: when every question is skipped nothing is shown but the skip count is kept", () => {
  expect(pickQuestion(qs, new Set(qs.map(questionKey)))).toEqual({ question: null, index: 0, total: 3, skipped: 3 });
});
test("A-2: the agent shows the position and a skip button", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, questions: qs }));
  expect(html).toContain("질문 1/3");
  expect(html).toMatch(/<button\b[^>]*>나중에 답할게요<\/button>/);
});
