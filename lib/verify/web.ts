// 공고 탐색에 쓰는 웹 접근. 접근 범위와 한도는 여기서 강제하며 모델이 넘을 수 없다(설계 5장 ②).

const PUBLIC_SUFFIXES = [".go.kr", ".or.kr", ".re.kr"];
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
  return extraHosts.includes(host);
}

function robotsAllows(robots: string, path: string): boolean {
  let applies = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const m = /^(user-agent|disallow|allow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") applies = value === "*";
    else if (applies && key === "disallow" && value && path.startsWith(value)) return false;
  }
  return true;
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
        const res = await fetchFn(`${origin}/robots.txt`, { signal: AbortSignal.timeout(LIMITS.timeoutMs) });
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
      const u = new URL(url);
      if (!robotsAllows(await robotsFor(u.origin), u.pathname)) return { ok: false, text: "robots.txt가 이 페이지 수집을 허용하지 않습니다." };
      try {
        const res = await fetchFn(url, { signal: AbortSignal.timeout(LIMITS.timeoutMs), headers: { "user-agent": "galimgil-policy-verifier/0.1" } });
        if (!res.ok) return { ok: false, text: `HTTP ${res.status}` };
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
