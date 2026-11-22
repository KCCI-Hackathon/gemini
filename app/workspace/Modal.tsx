"use client";
import { useEffect, useRef, type ReactNode } from "react";
import s from "./workspace.module.css";
let depth = 0;
let originalOverflow = "";
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const titleId = `dialog-${title.replace(/\s/g, "-")}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (depth === 0) { originalOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    const ownDepth = ++depth;
    const marker = globalThis.crypto.randomUUID();
    window.history.pushState({ ...window.history.state, pathfinderModal: marker }, "");
    const siblings = Array.from(ref.current?.parentElement?.parentElement?.children ?? []).filter(el => el !== ref.current?.parentElement) as HTMLElement[];
    const originalInert = siblings.map(el => el.inert);
    siblings.forEach(el => { el.inert = true; });
    const popstate = () => { if (depth === ownDepth && window.history.state?.pathfinderModal !== marker) close.current(); };
    window.addEventListener("popstate", popstate);
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (depth !== ownDepth) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close.current(); }
      if (event.key === "Tab") {
        const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(e => e.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true); window.removeEventListener("popstate", popstate);
      siblings.forEach((el, i) => { el.inert = originalInert[i]; });
      depth--; if (depth === 0) document.body.style.overflow = originalOverflow;
      queueMicrotask(() => { if (window.history.state?.pathfinderModal === marker) window.history.back(); });
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLButtonElement>('[id^="stage-"] button')?.focus();
    };
  }, []);
  return <div className={s.backdrop} style={{ zIndex: 100 + depth * 10 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} tabIndex={-1} className={`${s.dialog} ${wide ? s.dialogWide : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}><div className={s.dialogHeader}><h2 id={titleId}>{title}</h2><button className={s.iconButton} onClick={onClose} aria-label={`${title} 닫기`}>×</button></div>{children}</div></div>;
}
