import { describe, expect, test } from "vitest";
import { judgeAll } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import { buildRoadmap } from "@/lib/route/roadmap";
import { buildTimeline } from "@/lib/route/timeline";

// 국민취업지원제도: 공고는 "구직자"만 대상으로 적지만 구직자의 정의가 분명하지 않다(definitionClear: false)
const NATIONAL = "20260710005400113256";
const NOW = new Date("2026-11-18T12:00:00+09:00");

describe("가정한 취업 뒤 국민취업지원제도", () => {
  test("취업 상태에서는 '기준일'이 아니라 구직자 정의를 확인하라고 적는다", () => {
    const employed: Profile = { ...PERSONA_A, currentStatus: ["employed"], events: [] };
    const r = judgeAll(employed, NOW).find((x) => x.policy.id === NATIONAL)!;
    expect(r.axes.personal.value).toBe("needs_check");
    expect(r.axes.personal.reasons).toContain("미취업 조건: 공고의 대상 정의 확인 필요");
    expect(r.axes.personal.reasons).not.toContain("자격 판단 기준일 확인 필요");
  });

  test("타임라인 구간은 이어지되 취업일에 '취업 후 다시 확인'이 붙는다", () => {
    // 수료 2026-12-19 + 3개월 = 2027-03-19 취업. 취업 뒤에도 '확인 필요'라 구간 자체는 이어진다
    const row = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3 }).rows.find((r) => r.policyId === NATIONAL)!;
    expect(row.lastAvailable).toBeNull();
    expect(row.summary).toContain("2027-03-19 취업 후 다시 확인");
    expect(row.breaks).toEqual(["2027-03-19"]);
  });

  test("취업을 가정하지 않으면 끊기지 않는다", () => {
    const row = buildTimeline(PERSONA_A, NOW, {}).rows.find((r) => r.policyId === NATIONAL)!;
    expect(row.breaks).toEqual([]);
    expect(row.summary).toContain("이후 계속");
  });

  test("로드맵의 내 조건 구간도 취업한 달에서 나뉘고, 뒤 구간에 '취업 후 다시 확인'이 붙는다", () => {
    const t = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3 });
    const row = buildRoadmap(t).rows.find((r) => r.policyId === NATIONAL)!;
    const k = t.months.findLastIndex((m) => m <= "2027-03-19");
    expect(row.windows.map((w) => [w.from, w.to, w.note ?? null])).toEqual([
      [0, k - 1, null],
      [k, t.months.length - 1, "취업 후 다시 확인"],
    ]);
  });
});

describe("경계 달: 가정한 사건이 있는 달은 '선후 확인 필요'", () => {
  test("판정이 바뀌는 사건 날짜를 경계로 기록한다", () => {
    const t = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3 });
    expect(t.rows.find((r) => r.policyId === NATIONAL)!.boundaries).toEqual(["2027-03-19"]);
    // K-뉴딜은 수료일(2026-12-19)에 판정이 바뀐다
    expect(t.rows.find((r) => r.policyId === "20260714005400113258")!.boundaries).toContain("2026-12-19");
  });

  test("로드맵은 그 달 칸에 무엇과 무엇의 선후인지 적는다", () => {
    const t = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3 });
    const k = t.months.findLastIndex((m) => m <= "2027-03-19");
    const row = buildRoadmap(t).rows.find((r) => r.policyId === NATIONAL)!;
    expect(row.boundaries).toEqual([{ col: k, date: "2027-03-19", text: "신청일과 취업일의 선후 확인 필요" }]);
  });

  test("판정이 바뀌지 않는 정책에는 경계를 붙이지 않는다", () => {
    const t = buildTimeline(PERSONA_A, NOW, {});
    // 인천 응시료는 11/30 마감이라 수료일(12/19) 판정과 무관
    expect(t.rows.find((r) => r.policyId === "20260406005400212445")!.boundaries).toEqual([]);
  });
});
