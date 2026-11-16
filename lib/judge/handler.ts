// /api/judge 처리. 판정은 우리 서버 코드가 하며 외부 AI를 부르지 않는다. 요청 내용을 저장·기록하지 않는다.
import { z } from "zod";
import { toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified, StatusKey } from "@/lib/data/verified";
import { assembleCards, type ActionCard } from "@/lib/agent/assemble";
import { rankOpenQuestions, type Question } from "@/lib/agent/questions";
import { applyTransition, CHANGE_LABEL, needsVerification, simulateTransition, type Transition, type TransitionResult } from "@/lib/sim/transition";
import { selectDefaultVisible } from "@/lib/ui/select";
import { judgeAll, type Profile, type PersonalValue } from "./index";
import { baselineOpts } from "./personal";

const NATIONAL = "20260710005400113256";

const ProfileSchema = z.object({
  birthYm: z.string().regex(/^\d{4}-\d{2}$/),
  sigungu: z.string().regex(/^\d{5}$/),
  school: z.string().regex(/^\d{7}$/),
  currentStatus: z.array(StatusKey),
  interest: z.enum(["job", "keep_searching", "startup"]),
  events: z.array(z.object({ type: z.enum(["training_completion", "employment", "business_registration"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(["scheduled", "completed", "simulated"]) })),
  participating: z.array(z.string()),
  source: z.enum(["demo_persona", "user"]),
});

const RequestSchema = z.object({
  profile: ProfileSchema,
  transitions: z.array(z.enum(["complete_training", "get_employed", "register_business"])).max(3).optional(),
  answers: z.object({ participating_national_employment_support: z.enum(["예", "아니오", "모름"]).optional() }).optional(),
});

export type JudgeItem = {
  id: string;
  name: string;
  org: string;
  verified: boolean;
  personal: PersonalValue;
  reasons: string[];
  recruitment: string;
  deadline: string | null;
  timeNote: string | null;
  restriction: string;
  restrictionQuotes: string[];
  link: string | null;
  change: string | null;
  changeKey: string | null;
};

export type JudgeBody =
  | { error: string }
  | {
      asOf: string;
      today: string;
      lastTransition: Transition | null;
      summary: Record<PersonalValue, number>;
      items: JudgeItem[];
      defaultVisible: string[];
      historyCount: number;
      cards: ActionCard[];
      questions: Question[];
      needsVerification: string[];
    };

export function handleJudge(body: unknown, now: Date): { status: number; body: JudgeBody } {
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "프로필 형식이 잘못됐습니다." } };
  let profile: Profile = structuredClone(parsed.data.profile);
  if (parsed.data.answers?.participating_national_employment_support === "예" && !profile.participating.includes(NATIONAL)) {
    profile.participating.push(NATIONAL);
  }
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
  const changeById = new Map(changes.map((c) => [c.policyId, c]));
  const verified = loadVerified();

  const current = results.filter((r) => r.layer !== "history");
  const items: JudgeItem[] = current.map((r) => {
    const v = verified.get(r.policy.id);
    const c = changeById.get(r.policy.id);
    const end = v ? v.apply.end : r.policy.applyEnd;
    return {
      id: r.policy.id,
      name: v?.name ?? r.policy.name,
      org: r.policy.supervisingOrg,
      verified: r.verified,
      personal: r.axes.personal.value,
      reasons: r.axes.personal.reasons,
      recruitment: r.axes.recruitment,
      deadline: r.axes.recruitment === "open" ? end : null,
      timeNote: r.axes.time.note ?? null,
      restriction: r.axes.restriction.value,
      restrictionQuotes: r.axes.restriction.quotes,
      link: v?.sources[0]?.url ?? r.policy.links.apply ?? r.policy.links.ref,
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
      today: toKstDate(now),
      lastTransition: last,
      summary,
      items,
      defaultVisible: selectDefaultVisible(items, now),
      historyCount: results.length - current.length,
      cards: assembleCards(results, last ?? "none", changes),
      questions: rankOpenQuestions(results),
      needsVerification: last ? needsVerification(changes, new Set()) : [],
    },
  };
}
