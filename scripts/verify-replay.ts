// API 키 없이 검증 루프를 돌린다: 모델 자리에 "미리 정한 도구 호출 목록"을 넣고, 나머지는 실제 코드가 한다.
// 허용 도메인·robots.txt·열기 한도·인용 대조는 lib/verify가 그대로 강제한다.
// 결과에는 producedBy: "claude_code_session"을 붙여, 서비스 안의 에이전트가 실행한 것과 구분한다.
//
// 본문 보기:  npx tsx --tsconfig tsconfig.json scripts/verify-replay.ts peek <정책번호> <url> [찾을말]
// 정책 요약:  npx tsx --tsconfig tsconfig.json scripts/verify-replay.ts brief <정책번호>
// 실행·저장:  npx tsx --tsconfig tsconfig.json scripts/verify-replay.ts run <정책번호> <turns.json> [--save]
import fs from "node:fs";
import { loadSnapshot } from "@/lib/data/snapshot";
import { policyBrief, policyHosts, runVerification, type AnthropicLike } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";

const OUT = "data/verify-results/index.json";
type Call = { name: string; input: Record<string, unknown> };

/** 정해 둔 차례대로 도구 호출을 돌려주는 클라이언트. 다 쓰면 "못 찾음"으로 끝낸다 */
export function replayClient(turns: Call[][]): AnthropicLike {
  let i = 0;
  return {
    beta: {
      messages: {
        create: async () => {
          const turn = turns[i] ?? [{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }];
          i++;
          return { id: `replay_${i}`, role: "assistant", stop_reason: "tool_use", usage: { input_tokens: 0, output_tokens: 0 }, content: turn.map((c, k) => ({ type: "tool_use", id: `tu_${i}_${k}`, name: c.name, input: c.input })) };
        },
      },
    },
  } as unknown as AnthropicLike;
}

async function main() {
  const [cmd, id, arg, extra] = process.argv.slice(2);
  const p = loadSnapshot().policies.find((x) => x.id === id);
  if (!p) throw new Error(`정책 번호 없음: ${id}`);
  if (cmd === "brief") return console.log(policyBrief(p));
  const web = createWeb({ extraHosts: policyHosts(p) });
  if (cmd === "peek") {
    const r = await web.openPage(arg);
    if (!r.ok) return console.log(`[열기 실패] ${r.text}`);
    if (!extra) return console.log(r.text.slice(0, 6000));
    // 찾을 말 주변만 출력
    for (const m of r.text.matchAll(new RegExp(extra, "g"))) console.log("…" + r.text.slice(Math.max(0, m.index - 200), m.index + 400).replace(/\n+/g, " ⏎ ") + "…\n");
    return;
  }
  if (cmd === "run") {
    // 파일은 차례 목록이거나, 정책 번호별 차례 목록 묶음
    const file = JSON.parse(fs.readFileSync(arg, "utf-8")) as Call[][] | Record<string, Call[][]>;
    const turns = Array.isArray(file) ? file : file[id];
    if (!turns) throw new Error(`차례 목록에 정책 번호 없음: ${id}`);
    const r = await runVerification(id, { client: replayClient(turns), web, now: new Date(), deadlineMs: 10 * 60_000 });
    const result = { ...r, producedBy: "claude_code_session" as const };
    console.log(JSON.stringify({ outcome: r.outcome, noticeUrl: r.noticeUrl, findings: r.findings, mismatches: r.mismatches, trail: r.trail.map((t) => `${t.action} ${t.target.slice(0, 80)} — ${t.reason.slice(0, 80)}`) }, null, 1));
    if (process.argv.includes("--save")) {
      const saved = JSON.parse(fs.readFileSync(OUT, "utf-8"));
      saved[id] = result;
      fs.writeFileSync(OUT, JSON.stringify(saved, null, 1));
      console.log(`저장: ${OUT}`);
    }
    return;
  }
  throw new Error("명령은 brief | peek | run");
}

if (process.argv[1]?.endsWith("verify-replay.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
