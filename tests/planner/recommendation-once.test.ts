import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Agent } from "@/app/workspace/Agent";
import { recommendationUpdate, recommendationEntries, recommendationMessage, revealRecommendationView } from "@/app/workspace/counsel-view";
import type { Card } from "@/lib/planner/types";

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
  expect(renderToStaticMarkup(React.createElement(Agent, { ...base, loadingAction: "recommend" }))).toContain("길잡이가 경로를 고르고 있어요");
});

test("조건 기준 경로에 사유가 있는 확인 필요 카드가 표시된다", () => {
  const recommendation = { source: "rule" as const, summary: "", notice: null,
    picks: [{ offeringId: "policy", stageId: "current", why: [], confirmation: "현재 상태를 알려 주세요." }] };
  const html = renderToStaticMarkup(React.createElement(Agent, {
    messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, recommendation,
    cards: [{ offeringId: "policy", stageId: "current", title: "주거 지원" } as Card],
  }));
  expect(html).toContain("조건 기준 추천 경로");
  expect(html).toContain("확인 필요 · 현재 상태를 알려 주세요.");
});

test("추천 질문 중에도 현재 조건으로 경로를 바로 열 수 있다", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, {
    messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {},
    aiQuestion: { text: "현재 상태가 어떤가요?", target: { kind: "status" } },
    onShowRecommendation: () => {},
  }));
  expect(html).toContain("지금 추천 보기");
});

test("준비된 추천 질문에서는 답변을 건너뛰어 경로를 열 수 없다", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, {
    messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {},
    aiQuestion: { text: "현재 상태가 어떤가요?", target: { kind: "status" }, preparedAnswers: new Set(["recent_history"]) },
    onShowRecommendation: () => {},
  }));
  expect(html).toContain("추천 질문 2");
  expect(html).toContain("추천 질문 그만하기");
  expect(html).not.toContain("지금 추천 보기");
});

test("자유 질문 · 후속 호출에서 온 조건 기준 추천(fallback)은 추천 경로를 다시 띄우지 않는다", () => {
  expect(recommendationUpdate("message", "fallback", false)).toEqual({ set: false, open: false });
  expect(recommendationUpdate("followup", "fallback", true)).toEqual({ set: false, open: false });
});

test("‘추천해줘’는 늘 추천 경로를 띄운다", () => {
  expect(recommendationUpdate("recommend", "plan", false)).toEqual({ set: true, open: true });
  expect(recommendationUpdate("recommend", "plan", true)).toEqual({ set: true, open: true });
  expect(recommendationUpdate("recommend", "fallback", true)).toEqual({ set: true, open: true });
});

test("답변 뒤 재판정으로 기존 추천이 지워져도 추천 중인 후속 응답을 표시한다", () => {
  expect(recommendationUpdate("followup", "plan", false, true)).toEqual({ set: true, open: true });
  expect(recommendationUpdate("followup", "fallback", false, true)).toEqual({ set: true, open: true });
});

test("자유 질문에서 온 AI 추천은 이미 추천을 보고 있을 때만 조용히 바꾼다", () => {
  expect(recommendationUpdate("message", "plan", false)).toEqual({ set: false, open: false });
  expect(recommendationUpdate("followup", "plan", true)).toEqual({ set: true, open: false });
});

test("추천 응답은 같은 회차 카드만 채팅과 상단 경로에서 공유한다", () => {
  const recommendation = { source: "ai" as const, summary: "주거 경로", notice: "조건 기준으로 일부를 채웠어요.", picks: [
    { offeringId: "home", stageId: "current", why: ["현재 조건과 맞아요"] },
    { offeringId: "home", stageId: "job", why: ["취업 후 신청"], filled: true },
    { offeringId: "home", stageId: "missing-stage", why: ["유효하지 않은 시점"] },
  ] };
  const cards = [
    { offeringId: "home", stageId: "current", title: "주거지원 A" },
    { offeringId: "home", stageId: "job", title: "주거지원 A" },
  ] as Card[];
  expect(recommendationEntries(recommendation, cards).map(({ pick, card }) => [pick.stageId, card.title, !!pick.filled])).toEqual([
    ["current", "주거지원 A", false], ["job", "주거지원 A", true],
  ]);
  const html = renderToStaticMarkup(React.createElement(Agent, {
    messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, recommendation, cards,
    stages: [{ stageId: "current", label: "현재", start: "2026-11-23", endExclusive: null, eventIds: [] }, { stageId: "job", label: "취업 후", start: "2027-01-01", endExclusive: null, eventIds: [] }],
  }));
  expect(html).toContain("추천 정책 2개");
  expect(html.match(/주거지원 A/g)).toHaveLength(2);
  expect(html).toContain("취업 후");
  expect(html).not.toContain("유효하지 않은 시점");
  expect(recommendationMessage(recommendation)).toBe("주거 경로 조건 기준으로 일부를 채웠어요.");
  expect(html).toContain("주거 경로 조건 기준으로 일부를 채웠어요.");
});

test("이미 열린 채 접힌 추천 경로도 새 결과가 오면 펼쳐진다", () => {
  expect(revealRecommendationView()).toEqual({ open: true, expanded: true });
});
