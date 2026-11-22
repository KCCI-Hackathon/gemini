import { describe, expect, test } from "vitest";
import { ageRange } from "@/lib/judge/personal";
import { birthYmForDate, isValidBirthDate } from "@/lib/judge/birth-date";
import { ProfileSnapshotSchema } from "@/lib/planner/schema";
import { PERSONA_A } from "@/lib/judge/personas";

describe("날짜 전용 생년월일", () => {
  test("유효한 날짜만 받고 미래·불가능한 날짜를 거부한다", () => {
    expect(isValidBirthDate("2000-02-29", "2026-11-23")).toBe(true);
    expect(isValidBirthDate("1900-02-29", "2026-11-23")).toBe(false);
    expect(isValidBirthDate("2026-11-24", "2026-11-23")).toBe(false);
    expect(isValidBirthDate("2000-2-09", "2026-11-23")).toBe(false);
    expect(isValidBirthDate("", "2026-11-23")).toBe(false);
  });

  test("출생월은 날짜에서 파생한다", () => {
    expect(birthYmForDate("1995-08-17")).toBe("1995-08");
  });

  test("생일 전날·당일·다음 날 나이를 정확히 판정한다", () => {
    expect(ageRange("2000-07", "2026-07-14", "2000-07-15")).toEqual([25, 25]);
    expect(ageRange("2000-07", "2026-07-15", "2000-07-15")).toEqual([26, 26]);
    expect(ageRange("2000-07", "2026-07-16", "2000-07-15")).toEqual([26, 26]);
    expect(ageRange("2000-07", "2027-02-01", "2000-07-15")).toEqual([26, 26]);
  });

  test("2월 29일 생일은 평년에 3월 1일에 나이가 바뀐다", () => {
    expect(ageRange("2000-02", "2026-02-28", "2000-02-29")).toEqual([25, 25]);
    expect(ageRange("2000-02", "2026-03-01", "2000-02-29")).toEqual([26, 26]);
    expect(ageRange("2000-02", "2024-02-29", "2000-02-29")).toEqual([24, 24]);
  });

  test("기존 월 전용 프로필은 유지하고 새 날짜는 birthYm과 일치해야 한다", () => {
    expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A, events: [] }).success).toBe(true);
    expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A, events: [], birthDate: "1999-03-18" }).success).toBe(true);
    expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A, events: [], birthDate: "1999-03-18", birthYm: "1999-04" }).success).toBe(false);
    expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A, events: [], birthDate: "1999-02-29" }).success).toBe(false);
    expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A, events: [], birthDate: "2999-01-01", birthYm: "2999-01" }).success).toBe(false);
  });
});
