import React from "react";
import { Agent } from "@/app/workspace/Agent";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { Building, canLeaveBuilding, MIN_BUILD_MS } from "@/app/workspace/Building";
import { ProfileForm } from "@/app/workspace/Dialogs";
import { demoStart, OnboardingScreen, personaProfile, SignupScreen, startInput } from "@/app/workspace/Entry";
import { Nav, resolveScreen, screenOf } from "@/app/workspace/Nav";
import { DEMO_MESSAGE } from "@/app/login/LoginForm";
import { PERSONA_A } from "@/lib/judge/personas";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
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

afterEach(() => vi.unstubAllGlobals());
// 렌더 결과(React 요소 트리)에서 조건에 맞는 요소를 찾는다. 훅을 쓰지 않는 화면 함수를 직접 불러 쓴다.
type Node = { type?: unknown; props?: { children?: unknown; [key: string]: unknown } };
const textOf = (node: unknown): string => Array.isArray(node) ? node.map(textOf).join("") : typeof node === "object" && node ? textOf((node as Node).props?.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
function findAll(node: unknown, test: (el: Node) => boolean): Node[] {
  if (Array.isArray(node)) return node.flatMap(n => findAll(n, test));
  if (typeof node !== "object" || !node) return [];
  const el = node as Node;
  return [...(test(el) ? [el] : []), ...findAll(el.props?.children, test)];
}
test("demo entry still opens persona board", () => {
  const onDemo = vi.fn(), onNext = vi.fn();
  const tree = SignupScreen({ onNext, onDemo, onSaved: () => {}, savedCount: 0 });
  const demo = findAll(tree, el => el.type === "button" && textOf(el) === "예시로 둘러보기");
  expect(demo).toHaveLength(1);
  (demo[0].props!.onClick as () => void)();
  expect(onDemo).toHaveBeenCalledTimes(1);
  expect(onNext).not.toHaveBeenCalled();
  // 예시 시작은 지금처럼 PERSONA_A 프로필 + PERSONA_DEMO_EVENTS 로 판정을 시작한다
  const start = vi.fn();
  demoStart(start);
  expect(start).toHaveBeenCalledWith({ ...PERSONA_A, events: [] }, true);
  expect(personaProfile).toEqual({ ...PERSONA_A, events: [] });
  const input = startInput(personaProfile, true);
  expect(input.events).toEqual(PERSONA_DEMO_EVENTS);
  expect(input.demoId).toBe("pathfinder-demo-2026");
  expect(startInput(personaProfile, false).events).toEqual([]);
});
test("signup is a demo screen that never sends or stores input", () => {
  const fetchSpy = vi.fn();
  const store = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
  vi.stubGlobal("fetch", fetchSpy); vi.stubGlobal("localStorage", store); vi.stubGlobal("sessionStorage", store);
  const onNext = vi.fn(), preventDefault = vi.fn();
  const tree = SignupScreen({ onNext, onDemo: () => {}, onSaved: () => {}, savedCount: 2 });
  (findAll(tree, el => el.type === "form")[0].props!.onSubmit as (e: unknown) => void)({ preventDefault });
  expect(preventDefault).toHaveBeenCalled();
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(store.setItem).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(React.createElement(SignupScreen, { onNext, onDemo: () => {}, onSaved: () => {}, savedCount: 2 }));
  expect(html).toContain(DEMO_MESSAGE);
  expect(html).toContain('href="/login"');
  expect(html).toContain("저장한 계획 확인 (2)");
  expect(html).not.toContain("알림 받기");
  for (const word of ["카카오", "네이버", "또는 이메일로"]) expect(html).not.toContain(word);
});
test("onboarding notice matches actual ai use", () => {
  const html = renderToStaticMarkup(React.createElement(ProfileForm, { onSave: () => {} }));
  expect(html).not.toContain("외부 AI에는 보내지 않아요");
  expect(html).toContain("AI 상담에 동의한 경우에만");
  const screen = renderToStaticMarkup(React.createElement(OnboardingScreen, { onSave: () => {}, onBack: () => {} }));
  expect(screen).not.toContain("외부 AI에는 보내지 않아요");
  expect(screen).toContain("AI 상담에 동의한 경우에만");
  expect(screen).toContain("정책 보드 열기");
});
test("nav shows four tabs", () => {
  const html = renderToStaticMarkup(React.createElement(Nav, { active: "saved" }));
  for (const [label, href] of [["정책 선택", "#board"], ["관심 정책", "#saved"], ["내 정책 로드맵", "#roadmap"], ["계정", "#account"]]) {
    expect(html).toMatch(new RegExp(`<a [^>]*href="${href}"[^>]*>.*?<span>${label}</span></a>`));
  }
  expect(html.match(/<a /g)).toHaveLength(4);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-current="page"[^>]*href="#saved"|href="#saved"[^>]*aria-current="page"/);
});
test("hash picks the screen and falls back to signup without a draft", () => {
  expect(screenOf("#roadmap")).toBe("roadmap");
  expect(screenOf("#nothing")).toBeNull();
  expect(screenOf("")).toBeNull();
  expect(resolveScreen(null, true)).toBe("board");
  expect(resolveScreen(null, false)).toBe("signup");
  expect(resolveScreen("account", false)).toBe("signup");
  expect(resolveScreen("onboarding", false)).toBe("onboarding");
  expect(resolveScreen("building", false)).toBe("building");
  expect(resolveScreen("saved", true)).toBe("saved");
});
test("building shows the trail and waits for the request and 1.2 seconds", () => {
  const html = renderToStaticMarkup(React.createElement(Building, { ready: false, onDone: () => {} }));
  expect(html).toContain("경로 제작 중...");
  expect(html).toContain('role="status"');
  expect(MIN_BUILD_MS).toBe(1200);
  expect(canLeaveBuilding(true, 1199)).toBe(false);
  expect(canLeaveBuilding(false, 9000)).toBe(false);
  expect(canLeaveBuilding(true, 1200)).toBe(true);
});
