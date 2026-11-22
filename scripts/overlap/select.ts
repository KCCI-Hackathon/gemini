import type { RawPolicy } from "@/lib/data/types";
import type { PublicField } from "./types";

const zips = new Set(["47111", "28185", "41111", "41113", "41115", "41117"]);
const supportKeywords = /중복|유사|동시|병행|수급|참여\s*중|수혜|기참여|생애|택일|제외|불가|차감|제한|타\s*사업|받은\s*경우|받고\s*있|수\s*없/;
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
export function batchFields(fields: PublicField[]): PublicField[][] {
  const result: PublicField[][] = [];
  let batch: PublicField[] = [], chars = 0;
  for (const field of fields) {
    if (batch.length && chars + field.text.length > 6000) {
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
