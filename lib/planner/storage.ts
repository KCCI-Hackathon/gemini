import type { Draft, SavedPlan } from "./types";
import { EvaluationSchema, PlannerInputSchema, ProfileSnapshotSchema } from "./schema";
const PREFIX = "pathfinder.plans.v2:";
export const DRAFT_KEY = "pathfinder.draft.v2";
/**
 * 저장 계획을 읽는 경계. 이전 버전 레코드의 빠진 칸(예: 카드의 verifyLabel)을 스키마 기본값으로 채운 "정규화된" 값을 돌려준다.
 * 검사만 하고 원본을 돌려주면 옛 레코드가 화면에서 undefined 칸을 만난다.
 */
export function parseSavedPlan(value: unknown): SavedPlan | null {
  if (!value || typeof value !== "object") return null;
  const plan = value as SavedPlan;
  if (plan.schemaVersion !== 2 || typeof plan.planId !== "string" || typeof plan.name !== "string" || typeof plan.createdAt !== "string") return null;
  const profile = ProfileSnapshotSchema.safeParse(plan.profileSnapshot);
  const input = PlannerInputSchema.safeParse(plan.input);
  const evaluation = EvaluationSchema.safeParse(plan.savedEvaluation);
  if (!profile.success || !input.success || !evaluation.success) return null;
  return { ...plan, savedEvaluation: evaluation.data as SavedPlan["savedEvaluation"] };
}
export function isSavedPlan(value: unknown): value is SavedPlan { return parseSavedPlan(value) !== null; }
/** 탭 초안을 읽는 경계. 저장 계획과 같은 규칙으로 정규화한다. 깨진 값은 null. */
export function parseDraft(raw: string | null): Draft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as Draft;
    if (!draft || typeof draft !== "object" || typeof draft.draftId !== "string") return null;
    const plan = parseSavedPlan({ planId: draft.draftId, schemaVersion: 2, name: "복원", createdAt: "", profileSnapshot: draft.profileSnapshot, input: draft.input, savedEvaluation: draft.evaluation });
    return plan ? { ...draft, evaluation: plan.savedEvaluation } : null;
  } catch { return null; }
}
export function createPlanRepository(storage: Storage) {
  return {
    listPlans(): { plans: SavedPlan[]; unreadable: number } {
      const plans: SavedPlan[] = []; let unreadable = 0;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        try { const record = parseSavedPlan(JSON.parse(storage.getItem(key) ?? "null")); if (record && `${PREFIX}${record.planId}` === key) plans.push(record); else unreadable++; } catch { unreadable++; }
      }
      return { plans: plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.planId.localeCompare(b.planId)), unreadable };
    },
    getPlan(id: string): SavedPlan | null { const text = storage.getItem(`${PREFIX}${id}`); if (!text) return null; const data = parseSavedPlan(JSON.parse(text)); if (!data) throw new Error("읽을 수 없는 계획이에요."); return data; },
    createPlan(plan: SavedPlan): SavedPlan { if (!isSavedPlan(plan)) throw new Error("계획 형식이 잘못됐어요."); if (storage.getItem(`${PREFIX}${plan.planId}`)) throw new Error("같은 계획 ID가 이미 있어요."); storage.setItem(`${PREFIX}${plan.planId}`, JSON.stringify(plan)); return structuredClone(plan); },
  };
}
export function readLegacyPolicies(storage: Storage): string[] {
  try { const ids: unknown = JSON.parse(storage.getItem("galimgil.mine.v1") ?? "[]"); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []; } catch { return []; }
}
export function readLegacySitePlans(storage: Storage): { sourceId: string; name: string; needsReselection: boolean }[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem("pathfinder-selection-plans-v1") ?? "[]");
    const entries: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" && "plans" in raw && Array.isArray(raw.plans) ? raw.plans : [];
    return entries.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      return [{ sourceId: typeof record.id === "string" ? record.id : `legacy-site-${index}`, name: typeof record.name === "string" ? record.name : "이전에 저장한 계획", needsReselection: true }];
    });
  } catch { return []; }
}
