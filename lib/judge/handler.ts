// /api/judge 처리. 판정은 우리 서버 코드가 하며 외부 AI를 부르지 않는다. 요청 내용을 저장·기록하지 않는다.
import { z } from "zod";
import { toKstDate } from "@/lib/date";
import { isBirthPairConsistent, isValidBirthDate } from "./birth-date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { overlapDataVersion } from "@/lib/data/overlap";
import { BenefitsSchema, type Restriction } from "./overlap";
import { loadVerified, StatusKey } from "@/lib/data/verified";
import { assembleCards, type ActionCard } from "@/lib/agent/assemble";
import { rankOpenQuestions, type Question } from "@/lib/agent/questions";
import { applyTransition, CHANGE_LABEL, needsVerification, simulateTransition, type Transition, type TransitionResult } from "@/lib/sim/transition";
import { buildRoute, type Route } from "@/lib/route/build";
import { allRelations } from "@/lib/route/build";
import { buildPipeline, type Pipeline } from "@/lib/route/pipeline";
import { buildRoadmap, policyNotice, type Roadmap, type VerifyLabel } from "@/lib/route/roadmap";
import { buildTimeline, type StationObserver, type Timeline } from "@/lib/route/timeline";
import { selectDefaultVisible } from "@/lib/ui/select";
import { judgeAll, type Profile, type PersonalValue } from "./index";
import { baselineOpts } from "./personal";
import { PlannerInputSchema } from "@/lib/planner/schema";
import { evaluateRequest } from "@/lib/planner/catalog";
import type { Evaluation } from "@/lib/planner/types";

const NATIONAL = "20260710005400113256";

const ProfileSchema = z.object({
  birthYm: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  birthDate: z.string().refine(value => isValidBirthDate(value), "생년월일은 실제 날짜이며 미래일 수 없어요.").optional(),
  sigungu: z.string().regex(/^\d{5}$/),
  school: z.string().regex(/^\d{7}$/),
  currentStatus: z.array(StatusKey),
  interest: z.enum(["job", "keep_searching", "startup"]),
  events: z.array(z.object({ type: z.enum(["training_completion", "employment", "business_registration"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(["scheduled", "completed", "simulated"]) })),
  participating: z.array(z.string()),
  recentHistory: z.enum(["yes", "no"]).optional(),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.enum(["demo_persona", "user"]),
}).superRefine((profile, ctx) => {
  if (!isBirthPairConsistent(profile.birthYm, profile.birthDate)) ctx.addIssue({ code: "custom", message: "생년월일과 출생연월이 일치하지 않아요.", path: ["birthDate"] });
});

export const JudgeRequestSchema = z.object({
  profile: ProfileSchema,
  benefits: BenefitsSchema.optional(),
  plannerV2: PlannerInputSchema.optional(),
  transitions: z.array(z.enum(["complete_training", "get_employed", "register_business"])).max(3).optional(),
  answers: z
    .object({
      participating_national_employment_support: z.enum(["예", "아니오", "모름"]).optional(),
      recent_history: z.enum(["예", "아니오", "모름"]).optional(),
    })
    .optional(),
  /** 타임라인의 가정: 기준일(수료일 또는 오늘)로부터 몇 개월 뒤 취업·사업자등록인지 */
  plan: z
    .object({
      employAfterMonths: z.number().int().min(0).max(12).nullable().optional(),
      businessAfterMonths: z.number().int().min(0).max(12).nullable().optional(),
      move: z.object({ sigungu: z.string().regex(/^\d{5}$/), afterMonths: z.number().int().min(0).max(12) }).nullable().optional(),
    })
    .optional(),
});

export type JudgeItem = {
  id: string;
  name: string;
  org: string;
  verified: boolean;
  verifyLabel: VerifyLabel;
  personal: PersonalValue;
  reasons: string[];
  recruitment: string;
  deadline: string | null;
  timeNote: string | null;
  restriction: string;
  restrictionQuotes: string[];
  restrictions: Restriction[];
  planned_conflicts: Restriction[];
  link: string | null;
  change: string | null;
  changeKey: string | null;
};

export type JudgeBody =
  | { error: string; field?: string; code?: string }
  | {
      asOf: string;
      dataVersion: string;
      today: string;
      lastTransition: Transition | null;
      summary: Record<PersonalValue, number>;
      items: JudgeItem[];
      defaultVisible: string[];
      historyCount: number;
      cards: ActionCard[];
      questions: Question[];
      route: Route;
      timeline: Timeline;
      roadmap: Roadmap;
      pipeline: Pipeline;
      needsVerification: string[];
      plannerV2?: Evaluation;
    };

export function handleJudge(body: unknown, now: Date, onStation?: StationObserver): { status: number; body: JudgeBody } {
  const parsed = JudgeRequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message ?? "프로필 형식이 잘못됐습니다.", field: parsed.error.issues[0]?.path.join("."), code: "INVALID_INPUT" } };
  let profile: Profile = structuredClone(parsed.data.profile);
  if (parsed.data.benefits) profile.benefits = parsed.data.benefits;
  if (parsed.data.answers?.participating_national_employment_support === "예" && !profile.participating.includes(NATIONAL)) {
    profile.participating.push(NATIONAL);
  }
  const history = parsed.data.answers?.recent_history;
  if (history === "예") profile.recentHistory = "yes";
  if (history === "아니오") profile.recentHistory = "no";
  const transitions = parsed.data.transitions ?? [];
  const last = transitions.at(-1) ?? null;
  const origin = profile;
  for (const t of transitions.slice(0, -1)) profile = applyTransition(profile, t, now);

  let changes: TransitionResult[] = [];
  let results;
  if (last) {
    changes = simulateTransition(profile, last, now, origin);
    results = judgeAll(applyTransition(profile, last, now), now, baselineOpts(origin, profile));
  } else {
    results = judgeAll(profile, now);
  }
  const timeline = buildTimeline(origin, now, parsed.data.plan ?? {}, onStation);
  const roadmap = buildRoadmap(timeline);
  const answered = new Set(Object.entries(parsed.data.answers ?? {}).filter(([, v]) => v && v !== "모름").map(([k]) => k));
  const changeById = new Map(changes.map((c) => [c.policyId, c]));
  const verified = loadVerified();

  const current = results.filter((r) => r.layer !== "history");
  const today = toKstDate(now);
  const items: JudgeItem[] = current.map((r) => {
    const v = verified.get(r.policy.id);
    const c = changeById.get(r.policy.id);
    const notice = policyNotice(r.policy, v, today);
    return {
      id: r.policy.id,
      name: v?.name ?? r.policy.name,
      org: r.policy.supervisingOrg,
      verified: r.verified,
      verifyLabel: notice.verifyLabel,
      personal: r.axes.personal.value,
      reasons: r.axes.personal.reasons,
      recruitment: r.axes.recruitment,
      deadline: r.axes.recruitment === "open" ? notice.official.end : null,
      timeNote: r.axes.time.note ?? null,
      restriction: r.axes.restriction.value,
      restrictionQuotes: r.axes.restriction.quotes,
      restrictions: r.axes.restriction.current_restrictions ?? [],
      planned_conflicts: r.axes.restriction.planned_conflicts ?? [],
      link: notice.link?.url ?? null,
      change: c && c.change !== "unchanged" ? CHANGE_LABEL[c.change] : null,
      changeKey: c && c.change !== "unchanged" ? c.change : null,
    };
  });
  const summary: Record<PersonalValue, number> = { eligible: 0, code_met_unreviewed: 0, needs_check: 0, ineligible: 0 };
  for (const i of items) summary[i.personal]++;

  return {
    status: 200,
    body: {
      asOf: loadSnapshot().asOf,
      dataVersion: overlapDataVersion(),
      today,
      lastTransition: last,
      summary,
      items,
      defaultVisible: selectDefaultVisible(items, now),
      historyCount: results.length - current.length,
      cards: assembleCards(results, last ?? "none", changes),
      // 이미 답한 질문은 다시 묻지 않는다
      questions: rankOpenQuestions(results).filter((q) => !answered.has(q.key)),
      route: buildRoute(origin, now),
      timeline,
      roadmap,
      pipeline: buildPipeline(roadmap, allRelations()),
      needsVerification: last ? needsVerification(changes, new Set()) : [],
      ...(parsed.data.plannerV2 ? { plannerV2: evaluateRequest(origin, parsed.data.plannerV2, now, parsed.data.plan) } : {}),
    },
  };
}
