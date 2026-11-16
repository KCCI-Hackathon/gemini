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

  test("robots.txt가 막으면 열지 않는다", async () => {
    const blocking = (async (u: string | URL) =>
      String(u).endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /", { status: 200 }) : new Response("<p>x</p>")) as unknown as typeof fetch;
    const web = createWeb({ fetchFn: blocking, extraHosts: [] });
    const r = await web.openPage("https://www.atfis.or.kr/lunch");
    expect(r.ok).toBe(false);
    expect(r.text).toContain("robots");
  });
});
