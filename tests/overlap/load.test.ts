import { expect, test } from "vitest";
import { indexOverlap } from "@/lib/data/overlap";
import { rule, TARGET } from "./runtime-fixture";

test("배포본에서 B별 규칙과 중복 없는 안내를 읽고 형식이 틀린 규칙은 거부한다", () => {
  const notice = { b: TARGET, field: "addAplyQlfcCndCn", quote: "원문" };
  const bundle = { snapshotId: "2026-11-16", rules: [rule()], notices: [notice, notice] };
  expect(indexOverlap(bundle).rules.get(TARGET)).toEqual(bundle.rules);
  expect(indexOverlap(bundle).notices.get(TARGET)).toEqual(["원문"]);
  expect(() => indexOverlap({ ...bundle, rules: [rule({ rule_id: "" })] })).toThrow();
});
