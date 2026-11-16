import { describe, expect, test } from "vitest";
import { judgeAll } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import { rankOpenQuestions } from "@/lib/agent/questions";
import { buildAgentPayload } from "@/lib/agent/payload";
import { assembleCards } from "@/lib/agent/assemble";
import { simulateTransition } from "@/lib/sim/transition";

const NOW = new Date("2026-11-24T12:00:00+09:00");
const CHALLENGE = "20250122005400110346";
const INCHEON = "20260406005400212445";

describe("rankOpenQuestions", () => {
  test("국민취업지원제도 참여 질문이 후보로 나오고, 영향 받는 정책 수를 센다", () => {
    const qs = rankOpenQuestions(judgeAll(PERSONA_A, NOW));
    const q = qs.find((x) => x.key === "participating_national_employment_support")!;
    expect(q).toBeDefined();
    expect(q.options).toEqual(["예", "아니오", "모름"]);
    expect(q.relatedCount).toBeGreaterThanOrEqual(1);
    expect(q.mayChangeCount).toBeLessThanOrEqual(q.relatedCount);
  });
});

describe("buildAgentPayload", () => {
  test("가상 인물 번호로만 만들고, 생년월·시군구·학력 값이 들어가지 않는다", () => {
    const p = buildAgentPayload("demo-1", NOW);
    const s = JSON.stringify(p);
    expect(p.stateLabel).toBe("교육 수강 중 · 구직 중");
    expect(s).not.toContain(PERSONA_A.birthYm);
    expect(s).not.toContain(PERSONA_A.sigungu);
    expect(s).not.toContain("연수구");
    expect(s).not.toContain(PERSONA_A.school);
  });

  test("가상 인물이 아닌 번호는 거부한다", () => {
    expect(() => buildAgentPayload("user" as never, NOW)).toThrow();
  });
});

describe("assembleCards", () => {
  test("청년도전(수강 중): 다음에 확인할 첫 항목은 실제 수료일", () => {
    const cards = assembleCards(judgeAll(PERSONA_A, NOW), "none");
    const c = cards.find((x) => x.policyId === CHALLENGE)!;
    expect(c.checkNextInOrder[0]).toContain("수료일");
    expect(c.rationale.length).toBeGreaterThan(0);
  });

  test("취업 상태로 바꾼 뒤 인천 응시료 카드는 응시일 기준을 먼저 확인하게 한다", () => {
    const changes = simulateTransition(PERSONA_A, "get_employed", NOW);
    const cards = assembleCards(judgeAll(PERSONA_A, NOW), "get_employed", changes);
    const c = cards.find((x) => x.policyId === INCHEON)!;
    expect(c.checkNextInOrder[0]).toContain("취업 전에 응시한 시험");
  });

  test("카드는 검증 정책에만 만든다", () => {
    const results = judgeAll(PERSONA_A, NOW);
    const cards = assembleCards(results, "none");
    expect(cards.length).toBe(results.filter((r) => r.verified).length);
  });
});
