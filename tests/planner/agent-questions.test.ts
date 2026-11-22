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

test("GPT 재설계 8장: a real user sees the consent box before any AI use", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, consentNeeded: true, onConsent: () => {} }));
  expect(html).toContain("AI 상담 사용");
  expect(html).toContain("보내지 않고");
});
test("GPT 재설계 8장: an AI question shows code-made inputs for its target and replaces the code question", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, questions: qs,
    aiQuestion: { text: "교육은 언제 끝나요?", target: { kind: "event", event: "training_completion" } } }));
  expect(html).toContain("교육은 언제 끝나요?");
  expect(html).toContain('type="date"');
  expect(html).not.toContain("질문 1/3");
});

test("question card names the source program instead of '해당 사업', shows which policy it changes, and uses styled answer buttons", () => {
  const q = { question: "해당 사업의 지원금을 현재 받고 있나요?", policyId: "target", sourcePolicyId: "s", sourceName: "국민취업지원제도", ruleId: "r", answerKind: "receiving" as const };
  const card = { policyId: "target", title: "청년도전지원사업" } as never;
  const html = renderToStaticMarkup(React.createElement(Agent, { messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, questions: [q], cards: [card] }));
  expect(html).toContain("국민취업지원제도의 지원금을 현재 받고 있나요?");
  expect(html).not.toContain("해당 사업");
  expect(html).toContain("답하면 ‘청년도전지원사업’ 판정이 바뀌어요");
  expect(html).toMatch(/<button class="[^"]*answerButton[^"]*"[^>]*>받고 있어요<\/button>/);
});
