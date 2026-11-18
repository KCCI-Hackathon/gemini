// 실제 AI로 검증 1건을 돌려 결과·비용·시간을 출력한다(저장하지 않음).
// 사용: npx tsx --tsconfig tsconfig.json scripts/verify-live.ts <정책번호>
import fs from "node:fs";
import { makeAiClient } from "@/lib/ai/client";
import { loadSnapshot } from "@/lib/data/snapshot";
import { policyHosts, runVerification } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";

for (const line of fs.readFileSync(".env.local", "utf-8").split(/\r?\n/)) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const id = process.argv[2] ?? "20260714005400113258";
const policy = loadSnapshot().policies.find((p) => p.id === id)!;
async function main() {
const started = Date.now();
const r = await runVerification(id, {
  client: makeAiClient(process.env),
  web: createWeb({ extraHosts: policyHosts(policy) }),
  now: new Date(),
  enableSearch: process.env.AI_PROVIDER !== "gemini",
  deadlineMs: Number(process.env.VERIFY_DEADLINE_MS) || undefined,
});
console.log(JSON.stringify({ policy: policy.name, provider: process.env.AI_PROVIDER ?? "anthropic", model: process.env.GEMINI_MODEL || "gemini-3.5-flash", seconds: Math.round((Date.now() - started) / 1000), outcome: r.outcome, noticeUrl: r.noticeUrl, notice: r.notice, usage: r.usage, findings: r.findings, mismatches: r.mismatches, fieldChecks: r.fieldChecks, trail: r.trail.map((t) => `${t.step} ${t.action} ${t.target.slice(0, 90)} — ${t.reason.slice(0, 80)}`) }, null, 2));
}
main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
