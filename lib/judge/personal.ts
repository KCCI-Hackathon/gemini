import { judgeConditions, pickRound, type Evidence } from "./rules";
import { toKstDate } from "@/lib/date";
import { regionLabel } from "@/lib/data/regions";
import type { Policy } from "@/lib/data/types";
import type { StatusKey, VerifiedPolicy } from "@/lib/data/verified";
import { judgeRegion } from "./region";
import { REASON, type JudgeOpts, type PersonalValue, type Profile } from "./types";

/** 생일이 있으면 해당 기준일의 만 나이를, 월 정보만 있으면 기존 범위를 반환한다. */
export function ageRange(birthYm: string, refYmd: string, birthDate?: string): [number, number] {
  const [by, bm] = birthYm.split("-").map(Number);
  const [ry, rm, rd] = refYmd.split("-").map(Number);
  const base = ry - by;
  if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && birthDate.slice(0, 7) === birthYm) {
    const [, birthMonth, birthDay] = birthDate.split("-").map(Number);
    // 2월 29일 생일은 평년의 3월 1일에 나이가 바뀌는 기준으로 계산한다.
    const anniversaryMonth = birthMonth === 2 && birthDay === 29 && !isLeapYear(ry) ? 3 : birthMonth;
    const anniversaryDay = birthMonth === 2 && birthDay === 29 && !isLeapYear(ry) ? 1 : birthDay;
    const passed = rm > anniversaryMonth || (rm === anniversaryMonth && rd >= anniversaryDay);
    const age = base - (passed ? 0 : 1);
    return [age, age];
  }
  if (rm > bm) return [base, base];
  if (rm < bm) return [base - 1, base - 1];
  return [base - 1, base];
}

function isLeapYear(year: number) { return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); }

/** 이벤트를 적용한 현재 상태. scheduled는 반영하지 않는다 */
/** 그날까지 일어난(가정 포함) 사건만 반영한 상태. 예정(scheduled)은 반영하지 않는다 */
export function statusAt(profile: Profile, ymd: string): Set<StatusKey> {
  return effectiveStatus({ ...profile, events: profile.events.filter((e) => e.date <= ymd) });
}

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

/** 사유 문구에 쓰는 상태 이름 */
const STATUS_LABEL: Partial<Record<StatusKey, string>> = {
  in_training: "교육·훈련 수강 중",
  unemployed: "미취업",
  employed: "재직",
  health_insured_employee: "건강보험 직장가입",
  business_registered: "사업자등록",
  participating_national_employment_support: "국민취업지원제도 참여",
};

/** "미취업 조건: 공고의 대상 정의 확인 필요" */
function definitionReason(missing: StatusKey[], excluded: StatusKey[]): string {
  const keys = [...missing, ...excluded].map((k) => STATUS_LABEL[k] ?? k);
  return `${keys.join("·")} 조건: 공고의 대상 정의 확인 필요`;
}

const RANK: Record<PersonalValue, number> = { eligible: 0, code_met_unreviewed: 1, needs_check: 2, ineligible: 3 };

class Verdict {
  value: PersonalValue;
  reasons: string[] = [];
  evidence?: Evidence[];
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
  birthDate?: string,
) {
  if (min == null && max == null) return;
  const outside = (a: number) => (min != null && a < min) || (max != null && a > max);
  if (refYmd) {
    const [lo, hi] = ageRange(birthYm, refYmd, birthDate);
    if (outside(lo) && outside(hi)) verdict.push("ineligible", `나이 조건(${min ?? ""}~${max ?? ""}세) 밖`);
    else if (outside(lo) || outside(hi)) verdict.push("needs_check", REASON.ageBoundary);
    return;
  }
  // 기준일 미상: 오늘 기준 ±1년 안에서 경계에 걸리면 확인 필요
  const [lo, hi] = ageRange(birthYm, today, birthDate);
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

/** 전이 전 프로필들로 완화 기준을 만든다 */
export function baselineOpts(...profiles: Profile[]): JudgeOpts {
  return {
    softenCodes: [...new Set(profiles.flatMap(statusCodes))],
    baseStatuses: profiles.map((p) => [...effectiveStatus(p)]),
  };
}

/** 프리랜서·(예비)창업자·영농·기타: 프로필 항목으로 표현할 수 없어 어긋나도 비해당으로 단정하지 않는다 */
const UNREPRESENTABLE = ["0013004", "0013006", "0013008", "0013009"];
const EMPLOYMENT_KEYS: StatusKey[] = ["unemployed", "employed", "business_registered"];

// 온통청년 학력 코드는 학업 단계 순서다(0049001 고졸 미만 … 0049008 대학원). 0049009 기타, 0049010 제한 없음.
const SCHOOL_STEPS = ["0049001", "0049002", "0049003", "0049004", "0049005", "0049006", "0049007", "0049008"];
/**
 * 입력한 학력이 정책의 학력 코드에 맞는지. ok 충족, near 확인 필요, far 불충족.
 * 졸업 예정과 졸업처럼 한 단계 차이는 공고마다 인정 범위가 달라 확인 필요로 두고, 두 단계 이상 떨어질 때만 불충족으로 본다.
 * 화면의 "고등학교 졸업"(0049003)은 졸업 예정 · 졸업(0049003 · 0049004)을 모두 본다.
 */
export function schoolFit(codes: string[], mine: string): "ok" | "near" | "far" {
  if (!codes.length || codes.includes("0049010")) return "ok";
  const own = mine === "0049003" ? ["0049003", "0049004"] : [mine];
  if (own.some(c => codes.includes(c))) return "ok";
  const at = own.map(c => SCHOOL_STEPS.indexOf(c));
  if (at.some(i => i < 0) || codes.includes("0049009")) return "near";
  const gap = Math.min(...codes.map(c => SCHOOL_STEPS.indexOf(c)).filter(i => i >= 0).flatMap(i => at.map(j => Math.abs(i - j))));
  return Number.isFinite(gap) && gap >= 2 ? "far" : "near";
}

export function judgePersonal(
  p: Policy,
  v: VerifiedPolicy | undefined,
  profile: Profile,
  now: Date,
  opts: JudgeOpts = {},
): { value: PersonalValue; reasons: string[] } {
  const today = toKstDate(now);
  const verdict = new Verdict(v ? "eligible" : "code_met_unreviewed");
  const status = effectiveStatus(profile);
  const statusUnknown = !EMPLOYMENT_KEYS.some((k) => status.has(k));

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
      judgeAge(verdict, v.age.min, v.age.max, profile.birthYm, ref, today, profile.birthDate);
    }
    // 회차별 규칙이 있으면 신청 시점의 회차로 조건마다 판정한다
    if (v.rounds?.length) {
      const pick = pickRound(v.rounds, today);
      if (pick.state === "under_review") {
        verdict.push("needs_check", REASON.roundReview);
        if (pick.round) {
          verdict.evidence = judgeConditions(pick.round, status, profile.examDate ? statusAt(profile, profile.examDate) : null)
            .evidence.filter((condition) => condition.confirmed);
        }
      } else if (pick.state === "outside") {
        verdict.push("needs_check", REASON.nextRound);
        if (pick.round) verdict.evidence = judgeConditions(pick.round, status, profile.examDate ? statusAt(profile, profile.examDate) : null).evidence;
        return verdict;
      } else if (pick.round) {
        const employmentRule = pick.round.conditions.some((c) => EMPLOYMENT_KEYS.includes(c.key));
        const r = judgeConditions(pick.round, status, profile.examDate ? statusAt(profile, profile.examDate) : null);
        verdict.evidence = r.evidence;
        if (statusUnknown && employmentRule) verdict.push("needs_check", REASON.statusUnknown);
        else for (const [val, reason] of r.verdicts) verdict.push(val, reason);
      }
      if (v.tenure && status.has("employed")) verdict.push("needs_check", REASON.tenure);
      if (v.incomeQuote) verdict.push("needs_check", REASON.income);
      return verdict;
    }
    // 상태 조건
    const missing = v.statusConditions.requires.filter((k) => !status.has(k));
    const excluded = v.statusConditions.excludes.filter((k) => status.has(k));
    if (missing.length || excluded.length) {
      const ref = v.referenceDate.status;
      // 전이 전 상태에서는 충족이던 조건이 전이로 어긋난 경우만 기준일 문제로 본다
      const metBefore = (opts.baseStatuses ?? []).some((b) => {
        const s = new Set(b);
        return v.statusConditions.requires.every((k) => s.has(k)) && !v.statusConditions.excludes.some((k) => s.has(k));
      });
      if (statusUnknown && missing.some((k) => EMPLOYMENT_KEYS.includes(k))) {
        verdict.push("needs_check", REASON.statusUnknown);
      } else if (metBefore && (!ref || !ref.includes("신청일"))) {
        verdict.push("needs_check", REASON.referenceDate);
        if (!v.statusConditions.definitionClear) verdict.push("needs_check", definitionReason(missing, excluded));
      } else if (v.statusConditions.definitionClear) {
        verdict.push("ineligible", `상태 조건 불충족(${[...missing.map((k) => `${STATUS_LABEL[k] ?? k} 필요`), ...excluded.map((k) => `${STATUS_LABEL[k] ?? k} 제외`)].join(", ")})`);
      } else {
        // 공고가 상태의 정의를 분명히 하지 않는다: 기준일이 아니라 대상 정의가 문제다
        verdict.push("needs_check", definitionReason(missing, excluded));
      }
    }
    if (v.tenure && status.has("employed")) verdict.push("needs_check", REASON.tenure);
    if (v.incomeQuote) verdict.push("needs_check", REASON.income);
    return verdict;
  }

  // 비검증 정책: 코드 조건
  judgeAge(verdict, p.minAge, p.maxAge, profile.birthYm, null, today, profile.birthDate);
  const jobs = p.jobCodes.filter((c) => c !== "0013010");
  if (jobs.length && !p.jobCodes.includes("0013010")) {
    const mine = [...status].flatMap((s) => CODE_OF_STATUS[s] ?? []);
    if (!jobs.some((c) => mine.includes(c))) {
      // 상태 전이 전에는 맞던 코드가 전이로 어긋난 경우만 확인 필요로 완화한다
      const causedByTransition = !!opts.softenCodes && jobs.some((c) => opts.softenCodes!.includes(c));
      const ambiguous = jobs.some((c) => UNREPRESENTABLE.includes(c));
      verdict.push(causedByTransition || ambiguous || statusUnknown ? "needs_check" : "ineligible", REASON.codeStatus);
    }
  }
  const school = schoolFit(p.schoolCodes, profile.school);
  if (school === "far") verdict.push("ineligible", "학력 조건 불충족");
  else if (school === "near") verdict.push("needs_check", REASON.school);
  if (p.specialCodes.length && !p.specialCodes.includes("0014010")) verdict.push("needs_check", REASON.special);
  if (p.marriageCode && p.marriageCode !== "0055003") verdict.push("needs_check", REASON.marriage);
  if (p.incomeCode === "0043002" || p.incomeCode === "0043003") verdict.push("needs_check", REASON.income);
  if (p.texts.addQualification || p.texts.excluded || p.texts.income) verdict.push("needs_check", REASON.unreviewed);
  return verdict;
}
