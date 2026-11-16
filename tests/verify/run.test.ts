import { describe, expect, test } from "vitest";
import { runVerification, runFixedPipeline } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";
import { fakeFetch, scriptedClient } from "./helpers";

const NOW = new Date("2026-11-16T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const LUNCH = "20260921005400113480";
const BIO = "20260928005400113623";
const CHALLENGE = "20250122005400110346";

const INCHEON_URL = "https://youth.incheon.go.kr/youthpolicy/youthPolicyInfoDetail.do?poly_seq=412";
const MAFRA = "https://www.mafra.go.kr/home/index.do";
const ATFIS = "https://www.atfis.or.kr/lunch";
const BIO_URL = "https://www.biocamp.kr/board/?tb_nm=notice&m_mode=view&menu=bbs&pds_no=2026011210245137526&category=";
const MOEL = "http://www.moel.go.kr/policy/policyinfo/young/list18.do";
const WORK = "https://www.work.go.kr/youngChallenge/index.do";

const deps = (client: ReturnType<typeof scriptedClient>, extraHosts: string[] = []) => ({
  client,
  web: createWeb({ fetchFn: fakeFetch, extraHosts }),
  now: NOW,
});

describe("runVerification: 공고 탐색 루프", () => {
  test("인천 응시료: 링크가 바로 맞는 공고면 검색 없이 대조하고, 공고에만 있는 조건을 찾는다", async () => {
    const client = scriptedClient([
      [{ name: "open_page", input: { url: INCHEON_URL } }],
      [{ name: "record_judgement", input: { url: INCHEON_URL, verdict: "matching_notice", reason: "사업명·2026년·인천시 일치", quote: "응시일 현재 미취업자" } }],
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: INCHEON_URL, findings: [{ kind: "status_reference", text: "미취업 여부는 응시일 기준", quote: "응시일 현재 미취업자" }], mismatches: [{ kind: "notice_only_condition", api_value: "(없음)", notice_value: "응시일 현재 미취업자", quote: "응시일 현재 미취업자" }] } }],
    ]);
    const r = await runVerification(INCHEON, deps(client));
    expect(r.outcome).toBe("verified_against_notice");
    expect(r.noticeUrl).toBe(INCHEON_URL);
    expect(r.trail.some((s) => s.action === "search")).toBe(false);
    expect(r.mismatches.map((m) => m.kind)).toContain("notice_only_condition");
  });

  test("든든한 점심밥: 첫 화면이라 판단하면 찾아 들어가고, 시행 지역 불일치를 기록한다", async () => {
    const client = scriptedClient([
      [{ name: "open_page", input: { url: MAFRA } }],
      [{ name: "record_judgement", input: { url: MAFRA, verdict: "site_home", reason: "부처 첫 화면" } }],
      [{ name: "open_page", input: { url: ATFIS } }],
      [{ name: "record_judgement", input: { url: ATFIS, verdict: "matching_notice", reason: "aT 점심밥 사업 사이트", quote: "시범사업 수행 지자체" } }],
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: ATFIS, findings: [], mismatches: [{ kind: "region_scope", api_value: "전국", notice_value: "시범사업 수행 지자체(인천 없음)", quote: "시범사업 수행 지자체" }] } }],
    ]);
    const r = await runVerification(LUNCH, deps(client));
    expect(r.trail.find((s) => s.action === "judge")?.judgement?.verdict).toBe("site_home");
    expect(r.noticeUrl).toBe(ATFIS);
    expect(r.mismatches.map((m) => m.kind)).toContain("region_scope");
  });

  test("바이오: 다른 하위 과정 페이지는 근거로 채택하지 않고, 못 찾으면 확인 불가로 끝난다", async () => {
    const client = scriptedClient([
      [{ name: "open_page", input: { url: BIO_URL } }],
      [{ name: "record_judgement", input: { url: BIO_URL, verdict: "different_program", reason: "단국대 의약바이오 취업캠프 공고로 하위 과정", quote: "의약바이오 취업캠프" } }],
      [{ name: "open_page", input: { url: "https://www.motie.go.kr/bio" } }],
      [{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [{ kind: "different_program", api_value: "바이오전문인력양성(상시)", notice_value: "의약바이오 취업캠프 공고", quote: "의약바이오 취업캠프" }] } }],
    ]);
    const r = await runVerification(BIO, deps(client, ["www.biocamp.kr"]));
    expect(r.outcome).toBe("notice_not_found");
    expect(r.noticeUrl).toBeNull();
    expect(r.mismatches.map((m) => m.kind)).toContain("different_program");
  });

  test("판단을 기록하지 않은 페이지를 근거로 끝내려 하면 거부하고 다시 묻는다", async () => {
    const client = scriptedClient([
      [{ name: "open_page", input: { url: BIO_URL } }],
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: BIO_URL, findings: [], mismatches: [] } }],
      [{ name: "record_judgement", input: { url: BIO_URL, verdict: "different_program", reason: "하위 과정" } }],
      [{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }],
    ]);
    const r = await runVerification(BIO, deps(client, ["www.biocamp.kr"]));
    expect(r.outcome).toBe("notice_not_found");
    expect(client.calls).toBe(4);
  });

  test("접속 오류 페이지면 다른 공식 출처로 간다", async () => {
    const client = scriptedClient([
      [{ name: "open_page", input: { url: MOEL } }],
      [{ name: "record_judgement", input: { url: MOEL, verdict: "error", reason: "기술적인 문제로 서비스에 접속이 되지 않음" } }],
      [{ name: "open_page", input: { url: WORK } }],
      [{ name: "record_judgement", input: { url: WORK, verdict: "matching_notice", reason: "고용24 청년도전 안내", quote: "6개월 이내 취업 및 직업훈련 참여 이력이 없어야" } }],
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: WORK, findings: [{ kind: "lookback", text: "신청일로부터 6개월 이내 훈련 이력 없음", quote: "6개월 이내 취업 및 직업훈련 참여 이력이 없어야" }], mismatches: [] } }],
    ]);
    const r = await runVerification(CHALLENGE, deps(client));
    expect(r.trail.filter((s) => s.action === "judge").map((s) => s.judgement?.verdict)).toEqual(["error", "matching_notice"]);
    expect(r.findings[0].kind).toBe("lookback");
  });

  test("공고 원문에 없는 인용의 불일치·발견은 버린다", async () => {
    const client = scriptedClient([
      [{ name: "open_page", input: { url: INCHEON_URL } }],
      [{ name: "record_judgement", input: { url: INCHEON_URL, verdict: "matching_notice", reason: "일치" } }],
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: INCHEON_URL, findings: [{ kind: "age", text: "만 50세 이하", quote: "원문에 없는 문장" }], mismatches: [] } }],
    ]);
    const r = await runVerification(INCHEON, deps(client));
    expect(r.findings).toEqual([]);
  });

  test("한도: 모델이 계속 페이지만 열면 확인 불가로 끝난다", async () => {
    const client = scriptedClient([[{ name: "open_page", input: { url: ATFIS } }]]);
    const r = await runVerification(LUNCH, deps(client));
    expect(r.outcome).toBe("notice_not_found");
    expect(r.trail.filter((s) => s.action === "open").length).toBeLessThanOrEqual(7);
  });

  test("요청에는 정책 번호와 공개 텍스트만 들어간다", async () => {
    const client = scriptedClient([[{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }]]);
    await runVerification(INCHEON, deps(client));
    const body = JSON.stringify(client.requests);
    expect(body).toContain(INCHEON);
    expect(body).not.toMatch(/birthYm|sigungu|28185|participating/);
  });
});

describe("runFixedPipeline: 고정 처리 기준선", () => {
  test("바이오: 첫 링크를 그대로 근거로 채택한다(판단·재탐색 없음)", async () => {
    const client = scriptedClient([
      [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: BIO_URL, findings: [], mismatches: [] } }],
    ]);
    const r = await runFixedPipeline(BIO, deps(client, ["www.biocamp.kr"]));
    expect(r.noticeUrl).toBe(BIO_URL);
    expect(client.calls).toBe(1);
  });
});
