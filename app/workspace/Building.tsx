"use client";
import { useEffect, useRef, useState } from "react";
import s from "./workspace.module.css";

export const MIN_BUILD_MS = 1200;
const STEPS = [
  ["경로 제작 중...", "내 일정과 맞는 공고를 찾고 있어요"],
  ["자격을 따져 보는 중...", "수료·취업 예정일로 기한을 계산하고 있어요"],
  ["길목마다 깃발 꽂는 중...", "겹쳐 받을 수 없는 지원을 골라내고 있어요"],
] as const;
const PATH = "M20 190 C 140 190, 160 60, 300 90 S 470 200, 600 50";
const PINS = [{ left: 150, top: 96, delay: ".8s" }, { left: 330, top: 62, delay: "1.5s" }, { left: 470, top: 120, delay: "2.2s" }];

// 판정 요청이 끝났고 로딩 화면을 최소 시간 보여 줬을 때만 떠난다
export function canLeaveBuilding(ready: boolean, shownMs: number) { return ready && shownMs >= MIN_BUILD_MS; }

// 경로 제작 중 화면 : 실제 판정이 끝날 때까지 보이고 최소 1.2초
export function Building({ ready, onDone }: { ready: boolean; onDone: () => void }) {
  const [step, setStep] = useState(0), [shownMs, setShownMs] = useState(0);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    const timers = [...STEPS.slice(1).map((_, i) => setTimeout(() => setStep(i + 1), (i + 1) * 1100)), setTimeout(() => setShownMs(MIN_BUILD_MS), MIN_BUILD_MS)];
    return () => timers.forEach(clearTimeout);
  }, []);
  useEffect(() => { if (canLeaveBuilding(ready, shownMs)) done.current(); }, [ready, shownMs]);
  return <div className={s.building} role="status" aria-live="polite">
    <div className={s.trail}>
      <svg viewBox="0 0 620 230" aria-hidden="true"><path d={PATH} /><path className={s.drawn} d={PATH} /></svg>
      {PINS.map(pin => <span key={pin.left} className={s.pin} style={{ left: pin.left, top: pin.top, animationDelay: pin.delay }} />)}
      <div className={s.walker}><img src="/pathfinder/robot-map.png" alt="" /></div>
    </div>
    <p className={s.buildText}>{STEPS[step][0]}</p>
    <p className={s.buildSub}>{STEPS[step][1]}</p>
    <div className={s.buildBar}><i /></div>
  </div>;
}
