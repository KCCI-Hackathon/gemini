import fs from "node:fs";
import path from "node:path";
import type { AnthropicLike } from "@/lib/verify/run";

const dir = path.resolve(__dirname, "../fixtures/web");
const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf-8")) as Record<string, string>;

/** 가짜 웹: fixture 사전에 있는 주소만 응답한다. robots.txt는 모두 허용 */
export const fakeFetch = (async (input: string | URL) => {
  const url = String(input);
  if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n", { status: 200 });
  const file = index[url];
  if (!file) return new Response("not found", { status: 404 });
  return new Response(fs.readFileSync(path.join(dir, file), "utf-8"), { status: 200, headers: { "content-type": "text/html" } });
}) as unknown as typeof fetch;

type ToolCall = { name: string; input: Record<string, unknown> };

/** 차례대로 정해진 도구 호출을 돌려주는 모의 클라이언트. 받은 요청을 모두 기록한다 */
export function scriptedClient(turns: ToolCall[][]): AnthropicLike & { requests: unknown[]; calls: number } {
  let i = 0;
  const requests: unknown[] = [];
  const client = {
    requests,
    calls: 0,
    beta: {
      messages: {
        create: async (params: unknown) => {
          requests.push(JSON.parse(JSON.stringify(params)));
          client.calls++;
          const turn = turns[Math.min(i, turns.length - 1)];
          i++;
          return {
            id: `msg_${i}`,
            model: "claude-opus-5-5",
            role: "assistant",
            stop_reason: "tool_use",
            usage: { input_tokens: 1000, output_tokens: 200 },
            content: turn.map((c, k) => ({ type: "tool_use", id: `tu_${i}_${k}`, name: c.name, input: c.input })),
          };
        },
      },
    },
  };
  return client as unknown as AnthropicLike & { requests: unknown[]; calls: number };
}
