// 다시 대조할 저장 결과 목록. 사용: npx tsx scripts/stale-results.ts [--all]
// 결과를 실제로 다시 대조하려면 담당자 API 키로 verify를 돌린다(이 스크립트는 목록만 낸다).
import savedJson from "../data/verify-results/index.json";
import { loadSnapshot } from "../lib/data/snapshot";
import { loadVerified } from "../lib/data/verified";
import { verificationVersion } from "../lib/verify/version";
import { toKstDate } from "../lib/date";
import type { VerifyResult } from "../lib/verify/run";
import { staleResults } from "../lib/verify/saved";

const today = toKstDate(new Date());
const verified = loadVerified();
const policies = new Map(loadSnapshot().policies.map((policy) => [policy.id, policy]));
const ids = staleResults(savedJson as unknown as Record<string, VerifyResult>, today, process.argv.includes("--all"), (id) => {
  const policy = policies.get(id);
  return policy ? verificationVersion(policy, verified.get(id), today) : undefined;
});
console.log(ids.length ? ids.join("\n") : "다시 대조할 결과가 없습니다.");
