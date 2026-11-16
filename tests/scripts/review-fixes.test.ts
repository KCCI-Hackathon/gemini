// 최종 리뷰 I11·I14 재현 테스트
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { assembleCards } from "@/lib/agent/assemble";
import { judgeAll } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import { fetchSnapshot } from "@/scripts/fetch-snapshot";

const NOW = new Date("2026-11-24T12:00:00+09:00");

describe("I11: 수료 예정일이 지났다는 안내가 행동 카드에 보인다", () => {
  test("카드의 확인된 사항 맨 앞에 상태를 바꿔 달라는 문구", () => {
    const overdue = { ...PERSONA_A, events: [{ type: "training_completion" as const, date: "2026-11-01", status: "scheduled" as const }] };
    const cards = assembleCards(judgeAll(overdue, NOW), "none");
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.confirmed[0], c.name).toContain("수료하셨다면 상태를 바꿔 주세요");
  });
});

describe("I14: 잘린 수집 결과로 기존 스냅샷을 덮어쓰지 않는다", () => {
  const list = (n: number, tag: string) => Array.from({ length: n }, (_, i) => ({ plcyNo: `${tag}-${i}`, plcyNm: "x" }));
  const out = () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "snap-")), "current.json");
    fs.writeFileSync(f, "ORIGINAL");
    return f;
  };
  const run = (f: string, respond: (pageNum: number) => Response) =>
    fetchSnapshot({ apiKey: "k", outPath: f, pageSize: 100, retryDelayMs: 0, fetchFn: (async (url: string) => respond(Number(new URL(url).searchParams.get("pageNum")))) as unknown as typeof fetch });

  test("전체 건수(totCount)가 없으면 실패하고 기존 파일 유지", async () => {
    const f = out();
    await expect(run(f, () => new Response(JSON.stringify({ result: { pagging: {}, youthPolicyList: list(100, "a") } })))).rejects.toThrow();
    expect(fs.readFileSync(f, "utf-8")).toBe("ORIGINAL");
  });

  test("받은 건수가 전체 건수와 다르면 실패하고 기존 파일 유지", async () => {
    const f = out();
    await expect(run(f, (p) => new Response(JSON.stringify({ result: { pagging: { totCount: 250 }, youthPolicyList: list(p === 3 ? 10 : 100, `p${p}`) } })))).rejects.toThrow(/건수/);
    expect(fs.readFileSync(f, "utf-8")).toBe("ORIGINAL");
  });

  test("HTTP 오류 응답은 본문이 JSON이어도 실패로 본다", async () => {
    const f = out();
    await expect(run(f, () => new Response(JSON.stringify({ result: { pagging: { totCount: 50 }, youthPolicyList: list(50, "a") } }), { status: 500 }))).rejects.toThrow();
    expect(fs.readFileSync(f, "utf-8")).toBe("ORIGINAL");
  });
});
