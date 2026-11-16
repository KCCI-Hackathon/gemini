import { describe, expect, test } from "vitest";
import { checkQuotes, loadVerified, parseVerified } from "@/lib/data/verified";
import { loadSnapshot } from "@/lib/data/snapshot";

const DEMO = [
  "20260406005400212445", // 인천 자격증 응시료
  "20260714005400113258", // k-뉴딜 아카데미
  "20260710005400113256", // 국민취업지원제도
  "20250122005400110346", // 청년도전지원사업
  "20260406005400212442", // 드림For 청년통장
  "20260921005400113480", // 직장인 든든한 점심밥
];

describe("검증 정책", () => {
  const verified = loadVerified();
  const { policies } = loadSnapshot();

  test("시연 6건이 모두 사람 검증 상태로 로드된다", () => {
    for (const id of DEMO) {
      expect(verified.get(id)?.verificationStatus, id).toBe("human_verified");
    }
  });

  test("API 출처 인용은 모두 원본 텍스트에 실제로 있다", () => {
    for (const id of DEMO) {
      const p = policies.find((x) => x.id === id)!;
      expect(checkQuotes(verified.get(id)!, p), id).toEqual([]);
    }
  });

  test("인천 응시료는 18시 마감, 응시일 기준", () => {
    const v = verified.get("20260406005400212445")!;
    expect(v.apply.endTime).toBe("18:00");
    expect(v.referenceDate.status).toContain("응시일");
  });

  test("드림For는 2026-01-01 기준 나이, 복지포인트와 동시참여 불가 관계", () => {
    const v = verified.get("20260406005400212442")!;
    expect(v.age?.referenceRule).toBe("fixed_date");
    expect(v.age?.referenceDate).toBe("2026-01-01");
    expect(v.confirmedRelations[0].otherId).toBe("20260406005400212410");
  });

  test("필수 필드가 빠지면 거부한다", () => {
    expect(() => parseVerified({ id: "x" })).toThrow();
  });

  test("API 인용이 원문에 없으면 찾아낸다", () => {
    const v = verified.get("20250122005400110346")!;
    const p = policies.find((x) => x.id === v.id)!;
    const broken = { ...v, restrictionQuotes: [{ text: "원문에 없는 문장", source: "api" as const }] };
    expect(checkQuotes(broken, p)).toEqual(["원문에 없는 문장"]);
  });
});
