"use client";
import Link from "next/link";
import type { Profile } from "@/lib/judge/types";
import { PERSONA_A } from "@/lib/judge/personas";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import type { PlannerInput } from "@/lib/planner/types";
import { DEMO_MESSAGE } from "@/app/login/LoginForm";
import { ProfileForm } from "./Dialogs";
import s from "./workspace.module.css";

export const personaProfile: Profile = { ...PERSONA_A, events: [] };

// 첫 판정 요청 입력 : 예시 시작이면 시연 인물의 일정을, 아니면 빈 일정으로 시작한다
export function startInput(profile: Profile, demo: boolean, mutedKeys: string[] = []): PlannerInput {
  return { revision: 0, events: demo ? structuredClone(PERSONA_DEMO_EVENTS) : [], choices: [], mutedKeys: [...new Set([...mutedKeys, ...(profile.currentStatus.length ? [] : ["status"])])], preferredCategory: "all", ...(demo ? { demoId: "pathfinder-demo-2026" as const } : {}) };
}

// 예시로 둘러보기 : 시연 인물(PERSONA_A)로 첫 판정을 시작한다
export function demoStart(start: (profile: Profile, demo: boolean) => void) { start(structuredClone(personaProfile), true); }

// 회원가입(시연) : 입력은 읽지도 저장하지도 보내지도 않고 다음 화면으로만 간다
export function SignupScreen({ onNext, onDemo, onSaved, savedCount, error }: { onNext: () => void; onDemo: () => void; onSaved: () => void; savedCount: number; error?: string | null }) {
  return <div className={s.entry}>
    <div className={s.entryHero}>
      <span className={s.entryLogo}>PATHFINDER</span>
      <img src="/pathfinder/robot-flag.png" alt="" />
      <h1>계획을 저장하고<br />이어서 확인해 보세요</h1>
      <p>둘러보기만 하려면 예시로 시작해도 돼요. 이 화면은 시연용이라 입력한 내용은 저장하지 않고, 계획은 이 브라우저에만 저장돼요.</p>
    </div>
    <div className={s.entryContent}>
      <div className={s.steps}><i className={s.on} /><i /><i /></div>
      <h2>회원가입</h2>
      <p>이메일로 만들어 시작하세요.</p>
      <form className={s.form} noValidate onSubmit={e => { e.preventDefault(); onNext(); }}>
        <label>이메일<input type="email" placeholder="name@example.com" autoComplete="off" /></label>
        <label>비밀번호 <span className={s.hint}>영문·숫자 포함 8자 이상</span><input type="password" autoComplete="off" /></label>
        <label>비밀번호 확인<input type="password" autoComplete="off" /></label>
        <label className={s.checkboxLabel}><input type="checkbox" defaultChecked /> (필수) 이용약관 동의</label>
        <label className={s.checkboxLabel}><input type="checkbox" defaultChecked /> (필수) 개인정보 수집·이용 동의</label>
        <button className={`${s.primaryButton} ${s.wideButton}`}>가입하고 내 정보 입력하기</button>
        <p className={s.hint}>{DEMO_MESSAGE}</p>
        {error && <p className={s.error} role="alert">{error}</p>}
        <p className={`${s.hint} ${s.center}`}>이미 계정이 있나요? <Link href="/login">로그인</Link> · <button type="button" className={s.textButton} onClick={onDemo}>예시로 둘러보기</button> · <button type="button" className={s.textButton} onClick={onSaved}>저장한 계획 확인 ({savedCount})</button></p>
      </form>
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
