import { describe, expect, test } from "vitest";
import { applyTransition, needsVerification, simulateTransition, CHANGE_LABEL } from "@/lib/sim/transition";
import { PERSONA_A } from "@/lib/judge/personas";

const NOW = new Date("2026-11-24T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const KNEWDEAL = "20260714005400113258";
const NATIONAL = "20260710005400113256";
const CHALLENGE = "20250122005400110346";
const DREAMFOR = "20260406005400212442";

const change = (rs: ReturnType<typeof simulateTransition>, id: string) => rs.find((r) => r.policyId === id)?.change;

describe("simulateTransition", () => {
  test("격리: 여러 번 호출해도 입력 프로필이 바뀌지 않고 결과가 같다", () => {
    const before = structuredClone(PERSONA_A);
    const a = simulateTransition(PERSONA_A, "get_employed", NOW);
    const b = simulateTransition(PERSONA_A, "get_employed", NOW);
    simulateTransition(PERSONA_A, "get_employed", NOW);
    expect(PERSONA_A).toEqual(before);
    expect(a.map((r) => r.change)).toEqual(b.map((r) => r.change));
  });

  test("수료 상태로 변경: k-뉴딜은 조건 충족 시 신청 가능, 청년도전은 6개월 경과 후 재검토", () => {
    const rs = simulateTransition(PERSONA_A, "complete_training", NOW);
    expect(change(rs, KNEWDEAL)).toBe("eligible_if_conditions");
    expect(change(rs, CHALLENGE)).toBe("recheck_after_period");
    expect(change(rs, INCHEON)).toBe("unchanged");
  });

  test("취업 상태로 변경: 인천 응시료는 기준일(응시일) 확인, 국취는 대상 정의 확인, 드림For는 조건 충족 시 검토(모집 종료)", () => {
    const rs = simulateTransition(PERSONA_A, "get_employed", NOW);
    expect(change(rs, INCHEON)).toBe("reference_date_needed");
    expect(change(rs, NATIONAL)).toBe("definition_check");
    const d = rs.find((r) => r.policyId === DREAMFOR)!;
    expect(d.change).toBe("eligible_if_conditions");
    expect(d.after.recruitment).toBe("closed");
  });

  test("이어서 적용: 수료 → 취업이면 k-뉴딜은 '개시일 전 해소' 기준일 확인", () => {
    const trained = applyTransition(PERSONA_A, "complete_training", NOW);
    const rs = simulateTransition(trained, "get_employed", NOW);
    expect(change(rs, KNEWDEAL)).toBe("reference_date_needed");
  });

  test("일괄 비해당 금지: 제한없음 코드의 비검증 정책은 취업해도 그대로", () => {
    const rs = simulateTransition(PERSONA_A, "get_employed", NOW);
    const unrestricted = rs.filter((r) => !r.verified && r.jobCodes.includes("0013010"));
    expect(unrestricted.length).toBeGreaterThan(10);
    for (const r of unrestricted) expect(r.after.personal.value).toBe(r.before.personal.value);
  });

  test("코드 기준 재검토: 미취업자 코드만 가진 비검증 정책은 recheck_code_only, 비해당이 아니라 확인 필요", () => {
    const rs = simulateTransition(PERSONA_A, "get_employed", NOW);
    const codeOnly = rs.filter((r) => r.change === "recheck_code_only");
    expect(codeOnly.length).toBeGreaterThan(0);
    for (const r of codeOnly) {
      expect(r.verified).toBe(false);
      expect(r.after.personal.value).toBe("needs_check");
    }
  });

  test("취업과 무관한 코드(영농종사자만)의 비검증 정책은 취업해도 변화 없음", () => {
    const rs = simulateTransition(PERSONA_A, "get_employed", NOW);
    const farm = rs.filter((r) => !r.verified && r.jobCodes.length > 0 && r.jobCodes.every((c) => c === "0013008"));
    expect(farm.length).toBeGreaterThan(0);
    for (const r of farm) expect(r.change).toBe("unchanged");
  });

  test("비검증 정책이 취업 후 새로 해당 범위에 들어오면 '코드 기준' 문구를 쓴다", () => {
    const rs = simulateTransition(PERSONA_A, "get_employed", NOW);
    expect(rs.some((r) => !r.verified && r.change === "eligible_if_conditions")).toBe(false);
    const opened = rs.filter((r) => r.change === "opened_code_only");
    for (const r of opened) {
      expect(r.verified).toBe(false);
      expect(r.jobCodes).toContain("0013001");
    }
  });

  test("사업자등록 상태로 변경: 청년도전은 재검토", () => {
    const trained = applyTransition(PERSONA_A, "complete_training", NOW);
    const rs = simulateTransition(trained, "register_business", NOW);
    expect(["recheck", "recheck_after_period"]).toContain(change(rs, CHALLENGE));
  });

  test("화면 문구는 설계 문서와 같다", () => {
    expect(CHANGE_LABEL.recheck_code_only).toBe("자격 재검토(코드 기준, 본문 미확인)");
    expect(CHANGE_LABEL.reference_date_needed).toBe("자격 판단 기준일 확인 필요");
    expect(CHANGE_LABEL.recheck_after_period).toBe("수료일 기준 6개월 경과 후 재검토");
  });
});

describe("needsVerification", () => {
  test("검증되지 않은 재검토·기준일 확인 정책을 최대 5개, 캐시된 것은 빼고", () => {
    const rs = simulateTransition(PERSONA_A, "get_employed", NOW);
    const ids = needsVerification(rs, new Set());
    expect(ids.length).toBeLessThanOrEqual(5);
    expect(ids.length).toBeGreaterThan(0);
    const again = needsVerification(rs, new Set(ids));
    for (const id of ids) expect(again).not.toContain(id);
  });
});
