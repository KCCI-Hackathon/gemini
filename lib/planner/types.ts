import type { Profile } from "@/lib/judge/types";

export type Category = "job" | "startup" | "housing" | "edu" | "life";
export const CATEGORIES: Record<Category, { label: string; color: string }> = {
  job: { label: "취업·일자리", color: "#3876BF" }, startup: { label: "창업", color: "#9474B3" },
  housing: { label: "주거", color: "#37877D" }, edu: { label: "교육·학습", color: "#AD7944" }, life: { label: "생활·복지", color: "#B56382" },
};
export const EVENT_NAMES = { training_completion: "수료", employment: "취업", business_registration: "창업", relocation: "이사" };
export type PlanEvent = { id: string; type: keyof typeof EVENT_NAMES; date: string; status: "scheduled" | "completed"; sigungu?: string };
export type Choice = { offeringId: string; stageId: string };
export type AiRecommendation = {
  source: "ai" | "rule";
  summary: string;
  picks: (Choice & { why: string[] })[];
  notice: string | null;
};
export type PlannerInput = { revision: number; events?: PlanEvent[]; choices: Choice[]; mutedKeys: string[]; preferredCategory: Category | "all"; demoId?: "pathfinder-demo-2026" };
export type Stage = { stageId: string; label: string; start: string; endExclusive: string | null; eventIds: string[] };
export type Period = { start: string; end: string | null };
export type OfficialPeriod = { kind: "fixed" | "rolling" | "budget" | "unknown"; start: string | null; end: string | null; closeAt: string | null };
export type Evidence = { evidenceId: string; title: string; quote: string; url: string | null; reviewedAt: string; reviewed: boolean };
export type Rule = { key: "trained" | "unemployed" | "employed" | "in_training" | "business_registered"; kind: "requires" | "excludes"; evidenceId: string; reviewed: boolean };
export type Restriction = { otherId: string; reviewed: boolean; action: "application" | "benefit"; direction: "both" | "outgoing"; period: Period | null; otherPeriod: Period | null; evidenceId: string };
export type Offering = {
  policyId: string; offeringId: string; roundLabel: string; title: string; category: Category;
  summary: string; support: string; org: string; official: OfficialPeriod; rules: Rule[]; evidence: Evidence[];
  verifyLabel?: string | null; regions?: string[]; restrictions: Restriction[]; reviewed: boolean; dataVersion: string;
};
export type Reason = { code: string; message: string; evidenceId?: string; eventId?: string; relatedOfferingId?: string };
export type Card = Offering & {
  verifyLabel: string | null;
  stageId: string; personalWindow: Period | null; stageWindow: Period | null; applicationWindows: Period[];
  deadlineKind: "official" | "personal_estimate" | "rolling" | "unknown" | "closed";
  daysLeft: number | null; availability: "eligible" | "needs_check" | "blocked";
  reasons: Reason[]; selectedStageId: string | null; otherStageIds: string[];
  conflicts: string[]; canReplace: boolean;
};
export type ChoiceWarning = Choice & { title: string; message: string; otherStageIds: string[] };
export type AnswerKind = "receiving" | "selected" | "ended_date" | "monthly_amount";
export type BenefitQuestion = {
  policyId: string; sourcePolicyId: string; sourceName: string;
  ruleId: string; question: string; answerKind: AnswerKind;
};
export type Evaluation = { questions: BenefitQuestion[]; revision: number; today: string; asOf: string; evaluatedAt: string; dataVersion: string; demo: boolean; stages: Stage[]; cards: Card[]; choiceWarnings: ChoiceWarning[]; recommendations: Choice[] };
export type Draft = { draftId: string; profileSnapshot: Profile; input: PlannerInput; evaluation: Evaluation };
export type SavedPlan = { planId: string; schemaVersion: 2; name: string; createdAt: string; source: "manual" | "recommendation" | "example"; recommendationSource?: AiRecommendation["source"]; profileSnapshot: Profile; input: PlannerInput; savedEvaluation: Evaluation };
