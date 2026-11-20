"use client";
import { useEffect, useRef, useState } from "react";
import { Robot } from "./Robot";
import s from "./workspace.module.css";
export type Message = { id: number; role: "assistant" | "user"; text: string };
export function Agent({ messages, onSend, onClose, busy }: { messages: Message[]; onSend: (text: string) => void; onClose: () => void; busy: boolean }) {
  const [text, setText] = useState(""); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" }); }, [messages.length]);
  function send(value: string) { if (!value.trim() || busy) return; onSend(value.trim()); setText(""); }
  return <aside className={s.agent} aria-label="정책 길잡이"><div className={s.agentHead}><Robot /><div><h2>나의 정책 길잡이</h2><small>일정부터 차근차근</small></div><button className={`${s.iconButton} ${s.agentClose}`} onClick={onClose} aria-label="에이전트 닫기">×</button></div><div className={s.agentMessages} role="log" aria-live="polite">{messages.map(m => <div key={m.id} className={`${s.agentMessage} ${m.role === "user" ? s.userMessage : ""}`}><span className={s.srOnly}>{m.role === "user" ? "나" : "길잡이"}: </span>{m.text}</div>)}<div ref={endRef} /></div><div className={s.agentExamples}>{["취업을 2월 13일로 옮겨줘", "왜 제 기한은 더 빠른가요?", "나에게 맞는 경로 추천해줘"].map(q => <button key={q} onClick={() => send(q)} disabled={busy}>{q}</button>)}</div><form className={s.agentForm} onSubmit={e => { e.preventDefault(); send(text); }}><label className={s.srOnly} htmlFor="agent-message">길잡이에게 메시지</label><textarea id="agent-message" value={text} onChange={e => setText(e.target.value)} placeholder="일정이나 정책을 물어보세요" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} /><button className={s.primaryButton} disabled={busy || !text.trim()}>보내기</button></form><p className={s.agentFoot}>앱의 일정·판정 결과로 안내해요.<br />외부 AI를 사용하지 않고 있어요.</p></aside>;
}
