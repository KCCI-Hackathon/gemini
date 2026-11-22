import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PlanCompare } from "@/app/workspace/PlanCompare";
import type { Card, Choice, SavedPlan, Stage } from "@/lib/planner/types";

const stages: Stage[] = [
  { stageId: "current", label: "현재", start: "2026-11-23", endExclusive: "2026-12-19", eventIds: [] },
  { stageId: "ev-course", label: "수료 후", start: "2026-12-19", endExclusive: null, eventIds: ["ev-course"] },
];
const card = (offeringId: string, title: string, roundLabel: string, stageId = "current") => ({ offeringId, title, roundLabel, stageId }) as Card;
// 같은 이름 ‘청년 월세 지원’의 서로 다른 회차(1차 · 2차)
const cards = [card("p1:r1", "청년 월세 지원", "2026년 1차"), card("p1:r2", "청년 월세 지원", "2026년 2차"), card("p2:c", "국민취업지원제도", "현재 수집된 공고"), card("p3:c", "청년 도약 장려금", "현재 수집된 공고"), card("p4:c", "아주 긴 이름의 청년 창업 사관학교 예비 창업자 성장 지원 사업", "현재 수집된 공고")];
const plan = (planId: string, name: string, choices: Choice[]) => ({ planId, name, schemaVersion: 2, createdAt: "2026-11-20T01:00:00.000Z", source: "manual", profileSnapshot: {}, input: { revision: 1, choices, mutedKeys: [], preferredCategory: "all" }, savedEvaluation: { today: "2026-11-20", stages, cards } }) as unknown as SavedPlan;
const A = plan("a", "취업 먼저", [{ offeringId: "p1:r1", stageId: "current" }, { offeringId: "p2:c", stageId: "current" }, { offeringId: "p3:c", stageId: "current" }]);
const B = plan("b", "창업 먼저", [{ offeringId: "p1:r2", stageId: "current" }, { offeringId: "p2:c", stageId: "current" }, { offeringId: "p3:c", stageId: "ev-course" }, { offeringId: "p4:c", stageId: "current" }]);
const render = (plans: SavedPlan[], onStart?: () => void) => renderToStaticMarkup(React.createElement(PlanCompare, { plans, onStart }));
const group = (html: string, label: string) => html.split(`aria-label="${label}`)[1]?.split("</section>")[0] ?? "";

test("계획 0개 · 1개는 고르는 칸 없이 다음 행동을 안내한다", () => {
  const none = render([], () => {});
  expect(none).toContain("아직 저장한 계획이 없어요");
  expect(none).toContain("정책 고르러 가기");
  const one = render([A]);
  expect(one).not.toContain("<select");
  expect(one).toContain("취업 먼저");
  expect(one).toContain("계획을 하나 더 저장하면");
  expect(one).toContain("3개"); // 담은 정책 수
});

test("두 계획: 첫 계획에만 · 공통 · 시점 변경 · 둘째 계획에만을 정책 이름과 시점으로 나눠 보여 준다", () => {
  const html = render([A, B]);
  expect(group(html, "첫 계획에만")).toContain("2026년 1차");
  expect(group(html, "둘째 계획에만")).toContain("2026년 2차"); // 같은 이름의 다른 회차를 공통으로 합치지 않는다
  expect(group(html, "공통 1개")).toContain("국민취업지원제도");
  const moved = group(html, "시점 변경 1개");
  expect(moved).toContain("청년 도약 장려금");
  expect(moved).toContain("현재 · 2026.11.23부터 → 수료 후 · 2026.12.19부터");
  expect(group(html, "공통 1개")).not.toContain("청년 도약 장려금"); // 시점이 바뀐 정책은 공통에 다시 넣지 않는다
  expect(html).not.toContain(", "); // 쉼표로 늘어놓지 않음
});

test("같은 계획을 두 번 고르면 비교 결과 대신 안내", () => {
  const html = renderToStaticMarkup(React.createElement(PlanCompare, { plans: [A] }));
  expect(html).not.toContain("같은 계획을 두 번");
  // 첫 렌더에서 둘째 칸은 다른 계획을 고른다. 같은 id 가 두 번 들어오는 경우를 직접 만든다.
  const dup = render([A, { ...A }]);
  expect(dup).toContain("같은 계획을 두 번 골랐어요");
  expect(dup).not.toContain("시점 변경");
});
