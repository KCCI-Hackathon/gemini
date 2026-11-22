import { createHash } from "node:crypto";
import { normalizeSpace } from "@/lib/verify/web";
import type { Condition, Effect, Field, Kind, Verdict } from "@/lib/data/overlap-schema";

import type { ModelId } from "./gemini";
export type { ModelId } from "./gemini";
export type Pass = 1 | 2;
export type Ask = (request: {
  stage: "extract" | "link" | "verify";
  pass: Pass;
  repair: 0 | 1;
  prompt: string;
  model?: ModelId;
}) => Promise<{ model: ModelId; hash: string; text: string }>;
export type PublicField = { b_policy_id: string; name: string; field: Field; text: string };
export type Mention = { text: string; org: string | null; type: "program" | "category" | "law" };
export type Clause = {
  b_policy_id: string; field: Field; quote: string; mentions: Mention[]; kind: Kind;
  effect_type: Effect | null; condition_type: Condition | null; condition_params: Record<string, unknown>;
  exception: string | null; period_text: string | null; restricted_item: string | null;
  start: number; end: number; occurrences: number; pass: Pass; response_hash: string; model: ModelId;
};
export type LinkedMention = {
  id: string; clause: Clause; mention: Mention; a: string | null;
  method: "exact" | "ai" | "none"; a_group_ids: string[]; orgMatches: boolean; link_hash: string | null;
  link_issue?: string;
};
export type Counterexample = "deduction" | "allowed" | "exception";
export type Verification = {
  claimId: string; counterexample: Counterexample | null; verdict: Verdict; reason: string;
  verify_quote: string; validQuote: boolean; model: ModelId; response_hash: string;
};
export function digest(...values: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

/** Compare normalized whitespace, but preserve offsets and the characters in the source. */
export function locate(text: string, quote: string) {
  const words = normalizeSpace(quote);
  if (!words || !normalizeSpace(text).includes(words)) return null;
  const escaped = words.split(" ").map(s => s.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&"));
  const matches = [...text.matchAll(new RegExp(escaped.join("\\s+"), "g"))];
  if (!matches.length) return null;
  const m = matches[0];
  return { quote: m[0], start: m.index!, end: m.index! + m[0].length, occurrences: matches.length };
}

export function indexedRows(text: string, size: number): Record<string, unknown>[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw) || raw.length !== size) throw Error("응답 개수 불일치");
  const ordered: Record<string, unknown>[] = [];
  for (const row of raw) {
    if (!row || !Number.isInteger(row.index) || row.index < 1 || row.index > size || ordered[row.index - 1]) {
      throw Error("모델 응답 index 오류");
    }
    ordered[row.index - 1] = row;
  }
  return ordered;
}
