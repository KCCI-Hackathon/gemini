import { describe, expect, test } from "vitest";
import { createWeb, htmlToText, isAllowedUrl } from "@/lib/verify/web";
import { fakeFetch } from "./helpers";

describe("htmlToText", () => {
  test("스크립트·스타일을 지우고 본문만 남긴다", () => {
    const t = htmlToText("<html><script>var x=1</script><style>a{}</style><p>신청기간 : 2026</p><br>끝</html>");
    expect(t).toContain("신청기간 : 2026");
    expect(t).not.toContain("var x");
  });
});

describe("isAllowedUrl", () => {
  test("공공 도메인과 정책 링크의 도메인은 허용, 민간 채용·SNS는 거부", () => {
    const extra = ["www.biocamp.kr"];
    expect(isAllowedUrl("https://youth.incheon.go.kr/a", extra)).toBe(true);
    expect(isAllowedUrl("https://www.atfis.or.kr/lunch", extra)).toBe(true);
    expect(isAllowedUrl("https://www.biocamp.kr/board", extra)).toBe(true);
    expect(isAllowedUrl("https://www.saramin.co.kr/zf_user/jobs", ["www.saramin.co.kr"])).toBe(false);
    expect(isAllowedUrl("https://evil.example.com/", extra)).toBe(false);
  });
});

describe("createWeb", () => {
  test("페이지를 열어 텍스트로 돌려준다", async () => {
    const web = createWeb({ fetchFn: fakeFetch, extraHosts: [] });
    const r = await web.openPage("https://youth.incheon.go.kr/youthpolicy/youthPolicyInfoDetail.do?poly_seq=412");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("응시일 현재 미취업자");
  });

  test("허용 목록 밖은 열지 않는다", async () => {
    const web = createWeb({ fetchFn: fakeFetch, extraHosts: [] });
    const r = await web.openPage("https://www.saramin.co.kr/x");
    expect(r.ok).toBe(false);
    expect(r.text).toContain("허용되지 않은");
  });

  test("페이지 열기는 정책당 6회까지", async () => {
    const web = createWeb({ fetchFn: fakeFetch, extraHosts: [] });
    for (let i = 0; i < 6; i++) await web.openPage("https://www.atfis.or.kr/lunch");
    const r = await web.openPage("https://www.atfis.or.kr/lunch");
    expect(r.ok).toBe(false);
    expect(r.text).toContain("한도");
  });

  test("허용 도메인이 허용되지 않은 곳으로 리다이렉트하면 따라가지 않는다", async () => {
    const redirecting = (async (u: string | URL) => {
      const url = String(u);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url.startsWith("https://www.atfis.or.kr")) return new Response(null, { status: 302, headers: { location: "https://evil.example.com/x" } });
      return new Response("<p>evil</p>", { status: 200 });
    }) as unknown as typeof fetch;
    const web = createWeb({ fetchFn: redirecting, extraHosts: [] });
    const r = await web.openPage("https://www.atfis.or.kr/lunch");
    expect(r.ok).toBe(false);
    expect(r.text).toContain("허용되지 않은");
  });

  test("허용 도메인 안의 리다이렉트는 따라간다", async () => {
    const redirecting = (async (u: string | URL) => {
      const url = String(u);
      if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
      if (url === "https://www.atfis.or.kr/lunch") return new Response(null, { status: 302, headers: { location: "/lunch/main.do" } });
      return new Response("<p>본문</p>", { status: 200 });
    }) as unknown as typeof fetch;
    const web = createWeb({ fetchFn: redirecting, extraHosts: [] });
    const r = await web.openPage("https://www.atfis.or.kr/lunch");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("본문");
  });

  const site = (routes: Record<string, () => Response>, seen: { url: string; redirect?: string }[] = []) =>
    (async (u: string | URL, init?: RequestInit) => {
      const url = String(u);
      seen.push({ url, redirect: init?.redirect });
      return (routes[url] ?? (() => new Response("", { status: 404 })))();
    }) as unknown as typeof fetch;

  test("리다이렉트로 옮겨 간 사이트의 robots.txt도 지킨다", async () => {
    const web = createWeb({
      fetchFn: site({
        "https://a.go.kr/r": () => new Response(null, { status: 302, headers: { location: "https://b.go.kr/secret" } }),
        "https://b.go.kr/robots.txt": () => new Response("User-agent: *\nDisallow: /secret"),
        "https://b.go.kr/secret": () => new Response("<p>비공개</p>"),
      }),
      extraHosts: [],
    });
    const r = await web.openPage("https://a.go.kr/r");
    expect(r.ok).toBe(false);
    expect(r.text).toContain("robots");
  });

  test("User-agent 줄이 연달아 오는 그룹도 적용한다", async () => {
    const web = createWeb({
      fetchFn: site({
        "https://a.go.kr/robots.txt": () => new Response("User-agent: *\nUser-agent: other\nDisallow: /"),
        "https://a.go.kr/x": () => new Response("<p>x</p>"),
      }),
      extraHosts: [],
    });
    expect((await web.openPage("https://a.go.kr/x")).ok).toBe(false);
  });

  test("와일드카드와 쿼리스트링 규칙을 지키고, Allow가 더 구체적이면 연다", async () => {
    const routes = {
      "https://a.go.kr/robots.txt": () => new Response("User-agent: *\nDisallow: /*.do\nDisallow: /board?id=\nAllow: /open/view.do"),
      "https://a.go.kr/a/list.do": () => new Response("<p>x</p>"),
      "https://a.go.kr/board?id=3": () => new Response("<p>x</p>"),
      "https://a.go.kr/open/view.do": () => new Response("<p>열림</p>"),
    };
    const web = createWeb({ fetchFn: site(routes), extraHosts: [] });
    expect((await web.openPage("https://a.go.kr/a/list.do")).ok).toBe(false);
    expect((await web.openPage("https://a.go.kr/board?id=3")).ok).toBe(false);
    expect((await web.openPage("https://a.go.kr/open/view.do")).ok).toBe(true);
  });

  test("robots.txt 요청은 리다이렉트를 따라가지 않는다", async () => {
    const seen: { url: string; redirect?: string }[] = [];
    const web = createWeb({ fetchFn: site({ "https://a.go.kr/x": () => new Response("<p>x</p>") }, seen), extraHosts: [] });
    await web.openPage("https://a.go.kr/x");
    expect(seen.find((s) => s.url.endsWith("/robots.txt"))?.redirect).toBe("manual");
  });

  test("정부24·정책브리핑은 공식 출처로 허용하되 비슷한 이름은 거부", () => {
    expect(isAllowedUrl("https://www.gov.kr/portal/service/serviceInfo/1", [])).toBe(true);
    expect(isAllowedUrl("https://plus.gov.kr/x", [])).toBe(true);
    expect(isAllowedUrl("https://www.korea.kr/news", [])).toBe(true);
    expect(isAllowedUrl("https://evilgov.kr/", [])).toBe(false);
    expect(isAllowedUrl("https://gov.kr.evil.com/", [])).toBe(false);
  });

  test("robots.txt가 막으면 열지 않는다", async () => {
    const blocking = (async (u: string | URL) =>
      String(u).endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /", { status: 200 }) : new Response("<p>x</p>")) as unknown as typeof fetch;
    const web = createWeb({ fetchFn: blocking, extraHosts: [] });
    const r = await web.openPage("https://www.atfis.or.kr/lunch");
    expect(r.ok).toBe(false);
    expect(r.text).toContain("robots");
  });
});
