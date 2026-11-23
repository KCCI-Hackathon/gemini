import { expect, test } from "vitest";
import { loadVerified } from "@/lib/data/verified";
import { judgePolicy } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import { lookupSaved, saveVerification, VERIFY_RECHECK, withSavedResults } from "@/lib/verify/saved";
import { verificationVersion } from "@/lib/verify/version";
import { loadSnapshot } from "@/lib/data/snapshot";
import { handleVerify, resetVerifyState } from "@/lib/verify/handler";
import { runVerification } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";
import { fakeFetch, scriptedClient } from "./helpers";

const ID = "20260406005400212445";
const TARGET = "https://youth.incheon.go.kr/youthpolicy/youthPolicyInfoDetail.do?poly_seq=412";
const OTHER = "https://www.atfis.or.kr/lunch";
const NOW = new Date("2026-11-16T12:00:00+09:00");

test("버전 없는 기존 결과는 다시 확인하도록 안내한다", async () => {
  resetVerifyState();
  const result = await handleVerify({ policyId: ID }, {
    env: {}, ip: "test", now: NOW, makeClient: () => { throw new Error("unexpected live call"); },
    saved: { [ID]: { policyId: ID } } as never,
  });
  expect(result.status).toBe(409);
  expect(result.body.source).toBeUndefined();
  expect(result.body.error).toContain("재확인");
});

test("다른 공고와 관련 없는 문의 문장을 연령 조건 근거로 사용하지 않는다", async () => {
  const quote = "문의처: 인천 청년정책과 032-123-4567";
  const age = "지원연령 : 18세 ~ 39세";
  const testimonialFragment = "만 25세 ~ 34세";
  const testimonial = `${testimonialFragment} 참가자의 경험을 소개합니다.`;
  const other = "시범사업 수행 지자체";
  const unopenedUrl = "https://youth.incheon.go.kr/unopened-application";
  const client = scriptedClient([
    [
      { name: "open_page", input: { url: TARGET } },
      { name: "open_page", input: { url: OTHER } },
    ],
    [
      { name: "record_judgement", input: { url: TARGET, verdict: "matching_notice", reason: "일치" } },
      { name: "record_judgement", input: { url: OTHER, verdict: "different_program", reason: "다른 사업" } },
    ],
    [{ name: "finish", input: {
      outcome: "verified_against_notice", notice_url: TARGET,
      findings: [{ kind: "age", quote }, { kind: "age", quote: testimonial }, { kind: "age", quote: testimonialFragment }, { kind: "age", quote: age, source_url: unopenedUrl }, { kind: "age", quote: age }],
      mismatches: [{ kind: "region_scope", quote: other }, { kind: "notice_only_condition", quote }],
      field_checks: [
        ...[quote, other, testimonial, age].map((quote) => ({ field: "age", status: "match", notice_value: "18~39", quote })),
        { field: "age", status: "match", notice_value: "25~34", quote: testimonialFragment },
        { field: "apply_link", status: "match", notice_value: unopenedUrl, quote: `신청 링크: ${unopenedUrl}` },
      ],
      notice: { year: 2040, round: "추가 모집", title: "2040년 추가 공고", apply_start: "2040-01-01", apply_end: "2040-02-01" },
    } }],
  ]);
  const fetchFn = (async (input) => String(input) === TARGET
    ? new Response(`<html><p>${quote}</p><p>${age}</p><p>참여 후기: ${testimonial}</p><p>신청 링크: ${unopenedUrl}</p></html>`, { headers: { "content-type": "text/html" } })
    : fakeFetch(input)) as typeof fetch;
  const result = await runVerification(ID, { client, web: createWeb({ fetchFn, extraHosts: [] }), now: NOW });
  expect(result.findings.map((finding) => finding.quote)).toEqual([age]);
  expect(result.mismatches).toEqual([]);
  expect(result.fieldChecks?.map((field) => [field.status, field.quote])).toEqual([
    ["notice_not_found", ""], ["notice_not_found", ""], ["notice_not_found", ""], ["match", age], ["notice_not_found", ""], ["notice_not_found", ""],
  ]);
  expect(result.notice).toBeNull();
  expect(result).toMatchObject({ version: { modifiedAt: loadSnapshot().policies.find((policy) => policy.id === ID)!.modifiedAt } });
});


test("수정일 또는 회차만 달라지면 이전 대조를 이력에 두고 판정에 적용하지 않는다", () => {
  const policy = loadSnapshot().policies.find((policy) => policy.id === ID)!;
  const reviewed = loadVerified().get(ID)!;
  const selected = reviewed.rounds![0];
  const nextRound = { ...selected, id: "extra", notice: { ...selected.notice, round: "추가 모집" } };
  const newReviewed = { ...reviewed, rounds: [nextRound] };
  const newPolicy = { ...policy, modifiedAt: "2026-11-20" };
  const day = "2026-11-16";
  const original = verificationVersion(policy, reviewed, day);
  const results: Parameters<typeof saveVerification>[0] = {};
  const result = {
    policyId: ID, version: original, mode: "agent" as const, outcome: "verified_against_notice" as const,
    noticeUrl: TARGET, findings: [], mismatches: [], trail: [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, pagesOpened: 0 },
    fieldChecks: [{ field: "age" as const, status: "differs" as const, apiValue: "18~39", noticeValue: "19~39", quote: "지원연령 19세~39세" }],
  };
  saveVerification(results, result);

  const restore = withSavedResults(results);
  try {
    expect(lookupSaved(results, ID, original)).toEqual({ result, needsReview: false });
    expect(judgePolicy(policy, reviewed, PERSONA_A, NOW).fieldNotes).toEqual(["API 연령 조건이 공고와 다름(참고)"]);
    expect(judgePolicy(newPolicy, reviewed, PERSONA_A, NOW).fieldNotes).toEqual([VERIFY_RECHECK]);
    expect(judgePolicy(policy, newReviewed, PERSONA_A, NOW).fieldNotes).toEqual([VERIFY_RECHECK]);
    const updated = { ...result, version: verificationVersion(newPolicy, reviewed, day), fieldChecks: [] };
    saveVerification(results, updated);
    expect(lookupSaved(results, ID, updated.version)).toEqual({ result: updated, needsReview: false });
    expect(Object.values(results)).toEqual([result, updated]);
  } finally {
    restore();
  }
});

test("같은 정책과 수정일이라도 달라진 회차의 캐시는 재사용하지 않는다", async () => {
  resetVerifyState();
  const reviewed = loadVerified().get(ID)!;
  const original = reviewed.rounds!;
  const open = original[0];
  const first = { ...open, status: "under_review" as const };
  const next = { ...first, id: "extra", notice: { ...first.notice, round: "추가 모집" } };
  const client = scriptedClient([[{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }]]);
  const ctx = {
    env: { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "test" },
    ip: "test", now: NOW, makeClient: () => client, saved: {},
  };
  try {
    reviewed.rounds = [first];
    const before = await handleVerify({ policyId: ID }, ctx);
    expect(before.body.source).toBe("live");
    reviewed.rounds = [next];
    const after = await handleVerify({ policyId: ID }, ctx);
    expect(after.body.source).toBe("live");
    expect(after.body.result?.version?.roundKey).not.toEqual(before.body.result?.version?.roundKey);
    expect(client.calls).toBe(2);
  } finally {
    reviewed.rounds = original;
  }
});


test.each([OTHER, TARGET])("이미 지난 회차로 등록된 공고는 현재 공고 원문(%s)에 대응하지 않으면 사용하지 않는다", async (activeUrl) => {
  const reviewed = loadVerified().get(ID)!;
  const original = reviewed.rounds!;
  const old = { ...original[0], notice: { ...original[0].notice, url: TARGET, applyEnd: "2026-11-15" } };
  const active = { ...original[0], id: "extra", notice: { ...original[0].notice, round: "추가 모집", url: activeUrl, applyStart: "2026-11-16" } };
  const client = scriptedClient([
    [{ name: "open_page", input: { url: TARGET } }],
    [{ name: "record_judgement", input: { url: TARGET, verdict: "matching_notice", reason: "사업명 일치" } }],
    [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: TARGET, findings: [], mismatches: [] } }],
    [{ name: "finish", input: { outcome: "notice_not_found", notice_url: null, findings: [], mismatches: [] } }],
  ]);
  try {
    reviewed.rounds = [old, active];
    const result = await runVerification(ID, { client, web: createWeb({ fetchFn: fakeFetch, extraHosts: [] }), now: NOW });
    expect(result.outcome).toBe("notice_not_found");
    expect(result.trail).toEqual(expect.arrayContaining([expect.objectContaining({ action: "reject", target: TARGET })]));
  } finally {
    reviewed.rounds = original;
  }
});
