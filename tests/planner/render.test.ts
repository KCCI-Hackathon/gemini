import React from "react";
import { Agent } from "@/app/workspace/Agent";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PolicyCard } from "@/app/workspace/PolicyCard";
import { Roadmap } from "@/app/workspace/Roadmap";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { createDraft } from "@/lib/planner/state";
import { DEMO_EVENTS, DEMO_PROFILE, demoCatalog } from "@/lib/planner/fixtures";
import type { PlannerInput } from "@/lib/planner/types";
const input: PlannerInput = { revision: 0, events: DEMO_EVENTS, choices: [{ offeringId: "demo-search-2027-01", stageId: "ev-course" }], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" };
const run = (date: string) => evaluatePlanner(DEMO_PROFILE, { ...input, events: DEMO_EVENTS.map(e => e.type === "employment" ? { ...e, date } : e) }, demoCatalog(), new Date("2026-11-19T12:00:00+09:00"));
test("agent shows a benefit question with its answer buttons", () => {
  const question = "국민취업지원제도를 받고 있나요?";
  const html = renderToStaticMarkup(React.createElement(Agent, {
    messages: [], busy: false, onClose: () => {}, onSend: () => {}, onAnswer: () => {},
    questions: [{ question, policyId: "target", sourcePolicyId: "source", sourceName: "국민취업지원제도", ruleId: "rule", answerKind: "receiving" }],
  }));
  expect(html).toContain(question);
  expect(html).toMatch(/<button\b[^>]*>받고 있어요<\/button>/);
  expect(html).toMatch(/<button\b[^>]*>안 받아요<\/button>/);
});
test("card action is separate from detail action and reads server deadline", () => {
  const ev = run("2027-01-20");
  const card = ev.cards.find(c => c.offeringId === "demo-search-2027-01" && c.stageId === "ev-course")!;
  const html = renderToStaticMarkup(React.createElement(PolicyCard, { card, today: ev.today, recommended: false, disabled: false, onDetail: () => {}, onChoose: () => {} }));
  expect(html).toContain("D−61");
  expect(html).toContain("내 예상 기한 2027년 1월 19일");
  expect(html).toContain("공고 마감 2027년 2월 26일");
  expect(html).toContain("✓ 담음");
  expect(html.match(/<button/g)).toHaveLength(2);
});
test("roadmap reads the selected snapshot, not another plan's current dates", () => {
  const ev = run("2027-02-13");
  const draft = createDraft(DEMO_PROFILE, { ...input, events: DEMO_EVENTS.map(e => e.id === "ev-job" ? { ...e, date: "2027-02-13" } : e) }, ev);
  const html = renderToStaticMarkup(React.createElement(Roadmap, { plan: draft, onDetail: () => {} }));
  expect(html).toContain("2월 12일");
  expect(html).toContain("1월 5일");
  expect(html).not.toContain("1월 19일");
});
