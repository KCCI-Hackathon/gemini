import { expect, test } from "vitest";
import { roadmapRange } from "@/lib/planner/roadmap-range";

test("일정이 없으면 이번 달부터 1년", () => {
  const r = roadmapRange("2026-11-23", []);
  expect(r).toMatchObject({ start: "2026-11-01", end: "2027-12-01", step: 1 });
  expect(r.ticks[0]).toBe("2026-11-01");
});

test("마지막 상태 변화(이사 2028-02-09) 뒤 1년까지만 표시한다", () => {
  const r = roadmapRange("2026-11-23", ["2027-01-20", "2027-07-29", "2028-02-09"]);
  expect(r.start).toBe("2026-11-01");
  expect(r.end).toBe("2029-03-01");
  expect(r.step).toBe(3); // 28개월이면 3개월 간격 눈금
});

test("지난 일정은 축을 늘리지 않는다", () => {
  expect(roadmapRange("2026-11-23", ["2025-01-01"]).end).toBe("2027-12-01");
});
