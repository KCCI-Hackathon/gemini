import { z } from "zod";
import type { ApprovedRule } from "@/lib/data/overlap-schema";
import { loadSnapshot } from "@/lib/data/snapshot";
import { addMonths, toKstDate } from "@/lib/date";
import { PolicyIdSchema } from "@/lib/data/overlap-schema";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const date = z.iso.date();
const BenefitSchema = z.strictObject({
  policyId: PolicyIdSchema,
  status: z.enum(["applied", "selected", "receiving", "eligible_unpaid", "ended", "planned", "unknown"]).optional(),
  lastPaymentDate: date.optional(),
  plannedStart: date.optional(),
  plannedEnd: date.optional(),
  noticeStatus: z.strictObject({ ruleId: z.string().min(1), date, met: z.boolean() }).optional(),
  monthlyPayment: z.strictObject({ month, amountWon: z.int().nonnegative() }).optional(),
});
export type Benefit = z.infer<typeof BenefitSchema>;

/** Rows for different payment months and notice dates may describe the same benefit. */
export const BenefitsSchema = z.array(BenefitSchema).superRefine((rows, ctx) => {
  const seen = new Map<string, string | number | boolean>();
  const unpaid = new Set<string>();
  const paid = new Set<string>();
  function record(key: string, value: string | number | boolean | undefined, index: number) {
    if (value === undefined) return;
    if (seen.has(key) && seen.get(key) !== value) ctx.addIssue({ code: "custom", path: [index], message: "같은 수혜 사실의 값이 다릅니다." });
    seen.set(key, value);
  }
  for (const [index, row] of rows.entries()) {
    const id = row.policyId;
    // A future plan and current status can both be known.
    if (row.status !== "planned" && row.status !== "unknown") record(id + ":status", row.status, index);
    record(id + ":last", row.lastPaymentDate, index);
    record(id + ":start", row.plannedStart, index);
    record(id + ":end", row.plannedEnd, index);
    if (row.monthlyPayment) record(id + ":pay:" + row.monthlyPayment.month, row.monthlyPayment.amountWon, index);
    const notice = row.noticeStatus;
    if (notice) record(id + ":notice:" + notice.ruleId + ":" + notice.date, notice.met, index);
    const start = seen.get(id + ":start"), end = seen.get(id + ":end");
    if (typeof start === "string" && typeof end === "string" && start > end)
      ctx.addIssue({ code: "custom", path: [index], message: "예정 시작일이 종료일보다 늦습니다." });
    if (row.status === "eligible_unpaid") unpaid.add(id);
    if (row.lastPaymentDate || (row.monthlyPayment?.amountWon ?? 0) > 0) paid.add(id);
    if (unpaid.has(id) && paid.has(id)) ctx.addIssue({ code: "custom", path: [index], message: "미수급 상태와 실제 지급 기록이 충돌합니다." });
  }
});

export type Restriction = {
  ruleId: string; sourceId: string; sourceName: string;
  review?: { source: "agent" | "research"; verdict: ApprovedRule["verify_verdict"]; judgement: ApprovedRule["judgement"]; model: string | null; reason: string | null };
  effect: ApprovedRule["effect_type"]; restricted_item: string | null;
  state: "applies" | "not_applies" | "needs_info";
  reason: string; question: string | null;
  /** 답이 Benefit 칸에 담기는 질문의 종류. 있으면 화면이 질문을 보여 준다. 문구 비교 대신 이 칸을 쓴다. */
  need?: Need;
  /** need 가 monthly_amount 일 때 묻는 지급 월(YYYY-MM) */
  month?: string;
  /** 화면용 짧은 문구. 조사 메모(needs_check_reason · research_basis)는 reason 에만 남긴다. */
  summary?: string;
  evidence: { field: string | null; quote: string; url: string | null; checkedAt: string };
};
export type Need = "receiving" | "selected" | "ended" | "last_payment" | "monthly_amount";
type Decision = Pick<Restriction, "state" | "reason" | "question" | "need" | "month" | "summary">;
const applies = (reason: string, summary?: string): Decision => ({ state: "applies", reason, question: null, ...(summary && { summary }) });
const no = (reason: string): Decision => ({ state: "not_applies", reason, question: null });
const ask = (reason: string, question: string, extra: Pick<Decision, "need" | "month" | "summary"> = {}): Decision => ({ state: "needs_info", reason, question, ...extra });
const factsNeeded: Record<string, string> = {
  activity: "해당 교육기간에 카드로 다른 훈련을 실제 수강하나요?",
  paid_months_at_least: "이 사업에서 실제 지급받은 기간은 몇 개월인가요?",
  program_type: "참여 중인 사업의 유형은 무엇인가요?",
  service: "기존 사업에서 이용하는 서비스는 무엇인가요?",
  points_used_year: "공고에서 지정한 해에 포인트를 실제로 사용했나요?",
  public_housing_residence: "신청 기준일에 해당 공공임대주택에 실제 거주하나요?",
  fund_loan_in_use: "신청 기준일에 해당 기금 대출을 이용 중인가요?",
  household_fund_loan: "신청 기준일에 가구원이 해당 기금 대출을 이용 중인가요?",
  same_contract_broker_fee: "같은 계약의 중개보수를 이미 지원받았나요?",
};
const knownParams = {
  receiving: ["payment_month", "min_amount_won", "max_amount_won"], within_months_after_end: ["months"],
  selected: [], status_on_notice_date: ["notice_date"], period_overlap: ["start", "end"],
} satisfies Record<NonNullable<ApprovedRule["condition_type"]>, string[]>;
const referenceEvents: Record<NonNullable<ApprovedRule["condition_type"]>, string[]> = {
  receiving: ["apply_date"], selected: ["screening", "apply_date"], within_months_after_end: ["last_payment", "apply_date"],
  status_on_notice_date: ["notice_date"], period_overlap: ["apply_date", "training_start"],
};

function condition(r: ApprovedRule, facts: Benefit[], plans: Benefit[], today: string, planned: boolean): Decision {
  const p = r.condition_params;
  const status = facts.find(f => f.status && f.status !== "unknown" && f.status !== "planned")?.status;
  const unknown = () => ask(r.needs_check_reason ?? "공고의 적용 조건 확인 필요",
    Object.keys(p).map(k => factsNeeded[k]).find(Boolean) ?? "공고의 어떤 조건이 해당되는지 확인했나요?", { summary: "공고의 적용 조건 확인 필요" });
  if (!r.condition_type) return unknown();
  const supported: string[] = knownParams[r.condition_type];
  if (Object.keys(p).some(k => !supported.includes(k))) return unknown();
  if (r.reference_event && !referenceEvents[r.condition_type].includes(r.reference_event))
    return ask("공고가 요구하는 기준 시점의 사실 확인 필요", "공고가 지정한 시점에도 해당 상태였나요?");
  if (r.condition_type === "period_overlap" || planned) {
    if (r.condition_type !== "period_overlap" && r.condition_type !== "receiving" && r.condition_type !== "selected") return unknown();
    const a = plans.filter(x => x.policyId === r.source_policy_id);
    const b = plans.filter(x => x.policyId === r.target_policy_id);
    const from = a.find(x => x.plannedStart)?.plannedStart, until = a.find(x => x.plannedEnd)?.plannedEnd;
    const bFrom = p.start ?? b.find(x => x.plannedStart)?.plannedStart;
    const bUntil = p.end ?? b.find(x => x.plannedEnd)?.plannedEnd;
    if (!from || !until || typeof bFrom !== "string" || typeof bUntil !== "string" || !date.safeParse(bFrom).success || !date.safeParse(bUntil).success || bFrom > bUntil)
      return ask("두 사업의 예정 기간 확인 필요", "두 사업의 시작일과 종료일은 언제인가요?");
    if (until < today || bUntil < today) return no("예정 기간이 이미 지남");
    if (from > bUntil || bFrom > until) return no("예정 기간이 겹치지 않음");
    if (r.condition_type === "receiving" && (r.effect_type === "amount_deduction" || Object.keys(p).length))
      return ask("예정 기간은 겹치지만 실제 지급액 확인 필요", "해당 월의 지급액이 정해졌나요?");
    return applies(r.condition_type === "selected" ? "두 계획의 기간이 겹치며 실제 선정 시 제한" : "두 사업의 예정 기간이 겹침");
  }
  switch (r.condition_type) {
    case "status_on_notice_date": {
      if (!date.safeParse(p.notice_date).success) return ask("적용 회차의 공고일 확인 필요", "이번 회차의 공고일은 언제인가요?");
      const notice = facts.map(f => f.noticeStatus).find(s => s?.ruleId === r.rule_id && s.date === p.notice_date);
      return notice ? (notice.met ? applies("해당 공고일의 신분 조건에 해당") : no("해당 공고일의 신분 조건에 해당하지 않음"))
        : ask("공고일 당시 신분 확인 필요", "해당 공고일에 이 사업의 대상 신분이었나요?");
    }
    case "within_months_after_end": {
      if (typeof p.months !== "number" || !Number.isSafeInteger(p.months) || p.months <= 0) return unknown();
      if (status && status !== "ended") return no("지급 종료 후 제한 조건에 해당하지 않음");
      if (!status) return ask("지급 종료 여부 확인 필요", "이 사업의 지급이 종료됐나요?", { need: "ended" });
      const last = facts.find(f => f.lastPaymentDate)?.lastPaymentDate;
      if (!last || last > today) return ask("마지막 지급일 확인 필요", "실제 마지막 지급일은 언제인가요?", { need: "last_payment" });
      return today < addMonths(last, p.months) ? applies("지급 종료 후 제한 기간 이내") : no("지급 종료 후 제한 기간 경과");
    }
    case "selected":
      return status ? (status === "selected" || status === "receiving" ? applies("해당 사업에 선정됨") : no("현재 선정 상태에 해당하지 않음"))
        : ask("선정 여부 확인 필요", "신청한 뒤 선정 통보를 받았나요?", { need: "selected" });
    case "receiving": {
      if (r.effect_type === "amount_deduction" || Object.keys(p).length) {
        const when = p.payment_month ?? today.slice(0, 7);
        const min = p.min_amount_won ?? 1, max = p.max_amount_won ?? Number.MAX_SAFE_INTEGER;
        if (!month.safeParse(when).success || typeof min !== "number" || typeof max !== "number" ||
            !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || min > max) return unknown();
        const payment = facts.map(f => f.monthlyPayment).find(m => m?.month === when);
        if (!payment) return ask("해당 월 지급액 확인 필요", `${Number(String(when).slice(5))}월에 실제로 지급받은 금액은 얼마인가요?`, { need: "monthly_amount", month: String(when) });
        return payment.amountWon >= min && payment.amountWon <= max ? applies("해당 월 지급액이 제한 기준에 해당") : no("해당 월 지급액이 제한 기준에 해당하지 않음");
      }
      return status ? (status === "receiving" ? applies("현재 해당 사업 수급 중") : no("현재 수급 중이 아님"))
        : ask("실제 수급 여부 확인 필요", "해당 사업의 지원금을 현재 받고 있나요?", { need: "receiving" });
    }
  }
}

const fullEffects = new Set(["participation_block", "apply_block", "selection_excluded"]);
export function blocksParticipation(r: Restriction) {
  return r.state === "applies" && r.restricted_item === null && r.effect !== null && fullEffects.has(r.effect);
}

let names: Map<string, string> | undefined;
function restriction(r: ApprovedRule, decision: Decision): Restriction {
  let d = decision;
  if (r.judgement === "needs_check") {
    d = ask(r.needs_check_reason ?? "중복수혜 근거 검토가 충분하지 않아요", "이번 회차의 제한 조항과 적용 조건을 확인했나요?", { summary: "중복수혜 근거 검토 필요" });
  } else if (d.state === "applies") {
    if (r.judgement !== "blocked" || !r.effect_type) {
      d = ask(r.needs_check_reason ?? "공고의 제한 조건 확인 필요", "이번 회차의 제한이 확인됐나요?", { summary: "공고의 제한 조건 확인 필요" });
    } else if (r.exception && !(r.condition_type === "receiving" &&
      ["수급자격만 있고 수급하지 않으면 참여 가능", "다만, 고용보험에 가입되어 구직급여 수급자격을 갖춘 경우라도 구직급여를 수급하지 않으면 참여 가능"].includes(r.exception))) {
      d = ask("공고의 예외 조건 확인 필요", "다음 예외에 해당하나요? " + r.exception);
    } else if (r.restricted_item && r.source !== "research") {
      d = ask("제한되는 항목 확인 필요", "공고에서 제한되는 항목이 확인됐나요?");
    } else if (!r.restricted_item && !fullEffects.has(r.effect_type)) {
      d = ask("제한되는 항목 확인 필요", "어떤 지원 항목이 제한되는지 확인했나요?");
    } else {
      const itemEffect = r.effect_type === "personal_payment_block" ? " 미지급" : r.effect_type === "amount_deduction" ? " 차감" : " 제한";
      const effect = r.restricted_item ? r.restricted_item + itemEffect : "수혜 불가";
      d = applies([effect, d.reason, r.research_basis?.conclusion].filter(Boolean).join(" · "), effect);
    }
  }
  names ??= new Map(loadSnapshot().policies.map(x => [x.id, x.name]));
  return {
    ...d, ruleId: r.rule_id, sourceId: r.source_policy_id, sourceName: names.get(r.source_policy_id) ?? r.source_policy_id,
    review: { source: r.source, verdict: r.verify_verdict, judgement: r.judgement, model: r.model, reason: r.needs_check_reason },
    effect: r.effect_type, restricted_item: r.restricted_item, evidence: {
      field: r.evidence.source_field, quote: r.evidence.quote_text, url: r.research_basis?.url ?? r.evidence.source_url,
      checkedAt: r.evidence.checked_at,
    },
  };
}

export function evaluateRules(rules: ApprovedRule[], benefits: Benefit[], plannedBenefits: Benefit[], now: Date) {
  const current_restrictions: Restriction[] = [], planned_conflicts: Restriction[] = [];
  const today = toKstDate(now);
  for (const r of rules) {
    const facts = benefits.filter(x => x.policyId === r.source_policy_id &&
      ((x.status && x.status !== "planned") || x.noticeStatus || x.monthlyPayment || x.lastPaymentDate));
    const planned = plannedBenefits.some(x => x.policyId === r.source_policy_id);
    const targetPlans = plannedBenefits.filter(x => x.policyId === r.target_policy_id);
    if (r.condition_type !== "period_overlap" && (facts.length || !planned)) {
      current_restrictions.push(restriction(r, condition(r, facts, [], today, false)));
    }
    if (r.condition_type === "within_months_after_end" && targetPlans.length) {
      const start = targetPlans.find(f => f.plannedStart)?.plannedStart;
      let d: Decision;
      if (!start) d = ask("예정 기준일 확인 필요", "언제 이 사업에 참여할 계획인가요?");
      else if (start > today && facts.some(f => f.status === "receiving"))
        d = ask("예정 기준일까지 지급이 끝나는지 확인 필요", "예정 신청일 전에 실제 지급이 끝나나요?");
      else d = condition(r, facts, [], start, false);
      planned_conflicts.push(restriction(r, d));
    } else if (planned || r.condition_type === "period_overlap" || (facts.length && targetPlans.length)) {
      planned_conflicts.push(restriction(r, condition(r, facts, plannedBenefits, today, true)));
    }
  }
  // Ask for the missing detail of a reported benefit before asking about another program.
  const reported = new Set([...benefits, ...plannedBenefits].map(f => f.policyId));
  const candidates = current_restrictions.some(blocksParticipation)
    ? planned_conflicts : [...current_restrictions, ...planned_conflicts];
  const unanswered = candidates.filter(r => r.question);
  const first = unanswered.find(r => reported.has(r.sourceId)) ?? unanswered[0];
  for (const item of [...current_restrictions, ...planned_conflicts]) if (item !== first) item.question = null;
  return { current_restrictions, planned_conflicts };
}
