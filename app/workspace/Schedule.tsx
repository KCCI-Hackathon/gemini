"use client";
import { useEffect, useRef } from "react";
import { addMonths } from "@/lib/date";
import { addDays, axisPosition, dateLabel } from "@/lib/planner/dates";
import { EVENT_NAMES, type Evaluation, type PlanEvent } from "@/lib/planner/types";
import s from "./workspace.module.css";
export function Schedule({ evaluation, events, onEdit, onAdd, onUndo, canUndo, readOnly, busy, focusedStage, onFocus }: { evaluation: Evaluation; events: PlanEvent[]; onEdit: (e: PlanEvent) => void; onAdd: () => void; onUndo: () => void; canUndo: boolean; readOnly: boolean; busy: boolean; focusedStage: string | null; onFocus: (id: string) => void }) {
  const todayRef = useRef<HTMLButtonElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusedStage || focusedStage === "current") return;
    const stage = evaluation.stages.find(st => st.stageId === focusedStage);
    const eventId = stage?.eventIds[0];
    if (!eventId) return;
    stripRef.current?.querySelector<HTMLButtonElement>(`[data-event="${eventId}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
  }, [events, focusedStage, evaluation.stages]);
  const start = `${evaluation.today.slice(0, 7)}-01`;
  const last = events.reduce((date, event) => event.date > date ? event.date : date, addMonths(start, 5));
  const end = addMonths(`${last.slice(0, 7)}-01`, 2);
  const ticks: string[] = [];
  for (let d = start; d < end; d = addMonths(d, 1)) ticks.push(d);
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let lastPosition = -200, row = 0;
  const placed = sorted.map(e => { const position = axisPosition(e.date, start, end) * 1200; row = position - lastPosition < 135 ? 1 - row : 0; lastPosition = position; return { event: e, row }; });
  return <section className={s.schedule} aria-labelledby="schedule-title"><div className={s.sectionHeader}><div><h2 id="schedule-title">내 일정</h2><span>생활이 바뀌는 날, 정책도 달라져요</span></div><div className={s.inlineActions}><button className={s.textButton} onClick={() => { todayRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" }); onFocus("current"); }}>오늘</button>{!readOnly && <><button className={s.textButton} disabled={!canUndo || busy} onClick={onUndo}>되돌리기</button><button className={s.outlineButton} disabled={busy} onClick={onAdd}>+ 일정 추가</button></>}</div></div><div className={s.scheduleScroll} ref={stripRef} aria-label="일 단위 일정. 가로로 이동할 수 있어요" tabIndex={0}><div className={s.scheduleAxis} style={{ minWidth: Math.max(1000, ticks.length * 165) }}>{ticks.map(d => <div className={s.monthTick} style={{ left: `${axisPosition(d, start, end) * 100}%` }} key={d}><strong>{d.slice(0, 4)}.{Number(d.slice(5, 7))}</strong><span>1일</span></div>)}{ticks.map(d => <span key={`${d}-mid`} className={s.dayTick} style={{ left: `${axisPosition(addDays(d, 14), start, end) * 100}%` }}>15</span>)}<button ref={todayRef} className={`${s.scheduleChip} ${s.todayChip}`} style={{ left: `${axisPosition(evaluation.today, start, end) * 100}%`, top: 62 }} onClick={() => onFocus("current")}>현재 <small>{dateLabel(evaluation.today)}</small></button>{placed.map(({ event: e, row: lane }) => { const stage = evaluation.stages.find(st => st.eventIds.includes(e.id)); return <button key={e.id} data-event={e.id} className={`${s.scheduleChip} ${focusedStage === stage?.stageId ? s.focusedChip : ""}`} style={{ left: `${axisPosition(e.date, start, end) * 100}%`, top: lane ? 114 : 62 }} disabled={readOnly || busy} onClick={() => onEdit(e)} aria-label={`${EVENT_NAMES[e.type]} 예정 ${e.date}, 날짜 변경`}><span>{EVENT_NAMES[e.type]} {e.status === "completed" ? "완료" : "예정"}</span><small>{dateLabel(e.date)}</small><span className={s.calendarGlyph}>▦</span></button>; })}</div></div></section>;
}
