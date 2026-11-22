"use client";
// 길잡이 얼굴 버튼 : 누르면 말랑하게 눌렸다가 채팅 창을 연다. 창은 버튼 자리에서 방울처럼 퍼져 나온다(workspace.module.css .agentDrawer .agent).
// 스프링 값은 원본 Goo Menu 의 main 버튼(520/16)과 같다.
import { useEffect, useRef, type ReactNode } from "react";
import s from "./workspace.module.css";

type Spring = { x: number; v: number; t: number; k: number; c: number };
const step = (sp: Spring, dt: number) => { const a = -sp.k * (sp.x - sp.t) - sp.c * sp.v; sp.v += a * dt; sp.x += sp.v * dt; };

export function AgentFab({ onOpen, face, hidden = false }: { onOpen: () => void; face: ReactNode; hidden?: boolean }) {
  const btn = useRef<HTMLButtonElement>(null);
  const st = useRef({ main: { x: 1, v: 0, t: 1, k: 520, c: 16 } as Spring, clock: 0, reduce: false });

  useEffect(() => {
    const m = st.current;
    m.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (m.reduce) m.main.c = 2 * Math.sqrt(m.main.k);
    let last = performance.now(), raf = 0;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
      for (let i = 0; i < 4; i++) { m.clock += dt / 4; step(m.main, dt / 4); }
      const breathe = m.reduce ? 0 : Math.sin(m.clock * 2.2) * 0.015; // 닫혀 있을 때 숨 쉬듯
      if (btn.current) btn.current.style.transform = `scale(${m.main.x + breathe})`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 창을 닫아 버튼이 다시 나오면 작게 시작해 튀어 오른다
  useEffect(() => { if (!hidden) { st.current.main.x = 0.4; st.current.main.v = 0; } }, [hidden]);

  return <button ref={btn} type="button" data-tour="agent-fab" className={`${s.agentFab} ${hidden ? s.agentFabHidden : ""}`} aria-label="길잡이와 대화 열기" disabled={hidden}
    onClick={() => { st.current.main.v -= 3; setTimeout(onOpen, 120); }}>{face}</button>;
}
