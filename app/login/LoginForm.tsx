"use client";
import Link from "next/link";
import { useState } from "react";
import styles from "../site.module.css";

export const DEMO_MESSAGE = "시연용 화면이에요. 입력한 내용은 어디로도 전송되지 않아요.";

// 시연용 제출 : 입력을 읽거나 보내지 않고 앱 로딩 화면으로만 이동한다
export function demoSubmit(event: { preventDefault(): void }, go: (url: string) => void) {
  event.preventDefault();
  go("/app#building");
}

// 시연용 로그인 폼 : 입력값은 상태에도 저장하지 않는다
export function LoginForm() {
  const [msg, setMsg] = useState(false);
  return (
    <form className={styles.loginCard} noValidate onSubmit={e => demoSubmit(e, url => { window.location.href = url; })}>
      <h2>로그인</h2>
      <p className={styles.sub}>이메일로 이어서 시작하세요</p>
      <div className={styles.field}><label htmlFor="em">이메일</label><input id="em" type="email" placeholder="name@example.com" autoComplete="off" /></div>
      <div className={styles.field}><label htmlFor="pw">비밀번호</label><input id="pw" type="password" placeholder="비밀번호 입력" autoComplete="off" /></div>
      <div className={styles.row}><label><input type="checkbox" /> 로그인 유지</label><a href="#">비밀번호 찾기</a></div>
      <button className={`${styles.btn} ${styles.primary}`} type="submit">로그인</button>
      <div className={styles.or}>또는</div>
      <div className={styles.social}>
        <button className={`${styles.btn} ${styles.kakao}`} type="button" onClick={() => setMsg(true)}>카카오로 시작하기</button>
        <button className={`${styles.btn} ${styles.naver}`} type="button" onClick={() => setMsg(true)}>네이버로 시작하기</button>
      </div>
      {msg && <p className={styles.msg}>{DEMO_MESSAGE}</p>}
      <p className={styles.join}>처음이신가요? <Link href="/app#signup">회원가입</Link></p>
    </form>
  );
}
