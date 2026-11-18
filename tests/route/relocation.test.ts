// 이사 예정(팀 상의 5): 그 달부터 지역 판정을 새 시군구로, 이사하는 달은 선후 확인 필요
import { describe, expect, test } from "vitest";
import { judgeAll } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import { handleJudge } from "@/lib/judge/handler";
import { buildRoadmap } from "@/lib/route/roadmap";
import { buildTimeline } from "@/lib/route/timeline";

const NOW = new Date("2026-11-18T12:00:00+09:00");
const SUWON = "41117"; // 경기 수원시 영통구
const MOVE = { sigungu: SUWON, afterMonths: 3 }; // 오늘부터 3개월 뒤 = 2027-02-18

// 인천 연수구에서만 보이는 비검증 정책과 수원 영통구에서만 보이는 비검증 정책
const only = (sigungu: string, other: string) => {
  const here = new Set(judgeAll({ ...PERSONA_A, sigungu }, NOW).filter((r) => !r.verified).map((r) => r.policy.id));
  const there = new Set(judgeAll({ ...PERSONA_A, sigungu: other }, NOW).filter((r) => !r.verified).map((r) => r.policy.id));
  return [...here].filter((id) => !there.has(id));
};

describe("이사 예정", () => {
  const t = buildTimeline(PERSONA_A, NOW, { move: MOVE });

  test("가정한 사건에 이사(대상 시군구 이름 포함)가 들어간다", () => {
    expect(t.events.find((e) => e.type === "relocation")).toMatchObject({ date: "2027-02-18" });
    expect(t.events.find((e) => e.type === "relocation")!.label).toContain("경기 수원시 영통구");
  });

  test("이사 뒤에는 새 지역 기준으로 판정한다: 수원에만 있는 정책은 이사일 전에는 칸이 비고 뒤에만 열린다", () => {
    const suwonOnly = new Set(only(SUWON, PERSONA_A.sigungu));
    const k = t.months.findLastIndex((m) => m <= "2027-02-18");
    const rows = t.rows.filter((r) => suwonOnly.has(r.policyId));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.cells.slice(0, k).every((c) => c === "no")).toBe(true);
      expect(r.firstAvailable! >= "2027-02-18").toBe(true);
    }
  });

  test("인천에만 있는 정책은 이사일에 구간이 끝나거나 다시 확인으로 바뀐다", () => {
    const incheonOnly = new Set(only(PERSONA_A.sigungu, SUWON));
    const r = t.rows.filter((x) => incheonOnly.has(x.policyId) && x.firstAvailable);
    for (const x of r) expect(x.lastAvailable === null || x.lastAvailable < "2027-02-18").toBe(true);
  });

  test("로드맵은 이사 가정 표시와 '신청일과 이사일의 선후 확인 필요' 경계를 보인다", () => {
    const rm = buildRoadmap(t);
    expect(rm.goals.find((g) => g.type === "relocation")!.label).toContain("이사");
    expect(rm.rows.some((r) => r.boundaries.some((b) => b.text === "신청일과 이사일의 선후 확인 필요"))).toBe(true);
  });

  test("판정 요청에 이사 계획을 받을 수 있다", () => {
    expect(handleJudge({ profile: PERSONA_A, plan: { move: MOVE } }, NOW).status).toBe(200);
    expect(handleJudge({ profile: PERSONA_A, plan: { move: { sigungu: "12", afterMonths: 3 } } }, NOW).status).toBe(400);
  });
});
