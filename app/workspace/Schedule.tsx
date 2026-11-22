"use client";
import { useEffect, useRef } from "react";
import { addMonths } from "@/lib/date";
import { addDays, axisPosition, dateLabel } from "@/lib/planner/dates";
import { chipLanes } from "@/lib/planner/chip-lanes";
import { EVENT_NAMES, type Evaluation, type PlanEvent } from "@/lib/planner/types";
import s from "./workspace.module.css";
// 칩 폭(px) 추정치와 줄 간격. 실제 폭보다 조금 넉넉하게 잡아 겹치지 않게 한다
const TODAY_CHIP = 132, EVENT_CHIP = 186, LANE_GAP = 52;
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
  // 칩이 겹치지 않게 현재 칩까지 함께 줄을 나눈다. 칩 폭은 글자 길이 기준 여유 있게 잡고, 띠의 최소 폭(px)으로 계산한다
  const axisWidth = Math.max(1000, ticks.length * 165);
  const lanes = chipLanes([
    { id: "today", x: axisPosition(evaluation.today, start, end) * axisWidth - 8, width: TODAY_CHIP },
    ...events.map(e => ({ id: e.id, x: axisPosition(e.date, start, end) * axisWidth - 8, width: EVENT_CHIP })),
  ]);
  const laneTop = (id: string) => 62 + (lanes.get(id) ?? 0) * LANE_GAP;
  const laneCount = Math.max(...lanes.values()) + 1;
  const placed = [...events].sort((a, b) => a.date.localeCompare(b.date)).map(e => ({ event: e, top: laneTop(e.id) }));
  return <section className={s.schedule} aria-labelledby="schedule-title" data-tour="schedule"><div className={s.sectionHeader}><div><h2 id="schedule-title">내 일정</h2><span>생활이 바뀌는 날, 정책도 달라져요</span></div><div className={s.inlineActions}><button className={s.textButton} onClick={() => { todayRef.current?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" }); onFocus("current"); }}>오늘</button>{!readOnly && <><button className={s.textButton} disabled={!canUndo || busy} onClick={onUndo}>되돌리기</button><button className={s.outlineButton} disabled={busy} onClick={onAdd}>+ 일정 추가</button></>}</div></div><div className={s.scheduleScroll} ref={stripRef} aria-label="일 단위 일정. 가로로 이동할 수 있어요" tabIndex={0}><div className={s.scheduleAxis} style={{ minWidth: axisWidth, height: 177 + Math.max(0, laneCount - 2) * LANE_GAP }}>{ticks.map(d => <div className={s.monthTick} style={{ left: `${axisPosition(d, start, end) * 100}%` }} key={d}><strong>{d.slice(0, 4)}.{Number(d.slice(5, 7))}</strong><span>1일</span></div>)}{ticks.map(d => <span key={`${d}-mid`} className={s.dayTick} style={{ left: `${axisPosition(addDays(d, 14), start, end) * 100}%` }}>15</span>)}<button ref={todayRef} className={`${s.scheduleChip} ${s.todayChip}`} style={{ left: `${axisPosition(evaluation.today, start, end) * 100}%`, top: laneTop("today") }} onClick={() => onFocus("current")}>현재 <small>{dateLabel(evaluation.today)}</small></button>{placed.map(({ event: e, top }) => { const stage = evaluation.stages.find(st => st.eventIds.includes(e.id)); return <button key={e.id} data-event={e.id} className={`${s.scheduleChip} ${focusedStage === stage?.stageId ? s.focusedChip : ""}`} style={{ left: `${axisPosition(e.date, start, end) * 100}%`, top }} disabled={readOnly || busy} onClick={() => onEdit(e)} aria-label={`${EVENT_NAMES[e.type]} 예정 ${e.date}, 날짜 변경`}><span>{EVENT_NAMES[e.type]} {e.status === "completed" ? "완료" : "예정"}</span><small>{dateLabel(e.date)}</small><span className={s.calendarGlyph}>▦</span></button>; })}</div></div></section>;
}
