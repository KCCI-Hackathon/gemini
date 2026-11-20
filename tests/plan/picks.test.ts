import { expect, test } from "vitest";
import { groupPlanPicks } from "@/app/planner/shared";

test("두 시점에 등장한 같은 정책의 순위는 하나이고 이유는 각각 남는다", () => {
  const picks = groupPlanPicks([
    { label: "지금", items: [{ policyId: "K", why: "개시일 확인" }] },
    { label: "수료 후", items: [{ policyId: "K", why: "수료를 가정" }] },
  ]);
  expect(picks.K).toEqual({ rank: 1, reasons: [
    { station: "지금", why: "개시일 확인" },
    { station: "수료 후", why: "수료를 가정" },
  ] });
});
