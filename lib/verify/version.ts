import type { Policy } from "@/lib/data/types";
import type { VerifiedPolicy } from "@/lib/data/verified";
import { pickRound } from "@/lib/judge/rules";

export type VerifyVersion = { modifiedAt: string; roundKey: string | null };

export function verificationVersion(policy: Policy, verified: VerifiedPolicy | undefined, date: string): VerifyVersion {
  const pick = verified?.rounds?.length ? pickRound(verified.rounds, date) : null;
  if (pick?.state === "under_review" && !pick.round) return { modifiedAt: policy.modifiedAt, roundKey: null };
  const round = pick?.state !== "outside" ? pick?.round : null;
  return {
    modifiedAt: policy.modifiedAt,
    roundKey: round
      ? JSON.stringify(["notice", round.id, round.notice.year, round.notice.round, round.notice.url, round.notice.applyStart, round.notice.applyEnd])
      : JSON.stringify(["api", policy.name, policy.applyPeriodType, policy.applyStart, policy.applyEnd, policy.bizEnd]),
  };
}

export function verificationKey(policyId: string, version: VerifyVersion): string {
  return JSON.stringify([policyId, version.modifiedAt, version.roundKey]);
}
