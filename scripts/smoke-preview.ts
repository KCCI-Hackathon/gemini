import assert from "node:assert/strict";
import { PERSONA_A } from "@/lib/judge/personas";
import type { JudgeBody } from "@/lib/judge/handler";
import type { Benefit } from "@/lib/judge/overlap";
import manifest from "@/data/release/manifest.json";
import approved from "@/data/overlap/approved.json";

async function main() {
  const input = process.argv[2];
  if (!input) throw Error("사용법: npm run smoke:preview -- <Preview URL>");
  const base = new URL(input);
  assert.ok(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)));
  const page = await fetch(new URL("/", base), { signal: AbortSignal.timeout(15000) });
  assert.equal(page.status, 200, "첫 화면 HTTP 상태");
  assert.match(await page.text(), /PathFinder/);

  const challenge = "20250122005400110346";
  const unemployment = "20250122005400110369";
  const dream = "20260406005400212442";
  const points = "20260406005400212410";
  const cases: {
    region: string; target: string; condition: number; benefit: Benefit;
    state: "applies" | "not_applies" | "needs_info";
  }[] = [
    { region: "47111", target: challenge, condition: 18, benefit: { policyId: unemployment, status: "receiving" }, state: "applies" },
    { region: "47111", target: challenge, condition: 18, benefit: { policyId: unemployment, status: "eligible_unpaid" }, state: "not_applies" },
    { region: "47111", target: challenge, condition: 18, benefit: { policyId: unemployment, status: "ended" }, state: "needs_info" },
    { region: "47111", target: challenge, condition: 18, benefit: { policyId: unemployment, status: "ended", lastPaymentDate: "2025-01-01" }, state: "not_applies" },
    { region: "28185", target: dream, condition: 12, benefit: { policyId: points, status: "selected" }, state: "applies" },
    { region: "28185", target: dream, condition: 12, benefit: { policyId: points, status: "applied" }, state: "not_applies" },
    // 만료된 경기 노동자 통장은 현재 API 목록에서 제외되므로 수원은 전국 정책으로 검증한다.
    { region: "41111", target: challenge, condition: 18, benefit: { policyId: unemployment, status: "receiving" }, state: "applies" },
    { region: "41111", target: challenge, condition: 18, benefit: { policyId: unemployment, status: "eligible_unpaid" }, state: "not_applies" },
  ];

  for (const scenario of cases) {
    const response = await fetch(new URL("/api/judge", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile: { ...PERSONA_A, sigungu: scenario.region }, benefits: [scenario.benefit] }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, 200, "/api/judge HTTP 상태");
    const body = await response.json() as JudgeBody;
    assert.ok("items" in body, "판정 응답");
    assert.equal(body.dataVersion, manifest.dataVersion, "배포 데이터 버전");
    const item = body.items.find(policy => policy.id === scenario.target);
    const rule = approved.rules.find(r => r.research_basis?.source_row === "표 1 · " + scenario.condition + "행" &&
      (scenario.condition !== 18 || r.condition_type === (scenario.benefit.status === "ended" ? "within_months_after_end" : "receiving")));
    assert.ok(rule, "시연 규칙 누락");
    const restriction = item?.restrictions.find(r => r.ruleId === rule.rule_id);
    assert.equal(restriction?.state, scenario.state, JSON.stringify(scenario));
    assert.ok(restriction.evidence.quote, "판정 근거 누락");
  }
  console.log("첫 화면과 /api/judge " + cases.length + "개 사례 통과 · " + manifest.dataVersion);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
