import type { SavedPlan } from "./types";
export function comparePlans(a: SavedPlan, b: SavedPlan) {
  const aa = new Map(a.input.choices.map(c => [c.offeringId, c.stageId]));
  const bb = new Map(b.input.choices.map(c => [c.offeringId, c.stageId]));
  return { onlyA: [...aa.keys()].filter(id => !bb.has(id)), onlyB: [...bb.keys()].filter(id => !aa.has(id)),
    both: [...aa.keys()].filter(id => bb.has(id)), moved: [...aa.keys()].filter(id => bb.has(id) && bb.get(id) !== aa.get(id)) };
}
