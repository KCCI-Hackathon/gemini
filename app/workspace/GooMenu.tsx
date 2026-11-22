"use client";
// 길잡이 얼굴 버튼 : 누르면 액체 방울처럼 기능 버튼이 흘러나오고(Goo Menu), 고르면 방울이 빨려 들어간 뒤 채팅이 열린다.
// 원본 : designbookmark.com motion "Goo Menu". 스프링 값은 원본 tokens.css 와 같다(--goo-out 230 15, --goo-in 520 34 등).
import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./workspace.module.css";

// ---- 작은 스프링 엔진 (원본 shared/motion.js 와 같은 식) ----
type Spring = { x: number; v: number; t: number; k: number; c: number };
const S = (x: number, k = 400, c = 30): Spring => ({ x, v: 0, t: x, k, c });
const step = (sp: Spring, dt: number) => { const a = -sp.k * (sp.x - sp.t) - sp.c * sp.v; sp.v += a * dt; sp.x += sp.v * dt; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const OUT: [number, number] = [230, 15], IN: [number, number] = [520, 34];
const RADIUS = 112, STAGGER = 0.045, BLUR = 10, BUBBLE = 48, MAIN = 64;
// 오른쪽 아래 구석에서 위 · 왼쪽으로 부채꼴로 펼친다(원본은 위쪽 반원)
const ANGLES = [-185, -150, -115, -80];

export type GooItem = { key: string; label: string; icon: ReactNode };

export function GooMenu({ items, onPick, face, hidden = false }: { items: GooItem[]; onPick: (key: string) => void; face: ReactNode; hidden?: boolean }) {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const mainBlob = useRef<HTMLDivElement>(null), mainBtn = useRef<HTMLButtonElement>(null);
  const blobs = useRef<(HTMLDivElement | null)[]>([]), btns = useRef<(HTMLButtonElement | null)[]>([]);
  const state = useRef({
    reduce: false,
    main: S(1, 520, 16),
    bubs: items.map(() => ({ x: S(0), y: S(0), s: S(0.5, 420, 22), pending: null as null | { t: number; x: number; y: number; k: number; c: number } })),
    timers: [] as { t: number; fn: () => void }[],
    clock: 0,
  });
  const home = ANGLES.map(d => { const a = d * Math.PI / 180; return { x: Math.cos(a) * RADIUS, y: Math.sin(a) * RADIUS }; });
  const tune = (sp: Spring, k: number, c: number) => { sp.k = k; sp.c = state.current.reduce ? 2 * Math.sqrt(k) : c; };
  const after = (sec: number, fn: () => void) => state.current.timers.push({ t: sec, fn });

  function setMenu(v: boolean) {
    if (v === openRef.current) return;
    openRef.current = v; setOpen(v);
    const st = state.current;
    st.main.v -= v ? 3 : 1.6;
    st.bubs.forEach((b, i) => {
      if (v) { b.pending = { t: i * STAGGER, ...home[i], k: OUT[0], c: OUT[1] }; b.s.t = 1; tune(b.s, 300, 14); }
      else { b.pending = { t: (st.bubs.length - 1 - i) * STAGGER * 0.66, x: 0, y: 0, k: IN[0], c: IN[1] }; b.s.t = 0.5; tune(b.s, 420, 30); }
    });
  }
  function pick(i: number) {
    const b = state.current.bubs[i];
    b.s.v += 4;
    after(0.08, () => setMenu(false));
    after(0.32, () => onPick(items[i].key)); // 방울이 들어가는 동안 기다렸다가 채팅을 연다
  }

  useEffect(() => {
    const st = state.current;
    st.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = performance.now(), raf = 0;
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30); last = now;
      for (let i = st.timers.length - 1; i >= 0; i--) if ((st.timers[i].t -= dt) <= 0) st.timers.splice(i, 1)[0].fn();
      for (let k = 0; k < 4; k++) {
        const d = dt / 4; st.clock += d;
        st.bubs.forEach(b => {
          if (b.pending && (b.pending.t -= d) <= 0) { const p = b.pending; b.pending = null; tune(b.x, p.k, p.c); tune(b.y, p.k, p.c); b.x.t = p.x; b.y.t = p.y; }
          step(b.x, d); step(b.y, d); step(b.s, d);
        });
        step(st.main, d);
      }
      // 닫혀 있을 때 얼굴이 살짝 숨 쉬듯 움직인다
      const breathe = !openRef.current && !st.reduce ? Math.sin(st.clock * 2.2) * 0.015 : 0;
      const mt = `translate(${-MAIN / 2}px,${-MAIN / 2}px) scale(${st.main.x + breathe})`;
      if (mainBlob.current) mainBlob.current.style.transform = mt;
      if (mainBtn.current) mainBtn.current.style.transform = mt;
      st.bubs.forEach((b, i) => {
        const x = b.x.x - BUBBLE / 2, y = b.y.x - BUBBLE / 2, sc = b.s.x;
        const sp = Math.hypot(b.x.v, b.y.v), stretch = 1 + Math.min(sp / 2600, 0.32), a = Math.atan2(b.y.v, b.x.v);
        const blob = blobs.current[i], btn = btns.current[i];
        if (blob) blob.style.transform = `translate(${x}px,${y}px) rotate(${a}rad) scale(${sc * stretch},${sc / stretch})`;
        if (btn) {
          btn.style.transform = `translate(${x}px,${y}px) scale(${sc})`;
          btn.style.opacity = String(clamp((Math.hypot(b.x.x, b.y.x) - 18) / 40, 0, 1));
        }
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const outside = (e: PointerEvent) => { if (openRef.current && !rootRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", outside); window.addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("pointerdown", outside); window.removeEventListener("keydown", esc); };
    // 스프링 상태는 ref 에 있고 한 번만 루프를 시작한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={rootRef} className={`${s.goo} ${hidden ? s.gooHidden : ""}`} aria-hidden={hidden || undefined}>
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <filter id="pf-goo" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur in="SourceGraphic" stdDeviation={BLUR} result="b" />
        <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10" result="g" />
        <feComposite in="SourceGraphic" in2="g" operator="atop" />
      </filter>
    </svg>
    <div className={s.gooLayer}>
      {items.map((item, i) => <div key={item.key} ref={el => { blobs.current[i] = el; }} className={s.gooBlob} style={{ width: BUBBLE, height: BUBBLE }} />)}
      <div ref={mainBlob} className={s.gooBlob} style={{ width: MAIN, height: MAIN }} />
    </div>
    <div className={s.gooUi}>
      {items.map((item, i) => <button key={item.key} ref={el => { btns.current[i] = el; }} type="button" className={s.gooBubble} tabIndex={open ? 0 : -1}
        style={{ pointerEvents: open ? "auto" : "none" }} aria-label={item.label} onClick={() => pick(i)}
        onPointerEnter={() => { if (!openRef.current) return; const b = state.current.bubs[i]; b.s.t = 1.14; tune(b.s, 500, 18); }}
        onPointerLeave={() => { if (openRef.current) state.current.bubs[i].s.t = 1; }}>
        {item.icon}<span className={s.gooTip}>{item.label}</span>
      </button>)}
      <button ref={mainBtn} type="button" className={s.gooMain} aria-label={open ? "길잡이 메뉴 닫기" : "길잡이 메뉴 열기"} aria-expanded={open} disabled={hidden}
        onClick={() => setMenu(!openRef.current)}>{face}</button>
    </div>
  </div>;
}
