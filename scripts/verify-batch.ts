// 정책 검증 에이전트를 여러 정책에 실제로 돌려 결과를 저장한다(사람 검토용 초안 + 시연 대비 저장본).
// 실행: npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-batch.ts <정책번호...>
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { loadSnapshot } from "@/lib/data/snapshot";
import { runVerification, policyHosts, type AnthropicLike } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";

const OUT = "data/verify-results/index.json";

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error("정책 번호를 하나 이상 주세요.");
  const saved = JSON.parse(fs.readFileSync(OUT, "utf-8"));
  const client = new Anthropic() as unknown as AnthropicLike;
  for (const id of ids) {
    const p = loadSnapshot().policies.find((x) => x.id === id);
    if (!p) {
      console.error(`없음: ${id}`);
      continue;
    }
    const r = await runVerification(id, { client, web: createWeb({ extraHosts: policyHosts(p) }), now: new Date(), enableSearch: true });
    saved[id] = r;
    console.log(`${id} ${p.name}: ${r.outcome} ${r.noticeUrl ?? ""} 불일치 ${r.mismatches.map((m) => m.kind).join(",") || "-"} (호출 ${r.usage.calls}, 페이지 ${r.usage.pagesOpened})`);
    fs.writeFileSync(OUT, JSON.stringify(saved, null, 1));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
