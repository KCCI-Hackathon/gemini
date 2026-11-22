import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ApprovedSchema, PolicyIdSchema, type ApprovedRule } from "@/lib/data/overlap-schema";
import type { Snapshot } from "@/lib/data/types";

const SnapshotSchema = z.object({
  asOf: z.iso.date(),
  records: z.array(z.looseObject({ plcyNo: PolicyIdSchema, plcyNm: z.string().min(1) })).min(1),
});

export function parseSnapshot(value: unknown): Snapshot {
  const snapshot = SnapshotSchema.parse(value);
  const seen = new Set<string>();
  for (const row of snapshot.records) {
    if (seen.has(row.plcyNo)) throw Error("중복 정책번호: " + row.plcyNo);
    seen.add(row.plcyNo);
  }
  return snapshot;
}

export function compareSnapshots(previous: Snapshot, next: Snapshot, rules: ApprovedRule[]) {
  const before = new Map(previous.records.map(row => [row.plcyNo, row]));
  const after = new Map(next.records.map(row => [row.plcyNo, row]));
  const added = [...after.keys()].filter(id => !before.has(id)).sort();
  const removed = [...before.keys()].filter(id => !after.has(id)).sort();
  const changed = [...after.keys()].filter(id => before.has(id)).sort().flatMap(policyId => {
    const oldRow = before.get(policyId)!;
    const newRow = after.get(policyId)!;
    const keys = new Set([...Object.keys(oldRow), ...Object.keys(newRow)]);
    const fields = [...keys].filter(key => !isDeepStrictEqual(oldRow[key], newRow[key])).sort();
    return fields.length ? [{ policyId, fields }] : [];
  });

  // Unknown source fields count as a change. The timestamp alone carries no policy condition.
  const targets = new Set([...added, ...changed.filter(c => c.fields.some(f => f !== "lastMdfcnDt")).map(c => c.policyId)]);
  const affected = new Set([...targets, ...removed]);
  const rulesToReview = rules.flatMap(rule => {
    const linked = [rule.source_policy_id, rule.target_policy_id, ...rule.a_group_ids];
    const affectedPolicyIds = linked.filter(id => affected.has(id)).sort();
    if (!affectedPolicyIds.length) return [];
    if (after.has(rule.target_policy_id)) targets.add(rule.target_policy_id);
    return [{ ruleId: rule.rule_id, affectedPolicyIds, missingPolicyIds: linked.filter(id => !after.has(id)).sort() }];
  }).sort((a, b) => a.ruleId.localeCompare(b.ruleId));

  return {
    previousAsOf: previous.asOf, nextAsOf: next.asOf, added, changed, removed,
    revalidatePolicyIds: [...targets].sort(), rulesToReview,
    needsReviewBeforePublish: affected.size > 0,
  };
}

function main() {
  const [previousPath, nextPath, approvedPath = "data/overlap/approved.json"] = process.argv.slice(2);
  if (!previousPath || !nextPath) throw Error("사용법: npm run snapshot:compare -- <이전 JSON> <새 JSON> [이전 배포 규칙 JSON]");
  const read = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
  const previous = parseSnapshot(read(previousPath));
  const next = parseSnapshot(read(nextPath));
  const release = ApprovedSchema.parse(read(approvedPath));
  if (release.snapshotId !== previous.asOf) throw Error("이전 스냅샷 기준일과 배포 규칙 기준일이 다릅니다.");
  if (next.asOf < previous.asOf) throw Error("새 스냅샷의 기준일이 이전 스냅샷보다 빠릅니다.");
  console.log(JSON.stringify(compareSnapshots(previous, next, release.rules), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
