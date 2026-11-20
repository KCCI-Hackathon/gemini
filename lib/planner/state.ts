import type { Profile } from "@/lib/judge/types";
import type { Choice, Draft, Evaluation, PlanEvent, PlannerInput, SavedPlan } from "./types";
export const newId = () => globalThis.crypto.randomUUID();
export const createDraft = (profile: Profile, input: PlannerInput, evaluation: Evaluation): Draft => ({ draftId: newId(), profileSnapshot: structuredClone(profile), input: structuredClone(input), evaluation: structuredClone(evaluation) });
export function changeEvents(draft: Draft, events: PlanEvent[], history: PlanEvent[][]) {
  return { draft: { ...draft, input: { ...draft.input, revision: draft.input.revision + 1, events: structuredClone(events) } }, history: [...history, structuredClone(draft.input.events ?? [])] };
}
export function undoEvents(draft: Draft, history: PlanEvent[][]) {
  if (!history.length) return { draft, history };
  return { draft: { ...draft, input: { ...draft.input, revision: draft.input.revision + 1, events: structuredClone(history[history.length - 1]) } }, history: history.slice(0, -1) };
}
export const acceptRevision = (latest: number, response: { revision: number }) => latest === response.revision;
export const applySavedRecheck = (selectedPlanId: string, response: { planId: string; evaluation: Evaluation }): Evaluation | null => selectedPlanId === response.planId ? response.evaluation : null;
export function preserveMissingChoices(previous: Evaluation, next: Evaluation, choices: Choice[]): Evaluation {
  const result = structuredClone(next);
  for (const choice of choices) {
    if (result.cards.some(c => c.offeringId === choice.offeringId && c.stageId === choice.stageId)) continue;
    const prior = previous.cards.find(c => c.offeringId === choice.offeringId && c.stageId === choice.stageId);
    if (!prior) continue;
    const missingOffering = !result.cards.some(c => c.offeringId === choice.offeringId);
    const message = missingOffering ? "공고 조회 불가 · 저장 당시 정책명과 날짜를 보존했어요" : "시점 다시 선택 · 원래 담은 시점을 찾을 수 없어요";
    result.cards.push({ ...prior, availability: "blocked", deadlineKind: "unknown", daysLeft: null, selectedStageId: choice.stageId, canReplace: false, conflicts: [], applicationWindows: [], reasons: [{ code: missingOffering ? "MISSING_OFFERING" : "MISSING_STAGE", message }] });
    result.choiceWarnings = result.choiceWarnings.filter(w => w.offeringId !== choice.offeringId);
    result.choiceWarnings.push({ ...choice, title: prior.title, message, otherStageIds: result.cards.filter(c => c.offeringId === choice.offeringId && c.availability !== "blocked").map(c => c.stageId) });
  }
  return result;
}
export function withChoices(evaluation: Evaluation, choices: Choice[]): Evaluation {
  const result = structuredClone(evaluation);
  for (const card of result.cards) card.selectedStageId = choices.find(c => c.offeringId === card.offeringId)?.stageId ?? null;
  result.choiceWarnings = result.choiceWarnings.filter(w => choices.some(c => c.offeringId === w.offeringId));
  return result;
}
export function recommendationDiff(manual: Choice[], recommended: Choice[]) {
  return { added: recommended.filter(r => !manual.some(m => m.offeringId === r.offeringId)).map(c => c.offeringId), removed: manual.filter(m => !recommended.some(r => r.offeringId === m.offeringId)).map(c => c.offeringId), moved: recommended.filter(r => manual.some(m => m.offeringId === r.offeringId && m.stageId !== r.stageId)).map(c => c.offeringId) };
}
export function savedSnapshot(draft: Draft, name: string, source: SavedPlan["source"]): SavedPlan {
  const clean = name.trim();
  if (clean.length < 1 || Array.from(clean).length > 35) throw new Error("이름은 1~35자로 입력해 주세요.");
  if (!draft.input.choices.length) throw new Error("정책을 하나 이상 담아 주세요.");
  if (draft.evaluation.revision !== draft.input.revision) throw new Error("최신 판정이 끝난 뒤 저장해 주세요.");
  return structuredClone({ planId: newId(), schemaVersion: 2 as const, name: clean, createdAt: new Date().toISOString(), source, profileSnapshot: draft.profileSnapshot, input: draft.input, savedEvaluation: draft.evaluation });
}
