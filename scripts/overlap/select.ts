import type { RawPolicy } from "@/lib/data/types";
import type { PublicField } from "./types";

const zips = new Set(["47111", "28185", "41111", "41113", "41115", "41117"]);
const supportKeywords = /중복|유사|동시|병행|수급|참여\s*중|수혜|기참여|생애|택일|제외|불가|차감|제한|타\s*사업|받은\s*경우|받고\s*있|수\s*없/;
const overlapSignals = /중복|유사\s*(?:한\s*)?(?:사업|정책|지원)|동시\s*(?:에\s*)?(?:참여|지원|신청|수혜|수급)|병행|기\s*수혜|택일|차감|차액|복수\s*(?:지원|참여)|이중\s*(?:지원|수급)|타\s*(?:사업|정책|지원)|다른\s*(?:사업|정책|기관|제도)|(?:지원|수당|장려금|급여|보조금).{0,24}(?:받은\s*적|받고\s*있|수급|수혜|반납)|(?:국민취업지원제도|실업급여|구직급여).{0,24}(?:제한|제외|불가|참여\s*중|수급)/;
const fieldOrder = ["ptcpPrpTrgtCn", "addAplyQlfcCndCn", "plcySprtCn"] as const;

export function selectRegion(records: RawPolicy[]): RawPolicy[] {
  return records.filter(r => typeof r.zipCd === "string" && r.zipCd.split(",").some(zip => zips.has(zip.trim())))
    .sort((a, b) => a.plcyNo.localeCompare(b.plcyNo));
}
export function selectFields(records: RawPolicy[], allRegions = false): PublicField[] {
  const out: PublicField[] = [];
  const policies = allRegions ? [...records].sort((a, b) => a.plcyNo.localeCompare(b.plcyNo)) : selectRegion(records);
  for (const policy of policies) for (const field of fieldOrder) {
    const text = policy[field];
    if (typeof text !== "string" || !text.trim() || (!allRegions && field === "plcySprtCn" && !supportKeywords.test(text))) continue;
    out.push({ b_policy_id: policy.plcyNo, name: policy.plcyNm, field, text });
  }
  return out;
}

export function screenPolicyIds(records: RawPolicy[], known: ReadonlySet<string>, changed?: ReadonlySet<string>) {
  return records.filter(row => (!changed || changed.has(row.plcyNo)) &&
    (known.has(row.plcyNo) || fieldOrder.some(field => typeof row[field] === "string" &&
      overlapSignals.test((row[field] as string).replace(/\s+/g, " "))))).map(row => row.plcyNo).sort();
}
export function batchFields(fields: PublicField[], maxChars = 6000): PublicField[][] {
  const result: PublicField[][] = [];
  let batch: PublicField[] = [], chars = 0;
  for (const field of fields) {
    if (batch.length && chars + field.text.length > maxChars) {
      result.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(field);
    chars += field.text.length;
  }
  if (batch.length) result.push(batch);
  return result;
}
