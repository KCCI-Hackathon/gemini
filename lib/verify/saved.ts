// 준비 단계에서 저장한 검증 결과(data/verify-results). 판정은 이 결과의 항목별 대조만 낮추기에 쓴다.
import savedJson from "@/data/verify-results/index.json";
import type { VerifyResult } from "./run";

let saved: Record<string, VerifyResult> = savedJson as unknown as Record<string, VerifyResult>;

export function savedResult(policyId: string): VerifyResult | undefined {
  return saved[policyId];
}

/** 테스트용: 저장 결과를 바꿔 끼운다. 돌려준 함수로 원래대로 */
export function withSavedResults(next: Record<string, VerifyResult>): () => void {
  const prev = saved;
  saved = next;
  return () => {
    saved = prev;
  };
}

const dayNum = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`) / 86_400_000;

/** 다시 대조할 저장 결과: 대조일이 없거나 7일이 지난 것(통합 설계 4.4). 11/23 제출 전에는 all=true로 전체 */
export function staleResults(results: Record<string, VerifyResult>, today: string, all = false): string[] {
  return Object.values(results)
    .filter((r) => all || !r.checkedAt || dayNum(today) - dayNum(r.checkedAt) >= 7)
    .map((r) => r.policyId)
    .sort();
}
