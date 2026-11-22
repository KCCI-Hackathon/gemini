import { describe, expect, test } from "vitest";
import { regionHierarchy, regionSelectionForCode } from "@/lib/data/regions";

describe("지역 단계 선택 자료", () => {
  const tree = regionHierarchy();
  const sido = (name: string) => tree.find(item => item.name === name)!;

  test("서울과 충북, 세종은 시도 다음 한 단계에서 끝난다", () => {
    expect(sido("서울").areas.find(area => area.label === "마포구")?.code).toBe("11440");
    expect(sido("충북").areas.find(area => area.label === "보은군")?.code).toBe("43720");
    expect(sido("세종").areas.find(area => area.label === "세종시")?.code).toBe("36110");
  });

  test("경기 수원시는 세 번째 단계에서 영통구 코드로 끝난다", () => {
    const suwon = sido("경기").areas.find(area => area.label === "수원시")!;
    expect(suwon.districts?.find(item => item.label === "영통구")?.code).toBe("41117");
  });

  test("기존 지역 코드를 시도·시군·구 선택으로 복원한다", () => {
    expect(regionSelectionForCode("41117")).toEqual({ sidoCode: "41", areaKey: "수원시", districtCode: "41117" });
    expect(regionSelectionForCode("11440")).toEqual({ sidoCode: "11", areaKey: "마포구", districtCode: null });
    expect(regionSelectionForCode("99999")).toBeNull();
  });

  test("지역명이 불명확한 코드는 이름을 지어내지 않고 코드와 함께 노출한다", () => {
    expect(sido("전남광주").areas.some(area => area.label === "지역명 미확인 (12170)" && area.code === "12170")).toBe(true);
    expect(sido("경기").areas.find(area => area.label === "화성시")?.districts?.some(item => item.label.includes("41591"))).toBe(true);
  });
});
