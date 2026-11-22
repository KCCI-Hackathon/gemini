import { z } from "zod";
import snapshotJson from "@/data/snapshot/current.json";
import releaseJson from "@/data/overlap/approved.json";
import casesJson from "@/data/overlap-agent/cases.json";
import { ApprovedSchema, CaseSchema } from "@/lib/data/overlap-schema";
import { parseSnapshot } from "./compare-snapshots";
import { screenPolicyIds } from "./overlap/select";

const snapshot = parseSnapshot(snapshotJson);
const release = ApprovedSchema.parse(releaseJson);
const cases = z.array(CaseSchema).nonempty().parse(casesJson);
if (snapshot.asOf !== release.snapshotId) throw Error("평가 스냅샷과 배포 규칙의 기준일이 다릅니다.");
const known = new Set(release.rules.flatMap(rule => [rule.source_policy_id, rule.target_policy_id, ...rule.a_group_ids]));
const fromText = new Set(screenPolicyIds(snapshot.records, new Set()));
const screened = new Set(screenPolicyIds(snapshot.records, known));
const byId = new Map(snapshot.records.map(row => [row.plcyNo, row]));
const result = cases.map((c, index) => {
  const source = byId.get(c.b);
  if (!source) throw Error("평가 사례의 정책을 찾을 수 없습니다: " + c.b);
  return {
    caseNumber: index + 1,
    sourceRow: c.source_row,
    policyId: c.b,
    policyName: source.plcyNm,
    phrase: c.phrase,
    expectedKinds: c.expect_kind,
    restrictionCase: c.expect_kind.some(kind => kind !== "allowed" && kind !== "not_restriction"),
    selected: screened.has(c.b),
    textMatch: fromText.has(c.b),
    known: known.has(c.b),
  };
});

function counts(rows: typeof result) {
  return {
    total: rows.length,
    selected: rows.filter(row => row.selected).length,
    textMatch: rows.filter(row => row.textMatch).length,
    knownOnly: rows.filter(row => row.known && !row.textMatch).length,
    missed: rows.filter(row => !row.selected).length,
  };
}

console.log(JSON.stringify({
  asOf: snapshot.asOf,
  policies: { total: snapshot.records.length, selected: screened.size, textMatch: fromText.size },
  allCases: counts(result),
  restrictionCases: counts(result.filter(row => row.restrictionCase)),
  casesWithoutKnownLinks: counts(result.filter(row => !row.known)),
  missedCases: result.filter(row => !row.selected),
}, null, 2));
