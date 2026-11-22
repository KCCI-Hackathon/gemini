import type { ReactNode } from "react";
import s from "./workspace.module.css";

export type Tab = "board" | "saved" | "roadmap" | "account";
export type Screen = Tab | "signup" | "onboarding" | "planning" | "building";
const SCREENS: Screen[] = ["signup", "onboarding", "planning", "building", "board", "saved", "roadmap", "account"];
const WORK: Screen[] = ["board", "saved", "roadmap", "account"];

// 주소의 해시(#board 등)를 화면 이름으로 바꾼다. 모르는 해시는 null
export function screenOf(hash: string): Screen | null {
  const id = hash.replace(/^#/, "");
  return (SCREENS as string[]).includes(id) ? (id as Screen) : null;
}

// 해시가 없으면 초안이 있을 때 보드, 없을 때 회원가입. 초안 없이는 탭 화면을 열지 않는다
export function resolveScreen(hash: Screen | null, hasDraft: boolean): Screen {
  const wanted = hash ?? (hasDraft ? "board" : "signup");
  return !hasDraft && WORK.includes(wanted) ? "signup" : wanted;
}

const icon = (paths: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{paths}</svg>;
const TABS: { id: Tab; label: string; icon: ReactNode; account?: boolean }[] = [
  { id: "board", label: "정책 선택", icon: icon(<><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="14" rx="1.5" /></>) },
  { id: "saved", label: "관심 정책", icon: icon(<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />) },
  { id: "roadmap", label: "내 정책 로드맵", icon: icon(<><path d="M4 6h10M4 12h16M4 18h7" /><circle cx="17" cy="6" r="2" /><circle cx="14" cy="18" r="2" /></>) },
  { id: "account", label: "계정", account: true, icon: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></>) },
];

// 왼쪽 메뉴 : 탭 4개. 이동은 해시 링크로만 한다
export function Nav({ active }: { active: Tab }) {
  return <nav className={s.nav} aria-label="주 메뉴">
    <div className={s.brand}><img src="/pathfinder/robot-face.png" alt="" /><strong>Pathfinder</strong><small>갈림길</small></div>
    {TABS.map(tab => <a key={tab.id} href={`#${tab.id}`} className={`${s.navButton} ${tab.account ? s.accountButton : ""} ${active === tab.id ? s.navActive : ""}`} aria-current={active === tab.id ? "page" : undefined} data-tour={`nav-${tab.id}`}>{tab.icon}<span>{tab.label}</span></a>)}
  </nav>;
}
