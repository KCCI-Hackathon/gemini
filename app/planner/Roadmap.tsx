"use client";

import { useEffect, useRef, useState } from "react";
import type { Roadmap, RoadmapCat, RoadmapRow } from "@/lib/route/roadmap";
import s from "./planner.module.css";
import { CAT_ORDER, CATS, CIRCLED, STATUS_STYLE, addMonthsYmd, columnOf, periodLabel, type AiPick, type AiPicks } from "./shared";

type Props = {
  roadmap: Roadmap;
  filterCats: Record<RoadmapCat, boolean>;
  onlyMine: boolean;
  /** 가정한 상태 변화로 구간이 열리거나 닫히거나 판정이 바뀌는 정책만 */
  onlyChanging: boolean;
  /** AI 계획 정리에서 고른 정책(없으면 빈 객체) */
  aiPicks: AiPicks;
  onlyAi: boolean;
  mine: Set<string>;
  collapsed: Record<string, boolean>;
  selectedId: string | null;
  onToggleCat: (c: RoadmapCat) => void;
  onSelect: (id: string) => void;
  onGoalClick: () => void;
};

const nextDay = (ymd: string) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const PAGE = 6;

/** 받침이 있으면 "으로", 없으면 "로"(ㄹ 받침은 "로") */
function josa(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return "로";
  const jong = c % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** 가정 때문에 달라지는 줄: 오늘이 아닌 날 열림, 기간 안에 끝남, 경계 달이 있음 */
export function isChanging(r: RoadmapRow, months: string[]): boolean {
  const w = r.windows;
  return r.boundaries.length > 0 || (w.length > 0 && (w[0].from > 0 || w[w.length - 1].to < months.length - 1)) || r.status === "wait";
}

export function RoadmapGrid({ roadmap, filterCats, onlyMine, onlyChanging, aiPicks, onlyAi, mine, collapsed, selectedId, onToggleCat, onSelect, onGoalClick }: Props) {
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [openGoal, setOpenGoal] = useState<string | null>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  // 펼친 목록 밖을 누르거나 Esc를 누르면 닫는다
  useEffect(() => {
    if (!openGoal) return;
    const onDown = (e: MouseEvent) => {
      if (laneRef.current && !laneRef.current.contains(e.target as Node)) setOpenGoal(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenGoal(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openGoal]);
  // 가까운 가정 표시는 위아래 두 줄로 엇갈려 놓는다
  const goalRow = roadmap.goals.map((g, i) => (i > 0 && columnOf(roadmap.months, g.date) - columnOf(roadmap.months, roadmap.goals[i - 1].date) < 2.5 ? 1 : 0));
  for (let i = 1; i < goalRow.length; i++) if (goalRow[i] === 1 && goalRow[i - 1] === 1) goalRow[i] = 0;
  const nameOf = (id: string) => roadmap.rows.find((r) => r.policyId === id)?.name ?? id;
  const N = roadmap.months.length;
  const pct = (col: number) => `${(Math.max(0, Math.min(N, col)) / N) * 100}%`;

  const years: { y: string; n: number }[] = [];
  for (const m of roadmap.months) {
    const y = m.slice(0, 4);
    if (years.at(-1)?.y === y) years.at(-1)!.n++;
    else years.push({ y, n: 1 });
  }

  const groups = CAT_ORDER.filter((c) => filterCats[c])
    .map((c) => ({
      cat: c,
      rows: roadmap.rows
        .filter((r) => r.cat === c && (!onlyMine || mine.has(r.policyId)) && (!onlyChanging || isChanging(r, roadmap.months)) && (!onlyAi || aiPicks[r.policyId]))
        // AI가 고른 정책을 분류 맨 위로(AI 순번 순). 나머지는 원래 순서
        .sort((a, b) => (aiPicks[a.policyId]?.rank ?? 999) - (aiPicks[b.policyId]?.rank ?? 999)),
    }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className={s.gridScroll}>
      <div className={s.grid} style={{ ["--cols" as string]: N }}>
        {/* 날짜 머리 */}
        <div className={s.headRow}>
          <div className={s.labelCell}>정책</div>
          <div className={s.track}>
            <div className={s.yearRow}>
              {years.map((y) => (
                <div key={y.y} style={{ flex: `0 0 ${(y.n / N) * 100}%` }}>
                  {y.y}년
                </div>
              ))}
            </div>
            <div className={s.monthRow}>
              {roadmap.months.map((m, k) => {
                const goal = roadmap.goals.some((g) => g.monthIndex === k);
                return (
                  <div key={m} className={goal ? s.monthGoal : undefined} title={`${m} ~ ${addMonthsYmd(m, 1)} 전날`}>
                    {Number(m.slice(5, 7))}.{Number(m.slice(8, 10))}~
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className={s.body}>
          {/* 세로선: 달 칸, 오늘, 가정한 사건 */}
          <div className={s.overlay} aria-hidden="true">
            <div className={s.labelCell} />
            <div className={s.track}>
              {roadmap.months.map((m) => (
                <div key={m} className={s.colLine} />
              ))}
              <div className={s.todayLine} style={{ left: pct(0) }} />
              {roadmap.goals.map((g) => (
                <div key={g.type} className={g.type === "business_registration" ? s.goalLineStartup : s.goalLine} style={{ left: pct(columnOf(roadmap.months, g.date)) }} />
              ))}
            </div>
          </div>

          {/* 내 상태 줄 */}
          <div className={s.goalLane} ref={laneRef}>
            <div className={s.labelCell}>
              <strong>내 상태 · 가정</strong>
              <span className={s.muted}>지금: {roadmap.stateLabels[0]}</span>
            </div>
            <div className={s.track}>
              <span className={s.todayPill} style={{ left: pct(0) }}>
                오늘
              </span>
              {roadmap.goals.map((g, i) => (
                <div key={g.type} className={s.goalWrap} style={{ left: pct(columnOf(roadmap.months, g.date)), top: goalRow[i] ? 36 : 6 }}>
                  <button
                    type="button"
                    className={g.type === "business_registration" ? s.goalChipStartup : s.goalChip}
                    onClick={() => setOpenGoal(openGoal === g.type ? null : g.type)}
                    aria-expanded={openGoal === g.type}
                    aria-label={`${g.label}, 새로 열림 ${g.opened.length}개, 다시 확인 ${g.changed.length}개`}
                  >
                    {g.label}
                    {g.opened.length + g.changed.length > 0 && (
                      <span className={s.goalCount}>
                        {g.opened.length > 0 && `새로 열림 ${g.opened.length}`}
                        {g.opened.length > 0 && g.changed.length > 0 && " · "}
                        {g.changed.length > 0 && `다시 확인 ${g.changed.length}`}
                      </span>
                    )}
                  </button>
                  {openGoal === g.type && (
                    <div className={s.goalPop} role="dialog" aria-label={`${g.label}에 바뀌는 정책`}>
                      <div className={s.goalPopHead}>
                        <button type="button" className={s.ghost} aria-label="닫기" onClick={() => setOpenGoal(null)} style={{ position: "absolute", right: 6, top: 6 }}>
                          ✕
                        </button>
                        <strong>{g.label}</strong>
                        <span className={s.muted}>{g.date}에 일어난다고 가정</span>
                      </div>
                      <div className={s.goalPopSec}>새로 열리는 정책 {g.opened.length}개</div>
                      {g.opened.length === 0 && <div className={s.muted}>없음</div>}
                      {g.opened.map((id) => (
                        <button key={id} type="button" className={s.goalPopItem} onClick={() => { onSelect(id); setOpenGoal(null); }}>
                          <span className={s.newDot}>NEW</span> {nameOf(id)}
                        </button>
                      ))}
                      <div className={s.goalPopSec}>판정이 바뀌어 다시 확인할 정책 {g.changed.length}개</div>
                      {g.changed.length === 0 && <div className={s.muted}>없음</div>}
                      {g.changed.map((id) => (
                        <button key={id} type="button" className={s.goalPopItem} onClick={() => { onSelect(id); setOpenGoal(null); }}>
                          <span className={s.changeDot}>!</span> {nameOf(id)}
                        </button>
                      ))}
                      <button type="button" className={s.linkButton} onClick={onGoalClick}>
                        시점 바꾸기(계획 수정)
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {roadmap.goals.length === 0 && <span className={s.muted}>가정한 수료·취업·창업이 없어요. 채팅이나 계획 수정에서 정할 수 있어요.</span>}
            </div>
          </div>

          {groups.map((g) => {
            const c = CATS[g.cat];
            const open = !collapsed[g.cat];
            return (
              <div key={g.cat}>
                <div className={s.catRow}>
                  <button type="button" className={s.catButton} aria-expanded={open} onClick={() => onToggleCat(g.cat)}>
                    <span className={s.chev} style={{ transform: `rotate(${open ? 0 : -90}deg)` }}>
                      ▾
                    </span>
                    <span className={s.catDot} style={{ background: c.fill, borderColor: c.stroke }} />
                    {c.label}
                    <span className={s.count}>{g.rows.length}</span>
                  </button>
                </div>
                {open &&
                  (more[g.cat] ? g.rows : g.rows.slice(0, PAGE)).map((r) => (
                    <PolicyRow key={r.policyId} r={r} months={roadmap.months} selected={selectedId === r.policyId} mine={mine.has(r.policyId)} pick={aiPicks[r.policyId]} dim={Object.keys(aiPicks).length > 0 && !aiPicks[r.policyId]} onSelect={onSelect} pct={pct} />
                  ))}
                {open && g.rows.length > PAGE && (
                  <div className={s.moreRow}>
                    <button type="button" className={s.linkButton} onClick={() => setMore({ ...more, [g.cat]: !more[g.cat] })}>
                      {more[g.cat] ? "접기" : `${c.label} ${g.rows.length - PAGE}개 더 보기`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && (
            <div className={s.empty}>
              <strong>조건에 맞는 정책이 없어요</strong>
              <span className={s.muted}>필터를 바꾸거나 채팅 질문에 답해 보세요.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PolicyRow({ r, months, selected, mine, pick, dim, onSelect, pct }: { r: RoadmapRow; months: string[]; selected: boolean; mine: boolean; pick?: AiPick; dim: boolean; onSelect: (id: string) => void; pct: (c: number) => string }) {
  const c = CATS[r.cat];
  const st = STATUS_STYLE[r.status];
  const N = months.length;
  let off: { from: number; to: number } | null = null;
  if (r.official.type === "always") off = { from: 0, to: N };
  else if (r.official.start || r.official.end) {
    off = { from: r.official.start ? columnOf(months, r.official.start) : 0, to: r.official.end ? columnOf(months, nextDay(r.official.end)) : N };
    if (off.to <= 0 || off.from >= N || off.to <= off.from) off = null;
  }
  const officialText = periodLabel(r.official);

  return (
    <div className={`${s.polRow} ${selected ? s.polRowSelected : ""} ${pick ? s.polRowAi : ""} ${dim ? s.polRowDim : ""}`}>
      <div className={s.labelCell}>
        <button type="button" className={s.polName} onClick={() => onSelect(r.policyId)} title={r.name}>
          {r.order != null && <span className={s.order}>{r.order}</span>}
          {r.name}
        </button>
        <span className={s.chips}>
          {pick && (
            <span className={s.aiChip} title={`AI가 고른 이유: ${pick.why}`}>
              AI 추천 {CIRCLED[pick.rank - 1] ?? pick.rank} · {pick.station}
            </span>
          )}
          <span className={s.statusChip} style={{ background: st.bg, color: st.fg }}>
            {r.statusLabel}
          </span>
          <span className={r.verified ? s.verifyOn : s.verifyOff}>{r.verifyLabel}</span>
          {mine && <span className={s.mineChip}>내 계획</span>}
        </span>
      </div>
      <div className={s.track}>
        {off ? (
          <>
            <button
              type="button"
              className={s.offBar}
              style={{ left: `calc(${pct(off.from)} + 2px)`, width: `max(10px, calc(${pct(off.to - off.from)} - 4px))`, background: mine ? c.fill : "#FFFFFF", borderColor: c.stroke, color: c.text }}
              onClick={() => onSelect(r.policyId)}
              title={`공식 신청 기간 ${officialText}`}
              aria-label={`${r.name} 공식 신청 기간 ${officialText}`}
            >
              {off.to - off.from >= 2 ? `신청 ${officialText}` : ""}
            </button>
            {off.to - off.from < 2 && (
              <span className={s.offOutside} style={{ left: `calc(${pct(off.to)} + 6px)`, color: c.text }}>
                신청 {officialText}
              </span>
            )}
          </>
        ) : (
          <span className={s.offText}>신청 기간: {officialText}{r.official.end && r.official.end < months[0] ? " (지난 공고)" : ""}</span>
        )}
        {r.windows.map((w) => (
          <div
            key={`${w.from}-${w.state}`}
            className={`${w.state === "ok" ? s.winOk : s.winCheck} ${r.openedBy && w.from === r.windows[0].from ? s.winNew : ""}`}
            style={{ left: `calc(${pct(w.from)} + 2px)`, width: `calc(${pct(w.to - w.from + 1)} - 4px)` }}
            title={r.summary}
          >
            {w.note ?? (r.openedBy && w.from === r.windows[0].from ? `▶ ${r.openedBy}${josa(r.openedBy)} 열림` : w.state === "ok" ? "내 조건 구간" : "확인 필요 구간")}
          </div>
        ))}
        {r.windows.length === 0 && <span className={s.winNone}>{r.summary}</span>}
        {r.boundaries.map((b) => (
          <span key={b.date} className={s.boundary} style={{ left: pct(b.col), width: pct(1) }} title={`${b.date}: ${b.text}`}>
            선후 확인
          </span>
        ))}
      </div>
    </div>
  );
}
