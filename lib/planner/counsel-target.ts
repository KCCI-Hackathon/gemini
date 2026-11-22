// 상담 에이전트(설계 2026-11-22 GPT 재설계)가 묻는 질문의 "답이 들어갈 칸"(target)과,
// 사용자의 답을 판정 입력(프로필 · 일정 · 수혜 상태)으로 바꾸는 코드. 화면과 서버가 같이 쓴다.
// AI 는 답을 들고 판정하지 않는다. 답은 여기서 구조화된 값이 되고, 판정 코드가 다시 판정한다.
import type { Profile } from "@/lib/judge/types";
import { applyAnswer, type BenefitAnswer } from "./answers";
import { addDays, isDate } from "./dates";
import type { BenefitQuestion, PlanEvent, PlannerInput } from "./types";

export type CounselTarget =
  | { kind: "benefit"; policyId: string; answer: "receiving" | "selected" | "ended_date" | "monthly_amount"; month?: string }
  | { kind: "event"; event: "training_completion" | "employment" | "business_registration" }
  | { kind: "status" }
  | { kind: "recent_history" };

export const STATUS_VALUES: Record<string, { label: string; statuses: string[] }> = {
  training: { label: "교육·훈련 수강 중", statuses: ["in_training", "unemployed"] },
  seeking: { label: "미취업·구직 중", statuses: ["unemployed"] },
  employed: { label: "재직 중", statuses: ["employed", "health_insured_employee"] },
  business: { label: "사업자등록 있음", statuses: ["business_registered"] },
};
export const MAX_AMOUNT_WON = 10_000_000;

/** 답 칸 종류별로 화면이 붙일 선택지 · 입력 칸. 문장은 AI 가 쓰지만 선택지는 코드가 정한다. */
export function answerOptions(t: CounselTarget): { value: string; label: string }[] | "date" | "amount" {
  if (t.kind === "benefit") {
    if (t.answer === "monthly_amount") return "amount";
    if (t.answer === "selected") return [{ value: "yes", label: "선정됐어요" }, { value: "no", label: "아니에요" }];
    if (t.answer === "ended_date") return [{ value: "yes", label: "받고 있어요" }, { value: "no", label: "안 받아요" }];
    return [{ value: "yes", label: "받고 있어요" }, { value: "no", label: "안 받아요" }];
  }
  if (t.kind === "event") return "date";
  if (t.kind === "status") return Object.entries(STATUS_VALUES).map(([value, v]) => ({ value, label: v.label }));
  return [{ value: "yes", label: "있어요" }, { value: "no", label: "없어요" }];
}

/** 이상한 답 값 막기(설계 7.1). 걸리면 재판정하지 않고 다시 묻는다. */
export function validateAnswer(t: CounselTarget, value: string, today: string): { ok: true } | { ok: false; message: string } {
  const v = value.trim();
  if (t.kind === "event") {
    if (!isDate(v)) return { ok: false, message: "달력에 있는 날짜를 YYYY-MM-DD 로 알려 주세요." };
    if (v < today || v > addDays(today, 365 * 3)) return { ok: false, message: "오늘부터 3년 안의 날짜만 받을 수 있어요." };
    return { ok: true };
  }
  if (t.kind === "status") return STATUS_VALUES[v] ? { ok: true } : { ok: false, message: "보기 중에서 골라 주세요." };
  if (t.kind === "recent_history") return v === "yes" || v === "no" ? { ok: true } : { ok: false, message: "있어요 · 없어요 중에서 골라 주세요." };
  if (t.answer === "monthly_amount") {
    if (v === "no") return { ok: true };
    if (!/^\d+$/.test(v) || Number(v) > MAX_AMOUNT_WON) return { ok: false, message: `0원부터 ${MAX_AMOUNT_WON.toLocaleString()}원 사이의 정수로 알려 주세요.` };
    return { ok: true };
  }
  if (t.answer === "ended_date" && isDate(v)) return v <= today ? { ok: true } : { ok: false, message: "마지막 지급일은 오늘이나 그 전이어야 해요." };
  return v === "yes" || v === "no" ? { ok: true } : { ok: false, message: "보기 중에서 골라 주세요." };
}

/** 검증을 통과한 답을 판정 입력으로 바꾼다. 일정은 같은 종류가 있으면 날짜만 바꾸고 없으면 더한다. */
export function applyTarget(profile: Profile, input: PlannerInput, t: CounselTarget, value: string): { profile: Profile; input: PlannerInput } {
  const v = value.trim();
  if (t.kind === "benefit") {
    const q: BenefitQuestion = { policyId: "", sourcePolicyId: t.policyId, sourceName: "", ruleId: "", question: "", answerKind: t.answer, ...(t.month && { month: t.month }) };
    const answer: BenefitAnswer = t.answer === "monthly_amount"
      ? v === "no" ? { kind: "not_receiving" } : { kind: "monthly_amount", month: t.month!, amountWon: Number(v) }
      : t.answer === "selected" ? { kind: v === "yes" ? "selected" : "not_selected" }
      : isDate(v) ? { kind: "ended", lastPaymentDate: v }
      : { kind: v === "yes" ? "receiving" : "not_receiving" };
    return { profile: { ...profile, benefits: applyAnswer(profile.benefits ?? [], q, answer) }, input: { ...input, mutedKeys: input.mutedKeys.filter(k => k !== "participation") } };
  }
  if (t.kind === "event") {
    const events = [...(input.events ?? [])];
    const at = events.findIndex(e => e.type === t.event);
    const event: PlanEvent = { id: at >= 0 ? events[at].id : `ev-${t.event}`, type: t.event, date: v, status: "scheduled" };
    if (at >= 0) events[at] = event; else events.push(event);
    return { profile, input: { ...input, events } };
  }
  if (t.kind === "status") return { profile: { ...profile, currentStatus: [...STATUS_VALUES[v].statuses] as Profile["currentStatus"] }, input: { ...input, mutedKeys: input.mutedKeys.filter(k => k !== "status") } };
  return { profile: { ...profile, recentHistory: v as "yes" | "no" }, input };
}

/** 수료 예정보다 취업 예정이 먼저인 일정은 막지 않고 한 번 확인한다(설계 7.1). */
export function scheduleNeedsConfirm(input: PlannerInput): string | null {
  const date = (type: PlanEvent["type"]) => input.events?.find(e => e.type === type)?.date;
  const course = date("training_completion"), job = date("employment");
  return course && job && job < course ? "수료 전에 취업 예정이에요. 맞나요?" : null;
}

// 식별 정보 지우기(설계 7장): 전화번호 · 주민번호 · 이메일 · 계좌번호 모양.
// 날짜(2026-12-19)와 정책 번호(20자리)는 지우지 않는다.
const PII = [
  /\b\d{6}\s*-\s*[1-8]\d{6}\b/g, // 주민·외국인등록번호
  /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, // 휴대전화
  /\b0\d{1,2}[-.\s]\d{3,4}[-.\s]\d{4}\b/g, // 일반 전화
  /[\w.+-]+@[\w-]+(\.[\w-]+)+/g, // 이메일
  /\b\d{2,6}-\d{2,6}-\d{2,8}(-\d{1,4})?\b/g, // 계좌(하이픈)
  /(?<!\d)\d{10,14}(?![\d원만])/g, // 계좌(숫자만). 뒤에 '원' · '만'이 붙으면 금액이라 그대로
];
export function scrubPII(text: string): { text: string; redacted: boolean } {
  let out = text, redacted = false;
  for (const re of PII) {
    out = out.replace(re, m => {
      // 하이픈 계좌 패턴이 날짜(YYYY-MM-DD)를 지우지 않게: 숫자 10자리 미만이면 그대로
      if (re.source.startsWith("\\b\\d{2,6}-") && m.replace(/\D/g, "").length < 10) return m;
      redacted = true;
      return "[개인정보]";
    });
  }
  return { text: out, redacted };
}
