// 정책 검증 에이전트: 관찰 → 판단 → 행동 → 재평가 루프(설계 5장 ②)
// 요청에는 정책 번호와 공개 데이터만 들어간다. 사용자 정보는 이 모듈에 들어오지 않는다.

import type Anthropic from "@anthropic-ai/sdk";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified, type Round } from "@/lib/data/verified";
import { containsNoticeDate, supportsComparedValue, supportsEvidence } from "./evidence";
import { verificationVersion, type VerifyVersion } from "./version";
import type { Policy } from "@/lib/data/types";
import { pickRound } from "@/lib/judge/rules";
import { toKstDate } from "@/lib/date";
import { normalizeSpace, type Web } from "./web";

const ymdOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** API 쪽 값. 날짜·숫자 항목은 코드가 비교할 수 있게 정해진 형식으로 */
function apiValueOf(field: FieldCheck["field"], p: Policy): string {
  switch (field) {
    case "apply_period":
      return p.applyPeriodType === "always" ? "상시" : `${p.applyStart ?? ""}~${p.applyEnd ?? ""}`;
    case "biz_period":
      return p.bizEnd ?? "";
    case "age":
      return `${p.minAge ?? ""}~${p.maxAge ?? ""}`;
    case "region":
      return p.zipCodes.join(",");
    case "status_school_special":
      return [...p.jobCodes, ...p.schoolCodes, ...p.specialCodes].join(",");
    case "income":
      return p.texts.income;
    case "support":
      return p.texts.support.slice(0, 200);
    case "extra_conditions":
      return `${p.texts.addQualification} ${p.texts.excluded}`.trim().slice(0, 200);
    case "apply_link":
      return p.links.apply ?? "";
  }
}

/** 인용이 원문에 없으면 notice_not_found. 신청기간·연령은 AI가 뽑은 값을 코드가 비교해 상태를 정한다 */
function toFieldCheck(f: Record<string, unknown>, p: Policy, quoted: (q: string) => boolean): FieldCheck[] {
  const field = String(f.field) as FieldCheck["field"];
  if (!(FIELDS as readonly string[]).includes(field)) return [];
  const noticeValue = String(f.notice_value ?? "").replace(/\s+/g, "");
  const quote = typeof f.quote === "string" ? f.quote : "";
  const apiValue = apiValueOf(field, p);
  let status = (["match", "differs", "not_in_notice"].includes(String(f.status)) ? f.status : "notice_not_found") as FieldCheck["status"];
  if (status !== "not_in_notice" && (!quote || !quoted(quote) || !supportsComparedValue(field, quote, noticeValue))) status = "notice_not_found";
  else if (status !== "not_in_notice" && (field === "apply_period" || field === "biz_period" || field === "age" || field === "apply_link")) status = noticeValue === apiValue.replace(/\s+/g, "") ? "match" : "differs";
  const supported = status === "match" || status === "differs";
  return [{ field, status, apiValue, noticeValue: supported ? noticeValue : "", quote: supported ? quote : "" }];
}

export type AnthropicLike = {
  beta: { messages: { create(params: Record<string, unknown>): Promise<Anthropic.Beta.BetaMessage> } };
};

export const VERIFY_MODEL = process.env.VERIFY_MODEL ?? "claude-opus-5-5";
// 열기 6 + 판단 6 + finish 1 + 거부·재시도 여유
const MAX_TURNS = 16;
const MAX_SEARCHES = 3;
/** 설계 5장: 정책 하나에 60초. 넘기면 새 호출을 하지 않는다 */
export const DEFAULT_DEADLINE_MS = 60_000;
const VERDICTS: PageVerdict[] = ["matching_notice", "site_home", "different_program", "error"];

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

/** 항목별 대조(통합 설계 4.2). 판정 근거와는 다른 질문: "API 값이 공고와 같은가" */
export const FIELDS = ["apply_period", "biz_period", "age", "region", "status_school_special", "income", "support", "extra_conditions", "apply_link"] as const;
export type FieldCheck = {
  field: (typeof FIELDS)[number];
  status: "match" | "differs" | "not_in_notice" | "notice_not_found";
  apiValue: string;
  noticeValue: string;
  quote: string;
};
/** 대조한 공고의 연도·회차 */
export type NoticeRound = { year: number; round: string; title: string; applyStart: string | null; applyEnd: string | null };

export type VerifyResult = {
  policyId: string;
  version?: VerifyVersion;
  mode: "agent" | "fixed";
  outcome: "verified_against_notice" | "notice_not_found";
  noticeUrl: string | null;
  findings: Finding[];
  mismatches: Mismatch[];
  trail: TrailStep[];
  usage: { calls: number; inputTokens: number; outputTokens: number; pagesOpened: number };
  fieldChecks?: FieldCheck[];
  /** 사람이 항목별 대조를 원문과 확인했으면 기록한다(검증 표시 '공고 항목 확인됨') */
  fieldChecksConfirmed?: { by: "human"; at: string };
  notice?: NoticeRound | null;
  /** 대조한 날(KST). 7일이 지나면 준비 단계에서 다시 대조한다 */
  checkedAt?: string;
  /** 서비스 안의 에이전트(Claude API)가 아니라 개발 도구가 같은 루프로 사전 실행한 결과면 표시한다 */
  producedBy?: "claude_code_session";
};

type Deps = { client: AnthropicLike; web: Web; now: Date; enableSearch?: boolean; deadlineMs?: number; clock?: () => number };

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
- 인용은 해당 조건과 대조값을 직접 뒷받침해야 합니다. 문의처나 관련 없는 안내 문구는 근거로 쓰지 않습니다.
- 페이지에 없는 값은 적지 않습니다.
- 자격 판정이나 신청 권유를 하지 않습니다. 확인한 사실만 기록합니다.
- 정부·공공기관·지자체·주관기관의 공식 사이트만 열 수 있고, 페이지 열기는 6회까지입니다.`;

const QUOTE = { type: "string", description: "페이지 원문에 그대로 있는 문장" };

function tools(searchesLeft: number): Record<string, unknown>[] {
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
                source_url: { type: "string", description: "인용 출처. different_program일 때는 열린 다른 사업 주소를 지정" },
                api_value: { type: "string" },
                notice_value: { type: "string" },
                quote: QUOTE,
              },
              required: ["kind", "api_value", "notice_value", "quote"],
              additionalProperties: false,
            },
          },
          field_checks: {
            type: "array",
            description: "API 항목과 공고 값의 항목별 대조. 신청기간은 YYYY-MM-DD~YYYY-MM-DD, 연령은 최소~최대 숫자로 notice_value에 적는다",
            items: {
              type: "object",
              properties: {
                field: { type: "string", enum: [...FIELDS] },
                status: { type: "string", enum: ["match", "differs", "not_in_notice"] },
                notice_value: { type: "string" },
                quote: QUOTE,
              },
              required: ["field", "status", "notice_value"],
              additionalProperties: false,
            },
          },
          notice: {
            type: ["object", "null"],
            description: "대조한 공고의 연도·회차·제목·신청기간",
            properties: { year: { type: "integer" }, round: { type: "string" }, title: { type: "string" }, apply_start: { type: ["string", "null"] }, apply_end: { type: ["string", "null"] } },
            required: ["year", "round", "title"],
            additionalProperties: false,
          },
        },
        required: ["outcome", "notice_url", "findings", "mismatches"],
        additionalProperties: false,
      },
    },
  ];
  if (searchesLeft <= 0) return custom;
  // max_uses는 요청 한 번당이라, 정책 전체 3회를 지키려고 남은 횟수를 매번 넣는다
  return [...custom, { type: "web_search_20260209", name: "web_search", max_uses: searchesLeft, allowed_domains: ["go.kr", "or.kr", "gov.kr", "korea.kr"] }];
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

function hasQuote(web: Web, urls: string[], quote: unknown): boolean {
  if (typeof quote !== "string") return false;
  const q = normalizeSpace(quote);
  return q.length > 0 && urls.some((u) => normalizeSpace(web.pageText(u) ?? "").includes(q));
}

const LIMIT_MESSAGE = "페이지 열기 한도에 도달했습니다. 더 열 수 없습니다. 지금까지 연 페이지로 record_judgement를 마치고 finish로 끝내세요.";

/** 모델이 준 배열 입력: 배열이 아니거나 객체가 아닌 항목은 버린다 */
function asObjects(x: unknown): Record<string, unknown>[] {
  return Array.isArray(x) ? x.filter((i): i is Record<string, unknown> => !!i && typeof i === "object") : [];
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: { policy: Policy; rounds: Round[]; activeRound: Round | null; version: VerifyVersion; web: Web; state: State; mode: "agent" | "fixed"; openedUrls: string[]; now: Date },
): Promise<{ content: string; isError?: boolean }> {
  const { web, state } = ctx;
  const step = state.trail.length + 1;
  if (name === "open_page") {
    const url = String(input.url ?? "");
    if (state.limitHit) return { content: LIMIT_MESSAGE, isError: true };
    const r = await web.openPage(url);
    state.trail.push({ step, action: "open", target: url, reason: r.ok ? "열림" : r.text });
    if (r.ok) ctx.openedUrls.push(url);
    if (!r.ok && r.text.includes("한도")) state.limitHit = true;
    if (state.limitHit) return { content: LIMIT_MESSAGE, isError: true };
    return r.ok ? { content: r.text } : { content: r.text, isError: true };
  }
  if (name === "record_judgement") {
    const url = String(input.url ?? "");
    const verdict = input.verdict as PageVerdict;
    const quote = typeof input.quote === "string" ? input.quote : null;
    if (!VERDICTS.includes(verdict)) {
      state.trail.push({ step, action: "reject", target: url, reason: "알 수 없는 판단 값" });
      return { content: `verdict는 ${VERDICTS.join(", ")} 중 하나여야 합니다.`, isError: true };
    }
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
    const noticeUrl = typeof input.notice_url === "string" ? input.notice_url : null;
    if (outcome !== "verified_against_notice" && outcome !== "notice_not_found") {
      return { content: "outcome은 verified_against_notice 또는 notice_not_found여야 합니다.", isError: true };
    }
    if (outcome === "verified_against_notice") {
      if (!noticeUrl || !ctx.openedUrls.includes(noticeUrl) || (ctx.mode === "agent" && state.judgements.get(noticeUrl) !== "matching_notice")) {
        state.trail.push({ step, action: "reject", target: noticeUrl ?? "", reason: "matching_notice로 판단하지 않은 페이지를 근거로 끝내려 함" });
        return { content: "notice_url은 record_judgement에서 matching_notice로 판단한 페이지여야 합니다. 판단을 기록하거나 notice_not_found로 끝내세요.", isError: true };
      }
    }
    const sourceUrl = outcome === "verified_against_notice" ? noticeUrl : null;
    const quoted = (quote: unknown, declaredUrl?: unknown) =>
      sourceUrl !== null && (declaredUrl === undefined || declaredUrl === sourceUrl) && hasQuote(web, [sourceUrl], quote);
    const n = sourceUrl && input.notice && typeof input.notice === "object" ? (input.notice as Record<string, unknown>) : null;
    const candidate: NoticeRound | null =
      n && typeof n.year === "number" ? { year: n.year, round: String(n.round ?? ""), title: String(n.title ?? ""), applyStart: ymdOrNull(n.apply_start), applyEnd: ymdOrNull(n.apply_end) } : null;
    const pageText = sourceUrl ? web.pageText(sourceUrl) ?? "" : "";
    const notice = candidate && quoted(candidate.title)
      && (candidate.title.includes(String(candidate.year)) || [candidate.applyStart, candidate.applyEnd].some((date) => date?.startsWith(`${candidate.year}-`)))
      && (quoted(candidate.round) || (candidate.round === `${candidate.year}년` && [candidate.applyStart, candidate.applyEnd].some((date) => date?.startsWith(`${candidate.year}-`))))
      && [candidate.applyStart, candidate.applyEnd].every((date) => date === null || containsNoticeDate(pageText, date))
      ? candidate : null;
    const known = ctx.rounds.filter((round) => round.notice.url === sourceUrl);
    const identified = notice && known.find((round) => round.notice.year === notice.year && round.notice.round === notice.round);
    const matchedActive = known.some((round) => round.id === ctx.activeRound?.id);
    if (sourceUrl && (ctx.version.roundKey === null || (known.length > 0 && !matchedActive)
      || (identified && identified.id !== ctx.activeRound?.id) || (known.length > 1 && !identified))) {
      state.trail.push({ step, action: "reject", target: sourceUrl, reason: "현재 모집 회차의 공고를 확인할 수 없음" });
      return { content: "현재 모집 회차의 공식 공고를 찾거나 notice_not_found로 끝내세요.", isError: true };
    }
    // 공고를 못 찾았으면 발견은 내보내지 않는다: 다른 사업 페이지의 문장이 "공고 기준"으로 보이면 안 된다
    const findings = sourceUrl
      ? asObjects(input.findings)
          .filter((f) => typeof f.quote === "string" && quoted(f.quote, f.source_url) && supportsEvidence(String(f.kind), f.quote))
          .map((f) => ({ kind: String(f.kind) as FindingKind, text: String(f.text ?? ""), quote: String(f.quote) }))
      : [];
    const mismatches = asObjects(input.mismatches).flatMap((m): Mismatch[] => {
      if (typeof m.quote !== "string") return [];
      const kind = String(m.kind) as MismatchKind;
      let quoteUrl = sourceUrl;
      if (kind === "different_program") {
        const pages = [...state.judgements].filter(([url, verdict]) => verdict === "different_program"
          && (m.source_url === undefined || m.source_url === url) && hasQuote(web, [url], m.quote));
        if (pages.length !== 1) return [];
        quoteUrl = pages[0][0];
      } else if ((m.source_url !== undefined && m.source_url !== sourceUrl) || !quoted(m.quote) || !supportsEvidence(kind, m.quote)) {
        return [];
      }
      return [{ kind, apiValue: String(m.api_value ?? ""), noticeValue: String(m.notice_value ?? ""), quote: m.quote, noticeUrl: quoteUrl }];
    });
    const fieldChecks = sourceUrl ? asObjects(input.field_checks).flatMap((f) =>
      toFieldCheck(f, ctx.policy, (quote) => quoted(quote, f.source_url)
        && (f.field !== "apply_link" || (typeof f.notice_value === "string" && ctx.openedUrls.includes(f.notice_value.trim()))))) : [];
    state.trail.push({ step, action: "finish", target: noticeUrl ?? "", reason: outcome });
    state.result = {
      policyId: ctx.policy.id,
      version: ctx.version,
      mode: ctx.mode,
      outcome: outcome === "verified_against_notice" && noticeUrl ? outcome : "notice_not_found",
      noticeUrl: outcome === "verified_against_notice" ? noticeUrl : null,
      findings,
      mismatches,
      fieldChecks,
      notice,
      checkedAt: toKstDate(ctx.now),
      trail: state.trail,
      usage: state.usage,
    };
    return { content: "검증을 마쳤습니다." };
  }
  return { content: `알 수 없는 도구: ${name}`, isError: true };
}

async function loop(policy: Policy, deps: Deps, mode: "agent" | "fixed", firstMessage: string, maxTurns: number): Promise<VerifyResult> {
  const state: State = { trail: [], judgements: new Map(), usage: { calls: 0, inputTokens: 0, outputTokens: 0, pagesOpened: 0 }, result: null, limitHit: false };
  const openedUrls: string[] = [];
  const clock = deps.clock ?? Date.now;
  const startedAt = clock();
  const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const verified = loadVerified().get(policy.id);
  const rounds = verified?.rounds ?? [];
  const date = toKstDate(deps.now);
  const selected = rounds.length ? pickRound(rounds, date) : null;
  const activeRound = selected?.state === "outside" ? null : selected?.round ?? null;
  const version = verificationVersion(policy, verified, date);
  let searches = 0;
  let stopReason = "단계 한도 도달";
  const toolDefs = () => (mode === "agent" ? tools(deps.enableSearch ? MAX_SEARCHES - searches : 0) : tools(0).filter((t) => t.name === "finish"));
  const messages: Record<string, unknown>[] = [{ role: "user", content: firstMessage }];
  if (mode === "fixed") {
    // 고정 처리: 첫 링크를 코드가 열어 둔다
    const first = [policy.links.apply, policy.links.ref, policy.links.ref2].find(Boolean);
    if (first) {
      const r = await deps.web.openPage(first);
      state.trail.push({ step: 1, action: "open", target: first, reason: r.ok ? "열림" : r.text });
      if (r.ok) openedUrls.push(first);
      messages[0] = { role: "user", content: `${firstMessage}\n\n[첫 링크 본문: ${first}]\n${r.text}\n\n이 페이지를 근거로 finish를 호출하세요.` };
    }
  }

  for (let turn = 0; turn < maxTurns && !state.result; turn++) {
    if (clock() - startedAt > deadlineMs) {
      stopReason = "시간 한도 도달";
      break;
    }
    const response = await deps.client.beta.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: toolDefs(),
      messages,
    });
    state.usage.calls++;
    state.usage.inputTokens += response.usage?.input_tokens ?? 0;
    state.usage.outputTokens += response.usage?.output_tokens ?? 0;
    if (response.stop_reason === "refusal") {
      stopReason = "모델이 요청을 거절함";
      break;
    }
    for (const b of response.content) {
      if (b.type === "server_tool_use") {
        searches++;
        state.trail.push({ step: state.trail.length + 1, action: "search", target: JSON.stringify(b.input), reason: "웹 검색" });
      }
    }
    if (!response.content.length) {
      stopReason = "모델이 빈 응답을 보냄";
      break;
    }
    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason === "pause_turn") continue;
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      messages.push({ role: "user", content: "도구를 호출해 진행하거나 finish로 끝내세요." });
      continue;
    }
    const results = [];
    for (const u of uses) {
      const r = await executeTool(u.name, u.input as Record<string, unknown>, { policy, rounds, activeRound, version, web: deps.web, state, mode, openedUrls, now: deps.now });
      results.push({ type: "tool_result", tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      if (state.result) break;
    }
    if (state.result) break;
    // 단계 한도가 가까우면 finish할 차례를 남기도록 알린다
    const content: Record<string, unknown>[] = [...results];
    if (turn === maxTurns - 3) content.push({ type: "text", text: "단계 한도가 가깝습니다. 다음 응답에서 finish로 끝내세요." });
    messages.push({ role: "user", content });
  }

  state.usage.pagesOpened = deps.web.opened();
  if (state.result) {
    state.result.usage = state.usage;
    return state.result;
  }
  state.trail.push({ step: state.trail.length + 1, action: "stop", target: "", reason: stopReason });
  return { policyId: policy.id, version, mode, outcome: "notice_not_found", noticeUrl: null, findings: [], mismatches: [], fieldChecks: [], notice: null, checkedAt: toKstDate(deps.now), trail: state.trail, usage: state.usage };
}

export async function runVerification(policyId: string, deps: Deps): Promise<VerifyResult> {
  const p = loadSnapshot().policies.find((x) => x.id === policyId);
  if (!p) throw new Error(`정책 번호 없음: ${policyId}`);
  return loop(p, deps, "agent", `다음 정책을 공식 공고와 대조해 주세요.\n\n${policyBrief(p)}`, MAX_TURNS);
}

/** 비교 실험용 고정 처리: 첫 링크만 열고, 판단·재탐색 없이 한 번에 끝낸다 */
export async function runFixedPipeline(policyId: string, deps: Deps): Promise<VerifyResult> {
  const p = loadSnapshot().policies.find((x) => x.id === policyId);
  if (!p) throw new Error(`정책 번호 없음: ${policyId}`);
  return loop(p, deps, "fixed", `다음 정책을 공식 공고와 대조해 주세요.\n\n${policyBrief(p)}`, 2);
}
