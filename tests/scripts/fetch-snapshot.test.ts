import { describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchSnapshot } from "@/scripts/fetch-snapshot";

function page(pageNum: number, total: number, size: number) {
  const n = Math.max(0, Math.min(size, total - (pageNum - 1) * size));
  const list = Array.from({ length: n }, (_, i) => ({ plcyNo: `P${pageNum}-${i}`, plcyNm: "x" }));
  return { resultCode: 200, result: { pagging: { totCount: total, pageNum, pageSize: size }, youthPolicyList: list } };
}

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-"));
  return path.join(dir, "current.json");
}

describe("fetchSnapshot", () => {
  test("한 쪽이 한 번 실패해도 재시도해서 전체를 받는다", async () => {
    const out = tmpFile();
    let failedOnce = false;
    const fetchFn = (async (url: string) => {
      const p = Number(new URL(url).searchParams.get("pageNum"));
      if (p === 2 && !failedOnce) {
        failedOnce = true;
        throw new Error("network");
      }
      return new Response(JSON.stringify(page(p, 250, 100)));
    }) as unknown as typeof fetch;
    const r = await fetchSnapshot({ apiKey: "k", outPath: out, fetchFn, pageSize: 100, now: new Date("2026-11-21T09:00:00+09:00") });
    expect(r.count).toBe(250);
    const saved = JSON.parse(fs.readFileSync(out, "utf-8"));
    expect(saved.asOf).toBe("2026-11-21");
    expect(saved.records).toHaveLength(250);
  });

  test("세 번 연속 실패하면 reject하고 기존 파일은 그대로", async () => {
    const out = tmpFile();
    fs.writeFileSync(out, "ORIGINAL");
    const fetchFn = (async (url: string) => {
      const p = Number(new URL(url).searchParams.get("pageNum"));
      if (p === 2) throw new Error("down");
      return new Response(JSON.stringify(page(p, 250, 100)));
    }) as unknown as typeof fetch;
    await expect(fetchSnapshot({ apiKey: "k", outPath: out, fetchFn, pageSize: 100, retryDelayMs: 0 })).rejects.toThrow();
    expect(fs.readFileSync(out, "utf-8")).toBe("ORIGINAL");
  });
});
