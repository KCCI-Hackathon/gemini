import { describe, expect, test } from "vitest";
import raw from "../fixtures/raw-sample.json";
import { normalize, countSnapshot } from "@/lib/data/normalize";
import type { RawPolicy } from "@/lib/data/types";

const records = raw as RawPolicy[];
const byId = (id: string) => normalize(records.find((r) => r.plcyNo === id)!);

describe("normalize", () => {
  test("신청 기간 문자열을 시작·종료 날짜로 나눈다", () => {
    const p = byId("20260406005400212445"); // 인천 자격증 응시료
    expect(p.applyPeriodType).toBe("period");
    expect(p.applyStart).toBe("2026-02-01");
    expect(p.applyEnd).toBe("2026-11-30");
  });

  test("나이 0/0은 null, 쉼표 목록은 배열", () => {
    const p = byId("20260710005400113256"); // 국민취업지원제도
    expect(p.minAge).toBe(15);
    expect(p.maxAge).toBe(69);
    expect(p.jobCodes).toEqual(["0013003"]);
    expect(p.zipCodes.length).toBeGreaterThan(200);
    expect(p.applyPeriodType).toBe("always");
  });

  test("schoolCd 키가 없으면 빈 배열", () => {
    const p = normalize(records[3]);
    expect(p.schoolCodes).toEqual([]);
  });

  test("마감 코드는 closed", () => {
    expect(normalize(records[4]).applyPeriodType).toBe("closed");
  });

  test("공백뿐인 사업 종료일은 null", () => {
    expect(normalize(records[5]).bizEnd).toBeNull();
  });

  test("날짜가 '~'뿐이거나 기간이 두 개 붙은 값은 시작·종료 null", () => {
    for (const r of [records[6], records[7]]) {
      const p = normalize(r);
      expect(p.applyPeriodType).toBe("period");
      expect(p.applyStart).toBeNull();
      expect(p.applyEnd).toBeNull();
    }
  });

  test("'-', '해당 없음', 공백은 빈 문자열로 통일", () => {
    const p = normalize({ ...records[0], addAplyQlfcCndCn: " - ", ptcpPrpTrgtCn: "해당 없음", earnEtcCn: "   " });
    expect(p.texts.addQualification).toBe("");
    expect(p.texts.excluded).toBe("");
    expect(p.texts.income).toBe("");
  });
});

describe("countSnapshot", () => {
  test("범주별 건수의 합이 전체와 같다", () => {
    const ps = records.map(normalize);
    const c = countSnapshot(ps, new Date("2026-11-16T12:00:00+09:00"));
    const sum = c.always + c.periodOpen + c.periodPast + c.periodUpcoming + c.periodUnknown + c.closedCode;
    expect(sum).toBe(c.total);
    expect(c.total).toBe(8);
    expect(c.periodUnknown).toBe(2);
    expect(c.closedCode).toBe(2); // fixture의 schoolCd 없는 레코드도 마감 코드
    expect(c.always).toBe(3);
  });
});
