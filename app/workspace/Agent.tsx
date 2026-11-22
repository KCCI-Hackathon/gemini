"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import type { BenefitAnswer } from "@/lib/planner/answers";
import type { AiRecommendation, BenefitQuestion, Card } from "@/lib/planner/types";
import { toKstDate } from "@/lib/date";
import { AGENT_EXAMPLES } from "@/lib/planner/fixtures";
import { pickQuestion, questionKey } from "@/lib/planner/questions";
import { answerOptions, type CounselTarget } from "@/lib/planner/counsel-target";

/** 상담 에이전트가 고른 질문. 문장은 AI, 선택지 · 입력 칸은 target 에 맞춰 코드가 붙인다. */
function AiQuestionCard({ text, target, onAnswer, onSkip, busy }: { text: string; target: CounselTarget; onAnswer: (value: string) => void; onSkip: () => void; busy: boolean }) {
  const [value, setValue] = useState("");
  const options = answerOptions(target);
  return <fieldset className={s.questionCard} disabled={busy}>
    <legend className={s.questionTitle}>{text}</legend>
    <p className={s.questionHint}>AI 질문 · 답하면 바로 다시 판정해요</p>
    {Array.isArray(options) ? <div className={s.answerRow}>{options.map(o => <button key={o.value} className={s.answerButton} onClick={() => onAnswer(o.value)}>{o.label}</button>)}</div>
      : <form className={s.answerForm} onSubmit={e => { e.preventDefault(); onAnswer(value); }}>
        <label>{options === "date" ? "날짜" : `${target.kind === "benefit" && target.month ? `${Number(target.month.slice(5))}월에 ` : ""}받은 금액(원)`}
          <input type={options === "date" ? "date" : "number"} inputMode={options === "amount" ? "numeric" : undefined} min={options === "amount" ? 0 : undefined} required value={value} onChange={e => setValue(e.target.value)} /></label>
        <div className={s.answerRow}><button className={s.answerButton} disabled={!value}>입력</button>
        {options === "amount" && <button type="button" className={s.answerButton} onClick={() => onAnswer("no")}>안 받아요</button>}</div>
      </form>}
    <button className={s.textButton} onClick={onSkip}>나중에 답할게요</button>
  </fieldset>;
}
import { Robot } from "./Robot";
import s from "./workspace.module.css";
export type Message = { id: number; role: "assistant" | "user"; text: string };
type AnswerHandler = (question: BenefitQuestion, answer: BenefitAnswer) => void;

/** "해당 사업" 대신 실제 원인 사업 이름으로 묻는다. 답하면 판정이 바뀌는 대상 정책도 함께 보여 준다. */
export function questionLabel(q: BenefitQuestion) { return q.question.replace(/^해당 사업(의|을|이)?/, (_m, j) => `${q.sourceName}${j ?? ""}`); }

function QuestionCard({ question, onAnswer, busy, month, targetTitle }: { question: BenefitQuestion; onAnswer: AnswerHandler; busy: boolean; month: string; targetTitle?: string }) {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const selected = question.answerKind === "selected";
  const head = <><legend className={s.questionTitle}>{questionLabel(question)}</legend>
    {targetTitle && <p className={s.questionHint}>답하면 ‘{targetTitle}’ 판정이 바뀌어요</p>}</>;
  if (question.answerKind === "monthly_amount") return <fieldset className={s.questionCard} disabled={busy}>
    {head}
    <form className={s.answerForm} onSubmit={e => {
      e.preventDefault();
      onAnswer(question, { kind: "monthly_amount", month, amountWon: Number(amount) });
    }}>
      <label>{Number(month.slice(5))}월에 받은 금액(원)<input type="number" inputMode="numeric" min={0} step={1} required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <div className={s.answerRow}><button className={s.answerButton} disabled={!/^\d+$/.test(amount)}>입력</button>
      <button type="button" className={s.answerButton} onClick={() => onAnswer(question, { kind: "not_receiving" })}>안 받아요</button></div>
    </form>
  </fieldset>;
  return <fieldset className={s.questionCard} disabled={busy}>
    {head}
    {question.answerKind === "ended_date" && <form className={s.answerForm} onSubmit={e => {
      e.preventDefault();
      onAnswer(question, { kind: "ended", lastPaymentDate: date });
    }}>
      <label>마지막 지급일<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
      <div className={s.answerRow}><button className={s.answerButton} disabled={!date}>끝났어요</button></div>
    </form>}
    <div className={s.answerRow}>
      {selected ? <button className={s.answerButton} onClick={() => onAnswer(question, { kind: "selected" })}>선정됐어요</button>
        : <button className={s.answerButton} onClick={() => onAnswer(question, { kind: "receiving" })}>받고 있어요</button>}
      {selected ? <button className={s.answerButton} onClick={() => onAnswer(question, { kind: "not_selected" })}>아니에요</button>
        : <button className={s.answerButton} onClick={() => onAnswer(question, { kind: "not_receiving" })}>안 받아요</button>}
    </div>
  </fieldset>;
}

export function Agent({ messages, onSend, onClose, busy, questions, onAnswer, recommendation, recommendationAt, cards, planLoading, loadingAction = "recommend", today, aiQuestion, onAiAnswer, onAiSkip, consentNeeded, onConsent, consentOn, onConsentOff }: {
  messages: Message[]; onSend: (text: string) => void; onClose: () => void; busy: boolean;
  aiQuestion?: { text?: string; target: CounselTarget } | null; onAiAnswer?: (value: string) => void; onAiSkip?: () => void;
  consentNeeded?: boolean; onConsent?: () => void; consentOn?: boolean; onConsentOff?: () => void;
  recommendation?: AiRecommendation | null; recommendationAt?: number | null; cards?: Card[]; planLoading?: boolean; loadingAction?: "message" | "recommend" | "followup";
  questions?: BenefitQuestion[]; onAnswer: AnswerHandler; today?: string;
}) {
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const pick = pickQuestion(questions ?? [], skipped);
  const first = pick.question;
  const currentQuestionKey = first ? questionKey(first) : null;
  const aiQuestionText = aiQuestion?.text ?? null;
  const [text, setText] = useState(""); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" }); }, [messages.length, recommendation, planLoading, currentQuestionKey, aiQuestionText, skipped.size]);
  function send(value: string) { if (!value.trim() || busy) return; onSend(value.trim()); setText(""); }
  // 추천 블록은 만들어진 메시지 바로 아래에 한 번만 둔다. 뒤에 오는 대화 아래로 따라 내려오지 않게.
  const inlineRecommendation = recommendationAt != null && messages.some(m => m.id === recommendationAt);
  const recommendationBlock = recommendation && <div className={s.agentMessage}>
    <strong>{recommendation.source === "ai" ? "AI 추천 경로" : "조건 기준 추천 경로"}</strong>
    {recommendation.summary && <p>{recommendation.summary}</p>}
    {recommendation.notice && <p>{recommendation.notice}</p>}
    {recommendation.picks.filter(pick => pick.why.length > 0).map(pick => <div key={pick.offeringId}>
      <strong>{cards?.find(card => card.offeringId === pick.offeringId)?.title ?? pick.offeringId}</strong>
      {pick.why.map((why, i) => <p key={i}>{why}</p>)}
    </div>)}
  </div>;
  return (
    <aside className={s.agent} aria-label="정책 길잡이">
      <div className={s.agentHead}>
        <Robot />
        <div><h2>길잡이</h2><small>일정을 말하면 보드에 바로 반영해요</small></div>
        <button className={`${s.iconButton} ${s.agentClose}`} onClick={onClose} aria-label="에이전트 닫기">×</button>
      </div>
      <div className={s.agentMessages} role="log" aria-live="polite">
        {messages.map(m => <Fragment key={m.id}><div className={`${s.agentMessage} ${m.role === "user" ? s.userMessage : ""}`}><span className={s.srOnly}>{m.role === "user" ? "나" : "길잡이"}: </span>{m.text}</div>
          {inlineRecommendation && m.id === recommendationAt && recommendationBlock}</Fragment>)}
        {consentNeeded && <div className={s.agentMessage} role="region" aria-label="AI 상담 동의">
          <strong>AI 상담 사용</strong>
          <p>자유 질문 · 추천은 해외 AI 제공자(OpenAI 또는 Google)에게 보내 정리해요. 보내는 것: 만 나이 범위, 시·군·구 이름, 학력·상태, 일정은 ‘오늘부터 N일 뒤’, 수혜 정책 이름과 상태, 그리고 쓴 질문. 질문 속 이름·상세 주소·전화번호·주민번호·이메일·계좌번호는 찾아서 지우고 보내요. 생년월일·정확한 날짜는 보내지 않고, 대화는 저장하지 않아요. 판정은 늘 코드가 해요.</p>
          <p>질문에는 이름 · 주소 · 연락처를 쓰지 말아 주세요.</p>
          <button className={s.primaryButton} onClick={onConsent}>AI 상담 사용</button>
        </div>}
        {consentOn && <button className={s.textButton} onClick={onConsentOff}>AI 상담 끄기</button>}
        {aiQuestion?.text && <AiQuestionCard key={aiQuestion.text} text={aiQuestion.text} target={aiQuestion.target} busy={busy} onAnswer={v => onAiAnswer?.(v)} onSkip={() => onAiSkip?.()} />}
        {!aiQuestion && first && <div className={s.questionWrap}>
          <p className={s.questionMeta}>질문 {pick.index}/{pick.total}</p>
          <QuestionCard key={questionKey(first)} question={first} onAnswer={onAnswer} busy={busy} month={first.month ?? (today ?? toKstDate(new Date())).slice(0, 7)} targetTitle={cards?.find(c => c.policyId === first.policyId)?.title} />
          <button className={s.textButton} disabled={busy} onClick={() => setSkipped(prev => new Set([...prev, questionKey(first)]))}>나중에 답할게요</button>
        </div>}
        {!first && pick.skipped > 0 && <button className={s.textButton} onClick={() => setSkipped(new Set())}>건너뛴 질문 {pick.skipped}개 다시 보기</button>}
        {planLoading && <p role="status">{loadingAction === "recommend" ? "AI 추천 경로를 확인하고 있어요…" : "길잡이가 답을 정리하고 있어요…"}</p>}
        {!inlineRecommendation && recommendationBlock}
        <div ref={endRef} />
      </div>
      <div className={s.agentExamples} aria-label="예시 질문">{AGENT_EXAMPLES.map(q => <button key={q} onClick={() => send(q)} disabled={busy}>{q}</button>)}</div>
      <form className={s.agentForm} onSubmit={e => { e.preventDefault(); send(text); }}>
        <label className={s.srOnly} htmlFor="agent-message">길잡이에게 메시지</label>
        <textarea id="agent-message" value={text} onChange={e => setText(e.target.value)} placeholder="일정이나 정책을 물어보세요 (이름·주소·연락처는 빼고)" onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} />
        <button className={s.primaryButton} disabled={busy || !text.trim()}>보내기</button>
      </form>
      <p className={s.agentFoot}>날짜·자격·중복 판정은 규칙 엔진이 하고, 길잡이는 추가로 물어보고 설명하고 추천해요.</p>
    </aside>
  );
}
