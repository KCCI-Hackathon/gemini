import { expect, it } from "vitest";
import { compareSnapshots, parseSnapshot } from "@/scripts/compare-snapshots";
import approvedJson from "@/data/overlap/approved.json";
import snapshot from "@/data/snapshot/current.json";
import { ApprovedSchema } from "@/lib/data/overlap-schema";

it("신규·변경·삭제를 구분하고 영향을 받는 양방향 규칙을 고른다", () => {
  const original = parseSnapshot(snapshot);
  const approved = ApprovedSchema.parse(approvedJson);
  const affected = approved.rules[0];
  const source = affected.source_policy_id;
  const target = affected.target_policy_id;
  const newId = "99999999999999999999";
  const updated = {
    asOf: "2026-11-21",
    records: original.records
      .filter(row => row.plcyNo !== source)
      .map(row => row.plcyNo === target ? { ...row, ptcpPrpTrgtCn: "변경된 공고" } : row)
      .concat({ plcyNo: newId, plcyNm: "신규 정책" }),
  };
  const report = compareSnapshots(original, updated, approved.rules);
  expect(report.added).toEqual([newId]);
  expect(report.removed).toEqual([source]);
  expect(report.changed).toEqual([{ policyId: target, fields: ["ptcpPrpTrgtCn"] }]);
  expect(report.revalidatePolicyIds).toHaveLength(7);
  expect(report.revalidatePolicyIds).toEqual(expect.arrayContaining([target, newId, "20250123005400110394"]));
  expect(report.revalidatePolicyIds).not.toContain(source);
  expect(report.rulesToReview).toContainEqual({
    ruleId: affected.rule_id, affectedPolicyIds: [source, target].sort(), missingPolicyIds: [source],
  });
  expect(report.needsReviewBeforePublish).toBe(true);
});

it("메타데이터만 수정된 정책은 재검증에서 제외하고 중복 번호는 거부한다", () => {
  const policy = { plcyNo: "00000000000000000001", plcyNm: "테스트", lastMdfcnDt: "2026-11-01" };
  const old = { asOf: "2026-11-16", records: [policy] };
  const current = { asOf: "2026-11-21", records: [{ ...policy, lastMdfcnDt: "2026-11-21" }] };
  const report = compareSnapshots(old, current, []);
  expect(report.changed).toEqual([{ policyId: policy.plcyNo, fields: ["lastMdfcnDt"] }]);
  expect(report.revalidatePolicyIds).toEqual([]);
  expect(report.needsReviewBeforePublish).toBe(false);
  expect(() => parseSnapshot({ ...old, records: [policy, policy] })).toThrow(/중복/);
});
