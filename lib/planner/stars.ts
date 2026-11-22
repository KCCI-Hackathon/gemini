export const STAR_KEY = "pathfinder.stars.v1";
export function createStarStore(storage: Storage) {
  let ids: string[] = [];
  try { const value: unknown = JSON.parse(storage.getItem(STAR_KEY) ?? "[]"); if (Array.isArray(value)) ids = [...new Set(value.filter((id): id is string => typeof id === "string" && !!id))]; } catch { /* Storage remains usable in memory. */ }
  return {
    list: () => [...ids],
    has: (policyId: string) => ids.includes(policyId),
    toggle(policyId: string) {
      ids = ids.includes(policyId) ? ids.filter(id => id !== policyId) : [...ids, policyId];
      try { storage.setItem(STAR_KEY, JSON.stringify(ids)); } catch { /* Keep the current session usable. */ }
      return ids.includes(policyId);
    },
  };
}
