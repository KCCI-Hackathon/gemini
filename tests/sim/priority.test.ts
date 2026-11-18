import { describe, expect, test } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";

const NOW = new Date("2026-11-24T12:00:00+09:00");

describe("상태가 바뀌면 에이전트가 확인하러 갈 정책의 순서", () => {
  test("기준일이 문제인 정책(인천 응시료, K-뉴딜)을 먼저, 대상 정의가 문제인 국민취업지원제도를 그다음에 확인한다", () => {
    const r = handleJudge({ profile: PERSONA_A, transitions: ["complete_training", "get_employed"] }, NOW);
    if (!("needsVerification" in r.body)) throw new Error("400");
    const ids = r.body.needsVerification;
    expect(ids.length).toBeLessThanOrEqual(5);
    expect(ids.slice(0, 2).sort()).toEqual(["20260406005400212445", "20260714005400113258"]);
    expect(ids[2]).toBe("20260710005400113256");
  });
});
