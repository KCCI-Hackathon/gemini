import { describe, expect, test } from "vitest";
import { loadSnapshot } from "@/lib/data/snapshot";
import { regionOptions, sidoOfOrg } from "@/lib/data/regions";
import { judgeRegion } from "@/lib/judge/region";
import type { Policy } from "@/lib/data/types";

const { policies } = loadSnapshot();
const byId = (id: string) => policies.find((p) => p.id === id)!;
const nationwideZips = byId("20260710005400113256").zipCodes; // 국민취업지원제도의 전국 코드

function fake(overrides: Partial<Policy>): Policy {
  return { ...byId("20260710005400113256"), ...overrides };
}

describe("sidoOfOrg", () => {
  test("표기 변형을 시도 코드로", () => {
    expect(sidoOfOrg("대구광역시")).toBe("27");
    expect(sidoOfOrg("인천광역시 청년정책담당관")).toBe("28");
    expect(sidoOfOrg("전남광주통합특별시")).toBe("12");
    expect(sidoOfOrg("전북특별자치도")).toBe("52");
    expect(sidoOfOrg("고용노동부")).toBeNull();
  });
});

describe("judgeRegion", () => {
  test("중앙부처 전국 사업은 지자체가 등록했어도 해당(국민취업지원제도 회귀 방지)", () => {
    expect(judgeRegion(byId("20260710005400113256"), "28185")).toEqual({ ok: true });
  });

  test("지자체 주관인데 전국 코드가 붙으면 주관 시도로 다시 좁힌다", () => {
    const r = judgeRegion(fake({ supervisingOrg: "대구광역시", zipCodes: nationwideZips }), "28185");
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toContain("대구");
  });

  test("같은 시도면 해당", () => {
    expect(judgeRegion(fake({ supervisingOrg: "인천광역시 청년정책담당관", zipCodes: nationwideZips }), "28185")).toEqual({ ok: true });
  });

  test("지자체로 보이지만 시도를 못 뽑으면 unknown", () => {
    expect(judgeRegion(fake({ supervisingOrg: "가상군청 일자리과", zipCodes: nationwideZips }), "28185").ok).toBe("unknown");
  });

  test("내 시군구 코드가 목록에 없으면 해당 안 됨", () => {
    expect(judgeRegion(fake({ zipCodes: ["47111"] }), "28185").ok).toBe(false);
  });
});

describe("regionOptions", () => {
  test("스냅샷에 실제로 있는 코드만(고양시는 구 단위)", () => {
    const codes = regionOptions().map((o) => o.code);
    expect(codes).not.toContain("41280");
    expect(codes).toContain("41281");
    expect(codes).toContain("28185");
  });
  test("모든 선택지에 이름이 붙는다", () => {
    for (const o of regionOptions()) expect(o.label.length).toBeGreaterThan(1);
  });
});
