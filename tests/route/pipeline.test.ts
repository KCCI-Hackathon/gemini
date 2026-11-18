import { describe, expect, test } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import { allRelations } from "@/lib/route/build";
import { buildPipeline } from "@/lib/route/pipeline";
import { buildRoadmap } from "@/lib/route/roadmap";
import { buildTimeline } from "@/lib/route/timeline";

const NOW = new Date("2026-11-18T12:00:00+09:00");
const NATIONAL = "20260710005400113256";
const CHALLENGE = "20250122005400110346";
const pipe = (plan = {}) => buildPipeline(buildRoadmap(buildTimeline(PERSONA_A, NOW, plan)), allRelations());

describe("buildPipeline: 기간별 단계, 단계마다 상위 카드만", () => {
  test("단계는 지금 → 가정한 시점 순서", () => {
    expect(pipe({ employAfterMonths: 3 }).stages.map((s) => s.key)).toEqual(["now", "training_completion", "employment"]);
  });

  test("지금 단계는 5장만 싣고 나머지는 개수로", () => {
    const now = pipe().stages[0];
    expect(now.cards.length).toBeLessThanOrEqual(5);
    expect(now.total).toBeGreaterThan(100);
    expect(now.hidden).toBe(now.total - now.cards.length);
  });

  test("사람이 확인한 정책이 먼저 온다", () => {
    const now = pipe().stages[0];
    expect(now.cards[0].verified).toBe(true);
  });
});

describe("중복 수혜 제한과 연계", () => {
  test("국취(지금)와 청년도전(수료 후)은 '국취 참여 중이면 청년도전 제한'으로 이어진다", () => {
    const p = pipe();
    const challenge = p.stages.flatMap((s) => s.cards).find((c) => c.policyId === CHALLENGE)!;
    const national = p.stages[0].cards.find((c) => c.policyId === NATIONAL)!;
    expect(challenge.blockedBy.map((b) => b.id)).toContain(NATIONAL);
    expect(challenge.blockedBy[0].quote).toContain("국민취업지원제도");
    expect(national.blocks.map((b) => b.id)).toContain(CHALLENGE);
  });

  test("연계(청년도전 이수 → 국취)는 따로 표시한다", () => {
    const challenge = pipe().stages.flatMap((s) => s.cards).find((c) => c.policyId === CHALLENGE)!;
    expect(challenge.leadsTo.map((l) => l.id)).toContain(NATIONAL);
  });

  test("한 단계 안에서 서로 제한하는 카드는 '하나만' 묶음으로", () => {
    // 인위적 관계: 지금 단계 첫 두 카드가 서로 제한된다고 두면 묶인다
    const rm = buildRoadmap(buildTimeline(PERSONA_A, NOW, {}));
    const base = buildPipeline(rm, []);
    const [a, b] = base.stages[0].cards;
    const p = buildPipeline(rm, [{ from: a.policyId, fromName: a.name, to: b.policyId, toName: b.name, kind: "blocks", quote: "q", source: "api", sourceUrl: null, checkedAt: null }]);
    expect(p.stages[0].exclusiveGroups).toEqual([[a.policyId, b.policyId]]);
  });

  test("상대를 특정할 수 없는 중복 제한 문구는 카드에 문구로만", () => {
    const cards = pipe().stages.flatMap((s) => s.cards);
    for (const c of cards) if (c.dupNote) expect(c.dupNote.length).toBeGreaterThan(0);
  });
});
