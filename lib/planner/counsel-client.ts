// 화면 → /api/plan version 2 (상담 · 추천 에이전트). 서버에 상태가 없으므로 최근 6턴 요약을 실어 보낸다.
import type { CounselBody } from "@/lib/plan/counsel";
import type { Draft } from "./types";

export type CounselTurn = { role: "user" | "assistant"; text: string };
export type CounselResult = CounselBody & { status: number };

export async function requestCounsel(args: {
  draft: Draft; action: "message" | "recommend" | "followup"; message?: string; history: CounselTurn[];
  consent: boolean; outOfScopeStreak: number; questionnaireComplete?: boolean; fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<CounselResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 60_000);
  try {
    const res = await (args.fetcher ?? fetch)("/api/plan", {
      method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
      body: JSON.stringify({
        version: 2, action: args.action, consent: args.consent, questionnaireComplete: args.questionnaireComplete, profile: args.draft.profileSnapshot, input: args.draft.input,
        ...(args.message ? { message: args.message.slice(0, 500) } : {}), history: args.history.slice(-6).map(h => ({ ...h, text: h.text.slice(0, 500) })), outOfScopeStreak: args.outOfScopeStreak,
      }),
    });
    const body = (await res.json().catch(() => ({ kind: "none", error: "응답을 읽지 못했어요." }))) as CounselBody;
    return { ...body, status: res.status };
  } catch {
    return { kind: "none", status: 0, error: "AI 상담에 연결하지 못했어요. 조건 기준 결과는 그대로 쓸 수 있어요." };
  } finally { clearTimeout(timer); }
}
