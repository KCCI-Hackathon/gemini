// 통합 설계 4.2(항목별 대조), 5.3-4(저장 결과로 낮추기), 5.4(실시간 대조 범위·새 회차)
import { beforeEach, describe, expect, test } from "vitest";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { judgeAll } from "@/lib/judge";
import { PERSONA_A } from "@/lib/judge/personas";
import { fieldCheckEffect } from "@/lib/verify/downgrade";
import { handleVerify, resetVerifyState } from "@/lib/verify/handler";
import { runVerification, type FieldCheck, type VerifyResult } from "@/lib/verify/run";
import { createWeb } from "@/lib/verify/web";
import { fakeFetch, scriptedClient } from "./helpers";

const NOW = new Date("2026-11-16T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const INCHEON_URL = "https://youth.incheon.go.kr/youthpolicy/youthPolicyInfoDetail.do?poly_seq=412";
const BIO = "20260928005400113623";

const finishWith = (fieldChecks: Record<string, unknown>[], notice: Record<string, unknown> | null) => [
  [{ name: "open_page", input: { url: INCHEON_URL } }],
  [{ name: "record_judgement", input: { url: INCHEON_URL, verdict: "matching_notice", reason: "사업명 일치", quote: "응시일 현재 미취업자" } }],
  [{ name: "finish", input: { outcome: "verified_against_notice", notice_url: INCHEON_URL, findings: [], mismatches: [], field_checks: fieldChecks, notice } }],
];

describe("finish의 항목별 대조(fieldChecks)", () => {
  test("신청기간·연령은 AI가 뽑은 값을 코드가 API 값과 비교한다", async () => {
    const client = scriptedClient(
      finishWith(
        [
          { field: "apply_period", status: "differs", notice_value: "2026-02-01~2026-11-30", quote: "신청기간 : 2026.02.01(09시) ~ 2026.11.30(18시)" },
          { field: "age", status: "match", notice_value: "18~39", quote: "지원연령 : 18세 ~ 39세" },
        ],
        { year: 2026, round: "2026년", title: "청년 자격증 응시료 지원", apply_start: "2026-02-01", apply_end: "2026-11-30" },
      ),
    );
    const r = await runVerification(INCHEON, { client, web: createWeb({ fetchFn: fakeFetch, extraHosts: [] }), now: NOW });
    const by = Object.fromEntries(r.fieldChecks!.map((f) => [f.field, f]));
    // AI가 differs라고 해도 날짜가 같으면 코드가 match로 정한다
    expect(by.apply_period).toMatchObject({ status: "match", apiValue: "2026-02-01~2026-11-30", noticeValue: "2026-02-01~2026-11-30" });
    expect(by.age).toMatchObject({ status: "match", apiValue: "18~39" });
    expect(r.notice).toEqual({ year: 2026, round: "2026년", title: "청년 자격증 응시료 지원", applyStart: "2026-02-01", applyEnd: "2026-11-30" });
    expect(r.checkedAt).toBe("2026-11-16");
  });

  test("인용이 원문에 없으면 notice_not_found", async () => {
    const client = scriptedClient(finishWith([{ field: "support", status: "differs", notice_value: "연 20만원", quote: "연 최대 20만원" }], null));
    const r = await runVerification(INCHEON, { client, web: createWeb({ fetchFn: fakeFetch, extraHosts: [] }), now: NOW });
    expect(r.fieldChecks).toEqual([expect.objectContaining({ field: "support", status: "notice_not_found" })]);
  });

  test("신청기간이 실제로 다르면 differs", async () => {
    const client = scriptedClient(finishWith([{ field: "apply_period", status: "match", notice_value: "2026-03-01~2026-11-30", quote: "신청기간 : 2026.02.01(09시) ~ 2026.11.30(18시)" }], null));
    const r = await runVerification(INCHEON, { client, web: createWeb({ fetchFn: fakeFetch, extraHosts: [] }), now: NOW });
    expect(r.fieldChecks![0].status).toBe("differs");
  });
});

const result = (policyId: string, fieldChecks: FieldCheck[], notice: VerifyResult["notice"] = null): VerifyResult => ({
  policyId,
  mode: "agent",
  outcome: "verified_against_notice",
  noticeUrl: "https://example.go.kr/n",
  findings: [],
  mismatches: [],
  trail: [],
  usage: { calls: 1, inputTokens: 0, outputTokens: 0, pagesOpened: 1 },
  fieldChecks,
  notice,
  checkedAt: "2026-11-16",
});
const differs = (field: FieldCheck["field"]): FieldCheck => ({ field, status: "differs", apiValue: "a", noticeValue: "b", quote: "q" });

describe("fieldCheckEffect: 낮추기는 API 값을 판정에 쓴 축만", () => {
  const policy = (id: string) => loadSnapshot().policies.find((p) => p.id === id)!;

  test("승인 규칙이 없는 정책: 신청기간이 다르면 모집 축, 연령이 다르면 개인 축을 확인 필요로", () => {
    const e = fieldCheckEffect(result(BIO, [differs("apply_period"), differs("age"), differs("support")]), policy(BIO), undefined, "2026-11-16");
    expect(e.recruitment).toBe("공고와 신청기간이 다릅니다");
    expect(e.personal).toEqual(["공고와 연령 조건이 다릅니다"]);
    expect(e.notes).toEqual(["API 지원 내용이 공고와 다름(참고)"]);
    expect(e.newRound).toBeNull();
  });

  test("그 회차에 승인된 규칙이 있는 정책: 낮추지 않고 참고로만", () => {
    const v = loadVerified().get(INCHEON)!;
    const e = fieldCheckEffect(result(INCHEON, [differs("apply_period")], { year: 2026, round: "2026년", title: "t", applyStart: null, applyEnd: null }), policy(INCHEON), v, "2026-11-16");
    expect(e.recruitment).toBeNull();
    expect(e.personal).toEqual([]);
    expect(e.notes).toEqual(["API 신청기간이 공고와 다름(참고)"]);
  });

  test("대조한 공고가 승인된 회차와 다르면(새 회차) '올해 공고 기준 확인 중' + 원문 링크, 다름으로 낮추지 않음", () => {
    const v = loadVerified().get(INCHEON)!;
    const e = fieldCheckEffect(result(INCHEON, [differs("apply_period")], { year: 2027, round: "2027년", title: "2027 공고", applyStart: "2027-02-01", applyEnd: "2027-11-30" }), policy(INCHEON), v, "2026-11-16");
    expect(e.newRound).toEqual({ text: "올해 공고 기준 확인 중", url: "https://example.go.kr/n" });
    expect(e.recruitment).toBeNull();
  });
});

describe("판정에 저장 결과의 fieldChecks를 반영한다", () => {
  test("저장 결과가 없으면 판정은 그대로", () => {
    expect(judgeAll(PERSONA_A, NOW).find((r) => r.policy.id === INCHEON)!.axes.recruitment).toBe("open");
  });
});

describe("실시간 대조는 승인 규칙이 없는 정책만", () => {
  beforeEach(() => resetVerifyState());
  const ctx = { env: { EXTERNAL_AI_ENABLED: "true", ANTHROPIC_API_KEY: "test" }, ip: "1.1.1.1", now: NOW, makeClient: () => scriptedClient([]), saved: {} };

  test("그 회차에 승인된 규칙이 있으면 돌리지 않는다", async () => {
    const out = await handleVerify({ policyId: INCHEON }, ctx);
    expect(out.status).toBe(409);
    expect(out.body.error).toContain("승인된 공고 규칙");
  });
});

describe("저장 결과의 fieldChecks가 판정을 낮춘다", () => {
  test("승인 규칙 없는 정책: 신청기간이 다르면 모집 축 '기간 확인 필요' + 사유", async () => {
    const { withSavedResults } = await import("@/lib/verify/saved");
    const { judgePolicy } = await import("@/lib/judge");
    const p = loadSnapshot().policies.find((x) => x.id === BIO)!;
    const before = judgePolicy(p, undefined, PERSONA_A, NOW);
    const restore = withSavedResults({ [BIO]: result(BIO, [differs("apply_period"), differs("age")]) });
    try {
      const after = judgePolicy(p, undefined, PERSONA_A, NOW);
      expect(after.recruitment).toBe("unknown");
      expect(after.fieldNotes).toContain("공고와 신청기간이 다릅니다");
      expect(after.personal.reasons).toContain("공고와 연령 조건이 다릅니다");
      // 낮추기만: 비해당은 비해당 그대로
      if (before.personal.value === "ineligible") expect(after.personal.value).toBe("ineligible");
      else expect(after.personal.value).toBe("needs_check");
    } finally {
      restore();
    }
  });

  test("승인 규칙 정책: 판정 그대로, 참고 문구만", async () => {
    const { withSavedResults } = await import("@/lib/verify/saved");
    const restore = withSavedResults({ [INCHEON]: result(INCHEON, [differs("apply_period")], { year: 2026, round: "2026년", title: "t", applyStart: null, applyEnd: null }) });
    try {
      const r = judgeAll(PERSONA_A, NOW).find((x) => x.policy.id === INCHEON)!;
      expect(r.axes.recruitment).toBe("open");
      expect(r.axes.fieldNotes).toEqual(["API 신청기간이 공고와 다름(참고)"]);
    } finally {
      restore();
    }
  });

  test("승인 규칙 정책에서 새 회차 공고를 찾았으면 '올해 공고 기준 확인 중'", async () => {
    const { withSavedResults } = await import("@/lib/verify/saved");
    const restore = withSavedResults({ [INCHEON]: result(INCHEON, [], { year: 2027, round: "2027년", title: "2027 공고", applyStart: "2027-02-01", applyEnd: null }) });
    try {
      const r = judgeAll(PERSONA_A, NOW).find((x) => x.policy.id === INCHEON)!;
      expect(r.axes.personal.reasons).toContain("올해 공고 기준 확인 중");
      expect(r.axes.personal.value).toBe("needs_check");
    } finally {
      restore();
    }
  });
});
