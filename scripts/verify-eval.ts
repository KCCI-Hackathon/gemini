// 비교 실험: 고정 처리 대 에이전트(설계 5장 ②). 정답 세트는 data/verify-eval/answers.json
// 실행: npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-eval.ts --mode=agent
//       npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-eval.ts --mode=fixed
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { toKstDate } from "@/lib/date";
import { loadSnapshot } from "@/lib/data/snapshot";
import { runFixedPipeline, runVerification, policyHosts, type AnthropicLike, type VerifyResult } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";

export type Answer = { policyId: string; correctNoticeUrls: string[] | null; note?: string };
export type Row = { answer: Answer; result: VerifyResult; originalOk: boolean };

/** 설계 5장 ② 평가 지표 다섯 개와 비용 */
export function score(rows: Row[]) {
  const n = rows.length;
  const correct = (r: Row) => !!r.result.noticeUrl && !!r.answer.correctNoticeUrls?.some((u) => r.result.noticeUrl!.startsWith(u));
  const hasAnswer = rows.filter((r) => r.answer.correctNoticeUrls);
  const noAnswer = rows.filter((r) => !r.answer.correctNoticeUrls);
  const originalBad = hasAnswer.filter((r) => !r.originalOk);
  return {
    total: n,
    originalLinkSuccess: hasAnswer.filter((r) => r.originalOk && correct(r)).length / Math.max(1, hasAnswer.length),
    researchSuccess: originalBad.filter(correct).length / Math.max(1, originalBad.length),
    sameProgramAccuracy: rows.filter((r) => (r.answer.correctNoticeUrls ? correct(r) : !r.result.noticeUrl)).length / Math.max(1, n),
    wrongEvidenceRate: rows.filter((r) => r.result.noticeUrl && !correct(r)).length / Math.max(1, n),
    properStopRate: noAnswer.filter((r) => r.result.outcome === "notice_not_found").length / Math.max(1, noAnswer.length),
    calls: rows.reduce((s, r) => s + r.result.usage.calls, 0),
    pages: rows.reduce((s, r) => s + r.result.usage.pagesOpened, 0),
    inputTokens: rows.reduce((s, r) => s + r.result.usage.inputTokens, 0),
    outputTokens: rows.reduce((s, r) => s + r.result.usage.outputTokens, 0),
  };
}

async function main() {
  const mode = (process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "agent") as "agent" | "fixed";
  const answers: Answer[] = JSON.parse(fs.readFileSync("data/verify-eval/answers.json", "utf-8")).answers;
  const client = new Anthropic() as unknown as AnthropicLike;
  const rows: Row[] = [];
  const started = Date.now();
  for (const a of answers) {
    const p = loadSnapshot().policies.find((x) => x.id === a.policyId)!;
    const first = [p.links.apply, p.links.ref, p.links.ref2].find(Boolean) ?? "";
    const deps = { client, web: createWeb({ extraHosts: policyHosts(p) }), now: new Date(), enableSearch: true };
    const result = mode === "agent" ? await runVerification(a.policyId, deps) : await runFixedPipeline(a.policyId, deps);
    rows.push({ answer: a, result, originalOk: !!a.correctNoticeUrls?.some((u) => first.startsWith(u)) });
    console.log(`${a.policyId} ${p.name}: ${result.outcome} ${result.noticeUrl ?? "-"}`);
  }
  const s = score(rows);
  const day = toKstDate(new Date());
  const report = [`# 검증 비교 실험 (${mode}) ${day}`, "", `걸린 시간 ${Math.round((Date.now() - started) / 1000)}초`, "", "```json", JSON.stringify(s, null, 2), "```", ""].join("\n");
  fs.writeFileSync(`data/verify-eval/report-${mode}-${day}.md`, report);
  console.log(report);
}

if (process.argv[1]?.endsWith("verify-eval.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
