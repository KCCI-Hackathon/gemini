"use client";
import Link from "next/link";
import { useState } from "react";
import { loginAccount, type Me } from "@/lib/planner/server-storage";
import styles from "../site.module.css";

export const ACCOUNT_NOTE = "계정 정보는 이 서비스의 서버에만 저장되고, 비밀번호는 암호화해 보관해요.";

/** 로그인 요청. 성공하면 null, 실패하면 화면에 보여 줄 문장 */
export async function submitLogin(email: string, password: string, login: (email: string, password: string) => Promise<Me> = loginAccount): Promise<string | null> {
  if (!email.trim() || !password) return "이메일과 비밀번호를 입력해 주세요.";
  try { await login(email, password); return null; }
  catch (e) { return e instanceof Error ? e.message : "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요."; }
}

// 로그인 폼 : 성공하면 앱으로 이동한다. 비밀번호는 서버에만 보내고 브라우저에 저장하지 않는다
export function LoginForm() {
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  return (
    <form className={styles.loginCard} noValidate onSubmit={async e => {
      e.preventDefault(); if (busy) return;
      setBusy(true); setError(null);
      const failed = await submitLogin(email, password);
      if (failed) { setError(failed); setBusy(false); return; }
      window.location.href = "/app";
    }}>
      <h2>로그인</h2>
      <p className={styles.sub}>이메일로 이어서 시작하세요</p>
      <div className={styles.field}><label htmlFor="em">이메일</label><input id="em" type="email" placeholder="name@example.com" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></div>
      <div className={styles.field}><label htmlFor="pw">비밀번호</label><input id="pw" type="password" placeholder="비밀번호 입력" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></div>
      <button className={`${styles.btn} ${styles.primary}`} type="submit" disabled={busy}>{busy ? "로그인 중…" : "로그인"}</button>
      {error && <p className={styles.msg} role="alert">{error}</p>}
      <p className={styles.msg}>{ACCOUNT_NOTE}</p>
      <p className={styles.join}>처음이신가요? <Link href="/app#signup">회원가입</Link></p>
    </form>
  );
}
