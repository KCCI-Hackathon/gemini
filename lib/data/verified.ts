import { z } from "zod";
import type { Policy } from "./types";
import verifiedIndex from "@/data/verified/index";

export const StatusKey = z.enum([
  "unemployed",
  "employed",
  "in_training",
  "business_registered",
  "health_insured_employee",
  "participating_national_employment_support",
]);
export type StatusKey = z.infer<typeof StatusKey>;

const Quote = z.object({
  text: z.string().min(1),
  source: z.enum(["official", "api"]),
  url: z.string().optional(),
});
export type Quote = z.infer<typeof Quote>;

const Transition = z.enum(["none", "complete_training", "get_employed", "register_business"]);

export const VerifiedPolicySchema = z.object({
  id: z.string().regex(/^\d{20}$/),
  name: z.string(),
  applicationSubject: z.enum(["individual", "organization", "system"]),
  statusConditions: z.object({
    requires: z.array(StatusKey),
    excludes: z.array(StatusKey),
    /** 원문이 그 상태의 정의까지 분명히 하는가. false면 비해당 대신 확인 필요 */
    definitionClear: z.boolean(),
    quotes: z.array(Quote),
  }),
  referenceDate: z.object({ status: z.string().nullable(), residence: z.string().nullable() }),
  lookback: z
    .object({ kind: z.literal("no_training_or_employment"), months: z.number().int().positive(), quote: Quote })
    .nullable(),
  tenure: z.object({ since: z.string(), quote: Quote }).nullable(),
  age: z
    .object({
      min: z.number().nullable(),
      max: z.number().nullable(),
      referenceRule: z.enum(["fixed_date", "apply_date"]).nullable(),
      referenceDate: z.string().nullable(),
      quote: Quote.nullable(),
    })
    .nullable(),
  regionScope: z.object({
    /** "경남 고성군"처럼 시도까지 붙인 이름. null이면 API 지역 코드를 따른다 */
    sigunguLabels: z.array(z.string()).nullable(),
    quote: Quote.nullable(),
  }),
  incomeQuote: Quote.nullable(),
  restrictionQuotes: z.array(Quote.extend({ mentions: z.array(z.string()).optional() })),
  confirmedRelations: z.array(
    z.object({ otherId: z.string().nullable(), otherName: z.string(), type: z.literal("no_concurrent"), quote: Quote }),
  ),
  apply: z.object({
    start: z.string().nullable(),
    end: z.string().nullable(),
    endTime: z.string().nullable(),
    type: z.enum(["period", "always"]),
  }),
  sources: z.array(z.object({ url: z.string(), checkedAt: z.string() })).min(1),
  verificationStatus: z.enum(["human_verified", "draft"]),
  guidance: z
    .array(z.object({ transition: Transition, checkOrder: z.array(z.string()).min(1), rationale: z.string() }))
    .default([]),
  notes: z.string().default(""),
});
export type VerifiedPolicy = z.infer<typeof VerifiedPolicySchema>;

export function parseVerified(raw: unknown): VerifiedPolicy {
  return VerifiedPolicySchema.parse(raw);
}

let cache: Map<string, VerifiedPolicy> | null = null;

export function loadVerified(): Map<string, VerifiedPolicy> {
  if (!cache) {
    cache = new Map(verifiedIndex.map((raw) => {
      const v = parseVerified(raw);
      return [v.id, v];
    }));
  }
  return cache;
}

function allApiText(p: Policy): string {
  const t = p.texts;
  return [t.addQualification, t.excluded, t.income, t.support, t.description, p.name].join("\n").replace(/\s+/g, " ");
}

/** 출처가 api인 인용 중 원본 텍스트에 없는 것 */
export function checkQuotes(v: VerifiedPolicy, p: Policy): string[] {
  const hay = allApiText(p);
  const quotes: Quote[] = [
    ...v.statusConditions.quotes,
    ...(v.lookback ? [v.lookback.quote] : []),
    ...(v.tenure ? [v.tenure.quote] : []),
    ...(v.age?.quote ? [v.age.quote] : []),
    ...(v.regionScope.quote ? [v.regionScope.quote] : []),
    ...(v.incomeQuote ? [v.incomeQuote] : []),
    ...v.restrictionQuotes,
    ...v.confirmedRelations.map((r) => r.quote),
  ];
  return quotes
    .filter((q) => q.source === "api")
    .filter((q) => !hay.includes(q.text.replace(/\s+/g, " ")))
    .map((q) => q.text);
}
