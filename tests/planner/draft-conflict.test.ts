import { expect, test } from "vitest";
import { backendDraftConflict, evaluateRequest } from "@/lib/planner/catalog";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Card } from "@/lib/planner/types";

const now = new Date("2026-11-22T12:00:00+09:00");
const window = { start: "2027-01-01", end: "2027-03-31" };
function card(policyId: string, title: string): Card {
  return {
    policyId, offeringId: policyId + ":2027", title, roundLabel: "2027", category: "life",
    summary: "", support: "", org: "", official: { ...window, kind: "fixed", closeAt: null },
    rules: [], evidence: [], restrictions: [], reviewed: true, dataVersion: "test", verifyLabel: null,
    stageId: "current", personalWindow: window, stageWindow: window, applicationWindows: [window],
    deadlineKind: "official", daysLeft: null, availability: "eligible", reasons: [],
    selectedStageId: null, otherStageIds: [], conflicts: [], canReplace: false,
  };
}
const dream = card("20260406005400212442", "드림For 청년통장");
const welfare = card("20260406005400212410", "재직청년 복지포인트");

test("I4 overlapping planned windows conflict through backend rules", () => {
  const out = backendDraftConflict(now)(dream, [welfare]);
  expect(out.blocked || out.uncertain).toBe(true);
  expect(out.reasons[0].code).toMatch(/DRAFT_CONFLICT|RESTRICTION_QUESTION/);
});
// J-8: 드림For 청년통장 · 재직청년 복지포인트는 실데이터에서 둘 다 접수 마감이라 시연할 수 없다.
// 시연 인물에게 지금 둘 다 열려 있는 승인 규칙 쌍을 모두 대 보면, 전체 차단까지 가는 쌍은 없고 "확인 필요" 까지만 간다.
// 그 중 국민취업지원제도 → 게임사 프로젝트 현장교육 프로그램으로, 담은 정책 충돌이 실데이터에서 조용히 지나가지 않는 것을 본다.
test("J-8: I4 on real data — choosing 국민취업지원제도 turns an open program into needs_check, naming it", () => {
  const NATIONAL = "20260710005400113256", TARGET = "20261001005400113794";
  const base = { revision: 0, events: [{ id: "ev-course", type: "training_completion" as const, date: "2026-12-19", status: "scheduled" as const }], mutedKeys: [], preferredCategory: "all" as const };
  const profile = { ...PERSONA_A, events: [] };
  const free = evaluateRequest(profile, { ...base, choices: [] }, now);
  const open = (policyId: string) => free.cards.filter(c => c.policyId === policyId && c.availability !== "blocked" && c.stageWindow);
  const national = open(NATIONAL).find(c => open(TARGET).some(t => t.stageId === c.stageId))!;
  expect(national).toBeTruthy();
  const chosen = evaluateRequest(profile, { ...base, choices: [{ offeringId: national.offeringId, stageId: national.stageId }] }, now);
  const target = chosen.cards.find(c => c.policyId === TARGET && c.stageId === national.stageId)!;
  expect(target.availability).toBe("needs_check");
  expect(target.reasons.some(r => r.code === "RESTRICTION_QUESTION" && r.message.includes("국민취업지원제도"))).toBe(true);
});
test("non-overlapping windows do not conflict", () => {
  const out = backendDraftConflict(now)(dream, [{ ...welfare, stageWindow: { start: "2027-06-01", end: "2027-06-30" } }]);
  expect(out.blocked).toBe(false);
});
test("open-ended window is not blocked", () => {
  const out = backendDraftConflict(now)(dream, [{ ...welfare, stageWindow: { start: "2027-01-01", end: null }, official: { ...welfare.official, end: null } }]);
  expect(out.blocked).toBe(false);
});
