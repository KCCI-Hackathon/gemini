import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Policy } from "@/lib/data/types";
import type { Round, VerifiedPolicy } from "@/lib/data/verified";
import { policyLinks } from "@/lib/planner/policy-links";
import { PolicyLinks } from "@/app/workspace/Dialogs";
import { EvaluationSchema } from "@/lib/planner/schema";
import { evaluateRequest } from "@/lib/planner/catalog";
import { PERSONA_A } from "@/lib/judge/personas";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import type { Card } from "@/lib/planner/types";

const policy = (links: Policy["links"]) => ({ id: "20260101000000000001", links }) as Policy;
const verified = (url: string, status: VerifiedPolicy["verificationStatus"] = "human_verified") => ({ sources: [{ url, checkedAt: "2026-11-01" }], verificationStatus: status }) as VerifiedPolicy;
const round = (url: string, status: Round["status"] = "approved") => ({ id: "r-2026-1", status, notice: { url, checkedAt: "2026-11-02", title: "2026년 1차" } }) as Round;

test("회차가 있으면 그 회차 공고만 준다(API 링크는 다른 회차일 수 있어 붙이지 않음)", () => {
  const links = policyLinks(policy({ apply: "https://api.example/apply", ref: null, ref2: null }), verified("https://gov.example/policy"), round("https://gov.example/notice/2026-1"));
  expect(links).toEqual([{ url: "https://gov.example/notice/2026-1", kind: "notice", checked: true, checkedAt: "2026-11-02" }]);
  expect(policyLinks(policy({ apply: null, ref: null, ref2: null }), undefined, round("https://gov.example/n", "under_review"))[0].checked).toBe(false);
});

test("회차가 없으면 공식 출처 → API 신청 → API 참고 순서이고 같은 주소는 한 번만", () => {
  const links = policyLinks(policy({ apply: "https://gov.example/policy", ref: "https://ref.example/a", ref2: "https://ref.example/a" }), verified("https://gov.example/policy"), null);
  expect(links.map(l => [l.kind, l.url])).toEqual([["official", "https://gov.example/policy"], ["ref", "https://ref.example/a"]]);
});

test("API 링크만 있으면 확인 안 된 신청·참고 링크로 구분하고, http(s)가 아니면 버린다", () => {
  const links = policyLinks(policy({ apply: "https://apply.example/", ref: "javascript:alert(1)", ref2: "www.no-scheme.example" }), undefined, null);
  expect(links).toEqual([{ url: "https://apply.example/", kind: "apply", checked: false, checkedAt: null }]);
  expect(policyLinks(policy({ apply: null, ref: null, ref2: null }), undefined, null)).toEqual([]);
});

test("상세 화면: API 링크는 공식 검증 전으로 표시하고, 링크가 없으면 만들지 않고 확인 필요로 안내", () => {
  const base = { roundLabel: "현재 수집된 공고", org: "고용노동부" } as Card;
  const api = renderToStaticMarkup(React.createElement(PolicyLinks, { card: { ...base, links: [{ url: "https://apply.example/", kind: "apply", checked: false, checkedAt: null }, { url: "javascript:alert(1)", kind: "ref", checked: false, checkedAt: null }] } }));
  expect(api).toContain('href="https://apply.example/" target="_blank" rel="noopener noreferrer"');
  expect(api).toContain("신청 페이지 보기");
  expect(api).toContain("공식 검증 전");
  expect(api).not.toContain("javascript:");
  const none = renderToStaticMarkup(React.createElement(PolicyLinks, { card: base }));
  expect(none).toContain("공고 링크 확인 필요");
  expect(none).not.toContain("<a ");
});

test("판정 결과 카드에 링크가 실리고, 링크 칸이 없는 예전 저장 평가도 읽힌다", () => {
  const evaluation = evaluateRequest({ ...PERSONA_A, events: [] }, { revision: 1, events: PERSONA_DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" }, new Date("2026-11-23T10:00:00+09:00"));
  expect(evaluation.cards.some(c => (c.links ?? []).length > 0)).toBe(true);
  for (const card of evaluation.cards) for (const l of card.links ?? []) expect(l.url).toMatch(/^https?:\/\//);
  const old = { ...evaluation, cards: evaluation.cards.slice(0, 3).map(c => { const rest: Partial<typeof c> = { ...c }; delete rest.links; return rest; }) };
  const parsed = EvaluationSchema.safeParse({ ...old, recommendations: [] });
  expect(parsed.success).toBe(true);
  expect(parsed.data?.cards[0].links).toEqual([]);
}, 30_000);
