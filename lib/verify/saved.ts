import savedJson from "@/data/verify-results/index.json";
import type { Policy } from "@/lib/data/types";
import type { VerifiedPolicy } from "@/lib/data/verified";
import type { VerifyResult } from "./run";
import { verificationKey, verificationVersion, type VerifyVersion } from "./version";

type SavedResults = Record<string, VerifyResult>;
let saved: SavedResults = savedJson as unknown as SavedResults;

export const VERIFY_RECHECK = "공고 자료가 변경되었거나 대조 버전을 확인할 수 없어 재확인이 필요합니다.";

export function lookupSaved(results: SavedResults, policyId: string, version: VerifyVersion) {
  const key = verificationKey(policyId, version);
  const result = results[key] ?? results[policyId];
  if (version.roundKey !== null && result && result.policyId === policyId && result.version && verificationKey(policyId, result.version) === key) {
    return { result, needsReview: false };
  }
  return {
    result: undefined,
    needsReview: version.roundKey === null || !!result || Object.values(results).some((historical) => historical.policyId === policyId),
  };
}

export function savedResult(policy: Policy, verified: VerifiedPolicy | undefined, date: string) {
  return lookupSaved(saved, policy.id, verificationVersion(policy, verified, date));
}

export function saveVerification(results: SavedResults, result: VerifyResult) {
  if (!result.version) throw new Error("대조 버전이 없는 결과는 저장할 수 없습니다.");
  results[verificationKey(result.policyId, result.version)] = result;
}

/** 테스트용: 저장 결과를 바꿔 끼운다. 돌려준 함수로 원래대로 */
export function withSavedResults(next: SavedResults): () => void {
  const prev = saved;
  saved = next;
  return () => {
    saved = prev;
  };
}

const dayNum = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;

/** 현재 대조 버전이 없거나 대조일이 없거나 7일이 지난 정책을 다시 확인한다. */
export function staleResults(results: SavedResults, today: string, all = false, versionOf?: (policyId: string) => VerifyVersion | undefined): string[] {
  const ids = [...new Set(Object.values(results).map((result) => result.policyId))];
  return ids.filter((id) => {
    if (all) return true;
    const version = versionOf?.(id);
    const result = version ? lookupSaved(results, id, version).result : versionOf ? undefined : results[id];
    return !result?.checkedAt || dayNum(today) - dayNum(result.checkedAt) >= 7;
  }).sort();
}
