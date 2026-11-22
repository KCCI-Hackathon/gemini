import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Agent, type Message } from "@/app/workspace/Agent";

const base = { busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {}, onRetry: () => {}, onNewChat: () => {} };
const render = (messages: Message[], planLoading = false) => renderToStaticMarkup(React.createElement(Agent, { ...base, messages, planLoading }));
const count = (html: string, text: string) => html.split(text).length - 1;

test("‘다시 시도’는 마지막 실패 안내에만, 응답을 기다리는 동안에는 숨긴다", () => {
  const failed: Message[] = [{ id: 0, role: "assistant", text: "안녕하세요" }, { id: 1, role: "assistant", text: "AI 실패", retry: true }];
  expect(count(render(failed), ">다시 시도</button>")).toBe(1);
  expect(render(failed, true)).not.toContain(">다시 시도</button>");
  expect(render([...failed, { id: 2, role: "user", text: "다른 질문" }])).not.toContain(">다시 시도</button>");
});

test("대화가 있으면 ‘새 대화’ 버튼, 첫 인사만 있으면 없다", () => {
  expect(render([{ id: 0, role: "assistant", text: "안녕하세요" }])).not.toContain(">새 대화</button>");
  expect(render([{ id: 0, role: "assistant", text: "안녕하세요" }, { id: 1, role: "user", text: "질문" }])).toContain(">새 대화</button>");
});
