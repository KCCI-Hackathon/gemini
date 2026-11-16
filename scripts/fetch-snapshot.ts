// 온통청년 청년정책 API 전체 수집.
// 운영 시 하루 1회 실행. 제출본은 기준일 고정을 위해 예약 실행을 비활성화한다(설계 6장).
// 예약 실행 예시(비활성):
// // vercel.json → { "crons": [{ "path": "/api/cron/snapshot", "schedule": "0 18 * * *" }] }

import fs from "node:fs";
import path from "node:path";
import { toKstDate } from "@/lib/date";
import type { RawPolicy, Snapshot } from "@/lib/data/types";

const ENDPOINT = "https://www.youthcenter.go.kr/go/ythip/getPlcy";

type Options = {
  apiKey: string;
  outPath: string;
  fetchFn?: typeof fetch;
  pageSize?: number;
  retryDelayMs?: number;
  now?: Date;
};

async function getPage(opts: Required<Pick<Options, "apiKey" | "fetchFn" | "pageSize" | "retryDelayMs">>, pageNum: number) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("apiKeyNm", opts.apiKey);
  url.searchParams.set("pageNum", String(pageNum));
  url.searchParams.set("pageSize", String(opts.pageSize));
  url.searchParams.set("rtnType", "json");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await opts.fetchFn(url.toString());
      const body = await res.json();
      const list = body?.result?.youthPolicyList;
      if (!Array.isArray(list)) throw new Error(`page ${pageNum}: 응답에 목록 없음`);
      return { list: list as RawPolicy[], total: Number(body.result.pagging.totCount) };
    } catch (e) {
      lastError = e;
      if (opts.retryDelayMs) await new Promise((r) => setTimeout(r, opts.retryDelayMs));
    }
  }
  throw new Error(`page ${pageNum} 수집 실패: ${String(lastError)}`);
}

export async function fetchSnapshot(options: Options): Promise<{ count: number }> {
  const opts = {
    apiKey: options.apiKey,
    fetchFn: options.fetchFn ?? fetch,
    pageSize: options.pageSize ?? 100,
    retryDelayMs: options.retryDelayMs ?? 1000,
  };
  const first = await getPage(opts, 1);
  const records = [...first.list];
  const pages = Math.ceil(first.total / opts.pageSize);
  for (let p = 2; p <= pages; p++) {
    records.push(...(await getPage(opts, p)).list);
  }
  const snapshot: Snapshot = { asOf: toKstDate(options.now ?? new Date()), records };
  // 모두 받은 뒤에만 교체한다. 부분 실패 시 기존 파일 보존.
  fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
  const tmp = `${options.outPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot));
  fs.renameSync(tmp, options.outPath);
  return { count: records.length };
}

if (process.argv[1] && process.argv[1].endsWith("fetch-snapshot.ts")) {
  const apiKey = process.env.YOUTH_POLICY_API_KEY;
  if (!apiKey) {
    console.error("YOUTH_POLICY_API_KEY가 없습니다(.env.local).");
    process.exit(1);
  }
  fetchSnapshot({ apiKey, outPath: path.resolve("data/snapshot/current.json") })
    .then((r) => console.log(`수집 완료: ${r.count}건`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
