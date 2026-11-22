import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Agent } from "@/app/workspace/Agent";

const base = { messages: [{ id: 1, role: "assistant" as const, text: "안녕하세요!" }], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {} };

test("AI 상담 동의 전에는 안내문과 동의 버튼만 보이고 채팅은 없다", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { ...base, consentNeeded: true, onConsent: () => {} }));
  expect(html).toContain('aria-label="AI 상담 동의"');
  expect(html).toContain("해외 AI 제공자(OpenAI 또는 Google)");
  expect(html).toContain(">AI 상담 사용</button>");
  expect(html).not.toContain("<textarea");
  expect(html).not.toContain("추천해줘");
  expect(html).not.toContain("안녕하세요!");
});

test("동의하면 대화와 입력창이 나오고 안내문은 사라진다", () => {
  const html = renderToStaticMarkup(React.createElement(Agent, { ...base, consentOn: true }));
  expect(html).toContain("<textarea");
  expect(html).not.toMatch(/<textarea[^>]*disabled/);
  expect(html).toContain("안녕하세요!");
  expect(html).not.toContain('aria-label="AI 상담 동의"');
});
