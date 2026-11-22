"use client";
import { useEffect, useRef, useState } from "react";
import type { BenefitAnswer } from "@/lib/planner/answers";
import type { AiRecommendation, BenefitQuestion, Card } from "@/lib/planner/types";
import { Robot } from "./Robot";
import s from "./workspace.module.css";
export type Message = { id: number; role: "assistant" | "user"; text: string };
type AnswerHandler = (question: BenefitQuestion, answer: BenefitAnswer) => void;

function QuestionCard({ question, onAnswer, busy }: { question: BenefitQuestion; onAnswer: AnswerHandler; busy: boolean }) {
  const [date, setDate] = useState("");
  const selected = question.answerKind === "selected";
  return <fieldset className={s.agentMessage} disabled={busy}>
    <legend>{question.question}</legend>
    {selected ? <button onClick={() => onAnswer(question, { kind: "selected" })}>선정됐어요</button>
      : <button onClick={() => onAnswer(question, { kind: "receiving" })}>받고 있어요</button>}
    {question.answerKind === "ended_date" && <form onSubmit={e => {
      e.preventDefault();
      onAnswer(question, { kind: "ended", lastPaymentDate: date });
    }}>
      <label>마지막 지급일<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
      <button disabled={!date}>끝났어요</button>
    </form>}
    {selected ? <button onClick={() => onAnswer(question, { kind: "not_selected" })}>아니에요</button>
      : <button onClick={() => onAnswer(question, { kind: "not_receiving" })}>안 받아요</button>}
  </fieldset>;
}

export function Agent({ messages, onSend, onClose, busy, questions, onAnswer, recommendation, cards, planLoading }: {
  messages: Message[]; onSend: (text: string) => void; onClose: () => void; busy: boolean;
  recommendation?: AiRecommendation | null; cards?: Card[]; planLoading?: boolean;
  questions?: BenefitQuestion[]; onAnswer: AnswerHandler;
}) {
  const first = questions?.[0];
  const [text, setText] = useState(""); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" }); }, [messages.length, recommendation, planLoading]);
  function send(value: string) { if (!value.trim() || busy) return; onSend(value.trim()); setText(""); }
  return <aside className={s.agent} aria-label="정책 길잡이"><div className={s.agentHead}><Robot /><div><h2>나의 정책 길잡이</h2><small>일정부터 차근차근</small></div><button className={`${s.iconButton} ${s.agentClose}`} onClick={onClose} aria-label="에이전트 닫기">×</button></div>
    {first && <QuestionCard key={first.ruleId} question={first} onAnswer={onAnswer} busy={busy} />}
    <div className={s.agentMessages} role="log" aria-live="polite">{messages.map(m => <div key={m.id} className={`${s.agentMessage} ${m.role === "user" ? s.userMessage : ""}`}><span className={s.srOnly}>{m.role === "user" ? "나" : "길잡이"}: </span>{m.text}</div>)}{planLoading && <p role="status">AI 추천 경로를 확인하고 있어요…</p>}
      {recommendation && <div className={s.agentMessage}>
        <strong>{recommendation.source === "ai" ? "AI 추천 경로" : "조건 기준 추천 경로"}</strong>
        {recommendation.summary && <p>{recommendation.summary}</p>}
        {recommendation.notice && <p>{recommendation.notice}</p>}
        {recommendation.picks.filter(pick => pick.why.length > 0).map(pick => <div key={pick.offeringId}>
          <strong>{cards?.find(card => card.offeringId === pick.offeringId)?.title ?? pick.offeringId}</strong>
          {pick.why.map((why, i) => <p key={i}>{why}</p>)}
        </div>)}
      </div>}<div ref={endRef} /></div><div className={s.agentExamples}>{["취업을 2월 13일로 옮겨줘", "왜 제 기한은 더 빠른가요?", "나에게 맞는 경로 추천해줘"].map(q => <button key={q} onClick={() => send(q)} disabled={busy}>{q}</button>)}</div><form className={s.agentForm} onSubmit={e => { e.preventDefault(); send(text); }}><label className={s.srOnly} htmlFor="agent-message">길잡이에게 메시지</label><textarea id="agent-message" value={text} onChange={e => setText(e.target.value)} placeholder="일정이나 정책을 물어보세요" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} /><button className={s.primaryButton} disabled={busy || !text.trim()}>보내기</button></form><p className={s.agentFoot}>앱의 일정·판정 결과로 안내해요.</p></aside>;
}
