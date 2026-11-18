"use client";

// 단계별 보기: 지금 → 수료 가정 → 취업 가정 → 창업 가정을 열로 놓고,
// 열마다 그 시점에 새로 열리거나 판정이 바뀌는 정책을 카드로 보인다. 판정은 코드 결과 그대로.
import { useState } from "react";
import type { Roadmap, RoadmapRow } from "@/lib/route/roadmap";
import s from "./planner.module.css";
import { CATS, CIRCLED, STATUS_STYLE, type AiPicks } from "./shared";

type Tag = { kind: "new" | "changed" | "later"; text: string };
type Column = { key: string; title: string; when: string; tone: "now" | "event" | "startup" | "later"; rows: { r: RoadmapRow; tag?: Tag }[]; note?: string };

const EVENT_NAME: Record<string, string> = { training_completion: "수료", employment: "취업", business_registration: "창업", relocation: "이사" };
const PAGE = 6;

function josa(word: string): string {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return "로";
  const jong = c % 28;
  return jong === 0 || jong === 8 ? "로" : "으로";
}

/** 열 만들기: 지금(오늘 열려 있음) · 가정한 시점마다 "그 뒤 다음 시점 전까지 새로 열리는 정책"만.
 *  지금 판정은 첫 열에서 이미 봤으므로, 뒤 열에는 판정이 바뀐 정책(다시 확인)을 다시 싣지 않는다 */
export function buildColumns(roadmap: Roadmap, pass: (r: RoadmapRow) => boolean): Column[] {
  const today = roadmap.months[0];
  const byId = new Map(roadmap.rows.map((r) => [r.policyId, r]));
  const firstGoal = roadmap.goals[0]?.date ?? "9999";
  const ym = (d: string) => d.slice(0, 7).replace("-", ".");
  const cols: Column[] = [
    {
      key: "now",
      title: "지금",
      when: `오늘 ${today.slice(5).replace("-", ".")}`,
      tone: "now",
      rows: roadmap.rows.filter((r) => r.firstAvailable === today && r.status !== "none" && pass(r)).map((r) => ({ r })),
    },
  ];
  // 오늘과 첫 가정 시점 사이에 열리는 정책(모집 시작 등)
  const soon = roadmap.rows.filter((r) => r.firstAvailable && r.firstAvailable > today && r.firstAvailable < firstGoal && pass(r));
  if (soon.length)
    cols.push({ key: "soon", title: roadmap.goals.length ? "곧 열림" : "앞으로 열림", when: roadmap.goals.length ? `${ym(firstGoal)} 전` : "12개월 안", tone: "later", rows: soon.map((r) => ({ r, tag: { kind: "later" as const, text: `${ym(r.firstAvailable!)}부터 열림` } })) });
  for (const g of roadmap.goals) {
    const ev = EVENT_NAME[g.type];
    const rows = g.openedAfter
      .map((id) => byId.get(id)!)
      .filter(pass)
      .map((r) => ({ r, tag: r.firstAvailable === g.date ? { kind: "new" as const, text: `${ev}${josa(ev)} 바로 열림` } : { kind: "later" as const, text: `${ym(r.firstAvailable!)}부터 열림` } }));
    cols.push({
      key: g.type,
      title: `${ev} 후`,
      when: `${ev} 가정 ${ym(g.date)}`,
      tone: g.type === "business_registration" ? "startup" : "event",
      rows,
      note: rows.length === 0 ? "이 시점 뒤에 새로 열리는 정책이 없어요" : undefined,
    });
  }
  return cols;
}

export function StageBoard({ roadmap, pass, aiPicks, selectedId, onSelect, onPlanEdit }: { roadmap: Roadmap; pass: (r: RoadmapRow) => boolean; aiPicks: AiPicks; selectedId: string | null; onSelect: (id: string) => void; onPlanEdit: () => void }) {
  const [more, setMore] = useState<Record<string, boolean>>({});
  const byAi = (a: { r: RoadmapRow }, b: { r: RoadmapRow }) => (aiPicks[a.r.policyId]?.rank ?? 999) - (aiPicks[b.r.policyId]?.rank ?? 999);
  const cols = buildColumns(roadmap, pass).map((c) => ({ ...c, rows: [...c.rows].sort(byAi) }));
  const hasAi = Object.keys(aiPicks).length > 0;

  return (
    <div className={s.board}>
      {cols.map((c, i) => (
        <div key={c.key} className={s.stageWrap}>
          <section className={s.stage} aria-label={`${c.title} ${c.when}`}>
            <header className={`${s.stageHead} ${s[`tone_${c.tone}`]}`}>
              <div>
                <strong>{c.title}</strong>
                <span>{c.when}</span>
              </div>
              <div className={s.stageCounts}>
                <span>{c.key === "now" ? `${c.rows.length}개` : `새로 열림 ${c.rows.length}`}</span>
              </div>
            </header>
            <div className={s.stageBody}>
              {c.note && (
                <p className={s.muted}>
                  {c.note}.{" "}
                  <button type="button" className={s.linkButton} onClick={onPlanEdit}>
                    시점 바꾸기
                  </button>
                </p>
              )}
              {(more[c.key] ? c.rows : c.rows.slice(0, PAGE)).map(({ r, tag }) => {
                const pick = aiPicks[r.policyId];
                const st = STATUS_STYLE[r.status];
                return (
                  <button
                    key={r.policyId}
                    type="button"
                    className={`${s.card} ${selectedId === r.policyId ? s.cardSelected : ""} ${pick ? s.cardAi : ""} ${hasAi && !pick ? s.cardDim : ""}`}
                    style={{ borderLeftColor: CATS[r.cat].stroke }}
                    onClick={() => onSelect(r.policyId)}
                    title={r.summary}
                  >
                    <span className={s.chips}>
                      {tag && <span className={tag.kind === "new" ? s.tagNew : tag.kind === "changed" ? s.tagChanged : s.tagLater}>{tag.kind === "new" ? "NEW · " : tag.kind === "changed" ? "! " : ""}{tag.text}</span>}
                      {pick && (
                        <span className={s.aiChip}>
                          AI 추천 {CIRCLED[pick.rank - 1] ?? pick.rank}
                        </span>
                      )}
                    </span>
                    <span className={s.cardName}>{r.name}</span>
                    <span className={s.chips}>
                      <span className={s.statusChip} style={{ background: st.bg, color: st.fg }}>
                        {r.statusLabel}
                      </span>
                      <span className={r.verified ? s.verifyOn : s.verifyOff}>{r.verifyLabel}</span>
                    </span>
                    {pick && <span className={s.cardWhy}>{pick.why}</span>}
                  </button>
                );
              })}
              {c.rows.length > PAGE && (
                <button type="button" className={s.linkButton} onClick={() => setMore({ ...more, [c.key]: !more[c.key] })}>
                  {more[c.key] ? "접기" : `${c.rows.length - PAGE}개 더 보기`}
                </button>
              )}
            </div>
          </section>
          {i < cols.length - 1 && (
            <span className={s.stageArrow} aria-hidden="true">
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
