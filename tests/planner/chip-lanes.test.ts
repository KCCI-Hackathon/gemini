import { expect, test } from "vitest";
import { chipLanes } from "@/lib/planner/chip-lanes";

test("현재와 같은 주의 수료 · 취업 칩은 서로 다른 줄에 놓인다", () => {
  // 현재 11/23, 수료 · 취업 11/28 : 5일 차이는 칩 폭보다 좁다
  const lanes = chipLanes([
    { id: "today", x: 100, width: 132 },
    { id: "course", x: 130, width: 186 },
    { id: "job", x: 130, width: 186 },
  ]);
  expect(new Set(lanes.values()).size).toBe(3);
  expect(lanes.get("today")).toBe(0);
});

test("충분히 떨어진 칩은 첫 줄을 함께 쓰고, 앞 칩이 끝난 뒤의 칩은 빈 윗줄로 돌아간다", () => {
  const lanes = chipLanes([
    { id: "today", x: 0, width: 132 },
    { id: "course", x: 400, width: 186 },
    { id: "job", x: 420, width: 186 },
    { id: "move", x: 900, width: 186 },
  ]);
  expect(Object.fromEntries(lanes)).toEqual({ today: 0, course: 0, job: 1, move: 0 });
});

test("날짜 순서와 입력 순서가 달라도 같은 결과", () => {
  const chips = [{ id: "b", x: 50, width: 100 }, { id: "a", x: 0, width: 100 }];
  expect(Object.fromEntries(chipLanes(chips))).toEqual({ a: 0, b: 1 });
  expect(Object.fromEntries(chipLanes([...chips].reverse()))).toEqual({ a: 0, b: 1 });
});
