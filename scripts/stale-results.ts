// 다시 대조할 저장 결과 목록. 사용: npx tsx scripts/stale-results.ts [--all]
// 결과를 실제로 다시 대조하려면 담당자 API 키로 verify를 돌린다(이 스크립트는 목록만 낸다).
import savedJson from "../data/verify-results/index.json";
import { toKstDate } from "../lib/date";
import type { VerifyResult } from "../lib/verify/run";
import { staleResults } from "../lib/verify/saved";

const ids = staleResults(savedJson as unknown as Record<string, VerifyResult>, toKstDate(new Date()), process.argv.includes("--all"));
console.log(ids.length ? ids.join("\n") : "다시 대조할 결과가 없습니다.");
