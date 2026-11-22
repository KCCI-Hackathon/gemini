// 루트에서 정책을 놓는 순서: "먼저 확인할 순서" 점수.
// 우리가 정한 규칙이며 공식 기준이 아니다. 어느 길이 낫다는 뜻도, 신청 결과의 예측도 아니다.
// 점수는 이유들의 합이고, 화면은 이유를 그대로 보여준다.
import { toKstDate } from "@/lib/date";
import { loadVerified } from "@/lib/data/verified";
import type { JudgedPolicy, Profile } from "@/lib/judge";
import { pickRound } from "@/lib/judge/rules";

export type WeightReason = { label: string; points: number };
export type Weight = { score: number; reasons: WeightReason[] };

export const WEIGHTS = {
  deadlineWithin14: 30,
  deadlineWithin30: 20,
  open: 10,
  upcoming: 8,
  always: 6,
  closed: -20,
  eligible: 30,
  codeMet: 14,
  needsCheckBase: 12,
  /** 본문을 아직 아무도 확인하지 않은 정책의 '확인 필요'는 낮게 둔다 */
  needsCheckUnreviewedBase: 4,
  perOpenCheck: -2,
  verified: 25,
  timeUnmet: -15,
  interest: 12,
  interestSkill: 8,
  opened: 20,
} as const;

function daysBetween(fromYmd: string, toYmd: string): number {
  const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((d(toYmd) - d(fromYmd)) / 86_400_000);
}

/** 모집 중인 정책의 신청 종료일(검증 정책은 공고 기준) */
export function deadlineOf(r: JudgedPolicy, now: Date): string | null {
  if (r.axes.recruitment !== "open") return null;
  const v = loadVerified().get(r.policy.id);
  if (v?.rounds?.length) {
    const pick = pickRound(v.rounds, toKstDate(now));
    if (pick.state !== "outside" && pick.round) return pick.round.notice.applyEnd;
  }
  return v ? v.apply.end : r.policy.applyEnd;
}

export function weighPolicy(r: JudgedPolicy, ctx: { interest: Profile["interest"]; now: Date; opened?: boolean }): Weight {
  const reasons: WeightReason[] = [];
  const add = (label: string, points: number) => reasons.push({ label, points });

  // 모집 상태와 마감
  // 본문을 아무도 확인하지 않았고 확인할 것이 남은 정책: 자격 근거가 약하므로 마감·관심 가점을 줄인다
  const weak = !r.verified && r.axes.personal.value === "needs_check";
  const scale = (n: number) => (weak ? Math.floor(n / 2) : n);
  const end = deadlineOf(r, ctx.now);
  if (r.axes.recruitment === "open") {
    const days = end ? daysBetween(toKstDate(ctx.now), end) : null;
    const label = days === 0 ? "오늘 마감" : `마감 ${days}일 전`;
    if (days != null && days <= 14) add(label, scale(WEIGHTS.deadlineWithin14));
    else if (days != null && days <= 30) add(label, scale(WEIGHTS.deadlineWithin30));
    else add("모집 중", scale(WEIGHTS.open));
  } else if (r.axes.recruitment === "upcoming") add("모집 예정", WEIGHTS.upcoming);
  else if (r.axes.recruitment === "always") add("상시 모집", WEIGHTS.always);
  else if (r.axes.recruitment === "closed") add("모집 종료(다음 모집 확인)", WEIGHTS.closed);

  // 자격 판정
  const p = r.axes.personal;
  if (p.value === "eligible") add("확인된 조건을 충족", WEIGHTS.eligible);
  else if (p.value === "code_met_unreviewed") add("코드 조건 충족(본문 미확인)", WEIGHTS.codeMet);
  else if (p.value === "needs_check") {
    const n = Math.min(p.reasons.length, 4);
    add(`확인할 사항 ${p.reasons.length}개 남음`, (r.verified ? WEIGHTS.needsCheckBase : WEIGHTS.needsCheckUnreviewedBase) + n * WEIGHTS.perOpenCheck);
  }

  if (r.verified) add("공식 공고를 사람이 확인", WEIGHTS.verified);
  if (r.axes.time.value === "unmet") add("기간 조건이 아직 남음", WEIGHTS.timeUnmet);

  // 관심 분야
  const cat = `${r.policy.category.large} ${r.policy.category.middle}`;
  if (!weak) {
    if (ctx.interest === "startup" && cat.includes("창업")) add("관심 분야(창업)", WEIGHTS.interest);
    else if (ctx.interest !== "startup" && cat.includes("취업")) add("관심 분야(취업)", WEIGHTS.interest);
    else if (ctx.interest === "keep_searching" && cat.includes("역량")) add("관심 분야(역량 강화)", WEIGHTS.interestSkill);
  }

  // 모집이 끝났거나 기간 조건이 남은 정책은 당장 검토할 수 없으므로 이 가점을 주지 않는다
  if (ctx.opened && r.axes.recruitment !== "closed" && r.axes.time.value !== "unmet") add("이 상태에서 새로 검토 대상", WEIGHTS.opened);

  return { score: reasons.reduce((s, x) => s + x.points, 0), reasons };
}
