import { expect, test } from "vitest";
import { PERSONA_A } from "@/lib/judge/personas";
import { applyAnswer } from "@/lib/planner/answers";
import { ProfileSnapshotSchema } from "@/lib/planner/schema";
import type { BenefitQuestion } from "@/lib/planner/types";

const SRC = "20260710005400113256";
const q = (answerKind: BenefitQuestion["answerKind"]): BenefitQuestion => ({
  policyId: "20250122005400110346", sourcePolicyId: SRC, sourceName: "국민취업지원제도",
  ruleId: "test-rule", question: "국민취업지원제도를 받고 있나요?", answerKind,
});

test("not receiving is stored as eligible_unpaid", () => {
  expect(applyAnswer([], q("receiving"), { kind: "not_receiving" })).toEqual([{ policyId: SRC, status: "eligible_unpaid" }]);
});
test("ended answer replaces an earlier receiving row", () => {
  expect(applyAnswer([{ policyId: SRC, status: "receiving" }], q("ended_date"), { kind: "ended", lastPaymentDate: "2026-08-01" })).toEqual([{ policyId: SRC, status: "ended", lastPaymentDate: "2026-08-01" }]);
});
test("saved plan without benefits still loads", () => {
  expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A }).success).toBe(true);
  expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A, benefits: [{ policyId: SRC, status: "receiving" }] }).success).toBe(true);
});
