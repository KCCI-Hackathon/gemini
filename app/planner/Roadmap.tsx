"use client";

import type { Roadmap, RoadmapCat, RoadmapRow } from "@/lib/route/roadmap";
import s from "./planner.module.css";
import { CAT_ORDER, CATS, STATUS_STYLE, addMonthsYmd, columnOf, periodLabel } from "./shared";

type Props = {
  roadmap: Roadmap;
  filterCats: Record<RoadmapCat, boolean>;
  onlyMine: boolean;
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

export function RoadmapGrid({ roadmap, filterCats, onlyMine, mine, collapsed, selectedId, onToggleCat, onSelect, onGoalClick }: Props) {
  const N = roadmap.months.length;
  const pct = (col: number) => `${(Math.max(0, Math.min(N, col)) / N) * 100}%`;

  const years: { y: string; n: number }[] = [];
  for (const m of roadmap.months) {
    const y = m.slice(0, 4);
    if (years.at(-1)?.y === y) years.at(-1)!.n++;
    else years.push({ y, n: 1 });
  }

  const groups = CAT_ORDER.filter((c) => filterCats[c])
    .map((c) => ({ cat: c, rows: roadmap.rows.filter((r) => r.cat === c && (!onlyMine || mine.has(r.policyId))) }))
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
          <div className={s.goalLane}>
            <div className={s.labelCell}>
              <strong>내 상태 · 가정</strong>
              <span className={s.muted}>지금: {roadmap.stateLabels[0]}</span>
            </div>
            <div className={s.track}>
              <span className={s.todayPill} style={{ left: pct(0) }}>
                오늘
              </span>
              {roadmap.goals.map((g) => (
                <button
                  key={g.type}
                  type="button"
                  className={g.type === "business_registration" ? s.goalChipStartup : s.goalChip}
                  style={{ left: pct(columnOf(roadmap.months, g.date)) }}
                  onClick={onGoalClick}
                  aria-label={`${g.label}, 계획 수정 열기`}
                >
                  {g.label}
                </button>
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
                {open && g.rows.map((r) => <PolicyRow key={r.policyId} r={r} months={roadmap.months} selected={selectedId === r.policyId} mine={mine.has(r.policyId)} onSelect={onSelect} pct={pct} />)}
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

function PolicyRow({ r, months, selected, mine, onSelect, pct }: { r: RoadmapRow; months: string[]; selected: boolean; mine: boolean; onSelect: (id: string) => void; pct: (c: number) => string }) {
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
    <div className={`${s.polRow} ${selected ? s.polRowSelected : ""}`}>
      <div className={s.labelCell}>
        <button type="button" className={s.polName} onClick={() => onSelect(r.policyId)} title={r.name}>
          {r.order != null && <span className={s.order}>{r.order}</span>}
          {r.name}
        </button>
        <span className={s.chips}>
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
            className={w.state === "ok" ? s.winOk : s.winCheck}
            style={{ left: `calc(${pct(w.from)} + 2px)`, width: `calc(${pct(w.to - w.from + 1)} - 4px)` }}
            title={r.summary}
          >
            {w.note ?? (w.state === "ok" ? "내 조건 구간" : "확인 필요 구간")}
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
