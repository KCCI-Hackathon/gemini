import type { SavedPlan } from "./types";
import { EvaluationSchema, PlannerInputSchema, ProfileSnapshotSchema } from "./schema";
const PREFIX = "pathfinder.plans.v2:";
export const DRAFT_KEY = "pathfinder.draft.v2";
export function isSavedPlan(value: unknown): value is SavedPlan {
  if (!value || typeof value !== "object") return false;
  const plan = value as SavedPlan;
  return plan.schemaVersion === 2 && typeof plan.planId === "string" && typeof plan.name === "string" && typeof plan.createdAt === "string" && ProfileSnapshotSchema.safeParse(plan.profileSnapshot).success && PlannerInputSchema.safeParse(plan.input).success && EvaluationSchema.safeParse(plan.savedEvaluation).success;
}
export function createPlanRepository(storage: Storage) {
  return {
    listPlans(): { plans: SavedPlan[]; unreadable: number } {
      const plans: SavedPlan[] = []; let unreadable = 0;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        try { const record: unknown = JSON.parse(storage.getItem(key) ?? "null"); if (isSavedPlan(record) && `${PREFIX}${record.planId}` === key) plans.push(record); else unreadable++; } catch { unreadable++; }
      }
      return { plans: plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.planId.localeCompare(b.planId)), unreadable };
    },
    getPlan(id: string): SavedPlan | null { const text = storage.getItem(`${PREFIX}${id}`); if (!text) return null; const data: unknown = JSON.parse(text); if (!isSavedPlan(data)) throw new Error("읽을 수 없는 계획이에요."); return data; },
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
