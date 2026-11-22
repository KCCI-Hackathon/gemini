import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Agent } from "@/app/workspace/Agent";
import { recommendationUpdate } from "@/app/workspace/counsel-view";

const rec = { source: "ai" as const, summary: "추천 요약", picks: [], notice: null };

test("추천 경로는 만들어진 자리에 한 번만 있고, 뒤에 오는 대화 아래로 따라 내려오지 않는다", () => {
  const messages = [
    { id: 1, role: "assistant" as const, text: "추천을 정리했어요" },
    { id: 2, role: "user" as const, text: "이 정책은 왜 확인 필요야?" },
    { id: 3, role: "assistant" as const, text: "공고에 소득 기준이 있어요" },
  ];
  const html = renderToStaticMarkup(React.createElement(Agent, { messages, busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, recommendation: rec, recommendationAt: 1 }));
  expect(html.match(/AI 추천 경로/g)?.length).toBe(1);
  expect(html.indexOf("AI 추천 경로")).toBeLessThan(html.indexOf("이 정책은 왜 확인 필요야?"));
});

test("자유 질문을 기다리는 동안에는 ‘추천 경로’ 로딩 문구를 띄우지 않는다", () => {
  const base = { messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, planLoading: true };
  expect(renderToStaticMarkup(React.createElement(Agent, { ...base, loadingAction: "message" }))).not.toContain("추천 경로");
  expect(renderToStaticMarkup(React.createElement(Agent, { ...base, loadingAction: "recommend" }))).toContain("AI 추천 경로를 확인하고 있어요");
});

test("자유 질문 · 후속 호출에서 온 조건 기준 추천(fallback)은 추천 경로를 다시 띄우지 않는다", () => {
  expect(recommendationUpdate("message", "fallback", false)).toEqual({ set: false, open: false });
  expect(recommendationUpdate("followup", "fallback", true)).toEqual({ set: false, open: false });
});

test("‘추천해줘’는 늘 추천 경로를 띄운다", () => {
  expect(recommendationUpdate("recommend", "plan", false)).toEqual({ set: true, open: true });
  expect(recommendationUpdate("recommend", "fallback", true)).toEqual({ set: true, open: true });
});

test("자유 질문에서 온 AI 추천은 이미 추천을 보고 있을 때만 조용히 바꾼다", () => {
  expect(recommendationUpdate("message", "plan", false)).toEqual({ set: false, open: false });
  expect(recommendationUpdate("followup", "plan", true)).toEqual({ set: true, open: false });
});
