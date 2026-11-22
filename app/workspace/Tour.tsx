"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import s from "./workspace.module.css";

/** 처음 온 사람에게 보드를 한 칸씩 짚어 주는 안내. 대상은 화면 요소의 data-tour 값으로 찾는다. */
export type TourStep = { target: string; title: string; body: string; pos?: "right" | "left" | "bottom" | "top" };
export const TOUR_STEPS: TourStep[] = [
  { target: "chips", title: "이 계획의 조건", body: "사는 곳, 지금 상태, 받고 있는 지원, 관심 분야예요. 초록 체크는 판정에 쓰는 조건이고, 눌러서 끄면 그 조건은 ‘확인 필요’로 남겨요.", pos: "bottom" },
  { target: "schedule", title: "내 일정", body: "수료 · 취업 · 이사처럼 생활이 바뀌는 날이에요. 칩을 눌러 날짜를 바꾸면 모든 정책의 기한이 바로 다시 계산돼요.", pos: "bottom" },
  { target: "tabs", title: "전체 · 확인 필요 · 신청 가능", body: "코드가 정책마다 자격을 판정해 나눠 둬요. ‘확인 필요’는 조건을 더 알려 주면 신청 가능이나 불가로 바뀌어요.", pos: "bottom" },
  { target: "board", title: "시점별 정책 보드", body: "지금, 수료 후, 취업 후처럼 시점마다 열이 나뉘어요. 카드의 D-day와 내 기한을 보고 ‘담기’를 누르면 내 계획에 들어가요.", pos: "bottom" },
  { target: "recommend", title: "AI 추천 경로", body: "누르면 AI 상담 동의 후 길잡이가 필요한 조건을 몇 가지 묻고, 시점마다 2~3개를 골라 줘요. 추천 카드는 파란 윤곽선으로 열 맨 위에 올라와요.", pos: "bottom" },
  { target: "agent|agent-fab", title: "길잡이와 대화", body: "오른쪽 아래 로봇을 눌러 길잡이를 열고 ‘AI 상담 사용’을 누르면 채팅할 수 있어요. “취업을 2월 19일로 옮겨줘”처럼 말하면 일정이 바뀌고, 정책이 왜 확인 필요인지도 물어볼 수 있어요.", pos: "left" },
  { target: "nav-roadmap", title: "내 정책 로드맵", body: "계획을 저장하면 로드맵에서 날짜 위에 깃발로 볼 수 있어요. 이제 직접 둘러보세요!", pos: "bottom" },
];
const BOX_W = 360, PAD = 8;
/** "a|b" 처럼 후보를 여러 개 적으면 지금 화면에 보이는 첫 요소를 고른다(닫힌 길잡이 대신 여는 버튼 등). */
function findTarget(target: string): HTMLElement | null {
  for (const key of target.split("|")) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${key}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && getComputedStyle(el).visibility !== "hidden") return el;
  }
  return null;
}

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [box, setBox] = useState<{ left: number; top: number }>({ left: 24, top: 24 });
  const boxRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  // 보이는 단계만(대상이 지금 화면에 없으면 건너뛴다)
  const [steps, setSteps] = useState<TourStep[]>(TOUR_STEPS);
  useEffect(() => { if (open) { setSteps(TOUR_STEPS.filter(st => findTarget(st.target))); setIndex(0); } }, [open]);
  const step = steps[index];

  const place = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    if (!el) return;
    // 화면 전체가 zoom .75 라 좌표를 zoom 으로 나눈다
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const r = el.getBoundingClientRect();
    const vw = innerWidth / zoom, vh = innerHeight / zoom;
    // 화면 밖으로 나간 부분은 잘라서 비춘다(큰 보드가 얇은 띠로 보이지 않게)
    const left = r.left / zoom - PAD, width = r.width / zoom + PAD * 2;
    const top = Math.max(8, r.top / zoom - PAD), bottom = Math.min(vh - 8, r.bottom / zoom + PAD, top + vh * 0.6);
    const height = Math.max(40, bottom - top);
    setHole({ left, top, width, height });
    const bh = boxRef.current?.offsetHeight ?? 220;
    let x: number, y: number;
    if (step.pos === "right") { x = left + width + 16; y = top; }
    else if (step.pos === "left") { x = left - BOX_W - 16; y = top; }
    else if (step.pos === "top") { x = left + 24; y = top - bh - 16; if (y < 12) y = top + 24; }
    else { x = left + 24; y = top + height + 16; }
    if (y + bh > vh - 12) y = Math.max(12, top - bh - 16);
    x = Math.min(Math.max(12, x), vw - BOX_W - 12); y = Math.max(12, y);
    setBox({ left: x, top: y });
  }, [step]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const el = findTarget(step.target);
    // 큰 요소(보드)는 위쪽이 보이게, 작은 요소는 가운데로
    el?.scrollIntoView({ block: el.getBoundingClientRect().height > innerHeight * 0.5 ? "start" : "center", inline: "nearest", behavior: "smooth" });
    // 부드러운 스크롤이 멈출 때까지 기다렸다가 자리를 잡는다
    let last = NaN, same = 0, n = 0, raf = 0;
    const tick = () => { const t = el?.getBoundingClientRect().top ?? 0; same = Math.abs(t - last) < 0.5 ? same + 1 : 0; last = t; if (same >= 6 || ++n > 150) { place(); nextRef.current?.focus({ preventScroll: true }); } else raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, step, place]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") next(); if (e.key === "ArrowLeft") setIndex(i => Math.max(0, i - 1)); };
    addEventListener("keydown", key); addEventListener("resize", place);
    return () => { removeEventListener("keydown", key); removeEventListener("resize", place); };
  });
  function next() { if (index >= steps.length - 1) onClose(); else setIndex(index + 1); }

  if (!open || !step) return null;
  return <div className={s.tour} role="dialog" aria-modal="true" aria-label="처음 사용 안내">
    {hole && <div className={s.tourHole} style={hole} />}
    <div ref={boxRef} className={s.tourBox} style={box}>
      <div className={s.tourHead}><img src="/pathfinder/robot-face.png" alt="" /><span className={s.tourStep}>{index + 1} / {steps.length}</span><button className={s.tourSkip} onClick={onClose}>건너뛰기</button></div>
      <h3>{step.title}</h3>
      <p>{step.body}</p>
      <div className={s.tourFoot}>
        <div className={s.tourDots} aria-hidden="true">{steps.map((_, i) => <i key={i} className={i === index ? s.tourDotOn : ""} />)}</div>
        <div className={s.tourButtons}><button className={s.outlineButton} disabled={index === 0} onClick={() => setIndex(index - 1)}>이전</button><button ref={nextRef} className={s.primaryButton} onClick={next}>{index === steps.length - 1 ? "시작하기" : "다음"}</button></div>
      </div>
    </div>
  </div>;
}

const KEY = "pf.tour";
export function tourSeen(): boolean { try { return localStorage.getItem(KEY) === "done"; } catch { return true; } }
export function markTourSeen() { try { localStorage.setItem(KEY, "done"); } catch { /* 저장 못 해도 안내는 닫힌다 */ } }
