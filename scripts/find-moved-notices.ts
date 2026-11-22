// 끊긴 공식 링크의 사이트 첫 화면에서 주소만 바뀐 같은 사업 공고를 찾는다.
// 사용: npm run find:moved-notices -- [--ids a,b]   (.env.local 의 GPT 설정을 쓴다)
// 찾으면 dead-links.json 항목에 keep: true, movedTo 등을 기록해 숨기지 않고, 못 찾으면 시도 기록만 남긴다.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSnapshot } from "@/lib/data/snapshot";
import { toKstDate } from "@/lib/date";
import { makeVerifyClient } from "@/lib/ai/client";
import { policyHosts } from "@/lib/verify/run";
import { createWeb, focusText, normalizeSpace, type Web } from "@/lib/verify/web";
import type { Policy } from "@/lib/data/types";

type DeadEntry = { policyId: string; title: string; links: { url: string; status: unknown }[]; keep?: boolean; movedTo?: string; movedReason?: string; movedQuote?: string; movedCheckedAt?: string };
type DeadFile = { checkedAt: string | null; snapshotAsOf: string | null; policies: DeadEntry[] };
type Verdict = { match: boolean; url: string | null; reason: string; quote: string; sameProgramOtherYear?: boolean };
type OpenedPage = { url: string; web: Web };

const FILE = resolve(process.cwd(), "data/verified/dead-links.json");
const MAX_CANDIDATES = 3;
const PAGE_CHARS = 6000;
/** 제목에서 핵심 낱말로 치지 않는 흔한 낱말 */
const COMMON_WORDS = ["지원", "사업", "운영", "청년", "프로그램", "모집", "추진", "참여", "활성화", "지원사업"];

const SYSTEM = `당신은 청년 정책의 공식 공고를 찾는 보조자입니다. 기관 사이트가 개편되어 주소만 바뀐 같은 사업 공고가 아래 페이지 중에 있는지 판단합니다.
규칙
- 사업 이름이 같아도 연도(회차)가 다르면 같은 공고가 아닙니다. 그 경우 match 는 false, sameProgramOtherYear 는 true 로 답합니다.
- 기관 소개, 목록, 다른 사업 페이지는 match false 입니다. 확신이 없으면 false 입니다.
- quote 는 match 한 페이지 본문에 있는 문장을 한 글자도 바꾸지 말고 그대로 옮깁니다.
- 답은 JSON 객체 하나만 씁니다: {"match": boolean, "url": string|null, "reason": string, "quote": string, "sameProgramOtherYear": boolean}`;

/** 인자 값을 읽는다(--name value) */
function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 정책 제목에서 핵심 낱말(2글자 이상, 흔한 낱말 제외)을 뽑는다 */
function titleKeywords(title: string): string[] {
  const words = title.split(/[^0-9A-Za-z가-힣]+/).map(w => {
    let word = w;
    for (const c of COMMON_WORDS) if (word.endsWith(c) && word.length > c.length) word = word.slice(0, -c.length);
    return word;
  });
  return [...new Set(words.filter(w => w.length >= 2 && !COMMON_WORDS.includes(w)))];
}

/** 링크 글자나 주소에 핵심 낱말이 들어간 정도(긴 낱말일수록 높게) */
function scoreLink(link: { href: string; text: string }, keywords: string[]): number {
  let haystack = link.href;
  try { haystack = decodeURIComponent(link.href); } catch { /* 그대로 쓴다 */ }
  haystack += ` ${link.text}`;
  return keywords.reduce((sum, k) => sum + (haystack.includes(k) ? k.length : 0), 0);
}

/** 첫 화면 링크 중 같은 host 이고 점수가 있는 상위 최대 3개 */
function pickCandidates(links: { href: string; text: string }[], origin: string, deadUrls: string[], keywords: string[]): string[] {
  const host = new URL(origin).host;
  const seen = new Set<string>([origin, `${origin}/`, ...deadUrls]);
  const scored: { href: string; score: number }[] = [];
  for (const l of links) {
    if (seen.has(l.href) || new URL(l.href).host !== host) continue;
    seen.add(l.href);
    const score = scoreLink(l, keywords);
    if (score > 0) scored.push({ href: l.href, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES).map(s => s.href);
}

/** 모델 답에서 JSON 객체를 꺼낸다(못 꺼내면 null) */
function parseVerdict(text: string): Verdict | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as Partial<Verdict>;
    return { match: v.match === true, url: typeof v.url === "string" ? v.url : null, reason: String(v.reason ?? ""), quote: String(v.quote ?? ""), sameProgramOtherYear: v.sameProgramOtherYear === true };
  } catch { return null; }
}

/** 정책 설명(제목 · 기관 · 연도 · 지원 내용 요약) */
function policySummary(p: Policy): string {
  return [
    `정책명: ${p.name}`,
    `주관기관: ${p.supervisingOrg}`,
    `신청 기간: ${p.applyStart ? `${p.applyStart} ~ ${p.applyEnd}` : p.applyPeriodType}`,
    `사업 종료: ${p.bizEnd ?? "(없음)"} · 최종 수정: ${p.modifiedAt}`,
    `지원 내용: ${p.texts.support.slice(0, 800) || "(없음)"}`,
  ].join("\n");
}

/** 끊긴 링크의 사이트 첫 화면에서 후보 페이지를 열어 모은다 */
async function openCandidates(p: Policy, deadUrls: string[]): Promise<OpenedPage[]> {
  const keywords = titleKeywords(p.name);
  const pages: OpenedPage[] = [];
  for (const origin of new Set(deadUrls.map(u => new URL(u).origin))) {
    const web = createWeb({ extraHosts: policyHosts(p) }); // 사이트마다 새로 만들어 열기 한도를 따로 쓴다
    const home = await web.openPage(`${origin}/`);
    if (!home.ok) continue;
    for (const url of pickCandidates(web.pageLinks(`${origin}/`), origin, deadUrls, keywords)) {
      if ((await web.openPage(url)).ok) pages.push({ url, web });
    }
  }
  return pages;
}

/** GPT 에게 같은 사업 공고인지 한 번 묻고, 근거 문장이 원문에 있을 때만 인정한다 */
async function judge(p: Policy, pages: OpenedPage[]): Promise<Verdict> {
  const blocks = pages.map(pg => `[페이지: ${pg.url}]\n${focusText(pg.web.pageText(pg.url) ?? "", PAGE_CHARS)}`);
  const res = await makeVerifyClient(process.env).beta.messages.create({
    model: "verify",
    max_tokens: 1500,
    system: SYSTEM,
    messages: [{ role: "user", content: `${policySummary(p)}\n\n${blocks.join("\n\n")}` }],
  }, { maxRetries: 1 });
  const text = res.content.map(b => (b.type === "text" ? b.text : "")).join("\n");
  const v = parseVerdict(text);
  if (!v) return { match: false, url: null, reason: "모델 답을 읽을 수 없음", quote: "" };
  if (!v.match) return v;
  const page = pages.find(pg => pg.url === v.url);
  const quote = normalizeSpace(v.quote);
  if (!page || !quote || !normalizeSpace(page.web.pageText(page.url) ?? "").includes(quote)) return { ...v, match: false, reason: `근거 문장을 원문에서 확인하지 못함 (${v.reason})` };
  return v;
}

/** 결과를 dead-links.json 그 정책 항목에 기록한다(매번 다시 읽어 다른 항목은 건드리지 않는다) */
function record(policyId: string, patch: Partial<DeadEntry>) {
  const file = JSON.parse(readFileSync(FILE, "utf8")) as DeadFile;
  const entry = file.policies.find(e => e.policyId === policyId);
  if (!entry) return;
  Object.assign(entry, patch);
  writeFileSync(FILE, JSON.stringify(file, null, 2) + "\n", "utf8");
}

async function main() {
  const ids = argValue("--ids")?.split(",").map(s => s.trim()).filter(Boolean);
  const entries = (JSON.parse(readFileSync(FILE, "utf8")) as DeadFile).policies.filter(e => !e.keep && (!ids || ids.includes(e.policyId)));
  const snapshot = loadSnapshot();
  const today = toKstDate(new Date());
  let found = 0;
  const lines: string[] = [];

  for (const entry of entries) {
    const policy = snapshot.policies.find(p => p.id === entry.policyId);
    if (!policy) { lines.push(`- ${entry.title}: 스냅샷에 없음`); continue; }
    try {
      const pages = await openCandidates(policy, entry.links.map(l => l.url));
      if (!pages.length) {
        record(entry.policyId, { movedCheckedAt: today, movedReason: "첫 화면에서 열 수 있는 후보 링크가 없음" });
        lines.push(`- ${entry.title}: 못 찾음 (후보 링크 없음)`);
        continue;
      }
      const v = await judge(policy, pages);
      if (v.match && v.url) {
        record(entry.policyId, { keep: true, movedTo: v.url, movedReason: v.reason, movedQuote: v.quote, movedCheckedAt: today });
        found++;
        lines.push(`- ${entry.title}: 찾음 ${v.url}`);
      } else {
        record(entry.policyId, { movedCheckedAt: today, movedReason: v.reason });
        lines.push(`- ${entry.title}: 못 찾음 (${v.sameProgramOtherYear ? "다른 연도 · " : ""}${v.reason})`);
      }
    } catch (error) {
      lines.push(`- ${entry.title}: 오류 ${String(error).slice(0, 120)}`); // 오류는 기록하지 않아 다음에 다시 시도한다
    }
  }

  console.log(`점검 ${entries.length}개 · 옮겨진 공고 찾음 ${found}개`);
  for (const l of lines) console.log(l);
}

main();
