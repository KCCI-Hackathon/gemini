// 화면 → /api/plan version 2 (상담 · 추천 에이전트). 서버에 상태가 없으므로 최근 6턴 요약을 실어 보낸다.
import type { CounselBody, CounselFailure } from "@/lib/plan/counsel";
import type { RecommendSession } from "./open-conditions";
import type { Draft } from "./types";

export type CounselTurn = { role: "user" | "assistant"; text: string };
export type CounselResult = CounselBody & { status: number };

export async function requestCounsel(args: {
  draft: Draft; action: "message" | "recommend" | "followup"; message?: string; history: CounselTurn[];
  consent: boolean; outOfScopeStreak: number; recommendSession?: RecommendSession; fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<CounselResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 190_000);
  try {
    const res = await (args.fetcher ?? fetch)("/api/plan", {
      method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({
        version: 2, action: args.action, consent: args.consent, recommendSession: args.recommendSession, profile: args.draft.profileSnapshot, input: args.draft.input,
        ...(args.message ? { message: args.message.slice(0, 500) } : {}), history: args.history.slice(-6).map(h => ({ ...h, text: h.text.slice(0, 500) })), outOfScopeStreak: args.outOfScopeStreak,
      }),
    });
    const body = (await res.json().catch(() => null)) as CounselBody | null;
    // 서버가 JSON 이 아닌 응답(배포 오류 화면 등)을 주면 형식 오류로 본다
    if (!body || typeof body !== "object") return { kind: "none", status: res.status, failure: "bad_response", retryable: true };
    return { ...body, status: res.status };
  } catch {
    return controller.signal.aborted
      ? { kind: "none", status: 0, failure: "client_timeout", retryable: true }
      : { kind: "none", status: 0, failure: "network", retryable: true };
  } finally { clearTimeout(timer); }
}

const FAILURE_TEXT: Record<Exclude<CounselFailure, "consent">, string> = {
  users_off: "지금은 운영 설정으로 실제 사용자 AI 상담이 꺼져 있어 AI 답을 받지 못했어요.",
  not_configured: "AI 제공자가 설정되지 않아 AI 답을 받지 못했어요.",
  quota: "오늘의 AI 사용 한도에 도달해 AI 답을 받지 못했어요. 내일 다시 이용해 주세요.",
  timeout: "AI가 제한 시간 안에 답하지 못했어요.",
  provider: "AI 제공자가 오류를 돌려줘 답을 받지 못했어요.",
  bad_response: "AI 응답 형식이 올바르지 않아 답을 표시하지 못했어요.",
  network: "AI 상담 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.",
  client_timeout: "AI 응답이 너무 오래 걸려 기다리기를 멈췄어요.",
};

/** 실패한 응답이면 화면에 보여 줄 이유와 재시도 가능 여부. 동의 부족은 화면이 따로 처리한다 */
export function counselFailure(result: CounselResult): { failure: CounselFailure; text: string; retryable: boolean } | null {
  const failure = result.failure ?? (result.status >= 500 ? "bad_response" : result.status === 0 ? "network" : undefined);
  if (!failure || failure === "consent") return null;
  const retryable = result.retryable ?? (failure !== "users_off" && failure !== "not_configured" && failure !== "quota");
  return { failure, text: FAILURE_TEXT[failure] + (retryable ? " 잠시 뒤 ‘다시 시도’를 눌러 주세요." : ""), retryable };
}
