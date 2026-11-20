// /api/plan 계획 에이전트(통합 설계 6장).
// - 가상 인물은 항상, 실제 사용자는 PLAN_AI_FOR_USERS=true이고 동의했을 때만 AI를 쓴다(기본 꺼짐).
// - AI에는 summarizeForAI 요약과 코드가 만든 길(정거장·정책)만 간다. 실제 사용자의 자유 입력은 받지 않는다.
// - 판정은 하지 않는다. 다음 질문 고르기, 기타 글 해석(가상 인물), 계획 요약만 한다.
// - 서버에 상태를 남기지 않는다. 같은 요약·같은 모드면 같은 날 결과를 다시 쓴다(기타 글이 있으면 다시 쓰지 않음).
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { aiConfigured } from "@/lib/ai/client";
import { monthsBetween, toKstDate } from "@/lib/date";
import { guardResponse } from "@/lib/agent/guard";
import { handleJudge } from "@/lib/judge/handler";

import { takeQuota } from "@/lib/limits";
import { policyNotice, type Roadmap } from "@/lib/route/roadmap";
import { loadVerified } from "@/lib/data/verified";
import { stateOf, type CellState } from "@/lib/route/timeline";
import { REASON, type JudgedPolicy } from "@/lib/judge";
import { VERIFY_MODEL, type AnthropicLike } from "@/lib/verify/run";
import { summarizeForAI, type PlanSession } from "./summary";

const SYSTEM = `당신은 청년 정책 계획 에이전트입니다. 사용자의 요약 정보와 코드가 계산한 정책 길(정거장별 정책)을 보고 다음 중 하나를 합니다.
- 계획 정리(finish_plan): 정거장(지금, 수료 후, 취업 후 등)마다 그 정거장의 정책(지금은 policies, 이후는 new_policies·changed_policies) 중 먼저 볼 1~3개를 고릅니다. why에는 그 시점에 무엇이 새로 열리거나 바뀌는지를 판정 사유(reasons)에 근거해 한 문장으로 씁니다("확인" 같은 한 단어는 쓰지 않습니다). 정책이 없는 정거장은 items를 비웁니다. 정거장 label은 get_route의 label을 그대로 씁니다. 정책은 get_route에 나온 것만 씁니다.
- 다음 질문(ask_user): rank_open_questions의 질문 후보 중 하나를 골라 문장만 씁니다. 선택지는 코드가 붙입니다.
- 기타 글 해석(parse_other_answer): 사용자가 직접 쓴 답을 정해진 형식의 값으로 바꿉니다. 확실하지 않으면 해석하지 말고 no_more_questions로 끝냅니다.
규칙
- 자격을 판정하지 않습니다. "조건 충족"은 선정을 뜻하지 않습니다. 선정된다고 말하지 않습니다.
- 취업·창업 중 어느 쪽이 낫다거나, 시점을 앞당기거나 늦추라고 권하지 않습니다.
- 날짜·금액을 지어내지 않습니다. 도구 결과만 인용합니다.
- 사용자가 쓴 개인 사정을 계획 문장에 다시 쓰지 않습니다.`;

const PARSE: Record<string, { values: RegExp; label: (v: string) => string }> = {
  status: { values: /^(training|seeking|employed|business|unknown)$/, label: (v) => ({ training: "교육·훈련 수강 중", seeking: "구직 중", employed: "재직 중", business: "사업자등록 있음", unknown: "모름" })[v]! },
  completion: { values: /^(1|3|6|unknown)$/, label: (v) => (v === "unknown" ? "수료 시점 모름" : `수료 ${v}개월 안`) },
  employ: { values: /^([0-9]|1[0-2]|none)$/, label: (v) => (v === "none" ? "취업 계획 없음" : `취업 ${v}개월 뒤`) },
  business: { values: /^([0-9]|1[0-2]|none)$/, label: (v) => (v === "none" ? "창업 계획 없음" : `창업 ${v}개월 뒤`) },
};

const TOOLS = [
  { name: "get_route", description: "코드가 계산한 정거장과 정책 길(판정·경계 달·검증 표시 포함)", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "rank_open_questions", description: "답하면 판정이 바뀔 수 있는 질문 후보(코드가 고름)", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "get_policy_evidence",
    description: "get_route의 정거장에서 사람이 확인한 정책 조건·근거 문장·기준일 종류. station을 생략하면 지금을 기준으로 합니다.",
    input_schema: { type: "object", properties: { policy_id: { type: "string" }, station: { type: "string" } }, required: ["policy_id"], additionalProperties: false },
  },
  {
    name: "ask_user",
    description: "질문 후보 중 하나를 골라 묻는다",
    input_schema: { type: "object", properties: { key: { type: "string" }, text: { type: "string" } }, required: ["key", "text"], additionalProperties: false },
  },
  {
    name: "parse_other_answer",
    description: "기타 글을 값으로 바꾼다. key: status(training|seeking|employed|business|unknown), completion(1|3|6|unknown), employ(0~12|none), business(0~12|none)",
    input_schema: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"], additionalProperties: false },
  },
  { name: "no_more_questions", description: "더 물을 것이 없거나 해석할 수 없을 때", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "finish_plan",
    description: "정거장별로 확인할 정책과 이유를 정리해 끝낸다",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        stations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              items: { type: "array", items: { type: "object", properties: { policy_id: { type: "string" }, why: { type: "string" } }, required: ["policy_id", "why"], additionalProperties: false } },
            },
            required: ["label", "items"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "stations"],
      additionalProperties: false,
    },
  },
];

const RequestSchema = z.object({
  mode: z.enum(["first", "answer", "replan"]),
  persona: z.boolean(),
  consent: z.boolean().optional(),
  session: z.object({ profile: z.any(), plan: z.any().default({}), answers: z.record(z.string(), z.string()).default({}) }),
  otherText: z.string().max(200).optional(),
});

type Station = { label: string; items: { policyId: string; name: string; why: string }[] };
export type PlanBody = {
  fallback?: boolean;
  disabled?: boolean;
  question?: { key: string; text: string; options: string[] };
  parsed?: { key: string; value: string; label: string; needsConfirm: true };
  plan?: { summary: string; stations: Station[] };
  log?: { tool: string; summary: string }[];
  error?: string;
};
type Out = { status: number; body: PlanBody };
type Ctx = { env: Record<string, string | undefined>; ip: string; now: Date; makeClient: () => AnthropicLike };

const cache = new Map<string, PlanBody>();
export function resetPlanState() {
  cache.clear();
}

const GOAL_STATION: Record<string, string> = { training_completion: "수료 후", employment: "취업 후", business_registration: "창업 후", relocation: "이사 후" };

const STATION_STATUS: Record<CellState, string> = {
  ok: "조건 충족", check: "확인 필요", wait: "기간 조건 남음", closed: "모집 기간 아님", no: "조건상 비해당",
};
type StationResults = Map<string, ReadonlyMap<string, JudgedPolicy>>;

function trainingAction(policy: JudgedPolicy | undefined, station: "now" | "completion" | "other") {
  const personal = policy?.axes.personal;
  if (personal?.reasons.includes(REASON.nextRound)) return;
  const rule = personal?.evidence?.find((e) =>
    e.key === "in_training" && e.kind === "excludes" && e.basis === "resolvable_before_start");
  if (station === "now" && rule?.outcome === "check") {
    return "수료 예정일과 지원할 과정 시작일을 비교해, 시작 전에 교육이 끝나는지 확인하세요.";
  }
  if (station === "completion" && rule?.outcome === "met") {
    const proof = rule.quote.text.includes("증빙") ? "과정 시작일과 수료 증빙을 확인하세요." : "과정 시작일을 확인하세요.";
    return `예정대로 수료하면 훈련 수강 제한이 해소될 수 있어요. ${proof}`;
  }
}

/** AI에 줄 길: 정거장마다 그 시점에 볼 정책(지금은 열려 있는 것, 이후는 새로 열리는 것·판정이 바뀌는 것). 날짜 대신 "N개월 뒤" */
function routeForAI(r: Roadmap, stationResults: StationResults) {
  const today = r.months[0];
  const byId = new Map(r.rows.map((x) => [x.policyId, x]));
  const verified = loadVerified();
  const brief = (id: string, date: string, station: "now" | "completion" | "other") => {
    const x = byId.get(id)!;
    const judged = stationResults.get(date)?.get(id);
    let status = "해당 시점 후보에 없음";
    if (judged) {
      const state = stateOf(judged);
      status = STATION_STATUS[state];
      if (state === "ok" && !x.verified) status = "코드 조건 충족(본문 미검토)";
      if (state === "closed" && judged.axes.recruitment === "unknown") status = "모집 기간 확인 필요";
    }
    return { policy_id: id, name: x.name, status, reasons: judged?.axes.personal.reasons.slice(0, 2) ?? [],
      next_action: trainingAction(judged, station), verify: judged ? policyNotice(judged.policy, verified.get(id), date).verifyLabel : x.verifyLabel };
  };
  const nowIds = r.rows
    .filter((x) => x.firstAvailable === today && x.status !== "none")
    .sort((a, b) => Number(b.verifyLabel !== "미검증(API)") - Number(a.verifyLabel !== "미검증(API)"))
    .slice(0, 8)
    .map((x) => x.policyId);
  return {
    stations: [
      { label: "지금", policies: nowIds.map((id) => brief(id, today, "now")) },
      ...r.goals.map((g) => ({
        label: `${GOAL_STATION[g.type]}(${Math.max(0, monthsBetween(today, g.date))}개월 뒤)`,
        new_policies: g.opened.slice(0, 6).map((id) => brief(id, g.date, g.type === "training_completion" ? "completion" : "other")),
        changed_policies: g.changed.slice(0, 6).map((id) => brief(id, g.date, g.type === "training_completion" ? "completion" : "other")),
      })),
    ],
  };
}

export async function handlePlan(raw: unknown, ctx: Ctx): Promise<Out> {
  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { error: "요청 형식이 잘못됐습니다." } };
  const req = parsed.data;
  if (!req.persona) {
    if (ctx.env.PLAN_AI_FOR_USERS !== "true" || !req.consent) return { status: 403, body: { disabled: true, error: "실제 사용자 정보로는 AI 계획 정리를 쓰지 않습니다." } };
    if (req.otherText) return { status: 400, body: { error: "실제 사용자의 자유 입력은 외부 AI로 보내지 않습니다." } };
  }
  if (!aiConfigured(ctx.env)) return { status: 503, body: { error: "AI가 꺼져 있습니다." } };

  const session = req.session as PlanSession;
  const stationResults: StationResults = new Map();
  const judged = handleJudge({ profile: session.profile, plan: session.plan, answers: session.answers }, ctx.now,
    (date, policies) => stationResults.set(date, policies));
  if (!("roadmap" in judged.body)) return { status: 400, body: { error: "프로필 형식이 잘못됐습니다." } };
  const roadmap = judged.body.roadmap;
  const questions = judged.body.questions;

  const summary = summarizeForAI(session, ctx.now);
  const key = `${toKstDate(ctx.now)}:${req.mode}:${JSON.stringify(summary)}`;
  if (!req.otherText && cache.has(key)) return { status: 200, body: cache.get(key)! };
  if (!takeQuota(ctx.env, ctx.ip, ctx.now)) return { status: 429, body: { error: "오늘의 AI 사용 한도에 도달했습니다." } };

  const out = await runPlan(req.mode, summary, routeForAI(roadmap, stationResults), roadmap, stationResults, questions, req.persona ? req.otherText : undefined, ctx);
  if (!req.otherText && !out.fallback) cache.set(key, out);
  return { status: 200, body: out };
}

async function runPlan(
  mode: "first" | "answer" | "replan",
  summary: ReturnType<typeof summarizeForAI>,
  route: ReturnType<typeof routeForAI>,
  roadmap: Roadmap,
  stationResults: StationResults,
  questions: { key: string; question: string; options: string[] }[],
  otherText: string | undefined,
  ctx: Ctx,
): Promise<PlanBody> {
  const known = new Map(roadmap.rows.map((r) => [r.policyId, r.name]));
  const stationNames = new Set(route.stations.map((st) => st.label));
  const stationActions = new Map(route.stations.map((station) => {
    const candidates = "policies" in station ? station.policies : [...station.new_policies, ...station.changed_policies];
    return [station.label, new Map(candidates.map((p) => [p.policy_id, p.next_action]))];
  }));
  const log: { tool: string; summary: string }[] = [];
  const task = mode === "answer" ? (otherText ? `사용자가 직접 쓴 답을 해석하세요: """${otherText}"""` : "다음에 물을 질문을 고르세요.") : "정거장별 계획을 정리하세요.";
  const messages: Record<string, unknown>[] = [{ role: "user", content: `사용자 요약: ${JSON.stringify(summary)}\n${task}` }];
  const client = ctx.makeClient();
  const maxTurns = mode === "answer" ? 3 : 6;

  for (let turn = 0; turn < maxTurns; turn++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model: VERIFY_MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: mode === "answer" ? "low" : "medium" },
        system: SYSTEM,
        tools: TOOLS,
        messages,
      });
    } catch {
      return { fallback: true, log };
    }
    if (res.stop_reason === "refusal") break;
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) break;
    const results: Record<string, unknown>[] = [];
    for (const u of uses) {
      const input = u.input as Record<string, unknown>;
      const reply = (content: string, isError = false) => results.push({ type: "tool_result", tool_use_id: u.id, content, ...(isError ? { is_error: true } : {}) });
      if (u.name === "get_route") {
        log.push({ tool: u.name, summary: `정거장 ${route.stations.length}개` });
        reply(JSON.stringify(route));
      } else if (u.name === "rank_open_questions") {
        log.push({ tool: u.name, summary: `질문 후보 ${questions.length}개` });
        reply(JSON.stringify(questions.map((q) => ({ key: q.key, question: q.question }))));
      } else if (u.name === "get_policy_evidence") {
        const stationIndex = route.stations.findIndex(({ label }) => label === (input.station ?? "지금"));
        const date = stationIndex === 0 ? roadmap.months[0] : roadmap.goals[stationIndex - 1]?.date;
        const judged = date && typeof input.policy_id === "string" ? stationResults.get(date)?.get(input.policy_id) : undefined;
        const personal = judged?.axes.personal;
        const evidence = personal?.reasons.includes(REASON.nextRound) ? [] : personal?.evidence?.filter((condition) => condition.confirmed) ?? [];
        log.push({ tool: u.name, summary: judged?.policy.name ?? "근거 없음" });
        reply(evidence.length ? JSON.stringify({ name: judged?.policy.name, round: evidence[0].round, conditions: evidence.map((c) => ({ key: c.key, kind: c.kind, basis: c.basisLabel, quote: c.quote.text })) }) : "이 정거장에서 사람이 확인한 조건별 근거가 없습니다.", !evidence.length);
      } else if (u.name === "ask_user") {
        const q = questions.find((x) => x.key === input.key);
        const text = String(input.text ?? "");
        if (!q || !guardResponse(text, new Set()).ok) {
          reply("질문 후보에 없는 key이거나 쓸 수 없는 표현입니다.", true);
          continue;
        }
        log.push({ tool: u.name, summary: q.key });
        return { fallback: false, question: { key: q.key, text, options: q.options }, log };
      } else if (u.name === "parse_other_answer") {
        const key = String(input.key ?? "");
        const value = String(input.value ?? "");
        const rule = PARSE[key];
        if (!otherText || !rule || !rule.values.test(value)) {
          reply("정해진 질문 key와 형식의 값만 받을 수 있습니다.", true);
          continue;
        }
        log.push({ tool: u.name, summary: `${key}=${value}` });
        return { fallback: false, parsed: { key, value, label: rule.label(value), needsConfirm: true }, log };
      } else if (u.name === "no_more_questions") {
        log.push({ tool: u.name, summary: "질문 없음" });
        return { fallback: false, log };
      } else if (u.name === "finish_plan") {
        log.push({ tool: u.name, summary: "계획 정리" });
        const rawStations = Array.isArray(input.stations) ? (input.stations as { label: string; items: { policy_id: string; why: string }[] }[]) : [];
        const text = [String(input.summary ?? ""), ...rawStations.flatMap((st) => [st.label, ...(st.items ?? []).flatMap((i) => [i.policy_id, i.why])])].join("\n");
        const unknownPolicy = rawStations.some((st) => (st.items ?? []).some((i) => !known.has(i.policy_id)));
        const unknownStation = rawStations.some((st) => !stationNames.has(st.label) && !st.label.startsWith("지금") && ![...stationNames].some((n) => n.startsWith(st.label)));
        // 모르는 정책·정거장, 금지 표현이 하나라도 있으면 계획 전체를 버린다(6.3)
        if (unknownPolicy || unknownStation || !guardResponse(text, new Set(known.keys())).ok) return { fallback: true, log };
        return {
          fallback: false,
          plan: {
            summary: String(input.summary ?? ""),
            stations: rawStations.map((st) => ({
              label: st.label,
              items: (st.items ?? []).map((i) => ({
                policyId: i.policy_id, name: known.get(i.policy_id)!,
                why: stationActions.get(st.label)?.get(i.policy_id) ?? i.why,
              })),
            })),
          },
          log,
        };
      } else {
        reply("알 수 없는 도구", true);
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { fallback: true, log };
}
