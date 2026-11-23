// 아이디(이메일)·비밀번호 계정과 세션. 비밀번호는 scrypt 해시로만 저장하고, 세션 토큰은 해시만 저장한다.
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AccountStore, User } from "./store";

export const SESSION_COOKIE = "pf_session";
const SESSION_DAYS = 30;
const KEY_LEN = 64;

function scryptAsync(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => scrypt(password, salt, KEY_LEN, (e, key) => e ? reject(e) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${(await scryptAsync(password, salt)).toString("base64")}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// 없는 이메일도 같은 시간만큼 해시를 계산해, 응답 시간으로 가입 여부를 알 수 없게 한다
const DUMMY_HASH = hashPassword(randomUUID());

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export const SignupSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("이메일 형식을 확인해 주세요."),
  password: z.string().min(8, "비밀번호는 8자 이상이에요.").max(128, "비밀번호는 128자 이하예요."),
  displayName: z.string().trim().min(1).max(20, "이름은 20자 이하예요.").optional(),
});
export const LoginSchema = z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().max(128) });

export type Result = { status: number; body: unknown; setCookie?: string };
type Ctx = { store: AccountStore; now: Date; secure: boolean };

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number) {
  return [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`, ...(secure ? ["Secure"] : [])].join("; ");
}
function startSession(ctx: Ctx, user: User): string {
  const token = randomBytes(32).toString("base64url");
  ctx.store.createSession(tokenHash(token), user.id, new Date(ctx.now.getTime() + SESSION_DAYS * 86_400_000).toISOString(), ctx.now.toISOString());
  return sessionCookie(token, ctx.secure, SESSION_DAYS * 86_400);
}
const me = (u: User) => ({ mode: "account" as const, userId: u.id, displayName: u.displayName });

export async function signup(body: unknown, ctx: Ctx): Promise<Result> {
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요." } };
  const { email, password } = parsed.data;
  const user = ctx.store.createUser({
    id: randomUUID(), email, displayName: parsed.data.displayName ?? email.split("@")[0].slice(0, 20),
    passwordHash: await hashPassword(password), createdAt: ctx.now.toISOString(),
  });
  if (!user) return { status: 409, body: { error: "이미 가입된 이메일이에요. 로그인해 주세요." } };
  return { status: 201, body: me(user), setCookie: startSession(ctx, user) };
}

// shortcut: 실패 횟수는 인스턴스 메모리에 센다. 운영 DB를 정하면 공유 저장소로 옮긴다.
const failures = new Map<string, { n: number; until: number }>();
const MAX_FAILURES = 10, LOCK_MS = 15 * 60_000;
export function resetLoginLimits() { failures.clear(); }

export async function login(body: unknown, ctx: Ctx & { ip: string }): Promise<Result> {
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "이메일과 비밀번호를 입력해 주세요." } };
  const key = `${ctx.ip}:${parsed.data.email}`, now = ctx.now.getTime();
  if (failures.size > 10_000) for (const [k, v] of failures) if (v.until <= now) failures.delete(k);
  const f = failures.get(key);
  if (f && f.n >= MAX_FAILURES && f.until > now) return { status: 429, body: { error: "로그인 시도가 많아요. 15분 뒤에 다시 시도해 주세요." } };
  const user = ctx.store.findUserByEmail(parsed.data.email);
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? await DUMMY_HASH);
  if (!user || !ok) {
    const n = f && f.until > now ? f.n + 1 : 1;
    failures.set(key, { n, until: now + LOCK_MS });
    return { status: 401, body: { error: "이메일 또는 비밀번호가 맞지 않아요." } };
  }
  failures.delete(key);
  return { status: 200, body: me(user), setCookie: startSession(ctx, user) };
}

export function logout(token: string | null, ctx: Ctx): Result {
  if (token) ctx.store.deleteSession(tokenHash(token));
  return { status: 200, body: { mode: "guest" }, setCookie: sessionCookie("", ctx.secure, 0) };
}

export function currentUser(token: string | null, ctx: Pick<Ctx, "store" | "now">): User | null {
  return token ? ctx.store.findSessionUser(tokenHash(token), ctx.now.toISOString()) : null;
}

export function getMe(token: string | null, ctx: Pick<Ctx, "store" | "now"> & { durable: boolean }): Result {
  const user = currentUser(token, ctx);
  return { status: 200, body: user ? { ...me(user), durable: ctx.durable } : { mode: "guest" } };
}
