import { toKstDate } from "@/lib/date";
import { regionLabel } from "@/lib/data/regions";
import type { Policy } from "@/lib/data/types";
import type { StatusKey, VerifiedPolicy } from "@/lib/data/verified";
import { judgeRegion } from "./region";
import { REASON, type PersonalValue, type Profile } from "./types";

/** 생년월과 기준일로 가능한 만 나이 범위. 기준일이 생일 달이면 두 값 */
export function ageRange(birthYm: string, refYmd: string): [number, number] {
  const [by, bm] = birthYm.split("-").map(Number);
  const [ry, rm] = refYmd.split("-").map(Number);
  const base = ry - by;
  if (rm > bm) return [base, base];
  if (rm < bm) return [base - 1, base - 1];
  return [base - 1, base];
}

/** 이벤트를 적용한 현재 상태. scheduled는 반영하지 않는다 */
export function effectiveStatus(profile: Profile): Set<StatusKey> {
  const s = new Set<StatusKey>(profile.currentStatus);
  const events = profile.events.filter((e) => e.status !== "scheduled").sort((a, b) => a.date.localeCompare(b.date));
  for (const e of events) {
    if (e.type === "training_completion") s.delete("in_training");
    if (e.type === "employment") {
      s.delete("unemployed");
      s.add("employed");
      s.add("health_insured_employee");
    }
    if (e.type === "business_registration") {
      s.delete("unemployed");
      s.add("business_registered");
    }
  }
  for (const id of profile.participating) if (id === "20260710005400113256") s.add("participating_national_employment_support");
  return s;
}

const RANK: Record<PersonalValue, number> = { eligible: 0, code_met_unreviewed: 1, needs_check: 2, ineligible: 3 };

class Verdict {
  value: PersonalValue;
  reasons: string[] = [];
  constructor(start: PersonalValue) {
    this.value = start;
  }
  push(v: PersonalValue, reason: string) {
    if (RANK[v] > RANK[this.value]) this.value = v;
    if (!this.reasons.includes(reason)) this.reasons.push(reason);
  }
}

function judgeAge(
  verdict: Verdict,
  min: number | null,
  max: number | null,
  birthYm: string,
  refYmd: string | null,
  today: string,
) {
  if (min == null && max == null) return;
  const outside = (a: number) => (min != null && a < min) || (max != null && a > max);
  if (refYmd) {
    const [lo, hi] = ageRange(birthYm, refYmd);
    if (outside(lo) && outside(hi)) verdict.push("ineligible", `나이 조건(${min ?? ""}~${max ?? ""}세) 밖`);
    else if (outside(lo) || outside(hi)) verdict.push("needs_check", REASON.ageBoundary);
    return;
  }
  // 기준일 미상: 오늘 기준 ±1년 안에서 경계에 걸리면 확인 필요
  const [lo, hi] = ageRange(birthYm, today);
  if (outside(lo - 1) && outside(hi + 1) && outside(lo) && outside(hi)) verdict.push("ineligible", `나이 조건(${min ?? ""}~${max ?? ""}세) 밖`);
  else if (outside(lo - 1) || outside(hi + 1) || outside(lo) || outside(hi)) verdict.push("needs_check", REASON.ageBoundary);
}

const CODE_OF_STATUS: Partial<Record<StatusKey, string[]>> = {
  unemployed: ["0013003"],
  employed: ["0013001", "0013005", "0013007"],
  business_registered: ["0013002", "0013006"],
};

/** 프로필의 현재 상태에 맞는 취업 요건 코드 */
export function statusCodes(profile: Profile): string[] {
  return [...effectiveStatus(profile)].flatMap((s) => CODE_OF_STATUS[s] ?? []);
}

export function judgePersonal(
  p: Policy,
  v: VerifiedPolicy | undefined,
  profile: Profile,
  now: Date,
  opts: { softenCodes?: string[] } = {},
): { value: PersonalValue; reasons: string[] } {
  const today = toKstDate(now);
  const verdict = new Verdict(v ? "eligible" : "code_met_unreviewed");
  const status = effectiveStatus(profile);

  // 지역
  const region = judgeRegion(p, profile.sigungu);
  if (region.ok === false) verdict.push("ineligible", region.reason);
  else if (region.ok === "unknown") verdict.push("needs_check", REASON.region);
  if (v?.regionScope.sigunguLabels && !v.regionScope.sigunguLabels.includes(regionLabel(profile.sigungu))) {
    verdict.push("ineligible", "공식 공고의 시행 지역이 아님");
  }

  if (v) {
    // 나이
    if (v.age) {
      const ref = v.age.referenceRule === "fixed_date" ? v.age.referenceDate : v.age.referenceRule === "apply_date" ? today : null;
      judgeAge(verdict, v.age.min, v.age.max, profile.birthYm, ref, today);
    }
    // 상태 조건
    const missing = v.statusConditions.requires.filter((k) => !status.has(k));
    const excluded = v.statusConditions.excludes.filter((k) => status.has(k));
    if (missing.length || excluded.length) {
      const ref = v.referenceDate.status;
      const changedBySimulation = profile.events.some((e) => e.status === "simulated");
      if (changedBySimulation && (!ref || !ref.includes("신청일"))) {
        verdict.push("needs_check", REASON.referenceDate);
      } else if (v.statusConditions.definitionClear) {
        verdict.push("ineligible", `상태 조건 불충족(${[...missing.map((k) => `${k} 필요`), ...excluded.map((k) => `${k} 제외`)].join(", ")})`);
      } else {
        verdict.push("needs_check", REASON.referenceDate);
      }
    }
    if (v.tenure && status.has("employed")) verdict.push("needs_check", REASON.tenure);
    if (v.incomeQuote) verdict.push("needs_check", REASON.income);
    return verdict;
  }

  // 비검증 정책: 코드 조건
  judgeAge(verdict, p.minAge, p.maxAge, profile.birthYm, null, today);
  const jobs = p.jobCodes.filter((c) => c !== "0013010");
  if (jobs.length && !p.jobCodes.includes("0013010")) {
    const mine = [...status].flatMap((s) => CODE_OF_STATUS[s] ?? []);
    if (!jobs.some((c) => mine.includes(c))) {
      // 상태 전이 전에는 맞던 코드가 전이로 어긋난 경우만 확인 필요로 완화한다
      const causedByTransition = !!opts.softenCodes && jobs.some((c) => opts.softenCodes!.includes(c));
      verdict.push(causedByTransition ? "needs_check" : "ineligible", REASON.codeStatus);
    }
  }
  if (p.schoolCodes.length && !p.schoolCodes.includes("0049010") && !p.schoolCodes.includes(profile.school)) verdict.push("needs_check", REASON.school);
  if (p.specialCodes.length && !p.specialCodes.includes("0014010")) verdict.push("needs_check", REASON.special);
  if (p.marriageCode && p.marriageCode !== "0055003") verdict.push("needs_check", REASON.marriage);
  if (p.incomeCode === "0043002" || p.incomeCode === "0043003") verdict.push("needs_check", REASON.income);
  if (p.texts.addQualification || p.texts.excluded || p.texts.income) verdict.push("needs_check", REASON.unreviewed);
  return verdict;
}
