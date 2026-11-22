// 계정 저장소 클라이언트. createPlanRepository(브라우저 저장)와 같은 세 메서드를 비동기로 제공한다.
// 화면은 fetchMe()가 account면 이 저장소를, guest면 createPlanRepository(localStorage)를 쓴다.
import type { PlanSummary } from "@/lib/account/store";
import { parseSavedPlan } from "./storage";
import type { SavedPlan } from "./types";

export type Me = { mode: "guest" } | { mode: "account"; userId: string; displayName: string; durable: boolean };
type Fetch = typeof fetch;
const MAX_PAGES = 10;

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `요청 실패 (${res.status})`), { status: res.status });
  return body;
}
const post = (fetchFn: Fetch, url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), credentials: "same-origin" });

export async function fetchMe(fetchFn: Fetch = fetch): Promise<Me> {
  return json(await fetchFn("/api/me", { credentials: "same-origin", cache: "no-store" }));
}
export async function signupAccount(email: string, password: string, displayName?: string, fetchFn: Fetch = fetch): Promise<Me> {
  return json(await post(fetchFn, "/api/auth/signup", { email, password, ...(displayName ? { displayName } : {}) }));
}
export async function loginAccount(email: string, password: string, fetchFn: Fetch = fetch): Promise<Me> {
  return json(await post(fetchFn, "/api/auth/login", { email, password }));
}
export async function logoutAccount(fetchFn: Fetch = fetch): Promise<void> {
  await json(await post(fetchFn, "/api/auth/logout", {}));
}

export function createServerPlanRepository(fetchFn: Fetch = fetch) {
  return {
    /** 목록은 요약만 받는다(계획 하나가 판정 결과를 포함해 수 MB). 열 때 getPlan으로 본문을 받는다. */
    async listPlans(): Promise<{ plans: PlanSummary[] }> {
      const plans: PlanSummary[] = []; let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const body: { plans: PlanSummary[]; nextCursor: string | null } = await json(await fetchFn(`/api/plans${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { credentials: "same-origin", cache: "no-store" }));
        plans.push(...body.plans);
        if (!(cursor = body.nextCursor)) break;
      }
      return { plans };
    },
    async getPlan(id: string): Promise<SavedPlan | null> {
      const res = await fetchFn(`/api/plans/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
      if (res.status === 404) return null;
      const plan = parseSavedPlan(await json(res));
      if (!plan) throw new Error("읽을 수 없는 계획이에요.");
      return plan;
    },
    /** 화면이 만든 planId를 재시도 키로 쓴다. 서버가 다시 판정한 저장본을 돌려준다. */
    async createPlan(plan: SavedPlan): Promise<SavedPlan> {
      if (plan.source === "example") throw new Error("예시 계획은 계정에 저장하지 않아요.");
      const { planId } = await json(await post(fetchFn, "/api/plans", {
        name: plan.name, source: plan.source, ...(plan.recommendationSource && { recommendationSource: plan.recommendationSource }),
        profileSnapshot: plan.profileSnapshot, input: plan.input,
      }, { "idempotency-key": plan.planId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100).padEnd(8, "0") }));
      const saved = await this.getPlan(planId);
      if (!saved) throw new Error("저장한 계획을 다시 읽지 못했어요.");
      return saved;
    },
  };
}
