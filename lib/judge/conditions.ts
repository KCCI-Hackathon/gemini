// 사용자의 답(소득 구간 · 혼인 · 재직 기간 · 중소기업)으로 판정을 바꿀 수 있는 조건만 모았다.
// 정책 데이터에 비교할 값이 없으면 "unknown" 을 돌려주고, 판정기는 지금처럼 '확인 필요'로 둔다.
import { monthsBetween } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified, type VerifiedPolicy } from "@/lib/data/verified";
import type { Policy } from "@/lib/data/types";
import type { Profile } from "./types";

export type Result = "met" | "unmet" | "unknown";

/** 소득은 금액이 아니라 기준 중위소득 대비 구간으로만 받는다. lo 초과 · hi 이하. */
export const INCOME_BANDS = {
  p60: { label: "중위소득 60% 이하", lo: 0, hi: 60 },
  p100: { label: "중위소득 60% 초과 ~ 100% 이하", lo: 60, hi: 100 },
  p150: { label: "중위소득 100% 초과 ~ 150% 이하", lo: 100, hi: 150 },
  over: { label: "중위소득 150% 초과", lo: 150, hi: Infinity },
} as const;
export type IncomeBand = keyof typeof INCOME_BANDS | "unknown";
export const INCOME_BAND_NAMES: IncomeBand[] = ["p60", "p100", "p150", "over", "unknown"];

export const MARITAL_VALUES = ["single", "married", "planned"] as const;
export type Marital = (typeof MARITAL_VALUES)[number];

/** 재직 기간 답: 구간의 시작 개월(min)이 tenureMonths 로 저장된다. 모름은 null. */
export const TENURE_BANDS = [
  { value: "0", label: "3개월 미만", min: 0, max: 3 },
  { value: "3", label: "3개월 ~ 6개월 미만", min: 3, max: 6 },
  { value: "6", label: "6개월 ~ 1년 미만", min: 6, max: 12 },
  { value: "12", label: "1년 ~ 2년 미만", min: 12, max: 24 },
  { value: "24", label: "2년 ~ 3년 미만", min: 24, max: 36 },
  { value: "36", label: "3년 이상", min: 36, max: Infinity },
] as const;

export type SmeAnswer = "yes" | "no" | "unknown";
const SME = "0014001", SPECIAL_NONE = "0014010";

/** 본문에 기준 중위소득 비율이 딱 하나(이하 · 미만)만 있으면 그 값. 여러 개이거나 이상 · 초과가 섞이면 null. */
export function medianIncomeLimit(text: string): number | null {
  const found = [...text.matchAll(/중위\s*소득\s*(\d{2,3})\s*%\s*(이하|미만|이내)?/g)];
  if (!found.length || /이상|초과/.test(text)) return null;
  const values = new Set(found.map(m => Number(m[1])));
  return values.size === 1 && found.some(m => m[2]) ? [...values][0] : null;
}

export function incomeResult(band: IncomeBand | undefined, limit: number | null): Result {
  if (!band || band === "unknown" || limit === null) return "unknown";
  const b = INCOME_BANDS[band];
  return b.hi <= limit ? "met" : b.lo >= limit ? "unmet" : "unknown";
}

/** 혼인 코드 0055001 기혼 · 0055002 미혼. 예정은 판단하지 않는다. */
export function marriageResult(marital: Marital | undefined, code: string | null): Result {
  if (!marital || marital === "planned" || (code !== "0055001" && code !== "0055002")) return "unknown";
  return (code === "0055001") === (marital === "married") ? "met" : "unmet";
}

export function tenureResult(months: number | null | undefined, neededMonths: number): Result {
  if (months === undefined || months === null) return "unknown";
  const band = [...TENURE_BANDS].reverse().find(b => b.min <= months);
  if (!band) return "unknown";
  return band.min >= neededMonths ? "met" : band.max <= neededMonths ? "unmet" : "unknown";
}

/** 특화 조건 중 답으로 가릴 수 있는 것은 중소기업뿐이다. 다른 대상(여성 · 장애인 등)이 섞이면 '아니요'로 불가를 내지 않는다. */
export function smeResult(answer: SmeAnswer | undefined, specialCodes: string[]): Result {
  if (!answer || answer === "unknown" || !specialCodes.includes(SME) || specialCodes.includes(SPECIAL_NONE)) return "unknown";
  if (answer === "yes") return "met";
  return specialCodes.length === 1 ? "unmet" : "unknown";
}

/** 판정에 쓰는 정책별 비교 값. 판정기와 질문 모으기가 같은 값을 본다. */
export type PolicyFacts = { incomeLimit: number | null; marriageCode: string | null; specialCodes: string[]; tenureSince: string | null; incomeText: string; hasHouseholdText: boolean };
export function factsOf(p: Policy, v: VerifiedPolicy | undefined): PolicyFacts {
  const incomeText = v ? v.incomeQuote?.text ?? "" : p.texts.income;
  return {
    incomeLimit: medianIncomeLimit(incomeText), marriageCode: p.marriageCode, specialCodes: p.specialCodes, tenureSince: v?.tenure?.since ?? null, incomeText,
    hasHouseholdText: /1인\s*가구|독거|혼자\s*사/.test([p.texts.addQualification, p.texts.excluded, p.texts.income].join(" ")),
  };
}
let factsCache: Map<string, PolicyFacts> | null = null;
export function policyFacts(policyId: string): PolicyFacts | undefined {
  if (!factsCache) {
    const verified = loadVerified();
    factsCache = new Map(loadSnapshot().policies.map(p => [p.id, factsOf(p, verified.get(p.id))]));
  }
  return factsCache.get(policyId);
}

/** 재직 기간 조건이 요구하는 최소 개월 수(공고의 기준 시작일부터 오늘까지). */
export const neededTenureMonths = (since: string, today: string) => monthsBetween(since, today);

/** 외부 AI 로 보내는 프로필 요약: 금액은 없고 구간 이름만. */
export function answeredLabels(p: Pick<Profile, "incomeBand" | "marital" | "tenureMonths" | "smeEmployee">) {
  return {
    ...(p.incomeBand && { income_band: p.incomeBand === "unknown" ? "모름" : INCOME_BANDS[p.incomeBand].label }),
    ...(p.marital && { marital: { single: "미혼", married: "기혼", planned: "혼인 예정" }[p.marital] }),
    ...(p.tenureMonths !== undefined && { tenure: p.tenureMonths === null ? "모름" : TENURE_BANDS.find(b => b.min === p.tenureMonths)?.label ?? "모름" }),
    ...(p.smeEmployee && { sme: { yes: "중소기업", no: "중소기업 아님", unknown: "모름" }[p.smeEmployee] }),
  };
}
