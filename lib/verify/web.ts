// 공고 탐색에 쓰는 웹 접근. 접근 범위와 한도는 여기서 강제하며 모델이 넘을 수 없다(설계 5장 ②).

const PUBLIC_SUFFIXES = [".go.kr", ".or.kr", ".re.kr"];
/** 접미사 규칙에 안 걸리는 정부 공식 사이트: 정부24, 대한민국 정책브리핑 */
const PUBLIC_DOMAINS = ["gov.kr", "korea.kr"];
const BLOCKED = /(saramin|jobkorea|albamon|incruit|blog\.naver|cafe\.naver|tistory|instagram|facebook|youtube|kmong|wanted\.co\.kr)/;

export const LIMITS = { opens: 6, timeoutMs: 10_000, maxChars: 20_000 } as const;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function isAllowedUrl(url: string, extraHosts: string[]): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  if (BLOCKED.test(host)) return false;
  if (PUBLIC_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (PUBLIC_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true;
  return extraHosts.includes(host);
}

/** robots.txt 경로 패턴(*, $)을 정규식으로 */
function robotsPattern(value: string): RegExp {
  const anchored = value.endsWith("$");
  const body = (anchored ? value.slice(0, -1) : value).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** target은 경로+쿼리스트링. 가장 긴 규칙이 이기고, 길이가 같으면 Allow가 이긴다 */
export function robotsAllows(robots: string, target: string): boolean {
  const rules: { allow: boolean; value: string }[] = [];
  let applies = false;
  let inAgents = false; // User-agent 줄이 연달아 오면 한 그룹이다
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!inAgents) applies = false;
      inAgents = true;
      if (value === "*" || value.toLowerCase().includes("galimgil")) applies = true;
    } else {
      inAgents = false;
      if (applies && value) rules.push({ allow: key === "allow", value });
    }
  }
  let best: { allow: boolean; value: string } | null = null;
  for (const r of rules) {
    if (!robotsPattern(r.value).test(target)) continue;
    if (!best || r.value.length > best.value.length || (r.value.length === best.value.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

export type Web = {
  openPage(url: string): Promise<{ ok: boolean; text: string }>;
  pageText(url: string): string | undefined;
  opened(): number;
};

export function createWeb(opts: { fetchFn?: typeof fetch; extraHosts: string[] }): Web {
  const fetchFn = opts.fetchFn ?? fetch;
  const pages = new Map<string, string>();
  const robotsCache = new Map<string, string>();
  let opens = 0;

  async function robotsFor(origin: string): Promise<string> {
    if (!robotsCache.has(origin)) {
      try {
        // 다른 도메인으로 넘기는 robots.txt는 따라가지 않고 "규칙 없음"으로 본다
        const res = await fetchFn(`${origin}/robots.txt`, { redirect: "manual", signal: AbortSignal.timeout(LIMITS.timeoutMs) });
        robotsCache.set(origin, res.ok ? await res.text() : "");
      } catch {
        robotsCache.set(origin, "");
      }
    }
    return robotsCache.get(origin)!;
  }

  return {
    async openPage(url: string) {
      if (!isAllowedUrl(url, opts.extraHosts)) return { ok: false, text: "허용되지 않은 도메인입니다. 정부·공공기관·지자체·주관기관의 공식 사이트만 열 수 있습니다." };
      if (opens >= LIMITS.opens) return { ok: false, text: `페이지 열기 한도(${LIMITS.opens}회)에 도달했습니다.` };
      opens++;
      try {
        // 리다이렉트는 직접 따라가며 매번 허용 도메인을 다시 확인한다(최대 3번)
        let current = url;
        let res: Response | null = null;
        for (let hop = 0; hop <= 3; hop++) {
          // 리다이렉트로 옮겨 간 사이트의 robots.txt도 매번 확인한다
          const u = new URL(current);
          if (!robotsAllows(await robotsFor(u.origin), u.pathname + u.search)) return { ok: false, text: "robots.txt가 이 페이지 수집을 허용하지 않습니다." };
          res = await fetchFn(current, { redirect: "manual", signal: AbortSignal.timeout(LIMITS.timeoutMs), headers: { "user-agent": "galimgil-policy-verifier/0.1" } });
          const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
          if (!loc) break;
          const next = new URL(loc, current).toString();
          if (!isAllowedUrl(next, opts.extraHosts)) return { ok: false, text: `허용되지 않은 도메인으로 이동하려 해 멈췄습니다: ${new URL(next).hostname}` };
          current = next;
          if (hop === 3) return { ok: false, text: "리다이렉트가 너무 많습니다." };
        }
        if (!res || !res.ok) return { ok: false, text: `HTTP ${res?.status ?? "?"}` };
        const text = htmlToText(await res.text()).slice(0, LIMITS.maxChars);
        pages.set(url, text);
        return { ok: true, text };
      } catch (e) {
        return { ok: false, text: `접속 실패: ${String(e)}` };
      }
    },
    pageText: (url) => pages.get(url),
    opened: () => opens,
  };
}
