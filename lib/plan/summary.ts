// AI에 보내는 사용자 정보는 이 함수 하나에서만 만든다(통합 설계 6.2).
// 생년월일 → 만 나이, 시군구 코드 → 이름, 날짜 → "N개월 뒤". 민감정보·응시일 날짜·자유 입력은 넣지 않는다.
import { monthsBetween, toKstDate } from "@/lib/date";
import { regionLabel } from "@/lib/data/regions";
import { STATUS_NAME } from "@/lib/judge/rules";
import { ageRange, effectiveStatus } from "@/lib/judge/personal";
import type { Benefit, Profile } from "@/lib/judge/types";
import type { TimelinePlan } from "@/lib/route/timeline";

export type PlanSession = { profile: Profile; plan: TimelinePlan; answers: Record<string, string>; benefits?: Benefit[] };

export type AiSummary = {
  age: string;
  region: string;
  school: string;
  status: string[];
  plans: string[];
  answered: string[];
};

const SCHOOL: Record<string, string> = { "0049004": "고등학교 졸업", "0049005": "대학 재학", "0049006": "대학 졸업 예정", "0049007": "대학 졸업", "0049008": "석·박사" };
const EVENT: Record<string, string> = { training_completion: "수료", employment: "취업", business_registration: "사업자등록", relocation: "이사" };
const ANSWER: Record<string, string> = { participating_national_employment_support: "국민취업지원제도 참여", recent_history: "최근 6개월 취업·훈련 이력" };

const after = (n: number) => (n <= 0 ? "이번 달" : `${n}개월 뒤`);

function regionForAI(code: string): string {
  const label = regionLabel(code);
  return label === code ? "지역 확인 필요" : label;
}

export function summarizeForAI(s: PlanSession, now: Date): AiSummary {
  const today = toKstDate(now);
  const [a, b] = ageRange(s.profile.birthYm, today, s.profile.birthDate);
  const training = s.profile.events.find((e) => e.type === "training_completion" && e.date >= today);
  const base = effectiveStatus(s.profile).has("in_training") && training ? "수료일" : "오늘";
  const plans = [
    ...s.profile.events.filter((e) => e.date >= today).map((e) => `${EVENT[e.type]}: ${after(monthsBetween(today, e.date))}`),
    ...(s.plan.employAfterMonths != null ? [`취업(가정): ${base}부터 ${after(s.plan.employAfterMonths)}`] : []),
    ...(s.plan.businessAfterMonths != null ? [`사업자등록(가정): ${base}부터 ${after(s.plan.businessAfterMonths)}`] : []),
    ...(s.plan.move ? [`이사(가정): 오늘부터 ${after(s.plan.move.afterMonths)}, ${regionForAI(s.plan.move.sigungu)}`] : []),
  ];
  return {
    age: a === b ? `만 ${a}세` : `만 ${a}~${b}세`,
    region: regionForAI(s.profile.sigungu),
    school: SCHOOL[s.profile.school] ?? "학력 미입력",
    status: [...effectiveStatus(s.profile)].map((k) => STATUS_NAME[k] ?? k),
    plans,
    answered: [
      ...Object.entries(s.answers).flatMap(([k, v]) => (ANSWER[k] ? [`${ANSWER[k]}: ${v}`] : [])),
      ...(s.profile.examDate ? ["응시일: 입력됨"] : []),
    ],
  };
}
