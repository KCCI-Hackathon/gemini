// 상담 에이전트(설계 2026-11-22 GPT 재설계)가 묻는 질문의 "답이 들어갈 칸"(target)과,
// 사용자의 답을 판정 입력(프로필 · 일정 · 수혜 상태)으로 바꾸는 코드. 화면과 서버가 같이 쓴다.
// AI 는 답을 들고 판정하지 않는다. 답은 여기서 구조화된 값이 되고, 판정 코드가 다시 판정한다.
import type { Profile } from "@/lib/judge/types";
import { applyAnswer, type BenefitAnswer } from "./answers";
import { addDays, isDate } from "./dates";
import { CATEGORIES, type BenefitQuestion, type Category, type PlanEvent, type PlannerInput } from "./types";

export type CounselTarget =
  | { kind: "benefit"; policyId: string; answer: "receiving" | "selected" | "ended_date" | "monthly_amount"; month?: string }
  | { kind: "event"; event: "training_completion" | "employment" | "business_registration" }
  | { kind: "status" }
  | { kind: "preferred_category" }
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
  if (t.kind === "preferred_category") return [{ value: "all", label: "모든 분야" }, ...Object.entries(CATEGORIES).map(([value, category]) => ({ value, label: category.label }))];
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
  if (t.kind === "preferred_category") return v === "all" || Object.hasOwn(CATEGORIES, v) ? { ok: true } : { ok: false, message: "보기 중에서 골라 주세요." };
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
  if (t.kind === "preferred_category") return { profile, input: { ...input, preferredCategory: v as Category | "all", mutedKeys: input.mutedKeys.filter(k => k !== "interest") } };
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
// 상세 주소: 시 · 군 · 구 · 동 이름만은 그대로 두고, 번지 · 도로명 번호 · 동호수가 붙으면 지운다.
// 숫자 뒤에 기간 · 개수 · 금액 단위가 오면(앞으로 3개월, 추가 200만원) 주소가 아니다.
const UNIT = "(?![\\d개월일년달주명원만세살시분회차건번호선%.])";
const ADDRESS = [
  /\d{1,4}\s?동\s?\d{1,4}\s?호/g, // 101동 1203호
  /[가-힣]{1,10}(?:동|읍|면|리|가)\s?\d{1,5}(?:-\d{1,4})?\s?번지/g, // 매탄동 123번지
  /[가-힣]{1,10}(?:동|읍|면|리|가)\s?\d{1,5}-\d{1,4}(?!\d)/g, // 매탄동 123-4
  /[가-힣0-9]{1,12}(?:로|길)\s?\d{1,4}번길\s?\d{1,4}(?:-\d{1,4})?(?!\d)/g, // 중앙로12번길 34-1
  new RegExp(`[가-힣0-9]{1,12}(?<!으)(?<![앞새바]로)(?:로|길)\\s?\\d{1,4}(?:-\\d{1,4})?${UNIT}`, "g"), // 월드컵로 120
];
// 스스로 밝힌 이름: "제 이름은 ○○" · "○○라고 해요"는 모양만으로, "저는 ○○이고" · "○○입니다"는
// 흔한 성씨로 시작하는 세 글자이고 상태 낱말(대학생 · 장애인 · 구직자 …)이 아닐 때만.
const SURNAME = "김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경";
const STATUS_WORDS = new Set(["대학생", "장애인", "한부모", "구직자", "정규직", "신입생", "차상위", "유학생", "임시직", "계약직", "직장인", "자영업", "수급자", "고령자", "고교생", "중학생", "초등생", "취준생", "재학생", "휴학생", "졸업생", "군인이", "주부예", "전역자", "이사자", "창업자", "예비군", "청년이", "학생이", "신혼이", "무직자", "프리랜", "알바생", "인턴이", "기혼자", "미혼자", "임산부", "다자녀", "조손가", "한부모", "외국인", "이주민", "북한이", "국가유", "보훈대"]);
const NAME_CUE = /((?:제\s?)?이름은\s?)([가-힣]{2,4})(?=\s|이에요|예요|입니다|이고|이야|[.,!?]|$)/g;
const NAME_SAID = /(^|[\s.,!?])([가-힣]{2,4})(?=\s?(?:이)?라고\s?(?:해요|합니다|해|불러))/g;
const NAME_SELF = new RegExp(`(^|저는\\s?|전\\s?|나는\\s?|난\\s?|[\\s.,!?])([${SURNAME}][가-힣]{2})(?=이고|이에요|입니다|이며|인데|이야|예요|,|\\s?이라고)`, "g");
function scrubName(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const mark = (pre: string) => { redacted = true; return `${pre}[개인정보]`; };
  let out = text.replace(NAME_CUE, (_m, pre: string) => mark(pre));
  out = out.replace(NAME_SAID, (_m, pre: string) => mark(pre));
  out = out.replace(NAME_SELF, (m, pre: string, name: string) => {
    // "저는" 같은 자기소개 표지가 없으면 문장 맨 앞의 "○○입니다"만 이름으로 본다.
    const self = /저는|전|나는|난/.test(pre) || pre === "";
    return self && !STATUS_WORDS.has(name) ? mark(pre) : m;
  });
  return { text: out, redacted };
}
export function scrubPII(text: string): { text: string; redacted: boolean } {
  let out = text, redacted = false;
  const named = scrubName(out); out = named.text; redacted = named.redacted;
  for (const re of ADDRESS) out = out.replace(re, () => { redacted = true; return "[개인정보]"; });
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
