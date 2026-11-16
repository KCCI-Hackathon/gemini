import { expect, test } from "vitest";
import { score } from "@/scripts/verify-eval";
import type { VerifyResult } from "@/lib/verify/run";

const r = (noticeUrl: string | null): VerifyResult => ({
  policyId: "x",
  mode: "agent",
  outcome: noticeUrl ? "verified_against_notice" : "notice_not_found",
  noticeUrl,
  findings: [],
  mismatches: [],
  trail: [],
  usage: { calls: 1, inputTokens: 1, outputTokens: 1, pagesOpened: 1 },
});

test("다른 사업의 공고를 채택하면 잘못된 근거로 센다", () => {
  const s = score([
    { answer: { policyId: "a", correctNoticeUrls: ["https://ok"] }, result: r("https://ok/1"), originalOk: true },
    { answer: { policyId: "b", correctNoticeUrls: null }, result: r("https://wrong"), originalOk: false },
    { answer: { policyId: "c", correctNoticeUrls: null }, result: r(null), originalOk: false },
  ]);
  expect(s.wrongEvidenceRate).toBeCloseTo(1 / 3);
  expect(s.properStopRate).toBe(0.5);
  expect(s.originalLinkSuccess).toBe(1);
});
