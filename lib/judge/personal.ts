import { judgeConditions, pickRound, type Evidence } from "./rules";
import { toKstDate } from "@/lib/date";
import { incomeResult, marriageResult, medianIncomeLimit, neededTenureMonths, smeResult, tenureResult } from "./conditions";
import { regionLabel } from "@/lib/data/regions";
import type { Policy } from "@/lib/data/types";
import type { StatusKey, VerifiedPolicy } from "@/lib/data/verified";
import { judgeRegion } from "./region";
import { REASON, type JudgeOpts, type PersonalValue, type Profile } from "./types";

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

/** 답으로 가릴 수 있는 조건: 충족이면 사유를 지우고, 미충족이면 불가, 모름 · 미답이면 확인 필요로 둔다. */
function judgeAnswered(verdict: Verdict, result: "met" | "unmet" | "unknown", unmet: string, unknown: string) {
  if (result === "unmet") verdict.push("ineligible", unmet);
  else if (result === "unknown") verdict.push("needs_check", unknown);
}
function judgeIncome(verdict: Verdict, profile: Profile, text: string) {
  const limit = medianIncomeLimit(text);
  judgeAnswered(verdict, incomeResult(profile.incomeBand, limit), `소득 조건(기준 중위소득 ${limit}% 이하) 밖`, REASON.income);
}
function judgeTenure(verdict: Verdict, profile: Profile, since: string, today: string) {
  const needed = neededTenureMonths(since, today);
  judgeAnswered(verdict, tenureResult(profile.tenureMonths, needed), `재직 기간 조건(${needed}개월 이상) 미달`, REASON.tenure);
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
      judgeAge(verdict, v.age.min, v.age.max, profile.birthYm, ref, today);
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
      if (v.tenure && status.has("employed")) judgeTenure(verdict, profile, v.tenure.since, today);
      if (v.incomeQuote) judgeIncome(verdict, profile, v.incomeQuote.text);
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
    if (v.tenure && status.has("employed")) judgeTenure(verdict, profile, v.tenure.since, today);
    if (v.incomeQuote) judgeIncome(verdict, profile, v.incomeQuote.text);
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
      const ambiguous = jobs.some((c) => UNREPRESENTABLE.includes(c));
      verdict.push(causedByTransition || ambiguous || statusUnknown ? "needs_check" : "ineligible", REASON.codeStatus);
    }
  }
  if (p.schoolCodes.length && !p.schoolCodes.includes("0049010") && !p.schoolCodes.includes(profile.school)) verdict.push("needs_check", REASON.school);
  if (p.specialCodes.length && !p.specialCodes.includes("0014010")) judgeAnswered(verdict, smeResult(profile.smeEmployee, p.specialCodes), "특화 조건(중소기업) 불충족", REASON.special);
  if (p.marriageCode && p.marriageCode !== "0055003") judgeAnswered(verdict, marriageResult(profile.marital, p.marriageCode), "혼인 조건 불충족", REASON.marriage);
  if (p.incomeCode === "0043002" || p.incomeCode === "0043003") judgeIncome(verdict, profile, p.texts.income);
  if (p.texts.addQualification || p.texts.excluded || p.texts.income) verdict.push("needs_check", REASON.unreviewed);
  return verdict;
}
