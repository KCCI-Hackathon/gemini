import { describe, expect, test } from "vitest";
import { classifyEligibility, countEligibilityTabs, hasOverlapLanguage } from "@/lib/planner/eligibility";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { DEMO_PROFILE, demoCatalog } from "@/lib/planner/fixtures";

describe("서버 자격 탭 분류", () => {
  test("확정 불충족은 중복 정보가 비어도 수혜불가능이다", () => {
    expect(classifyEligibility("blocked", "no_restriction_found", ["나이 조건 밖"]))
      .toMatchObject({ eligibility: "blocked", reason: "나이 조건 밖" });
  });

  test("확인된 중복 금지는 수혜불가능이다", () => {
    expect(classifyEligibility("blocked", "reviewed_rules", ["현재 수혜 중인 정책과 중복 불가"]))
      .toMatchObject({ eligibility: "blocked" });
  });

  test("일반 자격 충족이어도 중복 조항 또는 근거가 미확인이면 확인 필요다", () => {
    expect(classifyEligibility("eligible", "unresolved", []))
      .toMatchObject({ eligibility: "needs_check" });
  });

  test("제한 정보가 확인되지 않았으면 수혜가능과 정보 부재 문구를 제공한다", () => {
    expect(classifyEligibility("eligible", "no_restriction_found", []))
      .toEqual({ eligibility: "eligible", reason: "입력 정보와 확인된 조건 기준으로 후보예요. 중복수혜 제한 정보 없음. 최종 선정·지급을 보장하지 않아요." });
  });

  test("동시 참여·재참여 조건도 원문에 있는 중복 조항으로 본다", () => {
    expect(hasOverlapLanguage("동시에 여러 아카데미에 참여하거나 동일한 아카데미에 재참여할 수 없습니다.")).toBe(true);
    expect(hasOverlapLanguage("미취업 청년에게 훈련비를 지원합니다.")).toBe(false);
  });

  test("일부 지원 항목 제한은 신청 자체를 막지 않는다", () => {
    expect(classifyEligibility("eligible", "reviewed_rules", ["일부 지원금 차감" ]))
      .toMatchObject({ eligibility: "eligible" });
  });

  test("불완전한 자격 정보는 별표나 배지에 관계없이 확인 필요다", () => {
    expect(classifyEligibility("needs_check", "no_restriction_found", ["나이 기준일 확인 필요"]))
      .toMatchObject({ eligibility: "needs_check", reason: "나이 기준일 확인 필요" });
  });

  test("검색 후 같은 회차·시점 중복만 제거하고 세 탭 합계를 보존한다", () => {
    const counts = countEligibilityTabs([
      { offeringId: "p1:r1", stageId: "current", eligibility: "blocked" },
      { offeringId: "p1:r1", stageId: "current", eligibility: "blocked" },
      { offeringId: "p1:r1", stageId: "next", eligibility: "eligible" },
      { offeringId: "p1:r2", stageId: "current", eligibility: "needs_check" },
    ]);
    expect(counts).toEqual({ blocked: 1, needs_check: 1, eligible: 1 });
    expect(counts.blocked + counts.needs_check + counts.eligible).toBe(3);
  });

  test("공고 API 검증 배지만 미확인인 카드는 자격 충족 탭에 남는다", () => {
    const offering = demoCatalog().find(card => card.offeringId === "demo-housing")!;
    const evaluation = evaluatePlanner(DEMO_PROFILE, { revision: 0, events: [], choices: [], mutedKeys: [], preferredCategory: "all" }, [{ ...offering, verifyLabel: "미검증(API)" }], new Date("2026-11-19T12:00:00+09:00"));
    expect(evaluation.cards[0]).toMatchObject({ availability: "eligible", eligibility: "eligible", verifyLabel: "미검증(API)" });
    expect(evaluation.recommendations).toEqual([{ offeringId: offering.offeringId, stageId: "current" }]);
  });
});
