import { expect, test } from "vitest";
import { roadmapRange } from "@/lib/planner/roadmap-range";

test("가까운 일정만 있으면 이번 달부터 최소 7개월", () => {
  const r = roadmapRange("2026-11-23", ["2026-12-19", null]);
  expect(r).toMatchObject({ start: "2026-11-01", end: "2027-06-01", step: 1 });
  expect(r.ticks[0]).toBe("2026-11-01");
  expect(r.ticks.length).toBe(7);
});

test("멀리 있는 기한 · 일정까지 잘리지 않게 축을 늘린다", () => {
  const r = roadmapRange("2026-11-23", ["2028-02-09", "2027-07-29"]);
  expect(r.start).toBe("2026-11-01");
  expect(r.end).toBe("2028-03-01");
  expect(r.step).toBe(2); // 16개월이면 2개월 간격 눈금
  expect(r.ticks).toContain("2028-01-01");
});

test("아주 먼 날짜(2030년 상시 마감 등)는 4년까지만", () => {
  const r = roadmapRange("2026-11-23", ["2030-04-22"]);
  expect(r.end).toBe("2030-05-01");
  expect(r.step).toBe(6);
  expect(roadmapRange("2026-11-23", ["2033-01-01"]).end).toBe("2030-11-01");
});

test("지난 날짜는 축을 앞으로 늘리지 않는다", () => {
  expect(roadmapRange("2026-11-23", ["2025-01-01"]).start).toBe("2026-11-01");
});
