// 회차별 규칙(통합 설계 4.3, 5.3): 신청 시점의 회차를 고르고, 조건마다 기준일 종류로 판정하며 근거를 붙인다.
import type { Basis, Quote, Round, StatusKey } from "@/lib/data/verified";
import type { PersonalValue } from "./types";

export type Evidence = {
  key: StatusKey;
  kind: "requires" | "excludes";
  basis: Basis;
  basisLabel: string;
  quote: Quote;
  /** 공고 회차 제목 */
  round: string;
  /** 사람이 조건 ↔ 근거 연결을 확인했는가 */
  confirmed: boolean;
  outcome: "met" | "unmet" | "check";
};

export const BASIS_LABEL: Record<Basis, string> = {
  apply_date: "신청일 기준",
  exam_date: "응시일 기준",
  notice_date: "공고일 기준",
  fixed_date: "정해진 날짜 기준",
  resolvable_before_start: "개시일 전 해소 가능",
  unspecified: "공고에 기준 시점 없음",
};

export const STATUS_NAME: Partial<Record<StatusKey, string>> = {
  in_training: "교육·훈련 수강 중",
  unemployed: "미취업",
  employed: "재직",
  health_insured_employee: "건강보험 직장가입",
  business_registered: "사업자등록",
  participating_national_employment_support: "국민취업지원제도 참여",
};

const inRange = (r: Round, date: string) => (!r.notice.applyStart || r.notice.applyStart <= date) && (!r.notice.applyEnd || date <= r.notice.applyEnd);

/** 신청 기간과 일치하는 회차를 고른다. 기간이 겹치면 식별값이 있어야 특정할 수 있다. */
export function pickRound(rounds: Round[], date: string, roundId?: string): { round: Round | null; state: "approved" | "under_review" | "outside" } {
  const covering = rounds.filter((r) => inRange(r, date) && (roundId === undefined || r.id === roundId));
  if (covering.length === 1) return { round: covering[0], state: covering[0].status };
  if (covering.length > 1 || roundId !== undefined) return { round: null, state: "under_review" };
  const approved = rounds.filter((r) => r.status === "approved").sort((a, b) =>
    b.notice.year - a.notice.year || (b.notice.applyStart ?? "").localeCompare(a.notice.applyStart ?? "") || a.id.localeCompare(b.id));
  return { round: approved.find((r) => !r.notice.applyStart || r.notice.applyStart <= date) ?? null, state: "outside" };
}

/** 그 회차의 조건을 상태에 적용한다. 걸린 조건만 판정으로 돌려주고, 근거는 모든 조건에 남긴다 */
export function judgeConditions(round: Round, status: Set<StatusKey>, statusAtExam: Set<StatusKey> | null = null): { verdicts: [PersonalValue, string][]; evidence: Evidence[] } {
  const verdicts: [PersonalValue, string][] = [];
  const evidence: Evidence[] = [];
  for (const c of round.conditions) {
    const name = STATUS_NAME[c.key] ?? c.key;
    const at = c.basis === "exam_date" && statusAtExam ? statusAtExam : status;
    const hit = c.kind === "requires" ? !at.has(c.key) : at.has(c.key);
    let outcome: Evidence["outcome"] = "met";
    if (hit) {
      if (c.definitionClear === false) {
        outcome = "check";
        verdicts.push(["needs_check", `${name} 조건: 공고의 대상 정의 확인 필요`]);
      } else if (c.basis === "unspecified") {
        outcome = "check";
        verdicts.push(["needs_check", `${name}: 공고에 기준 시점이 없어 확인 필요`]);
      } else if (c.basis === "exam_date" && !statusAtExam) {
        outcome = "check";
        verdicts.push(["needs_check", "응시일 확인 필요"]);
      } else if (c.basis === "resolvable_before_start") {
        outcome = "check";
        verdicts.push(["needs_check", `${name}: 프로그램 개시일 전 해소 여부 확인 필요`]);
      } else {
        outcome = "unmet";
        verdicts.push(["ineligible", `${name} ${c.kind === "requires" ? "필요" : "제외"}(${BASIS_LABEL[c.basis]})`]);
      }
    }
    evidence.push({ key: c.key, kind: c.kind, basis: c.basis, basisLabel: BASIS_LABEL[c.basis], quote: c.quote, round: round.notice.title, confirmed: c.supportsConfirmed != null, outcome });
  }
  return { verdicts, evidence };
}
