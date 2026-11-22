// 계정 저장 계획 (프론트 명세 9.2). 서버가 기존 판정기로 다시 판정해 저장 당시 결과를 쓴다.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { evaluateRequest } from "@/lib/planner/catalog";
import { PlannerInputSchema, ProfileSnapshotSchema } from "@/lib/planner/schema";
import type { SavedPlan } from "@/lib/planner/types";
import type { Result } from "./auth";
import type { AccountStore, PlanCursor, User } from "./store";

// 상담 API(lib/plan/counsel.ts)와 같은 프로필 범위
const ProfileSchema = ProfileSnapshotSchema.extend({ recentHistory: z.enum(["yes", "no"]).optional(), examDate: z.string().optional() });
export const CreatePlanSchema = z.object({
  name: z.string().trim().min(1, "계획 이름을 입력해 주세요.").max(35, "계획 이름은 35자 이하예요."),
  source: z.enum(["manual", "recommendation"]),
  recommendationSource: z.enum(["ai", "rule"]).optional(),
  profileSnapshot: ProfileSchema,
  input: PlannerInputSchema,
}).refine(b => b.input.choices.length > 0, { message: "담은 정책이 있어야 저장할 수 있어요.", path: ["input", "choices"] });
const KEY = /^[A-Za-z0-9_-]{8,100}$/;
const PAGE = 20;

type Ctx = { store: AccountStore; now: Date };
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical((v as Record<string, unknown>)[k])).join(",")}}`
  : JSON.stringify(v) ?? "null";

export function createPlan(user: User | null, idempotencyKey: string | null, body: unknown, ctx: Ctx): Result {
  if (!user) return { status: 401, body: { error: "로그인이 필요해요." } };
  if (!idempotencyKey || !KEY.test(idempotencyKey)) return { status: 400, body: { error: "Idempotency-Key 헤더가 필요해요." } };
  const parsed = CreatePlanSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message ?? "계획 형식이 잘못됐어요." } };
  const requestHash = createHash("sha256").update(canonical(parsed.data)).digest("hex");
  const { name, source, recommendationSource, profileSnapshot, input } = parsed.data;
  const id = randomUUID();
  const plan: SavedPlan = {
    planId: id, schemaVersion: 2, name, createdAt: ctx.now.toISOString(), source,
    ...(recommendationSource && { recommendationSource }), profileSnapshot, input,
    savedEvaluation: evaluateRequest(profileSnapshot, input, ctx.now),
  };
  const { record, created } = ctx.store.insertPlan({ id, ownerId: user.id, idempotencyKey, requestHash, plan });
  if (!created && record.requestHash !== requestHash) return { status: 409, body: { error: "같은 저장 요청 키로 다른 내용을 보냈어요." } };
  return { status: created ? 201 : 200, body: { planId: record.id, createdAt: record.plan.createdAt } };
}

const encodeCursor = (c: PlanCursor) => Buffer.from(JSON.stringify([c.createdAt, c.id])).toString("base64url");
function decodeCursor(text: string): PlanCursor | null {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
    return typeof createdAt === "string" && typeof id === "string" ? { createdAt, id } : null;
  } catch { return null; }
}

export function listPlans(user: User | null, cursor: string | null, ctx: Ctx): Result {
  if (!user) return { status: 401, body: { error: "로그인이 필요해요." } };
  const after = cursor ? decodeCursor(cursor) : undefined;
  if (after === null) return { status: 400, body: { error: "목록 위치가 잘못됐어요." } };
  const rows = ctx.store.listPlans(user.id, PAGE + 1, after);
  const page = rows.slice(0, PAGE);
  const last = page.at(-1);
  return { status: 200, body: { plans: page, nextCursor: rows.length > PAGE && last ? encodeCursor({ createdAt: last.createdAt, id: last.planId }) : null } };
}

export function getPlan(user: User | null, id: string, ctx: Ctx): Result {
  if (!user) return { status: 401, body: { error: "로그인이 필요해요." } };
  // 없는 계획과 다른 사람의 계획을 구분하지 않는다
  const record = ctx.store.getPlan(user.id, id);
  return record ? { status: 200, body: record.plan } : { status: 404, body: { error: "계획을 찾을 수 없어요." } };
}
