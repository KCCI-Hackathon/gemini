import { roadmapRange } from "@/lib/planner/roadmap-range";
import { EVENT_NAMES } from "@/lib/planner/types";
import { addDays, axisPosition, dateLabel } from "@/lib/planner/dates";
import type { Card, Draft, SavedPlan } from "@/lib/planner/types";
import { deadlineText } from "./PolicyCard";
import s from "./workspace.module.css";
const FLAG_STATES = [["open", "신청 가능"], ["soon", "곧 마감"], ["check", "확인 필요"], ["blocked", "신청 불가"]] as const;

export function Roadmap({ plan, onDetail }: { plan: Draft | SavedPlan; onDetail: (c: Card) => void }) {
  const evaluation = "evaluation" in plan ? plan.evaluation : plan.savedEvaluation;
  const cards = plan.input.choices.map(choice => ({ choice, card: evaluation.cards.find(c => c.offeringId === choice.offeringId && c.stageId === choice.stageId) }));
  const events = (plan.input.events ?? []).filter(e => e.date >= evaluation.today);
  // 마지막 상태 변화 뒤 1년까지만 축으로 쓴다(가로 스크롤 없이).
  const { start, end, ticks } = roadmapRange(evaluation.today, events.map(e => e.date));
  cards.sort((a, b) => evaluation.stages.findIndex(st => st.stageId === a.choice.stageId) - evaluation.stages.findIndex(st => st.stageId === b.choice.stageId) || (a.card?.personalWindow?.end ?? "9999").localeCompare(b.card?.personalWindow?.end ?? "9999"));
  function bar(a: string | null, b: string | null) { const left = a ? axisPosition(a, start, end) : 0, right = b ? axisPosition(addDays(b, 1), start, end) : 1; return { left: `${left * 100}%`, width: `${Math.max(0, right - left) * 100}%`, display: right <= left ? "none" : undefined }; }
  /** 내 기한(없으면 공고 마감)에 꽂는 깃발. 위에서 떨어져 꽂히고 펄럭인다. 줄마다 차례대로. */
  function plantFlag(card: Card, index: number) {
    const date = card.eligibility === "blocked" ? (card.official.end ?? card.official.start) : (card.personalWindow?.end ?? card.official.end);
    if (!date || date < start || date >= end) return null;
    const key = card.eligibility === "blocked" ? "blocked" : card.eligibility === "needs_check" ? "check" : card.daysLeft != null && card.daysLeft <= 30 ? "soon" : "open";
    const label = FLAG_STATES.find(([k]) => k === key)![1];
    return <span className={`${s.plantFlag} ${s[`pf_${key}`]}`} style={{ left: `${axisPosition(addDays(date, 1), start, end) * 100}%`, animationDelay: `${0.25 + index * 0.22}s` }} title={`${label} · ${dateLabel(date)}`}><i /><em>{label}</em></span>;
  }
  if (!cards.length) return <div className={s.emptyState}>아직 담은 정책이 없어요.<br />정책 선택하기에서 나에게 맞는 정책을 담아 보세요.</div>;
  return <><h2>이 계획의 일정</h2><div className={s.periodLegend}><span><i />공식 접수 기간</span><span><i />내 신청 가능 기간</span></div><div className={s.flagLegend}>{FLAG_STATES.map(([key, label]) => <span key={key}><span className={`${s.plantFlag} ${s.plantStill} ${s[`pf_${key}`]}`}><i /></span>{label}</span>)}<span>점선: 확인 필요</span></div><div className={s.roadmapScroll} tabIndex={0} aria-label="정책별 일 단위 로드맵. 날짜축은 가로로 이동할 수 있어요"><div className={s.roadmapTable}><div className={s.roadmapTicks}><strong>담은 정책 {cards.length}개</strong><div className={s.periodTrack} style={{ minHeight: 54 }}>{ticks.map(d => <span key={d} className={s.periodMonth} style={{ left: `${axisPosition(d, start, end) * 100}%` }}>{d.slice(2, 4)}.{Number(d.slice(5, 7))}</span>)}{events.map(e => <span key={e.id} className={`${s.roadmapEventFlag} ${s[`flag_${e.type}`] ?? ""}`} style={{ left: `${axisPosition(e.date, start, end) * 100}%` }} title={`${EVENT_NAMES[e.type]} ${dateLabel(e.date)}`}><Flag />{EVENT_NAMES[e.type]}</span>)}</div></div>{cards.map(({ choice, card }, index) => <div key={choice.offeringId} className={s.roadmapRow}><div className={s.roadmapPolicy}><button onClick={() => card && onDetail(card)}>{card?.title ?? `공고 조회 불가 (${choice.offeringId})`}</button><small>{evaluation.stages.find(st => st.stageId === choice.stageId)?.label ?? "시점 다시 선택"}</small><small>{card ? deadlineText(card, evaluation.today) : "저장한 회차를 다시 확인해 주세요."}</small></div><div className={`${s.periodTrack} ${s.roadmapTrack}`}>{events.map(e => <span key={e.id} className={`${s.roadmapEventLine} ${s[`flag_${e.type}`] ?? ""}`} style={{ left: `${axisPosition(e.date, start, end) * 100}%` }} aria-hidden="true" />)}{card && <><div className={s.officialBar} style={bar(card.official.start, card.official.end)} aria-hidden="true" />{card.personalWindow && card.availability !== "blocked" && <>{card.applicationWindows.map((window, index) => <div key={index} className={`${s.personalBar} ${card.eligibility === "needs_check" || card.availability === "needs_check" ? s.uncertainBar : ""}`} style={bar(window.start, window.end)} aria-hidden="true" />)}</>}{plantFlag(card, index)}<p className={s.periodText}>{card.eligibility === "blocked" ? `수혜불가능 · ${card.eligibilityReason}` : `${dateLabel(card.stageWindow?.start ?? null)}부터 ${card.personalWindow?.end ? `${dateLabel(card.personalWindow.end)}까지` : "기한 미정"}${card.eligibility === "needs_check" ? ` · 확인 필요 · ${card.eligibilityReason}` : " · 수혜가능"}${card.personalWindow?.end && card.personalWindow.end >= end ? " · 표시 범위 밖으로 계속" : ""}`}</p></>}</div></div>)}</div></div></>;
}

/** 로드맵 깃발: 일정(수료 · 취업 · 이사 …)과 내 기한에 꽂는다. 색은 CSS 클래스가 정한다. */
function Flag() {
  return <svg viewBox="0 0 14 18" width="14" height="18" aria-hidden="true"><path d="M2 1v16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><path d="M3 2h9l-2.5 3.5L12 9H3z" fill="currentColor" /></svg>;
}
