import { expect, test } from "vitest";
import { DEMO_PROFILE, DEMO_EVENTS, demoCatalog } from "@/lib/planner/fixtures";
import { evaluatePlanner } from "@/lib/planner/evaluate";
import { applyTarget, validateAnswer } from "@/lib/planner/counsel-target";
import { nextRecommendationQuestion, recommendationQuestionKey } from "@/lib/planner/recommendation-questions";
import type { PlannerInput } from "@/lib/planner/types";

const now = new Date("2026-11-23T12:00:00+09:00");
const input: PlannerInput = { revision: 0, events: DEMO_EVENTS, choices: [], preferredCategory: "all", mutedKeys: [] };
const run = (draftInput: PlannerInput) => evaluatePlanner(DEMO_PROFILE, draftInput, demoCatalog(), now);

test("an unresolved status is asked before the plan, and answering it resolves the prepared question", () => {
  const muted = { ...input, mutedKeys: ["status"] };
  const question = nextRecommendationQuestion(DEMO_PROFILE, muted, run(muted), new Set())!;
  expect(question.target).toEqual({ kind: "status" });
  const next = applyTarget(DEMO_PROFILE, muted, question.target, "training");
  expect(next.input.mutedKeys).not.toContain("status");
  expect(nextRecommendationQuestion(next.profile, next.input, run(next.input), new Set([recommendationQuestionKey(question.target)]))).toBeUndefined();
});

test("even with no actionable condition, the user picks a preferred category before seeing a plan", () => {
  const evaluation = run(input);
  const question = nextRecommendationQuestion(DEMO_PROFILE, input, evaluation, new Set())!;
  expect(question.target).toEqual({ kind: "preferred_category" });
  expect(validateAnswer(question.target, "housing", evaluation.today).ok).toBe(true);
  const next = applyTarget(DEMO_PROFILE, input, question.target, "housing");
  expect(next.input.preferredCategory).toBe("housing");
  expect(nextRecommendationQuestion(next.profile, next.input, run(next.input), new Set([recommendationQuestionKey(question.target)]))).toBeUndefined();
});

test("a remaining benefit question is still asked after status, with the source policy named", () => {
  const evaluation = run(input);
  const first = evaluation.cards.find(card => card.availability !== "blocked")!;
  first.eligibility = "needs_check";
  evaluation.questions = [{
    policyId: first.policyId, sourcePolicyId: "example", sourceName: "청년수당", ruleId: "rule",
    question: "해당 사업의 지원금을 현재 받고 있나요?", answerKind: "receiving",
  }];
  const answered = new Set(["status"]);
  const question = nextRecommendationQuestion(DEMO_PROFILE, input, evaluation, answered)!;
  expect(question.text).toBe("청년수당의 지원금을 현재 받고 있나요?");
  expect(question.target).toEqual({ kind: "benefit", policyId: "example", answer: "receiving" });
  answered.add(recommendationQuestionKey(question.target));
  expect(nextRecommendationQuestion(DEMO_PROFILE, input, evaluation, answered)).toBeUndefined();
});
