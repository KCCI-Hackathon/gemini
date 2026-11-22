import type { Card, Stage } from "./types";

type BoardCard = Pick<Card, "offeringId" | "stageId" | "availability" | "selectedStageId">;

export function selectBoardCards<T extends BoardCard>(stages: Pick<Stage, "stageId">[], cards: T[]): T[] {
  const byStage = new Map(stages.map(stage => [stage.stageId, new Map<string, T>()]));
  for (const card of cards) byStage.get(card.stageId)?.set(card.offeringId, card);
  const previousStage = new Map(stages.slice(1).map((stage, index) => [stage.stageId, stages[index].stageId]));
  return cards.filter(card => {
    const priorStageId = previousStage.get(card.stageId);
    if (card.stageId === stages[0]?.stageId || card.selectedStageId === card.stageId) return true;
    if (!priorStageId || card.availability === "blocked") return false;
    const prior = byStage.get(priorStageId)?.get(card.offeringId);
    return !prior || prior.availability === "blocked";
  });
}
