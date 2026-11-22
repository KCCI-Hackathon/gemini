import { z } from "zod";
import { isDate } from "./dates";
import { regionOptions } from "@/lib/data/regions";
import { StatusKey } from "@/lib/data/verified";
const regions = new Set(regionOptions().map(r => r.code));
export const ProfileSnapshotSchema = z.object({
  birthYm: z.string().refine(value => isDate(`${value}-01`)), sigungu: z.string().refine(value => regions.has(value)), school: z.string().regex(/^\d{7}$/),
  currentStatus: z.array(StatusKey), interest: z.enum(["job", "keep_searching", "startup"]), participating: z.array(z.string()), source: z.enum(["demo_persona", "user"]),
  events: z.array(z.object({ type: z.enum(["training_completion", "employment", "business_registration", "relocation"]), date: z.string().refine(isDate), status: z.enum(["scheduled", "completed", "simulated"]) })),
});
export const EventSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), type: z.enum(["training_completion", "employment", "business_registration", "relocation"]),
  date: z.string().refine(isDate, "실제 달력 날짜를 입력해 주세요."), status: z.enum(["scheduled", "completed"]), sigungu: z.string().optional(),
}).refine(e => e.type !== "relocation" || (e.sigungu != null && regions.has(e.sigungu)), { message: "이사 목적지의 시군구를 선택해 주세요.", path: ["sigungu"] });
export const PlannerInputSchema = z.object({
  revision: z.number().int().min(0), events: z.array(EventSchema).max(30).optional(),
  choices: z.array(z.object({ offeringId: z.string().min(1).max(150), stageId: z.string().min(1).max(2500) })).max(200),
  mutedKeys: z.array(z.enum(["residence", "participation", "status", "interest"])).max(4),
  preferredCategory: z.enum(["all", "job", "startup", "housing", "edu", "life"]), demoId: z.literal("pathfinder-demo-2026").optional(),
}).superRefine((input, ctx) => {
  const ids = new Set<string>();
  const single = new Set<string>();
  const moves = new Map<string, string>();
  for (const event of input.events ?? []) {
    if (ids.has(event.id)) ctx.addIssue({ code: "custom", message: "중복된 사건 ID", path: ["events"] });
    ids.add(event.id);
    if (event.type !== "relocation" && single.has(event.type)) ctx.addIssue({ code: "custom", message: "같은 사건의 예정일을 수정해 주세요.", path: ["events"] });
    single.add(event.type);
    if (event.type === "relocation") {
      if (moves.has(event.date) && moves.get(event.date) !== event.sigungu) ctx.addIssue({ code: "custom", message: "같은 날의 이사 목적지를 하나로 정해 주세요.", path: ["events"] });
      moves.set(event.date, event.sigungu!);
    }
  }
  if (new Set(input.choices.map(c => c.offeringId)).size !== input.choices.length) ctx.addIssue({ code: "custom", message: "같은 회차는 한 시점에만 담을 수 있어요.", path: ["choices"] });
});

const PeriodSchema = z.object({ start: z.string().refine(isDate), end: z.string().refine(isDate).nullable() });
const ReasonSchema = z.object({ code: z.string(), message: z.string(), evidenceId: z.string().optional(), eventId: z.string().optional(), relatedOfferingId: z.string().optional() });
const CardSchema = z.object({
  policyId: z.string(), offeringId: z.string(), roundLabel: z.string(), title: z.string(), category: z.enum(["job", "startup", "housing", "edu", "life"]),
  summary: z.string(), support: z.string(), org: z.string(), dataVersion: z.string(), reviewed: z.boolean(),
  official: z.object({ kind: z.enum(["fixed", "rolling", "budget", "unknown"]), start: z.string().refine(isDate).nullable(), end: z.string().refine(isDate).nullable(), closeAt: z.string().nullable() }),
  rules: z.array(z.object({ key: z.enum(["trained", "unemployed", "employed", "in_training", "business_registered"]), kind: z.enum(["requires", "excludes"]), reviewed: z.boolean(), evidenceId: z.string() })),
  restrictions: z.array(z.object({ otherId: z.string(), reviewed: z.boolean(), action: z.enum(["application", "benefit"]), direction: z.enum(["both", "outgoing"]), period: PeriodSchema.nullable(), otherPeriod: PeriodSchema.nullable(), evidenceId: z.string() })),
  evidence: z.array(z.object({ evidenceId: z.string(), title: z.string(), quote: z.string(), url: z.string().nullable(), reviewedAt: z.string(), reviewed: z.boolean() })),
  stageId: z.string(), personalWindow: PeriodSchema.nullable(), stageWindow: PeriodSchema.nullable(), applicationWindows: z.array(PeriodSchema), deadlineKind: z.enum(["official", "personal_estimate", "rolling", "unknown", "closed"]),
  daysLeft: z.number().nullable(), availability: z.enum(["eligible", "needs_check", "blocked"]), reasons: z.array(ReasonSchema), selectedStageId: z.string().nullable(), otherStageIds: z.array(z.string()), conflicts: z.array(z.string()), canReplace: z.boolean(),
});
export const EvaluationSchema = z.object({
  revision: z.number().int().min(0), today: z.string().refine(isDate), asOf: z.string(), evaluatedAt: z.string(), dataVersion: z.string(), demo: z.boolean(),
  stages: z.array(z.object({ stageId: z.string(), label: z.string(), start: z.string().refine(isDate), endExclusive: z.string().refine(isDate).nullable(), eventIds: z.array(z.string()) })), cards: z.array(CardSchema),
  choiceWarnings: z.array(z.object({ offeringId: z.string(), stageId: z.string(), title: z.string(), message: z.string(), otherStageIds: z.array(z.string()) })), recommendations: z.array(z.object({ offeringId: z.string(), stageId: z.string() })),
}).superRefine((evaluation, ctx) => {
  for (const recommendation of evaluation.recommendations) {
    if (!evaluation.cards.some(c => c.offeringId === recommendation.offeringId && c.stageId === recommendation.stageId) || !evaluation.stages.some(st => st.stageId === recommendation.stageId)) ctx.addIssue({ code: "custom", message: "추천 대상 회차·시점을 찾을 수 없어요.", path: ["recommendations"] });
  }
});
