"use client";

import { useState } from "react";
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
  /** time: 지금·수료·취업·창업 시점별 묶음, cat: 분류별 묶음 */
  groupBy: "time" | "cat";
  onToggleGroup: (key: string, open: boolean) => void;
  onSelect: (id: string) => void;
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

type RowTag = { kind: "new" | "changed" | "later"; text: string };
type Group = { key: string; title: string; sub?: string; dot: { fill: string; stroke: string }; rows: { r: RoadmapRow; tag?: RowTag }[]; defaultClosed?: boolean };

const EVENT_DOT: Record<string, { fill: string; stroke: string }> = {
  now: { fill: "#FDECEC", stroke: "#D93D42" },
  training_completion: { fill: "#ECE7FD", stroke: "#6846E8" },
  employment: { fill: "#ECE7FD", stroke: "#6846E8" },
  business_registration: { fill: "#FCEADB", stroke: "#A9561A" },
  relocation: { fill: "#DCF2EA", stroke: "#2A8F73" },
  later: { fill: "#E0EBFB", stroke: "#3A74CC" },
  none: { fill: "#F1F2F6", stroke: "#A3A6B6" },
};

export function RoadmapGrid({ roadmap, groupBy, filterCats, onlyMine, onlyChanging, aiPicks, onlyAi, mine, collapsed, selectedId, onToggleGroup, onSelect }: Props) {
  const [more, setMore] = useState<Record<string, boolean>>({});
  // 가까운 가정 표시는 위아래 두 줄로 엇갈려 놓는다(그래프 위에 목록을 겹쳐 띄우지 않는다)
  const goalRow = roadmap.goals.map((g, i) => (i > 0 && columnOf(roadmap.months, g.date) - columnOf(roadmap.months, roadmap.goals[i - 1].date) < 2.5 ? 1 : 0));
  for (let i = 1; i < goalRow.length; i++) if (goalRow[i] === 1 && goalRow[i - 1] === 1) goalRow[i] = 0;
  const N = roadmap.months.length;
  const pct = (col: number) => `${(Math.max(0, Math.min(N, col)) / N) * 100}%`;
  const today = roadmap.months[0];

  const years: { y: string; n: number }[] = [];
  for (const m of roadmap.months) {
    const y = m.slice(0, 4);
    if (years.at(-1)?.y === y) years.at(-1)!.n++;
    else years.push({ y, n: 1 });
  }

  const pass = (r: RoadmapRow) => filterCats[r.cat] && (!onlyMine || mine.has(r.policyId)) && (!onlyChanging || isChanging(r, roadmap.months)) && (!onlyAi || !!aiPicks[r.policyId]);
  const byAi = (a: { r: RoadmapRow }, b: { r: RoadmapRow }) => (aiPicks[a.r.policyId]?.rank ?? 999) - (aiPicks[b.r.policyId]?.rank ?? 999);
  const byId = new Map(roadmap.rows.map((r) => [r.policyId, r]));

  let groups: Group[];
  if (groupBy === "time") {
    const goalDates = new Set(roadmap.goals.map((g) => g.date));
    const name = (t: string) => (t === "training_completion" ? "수료" : t === "employment" ? "취업" : t === "business_registration" ? "창업" : "이사");
    groups = [
      {
        key: "now",
        title: "지금 신청할 수 있는 정책",
        sub: `오늘(${today}) 기준`,
        dot: EVENT_DOT.now,
        rows: roadmap.rows.filter((r) => r.firstAvailable === today && r.status !== "none" && pass(r)).map((r) => ({ r })),
      },
      ...roadmap.goals.map((g) => {
        const ev = name(g.type);
        const opened = g.opened.map((id) => byId.get(id)!).filter(pass).map((r) => ({ r, tag: { kind: "new" as const, text: `${ev}${josa(ev)} 새로 열림` } }));
        const changed = g.changed.map((id) => byId.get(id)!).filter(pass).map((r) => ({ r, tag: { kind: "changed" as const, text: `${ev} 후 다시 확인` } }));
        return {
          key: g.type,
          title: `${g.label} 이후`,
          sub: `새로 열림 ${g.opened.length} · 다시 확인 ${g.changed.length}`,
          dot: EVENT_DOT[g.type],
          rows: [...opened, ...changed],
        };
      }),
      {
        key: "later",
        title: "기간이 지나 열리는 정책",
        sub: "최근 이력·대기 기간 조건이 풀리는 때",
        dot: EVENT_DOT.later,
        rows: roadmap.rows
          .filter((r) => r.firstAvailable && r.firstAvailable > today && !goalDates.has(r.firstAvailable) && pass(r))
          .map((r) => ({ r, tag: { kind: "later" as const, text: `${r.firstAvailable!.slice(0, 7).replace("-", ".")}부터 열림` } })),
      },
      { key: "none", title: "이 기간 신청 구간 없음", dot: EVENT_DOT.none, rows: roadmap.rows.filter((r) => !r.firstAvailable && pass(r)).map((r) => ({ r })), defaultClosed: true },
    ];
  } else {
    groups = CAT_ORDER.filter((c) => filterCats[c]).map((c) => ({
      key: c,
      title: CATS[c].label,
      dot: CATS[c],
      rows: roadmap.rows.filter((r) => r.cat === c && pass(r)).map((r) => ({ r })),
    }));
  }
  groups = groups.map((g) => ({ ...g, rows: [...g.rows].sort(byAi) })).filter((g) => g.rows.length > 0 || roadmap.goals.some((x) => x.type === g.key));

  const isOpen = (g: Group) => (g.defaultClosed ? collapsed[g.key] === false : !collapsed[g.key]);
  const jump = (key: string) => {
    if (collapsed[key]) onToggleGroup(key, true);
    requestAnimationFrame(() => document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

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

          {/* 내 상태 줄: 표시를 누르면 그 시점의 묶음으로 내려간다 */}
          <div className={s.goalLane}>
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
                    onClick={() => groupBy === "time" && jump(g.type)}
                    aria-label={`${g.label}, 그 뒤 새로 열림 ${g.openedAfter.length}개`}
                  >
                    {g.label}
                    {g.openedAfter.length > 0 && <span className={s.goalCount}>새로 {g.openedAfter.length}</span>}
                  </button>
                </div>
              ))}
              {roadmap.goals.length === 0 && <span className={s.muted}>가정한 수료·취업·창업이 없어요. 채팅이나 계획 수정에서 정할 수 있어요.</span>}
            </div>
          </div>

          {groups.map((g) => {
            const open = isOpen(g);
            return (
              <div key={g.key} id={`sec-${g.key}`} className={s.section}>
                <div className={s.catRow}>
                  <button type="button" className={s.catButton} aria-expanded={open} onClick={() => onToggleGroup(g.key, !open)}>
                    <span className={s.chev} style={{ transform: `rotate(${open ? 0 : -90}deg)` }}>
                      ▾
                    </span>
                    <span className={s.catDot} style={{ background: g.dot.fill, borderColor: g.dot.stroke }} />
                    <span className={s.groupTitle}>{g.title}</span>
                    <span className={s.count}>{g.rows.length}</span>
                  </button>
                  {g.sub && <span className={s.groupSub}>{g.sub}</span>}
                </div>
                {open && g.rows.length === 0 && <div className={s.moreRow}><span className={s.muted}>이 시점에 새로 열리거나 바뀌는 정책이 없어요.</span></div>}
                {open &&
                  (more[g.key] ? g.rows : g.rows.slice(0, PAGE)).map(({ r, tag }) => (
                    <PolicyRow key={r.policyId} r={r} tag={tag} months={roadmap.months} selected={selectedId === r.policyId} mine={mine.has(r.policyId)} pick={aiPicks[r.policyId]} dim={Object.keys(aiPicks).length > 0 && !aiPicks[r.policyId]} onSelect={onSelect} pct={pct} />
                  ))}
                {open && g.rows.length > PAGE && (
                  <div className={s.moreRow}>
                    <button type="button" className={s.linkButton} onClick={() => setMore({ ...more, [g.key]: !more[g.key] })}>
                      {more[g.key] ? "접기" : `${g.rows.length - PAGE}개 더 보기`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {groups.every((g) => g.rows.length === 0) && (
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

function PolicyRow({ r, tag, months, selected, mine, pick, dim, onSelect, pct }: { r: RoadmapRow; tag?: RowTag; months: string[]; selected: boolean; mine: boolean; pick?: AiPick; dim: boolean; onSelect: (id: string) => void; pct: (c: number) => string }) {
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
          {tag && <span className={tag.kind === "new" ? s.tagNew : tag.kind === "changed" ? s.tagChanged : s.tagLater}>{tag.kind === "new" ? "NEW · " : tag.kind === "changed" ? "! " : ""}{tag.text}</span>}
          {pick && (
            <span className={s.aiChip} title={pick.reasons.map((reason) => `${reason.station} · ${reason.why}`).join("\n")}>
              AI 추천 {CIRCLED[pick.rank - 1] ?? pick.rank} · {pick.reasons.map((reason) => reason.station).join(" / ")}
            </span>
          )}
          <span className={s.statusChip} style={{ background: st.bg, color: st.fg }}>
            {r.statusLabel}
          </span>
          <span className={r.verifyLabel === "근거 확인됨" || r.verifyLabel === "공고 항목 확인됨" ? s.verifyOn : s.verifyOff}>{r.verifyLabel}</span>
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
