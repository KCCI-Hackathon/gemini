import assert from "node:assert/strict";
import { PERSONA_A } from "@/lib/judge/personas";

async function main() {
  const input = process.argv[2];
  if (!input) throw Error("사용법: npm run smoke:api -- <AI가 비활성화된 서버 URL>");
  const base = new URL(input);
  assert.ok(base.protocol === "https:" || (base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)));

  const plan = { mode: "first", persona: true, session: { profile: PERSONA_A } };
  const cases = [
    { path: "plan", name: "AI 비활성 시연", input: plan, status: 503, error: /AI가 꺼져/ },
    { path: "plan", name: "잘못된 요청 모드", input: { ...plan, mode: "unknown" }, status: 400, error: /요청 형식/ },
    { path: "plan", name: "시연 인물 위조", input: { ...plan, session: { profile: { ...PERSONA_A, birthYm: "1998-01" } } }, status: 400, error: /등록된 시연 인물/ },
    { path: "plan", name: "실제 사용자 요청 차단", input: { ...plan, persona: false, consent: true }, status: 403, error: /실제 사용자 정보/ },
    { path: "agent", name: "외부 AI 없이 시연 카드", input: { personaId: "demo-1" }, status: 200 },
    { path: "agent", name: "시연 외 입력 거부", input: { personaId: "demo-1", profile: PERSONA_A }, status: 400, error: /가상 인물 번호만/ },
    { path: "verify", name: "버전 없는 저장 검증 재확인", input: { policyId: "20260406005400212445" }, status: 409, error: /재확인/ },
    { path: "verify", name: "없는 정책 조회", input: { policyId: "00000000000000000000" }, status: 404, error: /정책을 찾을 수/ },
  ];
  for (const scenario of cases) {
    const label = "/api/" + scenario.path + " " + scenario.name;
    const response = await fetch(new URL("/api/" + scenario.path, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scenario.input),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.status, scenario.status, label);
    const body = await response.json();
    if (scenario.error) assert.match(body.error, scenario.error, label);
    else {
      assert.equal(body.fallback, true, label);
      assert.ok(Array.isArray(body.cards) && body.cards.length > 0, label);
    }
  }
  console.log("외부 AI 비활성 상태에서 API 응답 " + cases.length + "개 통과");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
