"use client";
import Link from "next/link";
import { useState } from "react";
import type { Profile } from "@/lib/judge/types";
import { PERSONA_A } from "@/lib/judge/personas";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import type { PlannerInput } from "@/lib/planner/types";
import { ACCOUNT_NOTE } from "@/app/login/LoginForm";
import { signupAccount, type Me } from "@/lib/planner/server-storage";
import { ProfileForm } from "./Dialogs";
import s from "./workspace.module.css";

export const personaProfile: Profile = { ...PERSONA_A, events: [] };

// 첫 판정 요청 입력 : 예시 시작이면 시연 인물의 일정을, 아니면 빈 일정으로 시작한다
export function startInput(profile: Profile, demo: boolean, mutedKeys: string[] = []): PlannerInput {
  return { revision: 0, events: demo ? structuredClone(PERSONA_DEMO_EVENTS) : [], choices: [], mutedKeys: [...new Set([...mutedKeys, ...(profile.currentStatus.length ? [] : ["status"])])], preferredCategory: "all", ...(demo ? { demoId: "pathfinder-demo-2026" as const } : {}) };
}

// 예시로 둘러보기 : 시연 인물(PERSONA_A)로 첫 판정을 시작한다
export function demoStart(start: (profile: Profile, demo: boolean) => void) { start(structuredClone(personaProfile), true); }

/** 회원가입 요청. 성공하면 null, 실패하면 화면에 보여 줄 문장 */
export async function submitSignup(form: { email: string; password: string; confirm: string; agreed: boolean },
  signup: (email: string, password: string) => Promise<Me> = signupAccount): Promise<string | null> {
  if (!form.email.trim() || !form.password) return "이메일과 비밀번호를 입력해 주세요.";
  if (form.password !== form.confirm) return "비밀번호 확인이 일치하지 않아요.";
  if (!form.agreed) return "필수 약관에 동의해 주세요.";
  try { await signup(form.email, form.password); return null; }
  catch (e) { return e instanceof Error ? e.message : "가입하지 못했어요. 잠시 뒤 다시 시도해 주세요."; }
}

// 회원가입 폼 : 비밀번호는 서버에만 보내고 브라우저에 저장하지 않는다
function SignupForm({ onSignedUp }: { onSignedUp: () => void }) {
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [terms, setTerms] = useState(false), [privacy, setPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  return <form className={s.form} noValidate onSubmit={async e => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    const failed = await submitSignup({ email, password, confirm, agreed: terms && privacy });
    setBusy(false);
    if (failed) setError(failed); else onSignedUp();
  }}>
    <label>이메일<input type="email" placeholder="name@example.com" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
    <label>비밀번호 <span className={s.hint}>8자 이상</span><input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
    <label>비밀번호 확인<input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
    <label className={s.checkboxLabel}><input type="checkbox" checked={terms} onChange={e => setTerms(e.target.checked)} /> (필수) 이용약관 동의</label>
    <label className={s.checkboxLabel}><input type="checkbox" checked={privacy} onChange={e => setPrivacy(e.target.checked)} /> (필수) 개인정보 수집·이용 동의</label>
    <button className={`${s.primaryButton} ${s.wideButton}`} disabled={busy}>{busy ? "가입 중…" : "가입하고 내 정보 입력하기"}</button>
    {error && <p className={s.error} role="alert">{error}</p>}
    <p className={s.hint}>{ACCOUNT_NOTE}</p>
  </form>;
}

// 회원가입 화면 : 로그인 전에는 가입 폼, 로그인 뒤에는 계정 이름과 다음 단계
export function SignupScreen({ me, onNext, onDemo, onSaved, onSignedUp, onLogout, savedCount, error }: { me: Me | null; onNext: () => void; onDemo: () => void; onSaved: () => void; onSignedUp: () => void; onLogout: () => void; savedCount: number; error?: string | null }) {
  const account = me?.mode === "account" ? me : null;
  return <div className={s.entry}>
    <div className={s.entryHero}>
      <span className={s.entryLogo}>PATHFINDER</span>
      <img src="/pathfinder/robot-flag.png" alt="" />
      <h1>계획을 저장하고<br />이어서 확인해 보세요</h1>
      <p>둘러보기만 하려면 예시로 시작해도 돼요. 가입하면 계획을 내 계정에 저장하고, 로그인 없이 쓰면 이 브라우저에만 저장돼요.</p>
    </div>
    <div className={s.entryContent}>
      <div className={s.steps}><i className={s.on} /><i /><i /></div>
      {account ? <>
        <h2>{account.displayName}님, 반가워요</h2>
        <p>계획은 내 계정에 저장돼요.{account.durable ? "" : " 지금 서버는 시연용이라 재시작하면 저장한 내용이 사라질 수 있어요."}</p>
        <div className={s.form}>
          <button className={`${s.primaryButton} ${s.wideButton}`} onClick={onNext}>내 정보 입력하기</button>
          {error && <p className={s.error} role="alert">{error}</p>}
          <p className={`${s.hint} ${s.center}`}><button type="button" className={s.textButton} onClick={onSaved}>저장한 계획 확인 ({savedCount})</button> · <button type="button" className={s.textButton} onClick={onDemo}>예시로 둘러보기</button> · <button type="button" className={s.textButton} onClick={onLogout}>로그아웃</button></p>
        </div>
      </> : <>
        <h2>회원가입</h2>
        <p>이메일로 만들어 시작하세요.</p>
        <SignupForm onSignedUp={onSignedUp} />
        {error && <p className={s.error} role="alert">{error}</p>}
        <p className={`${s.hint} ${s.center}`}>이미 계정이 있나요? <Link href="/login">로그인</Link> · <button type="button" className={s.textButton} onClick={onDemo}>예시로 둘러보기</button> · <button type="button" className={s.textButton} onClick={onSaved}>저장한 계획 확인 ({savedCount})</button></p>
      </>}
    </div>
  </div>;
}

// 내 정보 입력 : 지금 ProfileForm 의 칸과 동작 그대로, 제출하면 첫 판정을 시작한다
export function OnboardingScreen({ onSave, onBack, error }: { onSave: (profile: Profile, mutedKeys: string[]) => void; onBack: () => void; error?: string | null }) {
  return <div className={s.entry}>
    <div className={s.entryHero}>
      <span className={s.entryLogo}>PATHFINDER</span>
      <img src="/pathfinder/robot-wave.png" alt="" />
      <h1>판정에 필요한 것만<br />몇 가지 여쭤볼게요</h1>
      <p>답을 건너뛰면 그 값에 기대는 정책은 ‘확인 필요’로 남겨요.</p>
    </div>
    <div className={s.entryContent}>
      <div className={s.steps}><i className={s.on} /><i className={s.on} /><i /></div>
      <h2>내 정보</h2>
      <ProfileForm onSave={onSave} onBack={onBack} submitLabel="정책 보드 열기" />
      {error && <p className={s.error} role="alert">{error}</p>}
    </div>
  </div>;
}
