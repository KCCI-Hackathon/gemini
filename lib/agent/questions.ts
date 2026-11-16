import type { JudgedPolicy } from "@/lib/judge";

export type Question = {
  key: string;
  question: string;
  options: string[];
  relatedCount: number;
  mayChangeCount: number;
  stillOpenCount: number;
};

const NATIONAL = "20260710005400113256";

type QuestionDef = { key: string; question: string; options: string[]; related: (r: JudgedPolicy) => boolean };

/** 이번 범위의 질문은 하나(설계 5장 ⑤). 목록 구조로 두어 늘릴 수 있게 한다 */
const DEFS: QuestionDef[] = [
  {
    key: "participating_national_employment_support",
    question: "국민취업지원제도에 참여 중인가요?",
    options: ["예", "아니오", "모름"],
    related: (r) =>
      r.axes.restriction.quotes.some((q) => q.includes("국민취업지원")) ||
      r.policy.texts.excluded.includes("국민취업지원") ||
      r.policy.id === NATIONAL,
  },
];

/** 답하면 판정이 바뀔 수 있는 정책 수가 많은 질문부터 */
export function rankOpenQuestions(results: JudgedPolicy[], defs: QuestionDef[] = DEFS): Question[] {
  return defs
    .map((d) => {
      const related = results.filter((r) => r.layer !== "history" && d.related(r));
      const mayChange = related.filter((r) => r.axes.personal.value !== "ineligible");
      return {
        key: d.key,
        question: d.question,
        options: d.options,
        relatedCount: related.length,
        mayChangeCount: mayChange.length,
        stillOpenCount: related.length - mayChange.length,
      };
    })
    .filter((q) => q.relatedCount > 0)
    .sort((a, b) => b.mayChangeCount - a.mayChangeCount || a.stillOpenCount - b.stillOpenCount);
}
