import { isOpenAt, monthsBetween, toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import type { Policy } from "@/lib/data/types";
import { loadVerified, type VerifiedPolicy } from "@/lib/data/verified";
import { effectiveStatus, judgePersonal } from "./personal";
import { REASON, type Axes, type Layer, type Profile } from "./types";

export * from "./types";

function recruitment(p: Policy, v: VerifiedPolicy | undefined, now: Date): Axes["recruitment"] {
  if (v) {
    if (v.apply.type === "always") return "always";
    return isOpenAt(now, v.apply.start, v.apply.end, v.apply.endTime ?? undefined);
  }
  if (p.applyPeriodType === "closed") return "closed";
  if (p.applyPeriodType === "always") {
    if (p.bizEnd && p.bizEnd < toKstDate(now)) return "unknown";
    return "always";
  }
  return isOpenAt(now, p.applyStart, p.applyEnd);
}

function timeAxis(v: VerifiedPolicy | undefined, profile: Profile, now: Date): Axes["time"] {
  const today = toKstDate(now);
  const overdue = profile.events.find((e) => e.status === "scheduled" && e.type === "training_completion" && e.date < today);
  const note = overdue ? "수료 예정일이 지났습니다. 수료하셨다면 상태를 바꿔 주세요." : undefined;
  if (!v?.lookback) return { value: "na", note };
  const status = effectiveStatus(profile);
  if (status.has("in_training")) return { value: "unmet", note: note ?? "교육·훈련 수강 중" };
  const last = profile.events
    .filter((e) => e.status !== "scheduled" && (e.type === "training_completion" || e.type === "employment"))
    .map((e) => e.date)
    .sort()
    .pop();
  if (!last) return { value: "met", note };
  const months = monthsBetween(last, today);
  if (months < v.lookback.months) return { value: "unmet", note: `수료일 기준 ${v.lookback.months}개월 경과 후 재검토` };
  return { value: "met", note };
}

function restrictionAxis(p: Policy, v: VerifiedPolicy | undefined, profile: Profile): Axes["restriction"] {
  if (v) {
    const applies = v.restrictionQuotes.filter((q) => q.mentions?.some((id) => profile.participating.includes(id)));
    if (applies.length) return { value: "applies", quotes: applies.map((q) => q.text) };
    if (v.confirmedRelations.length) return { value: "confirmed_relation", quotes: v.confirmedRelations.map((r) => `${r.otherName}: ${r.quote.text}`) };
    if (v.restrictionQuotes.length) return { value: "official_quote", quotes: v.restrictionQuotes.map((q) => q.text) };
    return { value: "unknown", quotes: [] };
  }
  const m = /[^.\n]*(중복|유사\s?사업|동시\s?(수혜|참여))[^.\n]*/.exec(p.texts.excluded);
  return m ? { value: "official_quote", quotes: [m[0].trim()] } : { value: "unknown", quotes: [] };
}

export function judgePolicy(
  p: Policy,
  v: VerifiedPolicy | undefined,
  profile: Profile,
  now: Date,
  opts: { softenCodes?: string[] } = {},
): Axes {
  const personal = judgePersonal(p, v, profile, now, opts);
  const restriction = restrictionAxis(p, v, profile);
  if (restriction.value === "applies" && personal.value === "eligible") {
    personal.value = "needs_check";
    personal.reasons.push(REASON.participating);
  }
  return { personal, recruitment: recruitment(p, v, now), time: timeAxis(v, profile, now), restriction };
}

const NON_INDIVIDUAL = /컨소시엄|운영|조성|센터|조사|위원회|의무제|설치|홍보|구축|활성화|협의체|포럼|축제|행사|기념|장려금|인프라/;
const NON_INDIVIDUAL_PROVISION = new Set(["0042001", "0042012"]); // 인프라 구축, 경제적 규제

export type JudgedPolicy = { policy: Policy; verified: boolean; layer: Layer; axes: Axes };

export function judgeAll(profile: Profile, now: Date, opts: { softenCodes?: string[] } = {}): JudgedPolicy[] {
  const verified = loadVerified();
  const out: JudgedPolicy[] = [];
  for (const p of loadSnapshot().policies) {
    const v = verified.get(p.id);
    if (!v) {
      if (p.applyPeriodType === "closed") continue;
      if (NON_INDIVIDUAL.test(p.name) || (p.provisionCode && NON_INDIVIDUAL_PROVISION.has(p.provisionCode))) continue;
      if (!p.zipCodes.includes(profile.sigungu)) continue;
    }
    const axes = judgePolicy(p, v, profile, now, opts);
    const layer: Layer = v ? "verified" : axes.recruitment === "closed" ? "history" : "partial";
    out.push({ policy: p, verified: !!v, layer, axes });
  }
  return out;
}
