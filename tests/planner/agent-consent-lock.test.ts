import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Agent } from "@/app/workspace/Agent";

const base = { messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {} };

test("AI 상담 동의 전에는 입력창 · 예시 질문 · 보내기가 잠긴다", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { ...base, consentNeeded: true, onConsent: () => {} }));
  expect(html).toMatch(/<textarea[^>]*disabled/);
  expect(html).toContain("‘AI 상담 사용’을 누르면 채팅할 수 있어요");
  expect(html.match(/<button[^>]*disabled=""[^>]*>[^<]*추천해줘/)).not.toBeNull();
});

test("동의하면 입력창이 열린다", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { ...base, consentOn: true }));
  expect(html).not.toMatch(/<textarea[^>]*disabled/);
});
