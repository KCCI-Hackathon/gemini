import { describe, expect, test } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import { allRelations } from "@/lib/route/build";
import { buildPipeline } from "@/lib/route/pipeline";
import { buildRoadmap } from "@/lib/route/roadmap";
import { buildTimeline } from "@/lib/route/timeline";

const NOW = new Date("2026-11-18T12:00:00+09:00");
const NATIONAL = "20260710005400113256";
const CHALLENGE = "20250122005400110346";
const INCHEON = "20260406005400212445";
const KNEWDEAL = "20260714005400113258";
const pipe = (plan = {}) => buildPipeline(buildRoadmap(buildTimeline(PERSONA_A, NOW, plan)), allRelations());
const cardsOf = (p: ReturnType<typeof pipe>) => p.columns.flatMap((c) => c.cards);
const colOf = (p: ReturnType<typeof pipe>, id: string) => p.columns.find((c) => c.cards.some((x) => x.policyId === id) || c.allIds.includes(id))!;

describe("buildPipeline: 마감월로 열을 자른다", () => {
  test("열은 마감월 순서이고 기한 없는(상시) 정책은 마지막 열", () => {
    const keys = pipe().columns.map((c) => c.key);
    const months = keys.filter((k) => k !== "always" && k !== "beyond");
    expect(months).toEqual([...months].sort());
    expect(keys.at(-1)).toBe("always");
    // 12개월 뒤보다 늦은 마감은 한 열로 모은다
    for (const k of months) expect(k <= "2027-11").toBe(true);
  });

  test("인천 응시료(11/30 마감)는 2026-11 열, K-뉴딜(12/31 마감)은 2026-12 열", () => {
    const p = pipe();
    expect(colOf(p, INCHEON).key).toBe("2026-11");
    expect(colOf(p, KNEWDEAL).key).toBe("2026-12");
  });

  test("카드마다 출처: 지금 열린 것은 now, 수료 뒤에 열리는 청년도전은 training_completion", () => {
    const p = pipe();
    expect(cardsOf(p).find((c) => c.policyId === INCHEON)!.source).toBe("now");
    expect(cardsOf(p).find((c) => c.policyId === CHALLENGE)!.source).toBe("training_completion");
  });

  test("상태가 바뀌어 구간이 먼저 끝나면 그날이 마감: 그 달 열에 놓는다", () => {
    const rm = buildRoadmap(buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3 })); // 2027-03-19 취업
    const p = buildPipeline(rm, allRelations());
    const ended = rm.rows.filter((r) => r.lastAvailable && (r.official.type === "always" || !r.official.end || r.official.end > r.lastAvailable));
    expect(ended.length).toBeGreaterThan(0);
    for (const r of ended) expect(colOf(p, r.policyId).key).toBe(r.lastAvailable!.slice(0, 7));
  });

  test("열마다 6장까지, 나머지는 개수로", () => {
    for (const c of pipe().columns) {
      expect(c.cards.length).toBeLessThanOrEqual(6);
      expect(c.hidden).toBe(c.total - c.cards.length);
    }
  });

  test("가정한 사건은 열 사이 표시로(그 달 열 앞에)", () => {
    const m = pipe().markers.find((x) => x.type === "training_completion")!;
    expect(m.date).toBe("2026-12-19");
    expect(m.beforeKey).toBe("2026-12");
  });
});

describe("중복 수혜 제한과 연계는 그대로", () => {
  test("국취 ⛔ 청년도전, 청년도전 ➜ 국취", () => {
    const cards = cardsOf(pipe());
    const challenge = cards.find((c) => c.policyId === CHALLENGE)!;
    expect(challenge.blockedBy.map((b) => b.id)).toContain(NATIONAL);
    expect(challenge.leadsTo.map((l) => l.id)).toContain(NATIONAL);
  });

  test("같은 열 안에서 서로 제한하는 카드는 '하나만' 묶음으로", () => {
    const rm = buildRoadmap(buildTimeline(PERSONA_A, NOW, {}));
    const base = buildPipeline(rm, []);
    const col = base.columns.find((c) => c.cards.length >= 2)!;
    const [a, b] = col.cards;
    const p = buildPipeline(rm, [{ from: a.policyId, fromName: a.name, to: b.policyId, toName: b.name, kind: "blocks", quote: "q", source: "api", sourceUrl: null, checkedAt: null }]);
    expect(p.columns.find((c) => c.key === col.key)!.exclusiveGroups).toEqual([[a.policyId, b.policyId]]);
  });
});
