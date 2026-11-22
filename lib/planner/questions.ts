import type { BenefitQuestion } from "./types";

/** 같은 규칙도 정책마다 따로 묻는다. */
export const questionKey = (q: BenefitQuestion) => `${q.ruleId}:${q.policyId}`;

/** 에이전트 패널에 보여 줄 질문. 건너뛴 질문은 빼고 다음 것을 고른다. 첫 질문이 안 풀려도 뒤 질문에 닿을 수 있게. */
export function pickQuestion(questions: BenefitQuestion[], skipped: ReadonlySet<string>) {
  const index = questions.findIndex(q => !skipped.has(questionKey(q)));
  const skippedCount = questions.filter(q => skipped.has(questionKey(q))).length;
  return { question: index >= 0 ? questions[index] : null, index: index + 1, total: questions.length, skipped: skippedCount };
}
