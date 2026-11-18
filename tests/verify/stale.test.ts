import { expect, test } from "vitest";
import { staleResults } from "@/lib/verify/saved";
import type { VerifyResult } from "@/lib/verify/run";

const r = (policyId: string, checkedAt?: string) => ({ policyId, checkedAt }) as VerifyResult;

test("대조일이 없거나 7일이 지난 저장 결과만 다시 대조한다", () => {
  const all = { a: r("a", "2026-11-16"), b: r("b", "2026-11-09"), c: r("c") };
  expect(staleResults(all, "2026-11-16")).toEqual(["b", "c"]);
  expect(staleResults(all, "2026-11-23")).toEqual(["a", "b", "c"]);
});

test("제출 전에는 전체를 다시 대조한다", () => {
  expect(staleResults({ a: r("a", "2026-11-22") }, "2026-11-23", true)).toEqual(["a"]);
});
