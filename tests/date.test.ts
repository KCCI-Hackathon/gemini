import { describe, expect, test } from "vitest";
import { addMonths, isOpenAt, monthsBetween, toKstDate } from "@/lib/date";

describe("isOpenAt", () => {
  test("종료일 당일은 24시까지 모집 중", () => {
    expect(isOpenAt(new Date("2026-11-30T23:59:00+09:00"), "2026-02-01", "2026-11-30")).toBe("open");
    expect(isOpenAt(new Date("2026-12-01T00:00:00+09:00"), "2026-02-01", "2026-11-30")).toBe("closed");
  });
  test("마감 시각이 있으면 그 시각까지", () => {
    expect(isOpenAt(new Date("2026-11-30T17:59:00+09:00"), "2026-02-01", "2026-11-30", "18:00")).toBe("open");
    expect(isOpenAt(new Date("2026-11-30T18:00:00+09:00"), "2026-02-01", "2026-11-30", "18:00")).toBe("closed");
  });
  test("기간이 비면 unknown, 시작 전이면 upcoming", () => {
    expect(isOpenAt(new Date("2026-11-16T12:00:00+09:00"), null, null)).toBe("unknown");
    expect(isOpenAt(new Date("2026-11-16T12:00:00+09:00"), "2026-12-01", "2026-12-31")).toBe("upcoming");
  });
});

describe("toKstDate", () => {
  test("서버가 UTC여도 한국 날짜로 판단", () => {
    expect(toKstDate(new Date("2026-11-30T15:30:00Z"))).toBe("2026-12-01");
  });
});

describe("monthsBetween / addMonths", () => {
  test("6개월 경계", () => {
    expect(monthsBetween("2026-12-02", "2027-06-01")).toBe(5);
    expect(monthsBetween("2026-12-02", "2027-06-02")).toBe(6);
  });
  test("addMonths는 달을 더한다", () => {
    expect(addMonths("2026-12-02", 6)).toBe("2027-06-02");
  });
});
