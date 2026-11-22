// 공식 공고 링크 점검. 사용: npm run check:dead-links -- [--limit N] [--ids a,b] [--merge]
// 링크가 하나 이상 있고 전부 404/410 인 정책만 data/verified/dead-links.json 에 기록한다(AI 미사용).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSnapshot } from "@/lib/data/snapshot";
import { toKstDate } from "@/lib/date";

type LinkResult = { url: string; status: number | "timeout" | "error" };
type DeadPolicy = { policyId: string; title: string; links: LinkResult[]; keep?: boolean };
type DeadFile = { checkedAt: string | null; snapshotAsOf: string | null; policies: DeadPolicy[] };

const OUT = resolve(process.cwd(), "data/verified/dead-links.json");
const TIMEOUT_MS = 10_000;
const CONCURRENCY = 6;

/** 인자 값을 읽는다(--name value) */
function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 링크 하나를 GET 으로 열어 상태를 돌려준다 */
async function checkLink(url: string): Promise<LinkResult> {
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "galimgil-link-checker/0.1" } });
    await res.body?.cancel();
    return { url, status: res.status };
  } catch (error) {
    return { url, status: error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "error" };
  }
}

/** 링크가 있고 전부 404/410 이면 끊김이다 */
function isDead(links: LinkResult[]): boolean {
  return links.length > 0 && links.every(l => l.status === 404 || l.status === 410);
}

/** 작업을 동시 CONCURRENCY 개로 나눠 돌린다 */
async function mapPool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

/** 기존 결과 파일을 읽는다(없거나 깨졌으면 빈 목록) */
function readExisting(): DeadFile {
  try { return JSON.parse(readFileSync(OUT, "utf8")) as DeadFile; } catch { return { checkedAt: null, snapshotAsOf: null, policies: [] }; }
}

async function main() {
  const snapshot = loadSnapshot();
  const ids = argValue("--ids")?.split(",").map(s => s.trim()).filter(Boolean);
  const limit = Number(argValue("--limit")) || undefined;
  const existing = readExisting().policies;
  const keepEntries = existing.filter(p => p.keep);
  const keepIds = new Set(keepEntries.map(p => p.policyId));
  let targets = snapshot.policies.filter(p => !keepIds.has(p.id)); // keep 항목은 다시 점검하지 않고 그대로 보존한다
  if (ids) targets = targets.filter(p => ids.includes(p.id));
  if (limit) targets = targets.slice(0, limit);

  const checked = await mapPool(targets, async p => {
    const urls = [...new Set([p.links.apply, p.links.ref, p.links.ref2].filter((u): u is string => !!u))];
    const links = await Promise.all(urls.map(checkLink));
    return { policyId: p.id, title: p.name, links };
  });
  const dead = checked.filter(c => isDead(c.links));

  const checkedIds = new Set(checked.map(c => c.policyId));
  const kept = process.argv.includes("--merge") ? existing.filter(p => !p.keep && !checkedIds.has(p.policyId)) : [];
  const result: DeadFile = { checkedAt: toKstDate(new Date()), snapshotAsOf: snapshot.asOf, policies: [...keepEntries, ...kept, ...dead] };
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n", "utf8");

  console.log(`점검 ${checked.length}개 · 끊김 ${dead.length}개`);
  for (const d of dead) console.log(`- ${d.title} (${d.policyId})`);
}

main();
