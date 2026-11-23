// 상담 에이전트(가상 인물 시연 전용, 설계 5장 ⑤). 요청은 가상 인물 번호와 선택지만 받는다.
import type Anthropic from "@anthropic-ai/sdk";
import { aiConfigured } from "@/lib/ai/client";
import { toKstDate } from "@/lib/date";
import { loadVerified } from "@/lib/data/verified";
import { BASIS_LABEL, pickRound } from "@/lib/judge/rules";
import { judgeAll } from "@/lib/judge";
import { PERSONAS, type PersonaId } from "@/lib/judge/personas";
import type { AnthropicLike } from "@/lib/verify/run";
import { VERIFY_MODEL } from "@/lib/verify/run";
import { assembleCards } from "./assemble";
import { guardResponse } from "./guard";
import { buildAgentPayload } from "./payload";

const MAX_TURNS = 6;

const SYSTEM = `당신은 청년 정책 상담 에이전트입니다. 가상 인물의 정책 판정 결과를 보고, 사용자가 먼저 풀어야 할 불확실성을 정해 정책별 "다음에 확인할 사항"을 순서대로 정리합니다.
- rank_open_questions로 답하면 판정이 바뀔 수 있는 질문 후보를 보고, get_policy_evidence로 해당 정책의 원문 조건을 확인한 뒤, finish_cards로 끝냅니다.
- 자격을 스스로 판정하지 않습니다. 도구 결과만 인용합니다.
- 금액·날짜를 계산하거나 지어내지 않습니다.
- "확인 필요"를 확정처럼 말하지 않습니다. 원문에 제한 문구가 없다고 "중복 가능"이라고 말하지 않습니다.
- 취업·창업을 미루거나 서두르라고 권하지 않고, 어느 쪽이 유리하다는 비교를 하지 않습니다.
- 소득·주소·신분을 바꿔 자격을 맞추는 방법을 권하지 않습니다. 선정된다고 말하지 않습니다.`;

const TOOLS = [
  { name: "rank_open_questions", description: "답하면 판정이 바뀔 수 있는 질문 후보와 영향 받는 정책 수", input_schema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "get_policy_evidence",
    description: "검증 정책의 원문 조건, 기준 시점, 제한 문구",
    input_schema: { type: "object", properties: { policy_id: { type: "string" } }, required: ["policy_id"], additionalProperties: false },
  },
  {
    name: "finish_cards",
    description: "정책별 다음에 확인할 사항을 순서대로 정리해 끝낸다",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        cards: {
          type: "array",
          items: {
            type: "object",
            properties: { policy_id: { type: "string" }, check_next: { type: "array", items: { type: "string" } }, rationale: { type: "string" } },
            required: ["policy_id", "check_next", "rationale"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "cards"],
      additionalProperties: false,
    },
  },
];

type Card = { policyId: string; name: string; checkNextInOrder: string[]; rationale: string };
type Out = { status: number; body: { fallback?: boolean; summary?: string; cards?: Card[]; log?: { tool: string; summary: string }[]; error?: string } };

function fallbackCards(personaId: PersonaId, now: Date): Card[] {
  return assembleCards(judgeAll(PERSONAS[personaId], now), "none").map((c) => ({ policyId: c.policyId, name: c.name, checkNextInOrder: c.checkNextInOrder, rationale: c.rationale }));
}

/** 입력이 고정된 가상 인물이라 같은 날 결과는 재사용한다 */
const agentCache = new Map<string, Out>();

export async function handleAgent(body: unknown, ctx: { env: Record<string, string | undefined>; ip?: string; now: Date; makeClient: () => AnthropicLike }): Promise<Out> {
  const pre = precheck(body);
  if ("status" in pre) return pre;
  const pid = pre.pid;
  if (!aiConfigured(ctx.env)) {
    return { status: 200, body: { fallback: true, cards: fallbackCards(pid, ctx.now), log: [] } };
  }
  const key = `${pid}:${toKstDate(ctx.now)}`;
  const hit = agentCache.get(key);
  if (hit) return hit;
  try {
    const out = await runAgent(pid, ctx);
    if (!out.body.fallback) agentCache.set(key, out);
    return out;
  } catch {
    // 호출 실패(과부하·인증·시간 초과)는 사전 조립 카드로 동작한다(설계 7장)
    return { status: 200, body: { fallback: true, cards: fallbackCards(pid, ctx.now), log: [], error: "AI 호출이 실패해 코드가 정리한 카드를 보여 드립니다." } };
  }
}

export function resetAgentState() {
  agentCache.clear();
}

function precheck(body: unknown): Out | { pid: PersonaId } {
  if (!body || typeof body !== "object") return { status: 400, body: { error: "요청 형식이 잘못됐습니다." } };
  const keys = Object.keys(body);
  if (keys.some((k) => k !== "personaId")) return { status: 400, body: { error: "가상 인물 번호만 보낼 수 있습니다." } };
  const personaId = (body as { personaId: unknown }).personaId;
  if (typeof personaId !== "string" || !(personaId in PERSONAS)) return { status: 400, body: { error: "가상 인물 번호가 잘못됐습니다." } };
  return { pid: personaId as PersonaId };
}

async function runAgent(pid: PersonaId, ctx: { now: Date; makeClient: () => AnthropicLike }): Promise<Out> {
  const payload = buildAgentPayload(pid, ctx.now);
  const verified = loadVerified();
  const knownIds = new Set(payload.policies.map((p) => p.id));
  const log: { tool: string; summary: string }[] = [];
  const messages: Record<string, unknown>[] = [
    { role: "user", content: `현재 상태: ${payload.stateLabel}\n검증 정책 판정 결과:\n${payload.policies.map((p) => `- ${p.id} ${p.name}: 자격 ${p.personal}, 모집 ${p.recruitment}${p.reasons.length ? `, 사유 ${p.reasons.join("; ")}` : ""}`).join("\n")}` },
  ];
  const client = ctx.makeClient();

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.beta.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason === "refusal") break;
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) break;
    const results = [];
    for (const u of uses) {
      const input = u.input as Record<string, unknown>;
      if (u.name === "rank_open_questions") {
        log.push({ tool: u.name, summary: `질문 후보 ${payload.questions.length}개` });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(payload.questions) });
      } else if (u.name === "get_policy_evidence") {
        const v = verified.get(String(input.policy_id));
        const pick = v?.rounds?.length ? pickRound(v.rounds, toKstDate(ctx.now)) : null;
        const round = pick?.state === "outside" ? null : pick?.round;
        const conditions = round?.conditions.filter((condition) => condition.supportsConfirmed).map((condition) => ({ key: condition.key, kind: condition.kind, basis: BASIS_LABEL[condition.basis], quote: condition.quote.text }));
        const evidence = pick
          ? conditions?.length ? { name: v?.name, round: round?.notice.title, conditions } : null
          : v ? { name: v.name, referenceDate: v.referenceDate, quotes: v.statusConditions.quotes.map((q) => q.text), restrictions: v.restrictionQuotes.map((q) => q.text), lookback: v.lookback?.quote.text ?? null } : null;
        log.push({ tool: u.name, summary: v ? v.name : "알 수 없는 정책" });
        results.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: evidence ? JSON.stringify(evidence) : "이번 신청 시점에 사람이 확인한 조건별 근거가 없습니다.",
          ...(evidence ? {} : { is_error: true }),
        });
      } else if (u.name === "finish_cards") {
        log.push({ tool: u.name, summary: "카드 작성" });
        const summary = String(input.summary ?? "");
        const raw = Array.isArray(input.cards) ? (input.cards as { policy_id: string; check_next: string[]; rationale: string }[]) : [];
        const cards = raw.filter((c) => knownIds.has(c.policy_id));
        const text = [summary, ...cards.flatMap((c) => [c.policy_id, ...c.check_next, c.rationale])].join("\n");
        // 모르는 정책 카드가 하나라도 있으면 응답 전체를 버린다(계획 Review Focus 3행)
        if (cards.length !== raw.length || !guardResponse(text, knownIds).ok || !cards.length) {
          return { status: 200, body: { fallback: true, cards: fallbackCards(pid, ctx.now), log } };
        }
        return {
          status: 200,
          body: {
            fallback: false,
            summary,
            cards: cards.map((c) => ({ policyId: c.policy_id, name: verified.get(c.policy_id)?.name ?? c.policy_id, checkNextInOrder: c.check_next, rationale: c.rationale })),
            log,
          },
        };
      } else {
        results.push({ type: "tool_result", tool_use_id: u.id, content: "알 수 없는 도구", is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return { status: 200, body: { fallback: true, cards: fallbackCards(pid, ctx.now), log } };
}
