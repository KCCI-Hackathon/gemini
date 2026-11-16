// 정책 검증 에이전트: 관찰 → 판단 → 행동 → 재평가 루프(설계 5장 ②)
// 요청에는 정책 번호와 공개 데이터만 들어간다. 사용자 정보는 이 모듈에 들어오지 않는다.

import type Anthropic from "@anthropic-ai/sdk";
import { loadSnapshot } from "@/lib/data/snapshot";
import type { Policy } from "@/lib/data/types";
import { normalizeSpace, type Web } from "./web";

export type AnthropicLike = {
  beta: { messages: { create(params: Record<string, unknown>): Promise<Anthropic.Beta.BetaMessage> } };
};

export const VERIFY_MODEL = process.env.VERIFY_MODEL ?? "claude-opus-5-5";
const MAX_TURNS = 12;

export type PageVerdict = "matching_notice" | "site_home" | "different_program" | "error";
export type MismatchKind = "recruitment_status" | "region_scope" | "reference_date_wording" | "different_program" | "notice_only_condition";
export type FindingKind = "status_reference" | "status_condition" | "age" | "lookback" | "tenure" | "region" | "income" | "restriction" | "application_period";

export type Mismatch = { kind: MismatchKind; apiValue: string; noticeValue: string; quote: string; noticeUrl: string | null };
export type Finding = { kind: FindingKind; text: string; quote: string };
export type TrailStep = {
  step: number;
  action: "open" | "search" | "judge" | "finish" | "stop" | "reject";
  target: string;
  judgement?: { verdict: PageVerdict; reason: string; quote: string | null };
  reason: string;
};

export type VerifyResult = {
  policyId: string;
  mode: "agent" | "fixed";
  outcome: "verified_against_notice" | "notice_not_found";
  noticeUrl: string | null;
  findings: Finding[];
  mismatches: Mismatch[];
  trail: TrailStep[];
  usage: { calls: number; inputTokens: number; outputTokens: number; pagesOpened: number };
};

type Deps = { client: AnthropicLike; web: Web; now: Date; enableSearch?: boolean };

const SYSTEM = `당신은 청년 정책 데이터를 공식 공고와 대조하는 검증 에이전트입니다.
목표: 주어진 정책의 공식 공고를 찾아, 상태 변화(교육 수료, 취업, 사업자등록)와 관련된 자격 조건과 그 기준 시점을 확인하고, API 데이터와 다른 점을 기록합니다.

진행 방식
1. API가 준 링크부터 open_page로 엽니다.
2. 연 페이지마다 record_judgement로 판단을 기록합니다: matching_notice(이 정책의 공식 공고·안내), site_home(사이트 첫 화면이라 내용 없음), different_program(다른 사업이나 하위 과정), error(접속 오류·빈 페이지). 근거 문장을 페이지에서 그대로 인용합니다.
3. 판단을 보고 다음 행동을 고릅니다. 첫 화면이면 같은 공식 사이트 안에서 찾고, 다른 사업이면 같은 사업의 공식 공고를 다시 찾고, 오류면 다른 공식 출처(정부24, 온통청년, 지자체 청년포털 등)를 찾습니다.
4. 새로 찾은 자료가 원래 정책과 같은 사업인지 다시 확인합니다.
5. 근거가 충분하면 finish로 끝냅니다. 같은 사업인지 확신이 없으면 근거로 쓰지 말고 더 찾거나 notice_not_found로 끝냅니다. 잘못된 공고를 근거로 쓰는 것이 공고를 못 찾는 것보다 나쁩니다.

규칙
- 인용(quote)은 페이지에 실제로 있는 문장을 그대로 옮깁니다. 지어내지 않습니다.
- 페이지에 없는 값은 적지 않습니다.
- 자격 판정이나 신청 권유를 하지 않습니다. 확인한 사실만 기록합니다.
- 정부·공공기관·지자체·주관기관의 공식 사이트만 열 수 있고, 페이지 열기는 6회까지입니다.`;

const QUOTE = { type: "string", description: "페이지 원문에 그대로 있는 문장" };

function tools(withSearch: boolean): Record<string, unknown>[] {
  const custom = [
    {
      name: "open_page",
      description: "공식 사이트의 페이지를 열어 본문 텍스트를 받는다. 허용 도메인과 횟수 한도가 있다.",
      input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false },
    },
    {
      name: "record_judgement",
      description: "방금 연 페이지가 이 정책의 공식 공고인지 판단을 기록한다.",
      input_schema: {
        type: "object",
        properties: {
          url: { type: "string" },
          verdict: { type: "string", enum: ["matching_notice", "site_home", "different_program", "error"] },
          reason: { type: "string" },
          quote: QUOTE,
        },
        required: ["url", "verdict", "reason"],
        additionalProperties: false,
      },
    },
    {
      name: "finish",
      description: "검증을 끝낸다. verified_against_notice면 notice_url은 matching_notice로 판단을 기록한 페이지여야 한다.",
      input_schema: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["verified_against_notice", "notice_not_found"] },
          notice_url: { type: ["string", "null"] },
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["status_reference", "status_condition", "age", "lookback", "tenure", "region", "income", "restriction", "application_period"] },
                text: { type: "string" },
                quote: QUOTE,
              },
              required: ["kind", "text", "quote"],
              additionalProperties: false,
            },
          },
          mismatches: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["recruitment_status", "region_scope", "reference_date_wording", "different_program", "notice_only_condition"] },
                api_value: { type: "string" },
                notice_value: { type: "string" },
                quote: QUOTE,
              },
              required: ["kind", "api_value", "notice_value", "quote"],
              additionalProperties: false,
            },
          },
        },
        required: ["outcome", "notice_url", "findings", "mismatches"],
        additionalProperties: false,
      },
    },
  ];
  if (!withSearch) return custom;
  return [...custom, { type: "web_search_20260209", name: "web_search", max_uses: 3, allowed_domains: ["go.kr", "or.kr", "youthcenter.go.kr"] }];
}

export function policyBrief(p: Policy): string {
  const t = p.texts;
  const links = [p.links.apply, p.links.ref, p.links.ref2].filter(Boolean);
  return [
    `정책 번호: ${p.id}`,
    `정책명: ${p.name}`,
    `주관기관: ${p.supervisingOrg}`,
    `API 신청 기간 구분: ${p.applyPeriodType}${p.applyStart ? ` (${p.applyStart} ~ ${p.applyEnd})` : ""}`,
    `API 지역 코드 수: ${p.zipCodes.length}개 (시도 ${new Set(p.zipCodes.map((z) => z.slice(0, 2))).size}곳)`,
    `API 추가 자격: ${t.addQualification || "(없음)"}`,
    `API 참여 제한: ${t.excluded || "(없음)"}`,
    `API 소득 조건: ${t.income || "(없음)"}`,
    `API 지원 내용: ${t.support.slice(0, 1500) || "(없음)"}`,
    `API가 준 링크: ${links.length ? links.join(" , ") : "(없음)"}`,
  ].join("\n");
}

function hostOf(url: string | null): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

/** 정책의 링크 도메인(민간 제외는 web.ts가 강제) */
export function policyHosts(p: Policy): string[] {
  return [p.links.apply, p.links.ref, p.links.ref2].map(hostOf).filter((h): h is string => !!h);
}

type State = {
  trail: TrailStep[];
  judgements: Map<string, PageVerdict>;
  usage: VerifyResult["usage"];
  result: VerifyResult | null;
  limitHit: boolean;
};

function hasQuote(web: Web, urls: string[], quote: string): boolean {
  const q = normalizeSpace(quote);
  return q.length > 0 && urls.some((u) => normalizeSpace(web.pageText(u) ?? "").includes(q));
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { policyId: string; web: Web; state: State; mode: "agent" | "fixed"; openedUrls: string[] },
): Promise<{ content: string; isError?: boolean }> {
  const { web, state } = ctx;
  const step = state.trail.length + 1;
  if (name === "open_page") {
    const url = String(input.url ?? "");
    const r = await web.openPage(url);
    state.trail.push({ step, action: "open", target: url, reason: r.ok ? "열림" : r.text });
    if (r.ok) ctx.openedUrls.push(url);
    if (!r.ok && r.text.includes("한도")) state.limitHit = true;
    return r.ok ? { content: r.text } : { content: r.text, isError: true };
  }
  if (name === "record_judgement") {
    const url = String(input.url ?? "");
    const verdict = input.verdict as PageVerdict;
    const quote = typeof input.quote === "string" ? input.quote : null;
    if (!ctx.openedUrls.includes(url) && verdict !== "error") {
      state.trail.push({ step, action: "reject", target: url, reason: "열지 않은 페이지에 대한 판단" });
      return { content: "먼저 open_page로 그 페이지를 여세요.", isError: true };
    }
    if (quote && !hasQuote(web, [url], quote)) {
      state.trail.push({ step, action: "reject", target: url, reason: "인용이 페이지에 없음" });
      return { content: "인용한 문장이 페이지에 없습니다. 원문 그대로 인용하세요.", isError: true };
    }
    state.judgements.set(url, verdict);
    state.trail.push({ step, action: "judge", target: url, judgement: { verdict, reason: String(input.reason ?? ""), quote }, reason: String(input.reason ?? "") });
    return { content: "기록했습니다." };
  }
  if (name === "finish") {
    const outcome = input.outcome as VerifyResult["outcome"];
    const noticeUrl = (input.notice_url as string | null) ?? null;
    if (outcome === "verified_against_notice") {
      if (!noticeUrl || (ctx.mode === "agent" && state.judgements.get(noticeUrl) !== "matching_notice")) {
        state.trail.push({ step, action: "reject", target: noticeUrl ?? "", reason: "matching_notice로 판단하지 않은 페이지를 근거로 끝내려 함" });
        return { content: "notice_url은 record_judgement에서 matching_notice로 판단한 페이지여야 합니다. 판단을 기록하거나 notice_not_found로 끝내세요.", isError: true };
      }
    }
    const sources = outcome === "verified_against_notice" && noticeUrl ? [noticeUrl] : ctx.openedUrls;
    const findings = ((input.findings as Record<string, string>[]) ?? [])
      .filter((f) => hasQuote(web, sources, f.quote))
      .map((f) => ({ kind: f.kind as FindingKind, text: f.text, quote: f.quote }));
    const mismatches = ((input.mismatches as Record<string, string>[]) ?? [])
      .filter((m) => hasQuote(web, ctx.openedUrls, m.quote))
      .map((m) => ({ kind: m.kind as MismatchKind, apiValue: m.api_value, noticeValue: m.notice_value, quote: m.quote, noticeUrl }));
    state.trail.push({ step, action: "finish", target: noticeUrl ?? "", reason: outcome });
    state.result = {
      policyId: ctx.policyId,
      mode: ctx.mode,
      outcome: outcome === "verified_against_notice" && noticeUrl ? outcome : "notice_not_found",
      noticeUrl: outcome === "verified_against_notice" ? noticeUrl : null,
      findings,
      mismatches,
      trail: state.trail,
      usage: state.usage,
    };
    return { content: "검증을 마쳤습니다." };
  }
  return { content: `알 수 없는 도구: ${name}`, isError: true };
}

async function loop(policyId: string, deps: Deps, mode: "agent" | "fixed", firstMessage: string, maxTurns: number): Promise<VerifyResult> {
  const state: State = { trail: [], judgements: new Map(), usage: { calls: 0, inputTokens: 0, outputTokens: 0, pagesOpened: 0 }, result: null, limitHit: false };
  const openedUrls: string[] = [];
  const toolDefs = mode === "agent" ? tools(!!deps.enableSearch) : tools(false).filter((t) => t.name === "finish");
  const messages: Record<string, unknown>[] = [{ role: "user", content: firstMessage }];
  if (mode === "fixed") {
    // 고정 처리: 첫 링크를 코드가 열어 둔다
    const p = loadSnapshot().policies.find((x) => x.id === policyId)!;
    const first = [p.links.apply, p.links.ref, p.links.ref2].find(Boolean);
    if (first) {
      const r = await deps.web.openPage(first);
      state.trail.push({ step: 1, action: "open", target: first, reason: r.ok ? "열림" : r.text });
      if (r.ok) openedUrls.push(first);
      messages[0] = { role: "user", content: `${firstMessage}\n\n[첫 링크 본문: ${first}]\n${r.text}\n\n이 페이지를 근거로 finish를 호출하세요.` };
    }
  }

  for (let turn = 0; turn < maxTurns && !state.result; turn++) {
    const response = await deps.client.beta.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: toolDefs,
      messages,
    });
    state.usage.calls++;
    state.usage.inputTokens += response.usage?.input_tokens ?? 0;
    state.usage.outputTokens += response.usage?.output_tokens ?? 0;
    if (response.stop_reason === "refusal") {
      state.trail.push({ step: state.trail.length + 1, action: "stop", target: "", reason: "모델이 요청을 거절함" });
      break;
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    for (const b of response.content) {
      if (b.type === "server_tool_use") state.trail.push({ step: state.trail.length + 1, action: "search", target: JSON.stringify(b.input), reason: "웹 검색" });
    }
    if (!uses.length) {
      messages.push({ role: "user", content: "도구를 호출해 진행하거나 finish로 끝내세요." });
      continue;
    }
    const results = [];
    for (const u of uses) {
      const r = await executeTool(u.name, u.input as Record<string, unknown>, { policyId, web: deps.web, state, mode, openedUrls });
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      if (state.result || state.limitHit) break;
    }
    if (state.result || state.limitHit) break;
    messages.push({ role: "user", content: results });
  }

  state.usage.pagesOpened = deps.web.opened();
  if (state.result) {
    state.result.usage = state.usage;
    return state.result;
  }
  state.trail.push({ step: state.trail.length + 1, action: "stop", target: "", reason: state.limitHit ? "탐색 한도 도달" : "단계 한도 도달" });
  return { policyId, mode, outcome: "notice_not_found", noticeUrl: null, findings: [], mismatches: [], trail: state.trail, usage: state.usage };
}

export async function runVerification(policyId: string, deps: Deps): Promise<VerifyResult> {
  const p = loadSnapshot().policies.find((x) => x.id === policyId);
  if (!p) throw new Error(`정책 번호 없음: ${policyId}`);
  return loop(policyId, deps, "agent", `다음 정책을 공식 공고와 대조해 주세요.\n\n${policyBrief(p)}`, MAX_TURNS);
}

/** 비교 실험용 고정 처리: 첫 링크만 열고, 판단·재탐색 없이 한 번에 끝낸다 */
export async function runFixedPipeline(policyId: string, deps: Deps): Promise<VerifyResult> {
  const p = loadSnapshot().policies.find((x) => x.id === policyId);
  if (!p) throw new Error(`정책 번호 없음: ${policyId}`);
  return loop(policyId, deps, "fixed", `다음 정책을 공식 공고와 대조해 주세요.\n\n${policyBrief(p)}`, 2);
}
