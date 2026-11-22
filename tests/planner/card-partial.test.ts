import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PolicyCard } from "@/app/workspace/PolicyCard";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { DEMO_EVENTS, DEMO_PROFILE, demoCatalog } from "@/lib/planner/fixtures";
import type { Card } from "@/lib/planner/types";

const ev = evaluatePlanner(DEMO_PROFILE, { revision: 0, events: DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, demoCatalog(), new Date("2026-11-19T12:00:00+09:00"));
const base = ev.cards.find(c => c.availability === "eligible" && c.reasons.length === 0)!;
const html = (card: Card) => renderToStaticMarkup(React.createElement(PolicyCard, { card, today: ev.today, recommended: false, disabled: false, onDetail: () => {}, onChoose: () => {} }));
const partial: Card = { ...base, verifyLabel: "근거 확인 대기", reasons: [{ code: "PARTIAL_RESTRICTION", message: "청년월세 지원 수혜 시 해당 월 청년월세 지급액 미지급" }] };

test("F-2: an eligible card with a partial restriction shows it on the front, still lets you add it, and keeps the badge", () => {
  const out = html(partial);
  expect(out).toContain("청년월세 지원 수혜 시 해당 월 청년월세 지급액 미지급");
  expect(out).toMatch(/<button\b[^>]*>담기<\/button>/);
  expect(out).toContain("근거 확인 대기");
  expect(out.split("지급액 미지급").length - 1).toBe(1);
});
test("F-2: a card without restrictions has no empty warning area", () => {
  expect(html(base)).not.toMatch(/class="[^"]*(checkNote|cardWarning|partialNote)/);
});
test("F-2: a blocked card still shows its first reason", () => {
  const blocked: Card = { ...base, availability: "blocked", eligibility: "blocked", eligibilityReason: "공식 접수가 마감되었어요", reasons: [{ code: "CLOSED", message: "공식 접수가 마감되었어요" }, ...partial.reasons] };
  const out = html(blocked);
  expect(out).toContain("공식 접수가 마감되었어요");
  expect(out).not.toContain("지급액 미지급");
});
