import { describe, expect, test } from "vitest";
import { BenefitsSchema, evaluateRules } from "@/lib/judge/overlap";
import type { Benefit } from "@/lib/judge/types";
import type { ApprovedRule } from "@/lib/data/overlap-schema";
import { rule, SOURCE, TARGET } from "./runtime-fixture";

const now = new Date("2027-01-14T12:00:00+09:00");
const next = new Date("2027-01-15T00:00:00+09:00");
const fact = (p: Omit<Benefit, "policyId">): Benefit => ({ policyId: SOURCE, ...p });
const run = (r: ApprovedRule, facts: Benefit[], day = now) => evaluateRules([r], facts, [], day).current_restrictions[0];

describe("중복수혜 조건과 개인 사실", () => {
  test("달력 기준 종료 후 여섯 달의 경계, 미수급, 마지막 지급일 누락", () => {
    const r = rule({ condition_type: "within_months_after_end", condition_params: { months: 6 } });
    const ended = [fact({ status: "ended", lastPaymentDate: "2026-07-15" })];
    expect(run(r, ended).state).toBe("applies");
    expect(run(r, ended, next).state).toBe("not_applies");
    expect(run(r, [fact({ status: "ended" })]).question).toContain("마지막 지급일");
    expect(run(r, [fact({ status: "eligible_unpaid" })]).state).toBe("not_applies");
  });

  test("선정 대기와 선정·첫 지급을 구분하고 원문과 공식 연구 근거를 보존한다", () => {
    const r = rule({ condition_type: "selected", effect_type: "selection_excluded", research_basis: {
      source_row: "표 1 행 12", url: "https://example.org/faq", conclusion: "선정 시 제외",
    } });
    expect(run(r, [fact({ status: "applied" })]).state).toBe("not_applies");
    for (const status of ["selected", "receiving"] as const) {
      expect(run(r, [fact({ status })])).toMatchObject({ state: "applies", reason: expect.stringContaining("선정 시 제외"),
        evidence: { quote: r.evidence.quote_text, url: r.research_basis!.url } });
    }
    expect(run(rule(), [fact({ status: "selected" })]).state).toBe("not_applies");
  });

  test("확인 필요인 규칙, 평가할 수 없는 예외·조건은 차단으로 바뀌지 않는다", () => {
    for (const patch of [{ judgement: "needs_check", needs_check_reason: "회차 미상" }, { exception: "별도 기준 있음" },
      { condition_params: { family_exception: true } }] as const) {
      expect(run(rule(patch), [fact({ status: "receiving" })]).state).toBe("needs_info");
    }
    const result = evaluateRules([rule(), rule({ rule_id: "second" })], [], [], now);
    expect(result.current_restrictions.filter(x => x.question)).toHaveLength(1);
  });

  test("공고일 신분은 동일 공고일·규칙에 명시한 참/거짓만 사용한다", () => {
    const r = rule({ condition_type: "status_on_notice_date", reference_event: "notice_date", condition_params: { notice_date: "2026-11-01" } });
    const notice = { ruleId: r.rule_id, date: "2026-11-01", met: false };
    expect(run(r, [fact({ noticeStatus: notice })]).state).toBe("not_applies");
    expect(run(r, [fact({ noticeStatus: { ...notice, met: true } })]).state).toBe("applies");
    for (const other of [{ ...notice, date: "2026-12-01" }, { ...notice, ruleId: "other" }]) {
      expect(run(r, [fact({ noticeStatus: other })]).state).toBe("needs_info");
    }
  });

  test("월별 지급액은 같은 달 금액으로 비교하며 0은 알려진 값이다", () => {
    const r = rule({ kind: "partial", effect_type: "amount_deduction", restricted_item: "월세 지원금" });
    const pay = (month: string, amountWon: number) => fact({ monthlyPayment: { month, amountWon } });
    expect(run(r, [pay("2027-01", 0), pay("2026-12", 200000)]).state).toBe("not_applies");
    expect(run(r, [pay("2027-01", 100)]).state).toBe("applies");
    expect(run(r, [pay("2026-12", 1234)]).state).toBe("needs_info");
    expect(run(r, []).state).toBe("needs_info");
  });

  test("예정 기간은 교집합이 있을 때만 예정 충돌이며 현재 차단과 구분한다", () => {
    const a = fact({ status: "planned", plannedStart: "2027-02-03", plannedEnd: "2027-02-04" });
    const r = rule({ condition_type: "period_overlap" });
    const b: Benefit = { ...a, policyId: TARGET };
    expect(evaluateRules([r], [], [a, b], now)).toMatchObject({ current_restrictions: [], planned_conflicts: [{ state: "applies" }] });
    expect(evaluateRules([r], [], [a, { ...b, plannedStart: "2027-02-05", plannedEnd: "2027-02-06" }], now).planned_conflicts[0].state).toBe("not_applies");
    expect(evaluateRules([r], [], [a], now).planned_conflicts[0].state).toBe("needs_info");
    const selected = rule({ condition_type: "selected", reference_event: "screening" });
    expect(evaluateRules([selected], [], [a, b], now)).toMatchObject({ current_restrictions: [], planned_conflicts: [{ state: "applies" }] });
    expect(evaluateRules([r], [], [], now).planned_conflicts[0].state).toBe("needs_info");
    const afterEnd = rule({ condition_type: "within_months_after_end", reference_event: "last_payment", condition_params: { months: 6 } });
    expect(evaluateRules([afterEnd], [fact({ status: "ended", lastPaymentDate: "2026-07-15" })], [b], now)).toMatchObject({
      current_restrictions: [{ state: "applies" }], planned_conflicts: [{ state: "not_applies" }],
    });
    expect(evaluateRules([afterEnd], [fact({ status: "receiving" })], [b], now).planned_conflicts[0].state).toBe("needs_info");
    const datesOnly = { policyId: SOURCE, plannedStart: a.plannedStart, plannedEnd: a.plannedEnd };
    expect(evaluateRules([selected], [datesOnly], [datesOnly, b], now).current_restrictions).toEqual([]);
  });

  test("날짜·금액·예정 기간·같은 식별자의 충돌을 검사한다", () => {
    for (const facts of [
      [fact({ lastPaymentDate: "2026-02-29" })],
      [fact({ monthlyPayment: { month: "2026-14", amountWon: 0 } })],
      [fact({ monthlyPayment: { month: "2026-04", amountWon: -1 } })],
      [fact({ plannedStart: "2026-11-02", plannedEnd: "2026-11-01" })],
      [fact({ status: "applied" }), fact({ status: "ended" })],
      [0, 100].map(amountWon => fact({ monthlyPayment: { month: "2026-11", amountWon } })),
      [true, false].map(met => fact({ noticeStatus: { ruleId: "r", date: "2026-01-01", met } })),
    ]) expect(BenefitsSchema.safeParse(facts).success).toBe(false);
    expect(BenefitsSchema.safeParse(["2026-10", "2026-11"].map(month => fact({ monthlyPayment: { month, amountWon: 0 } })) ).success).toBe(true);
  });
});
