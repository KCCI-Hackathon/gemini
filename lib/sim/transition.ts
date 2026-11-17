import { toKstDate } from "@/lib/date";
import { judgeAll, REASON, type Axes, type EventType, type Profile } from "@/lib/judge";
import { baselineOpts } from "@/lib/judge/personal";

export type Transition = "complete_training" | "get_employed" | "register_business";

export type Change =
  | "recheck"
  | "recheck_code_only"
  | "reference_date_needed"
  | "eligible_if_conditions"
  | "opened_code_only"
  | "recheck_after_period"
  | "unchanged";

/** 설계 5장 ④ "전이 결과의 표현" 표의 화면 문구 */
export const CHANGE_LABEL: Record<Change, string> = {
  recheck: "자격 재검토",
  recheck_code_only: "자격 재검토(코드 기준, 본문 미확인)",
  reference_date_needed: "자격 판단 기준일 확인 필요",
  eligible_if_conditions: "조건 충족 시 신청 가능",
  opened_code_only: "새로 검토할 정책(코드 기준, 본문 미확인)",
  recheck_after_period: "수료일 기준 6개월 경과 후 재검토",
  unchanged: "변화 없음",
};

const EVENT_OF: Record<Transition, EventType> = {
  complete_training: "training_completion",
  get_employed: "employment",
  register_business: "business_registration",
};

/** "오늘 이 사건이 일어났다고 가정"한 새 프로필. 입력은 바꾸지 않는다 */
export function applyTransition(profile: Profile, t: Transition, now: Date): Profile {
  const next = structuredClone(profile);
  const type = EVENT_OF[t];
  // 같은 종류의 예정 이벤트는 가정 이벤트로 대체(중복 방지)
  next.events = next.events.filter((e) => !(e.type === type && e.status !== "completed"));
  next.events.push({ type, date: toKstDate(now), status: "simulated" });
  return next;
}

const ORDER = { eligible: 0, code_met_unreviewed: 1, needs_check: 2, ineligible: 3 } as const;

export function classifyChange(before: Axes, after: Axes, verified: boolean): Change {
  const newReasons = after.personal.reasons.filter((r) => !before.personal.reasons.includes(r));
  const sameValue = before.personal.value === after.personal.value;
  if (sameValue && newReasons.length === 0 && before.time.value === after.time.value) return "unchanged";
  // 원래부터 다른 이유로 비해당이던 정책은 상태가 바뀌어도 사용자가 할 일이 없다
  if (before.personal.value === "ineligible" && after.personal.value === "ineligible" && before.time.note === after.time.note) return "unchanged";
  if (newReasons.includes(REASON.referenceDate)) return "reference_date_needed";
  // 그 상태에서 다른 이유로 비해당이면 기간이 지나도 달라지지 않으므로 기간 라벨을 붙이지 않는다
  if (after.personal.value !== "ineligible" && after.time.value === "unmet" && after.time.note?.includes("수료일") && before.time.note !== after.time.note) return "recheck_after_period";
  if (!verified && newReasons.includes(REASON.codeStatus)) return "recheck_code_only";
  const improved = ORDER[after.personal.value] < ORDER[before.personal.value];
  if (improved) return verified ? "eligible_if_conditions" : "opened_code_only";
  return "recheck";
}

export type TransitionResult = {
  policyId: string;
  name: string;
  verified: boolean;
  jobCodes: string[];
  before: Axes;
  after: Axes;
  change: Change;
};

/**
 * origin: 사용자가 실제로 입력한 프로필. 전이를 이어 눌렀으면 profile은 이전 가정이 반영된 상태이고,
 * 완화 기준은 원래 프로필과 직전 상태 둘 다에서 만든다.
 */
export function simulateTransition(profile: Profile, t: Transition, now: Date, origin: Profile = profile): TransitionResult[] {
  const beforeAll = judgeAll(profile, now, origin === profile ? {} : baselineOpts(origin));
  const afterAll = judgeAll(applyTransition(profile, t, now), now, baselineOpts(origin, profile));
  const afterById = new Map(afterAll.map((r) => [r.policy.id, r]));
  const out: TransitionResult[] = [];
  for (const b of beforeAll) {
    if (b.layer === "history") continue;
    const a = afterById.get(b.policy.id);
    if (!a) continue;
    out.push({
      policyId: b.policy.id,
      name: b.policy.name,
      verified: b.verified,
      jobCodes: b.policy.jobCodes,
      before: b.axes,
      after: a.axes,
      change: classifyChange(b.axes, a.axes, b.verified),
    });
  }
  return out;
}

/** 상태가 바뀌면 에이전트가 확인하러 갈 정책(설계 5장 ④). 최대 5개 */
export function needsVerification(results: TransitionResult[], verifiedCache: Set<string>): string[] {
  return results
    .filter((r) => (r.change === "recheck_code_only" || r.change === "reference_date_needed") && !verifiedCache.has(r.policyId))
    // 기준일이 문제인 정책이 먼저: 공고의 기준 시점을 확인하면 판정이 실제로 달라진다
    .sort((a, b) => Number(b.change === "reference_date_needed") - Number(a.change === "reference_date_needed"))
    .slice(0, 5)
    .map((r) => r.policyId);
}
