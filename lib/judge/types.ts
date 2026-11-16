import type { StatusKey } from "@/lib/data/verified";

export type EventType = "training_completion" | "employment" | "business_registration";

export type ProfileEvent = {
  type: EventType;
  date: string; // YYYY-MM-DD
  /** scheduled: 예정(현재 판정에 반영 안 함), completed: 실제로 일어남, simulated: 상태 변경 버튼의 가정 */
  status: "scheduled" | "completed" | "simulated";
};

export type Profile = {
  birthYm: string; // YYYY-MM
  sigungu: string; // 시군구 코드 5자리
  school: string; // schoolCd (예: 0049007 대학 졸업)
  currentStatus: StatusKey[];
  interest: "job" | "keep_searching" | "startup";
  events: ProfileEvent[];
  /** 사용자가 참여 중이라고 답한 정책 번호 */
  participating: string[];
  /** 화면 표시용. 서버는 이 값을 믿지 않는다 */
  source: "demo_persona" | "user";
};

export type PersonalValue = "eligible" | "code_met_unreviewed" | "needs_check" | "ineligible";

export type Axes = {
  personal: { value: PersonalValue; reasons: string[] };
  recruitment: "open" | "upcoming" | "closed" | "always" | "unknown";
  time: { value: "met" | "unmet" | "needs_check" | "na"; note?: string };
  restriction: { value: "applies" | "official_quote" | "confirmed_relation" | "unknown"; quotes: string[] };
};

export type Layer = "verified" | "partial" | "history";

/** 사유 문구 상수: 상태 전이 비교가 이 문구로 원인을 판별한다 */
export const REASON = {
  referenceDate: "자격 판단 기준일 확인 필요",
  codeStatus: "취업 요건(코드 기준, 본문 미확인)",
  tenure: "재직 기간 조건 확인 필요",
  income: "소득 조건 확인 필요",
  unreviewed: "별도 자격 조건(본문) 확인 필요",
  ageBoundary: "나이 기준일 경계 확인 필요",
  region: "지역 확인 필요",
  school: "학력 조건 확인 필요",
  special: "특화 조건(중소기업 등) 확인 필요",
  marriage: "혼인 조건 확인 필요",
  participating: "참여 중인 다른 사업으로 제한될 수 있음",
  history: "최근 취업·훈련 이력 확인 필요",
  statusUnknown: "현재 취업 상태 확인 필요",
} as const;

/** 상태 전이 비교의 기준. 전이 전 프로필들(원래 프로필, 이전 가정 상태)에서 계산한다 */
export type JudgeOpts = {
  /** 전이 전에 맞던 취업 요건 코드: 이 코드가 전이로 어긋나면 확인 필요로 완화 */
  softenCodes?: string[];
  /** 전이 전 상태 집합들: 검증 정책의 상태 조건을 이 중 하나에서 충족했으면 기준일 확인으로 완화 */
  baseStatuses?: string[][];
};
