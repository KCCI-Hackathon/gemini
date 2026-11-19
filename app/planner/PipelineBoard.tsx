"use client";

// 파이프라인 보기: 신청 마감월로 열을 자른다(11월 마감 → 12월 마감 → … → 상시).
// 카드 색은 출처(지금 열려 있음 = 빨강, 수료 뒤 = 보라, 취업 뒤 = 초록, 창업 뒤 = 주황),
// 가정한 사건은 열 사이 표시. 정책 사이 중복 수혜 제한·연계는 카드 안에. 판정은 코드 결과 그대로.
import type { CardSource, Pipeline, PipelineCard, PipelineColumn } from "@/lib/route/pipeline";
import s from "./planner.module.css";
import { CIRCLED, STATUS_STYLE, type AiPicks } from "./shared";

export const SOURCE: Record<CardSource, { label: string; color: string; bg: string }> = {
  now: { label: "지금 신청 가능", color: "#D93D42", bg: "#FDECEC" },
  later: { label: "곧 열림", color: "#3A74CC", bg: "#E6F0FD" },
  training_completion: { label: "수료 후 열림", color: "#6846E8", bg: "#F1EDFF" },
  employment: { label: "취업 후 열림", color: "#17643F", bg: "#E3F5EC" },
  business_registration: { label: "창업 후 열림", color: "#A9561A", bg: "#FCEADB" },
  relocation: { label: "이사 후 열림", color: "#2A8F73", bg: "#DCF2EA" },
};

const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;

export function PipelineBoard({ pipeline, aiPicks, selectedId, onSelect, onShowAll }: { pipeline: Pipeline; aiPicks: AiPicks; selectedId: string | null; onSelect: (id: string) => void; onShowAll: () => void }) {
  const hasAi = Object.keys(aiPicks).length > 0;
  const byAi = (a: PipelineCard, b: PipelineCard) => (aiPicks[a.policyId]?.rank ?? 999) - (aiPicks[b.policyId]?.rank ?? 999);
  const sourcesUsed = [...new Set(pipeline.columns.flatMap((c) => Object.keys(c.bySource) as CardSource[]))];

  const renderCard = (c: PipelineCard) => {
    const pick = aiPicks[c.policyId];
    const st = STATUS_STYLE[c.status];
    const src = SOURCE[c.source];
    return (
      <div key={c.policyId} className={`${s.card} ${selectedId === c.policyId ? s.cardSelected : ""} ${pick ? s.cardAi : ""} ${hasAi && !pick ? s.cardDim : ""}`} style={{ borderLeftColor: src.color, background: c.source === "now" ? undefined : src.bg }}>
        <button type="button" className={s.cardMain} onClick={() => onSelect(c.policyId)}>
          <span className={s.chips}>
            <span className={s.srcChip} style={{ background: src.color }}>
              {src.label}
              {c.opensAt ? ` · ${md(c.opensAt)}~` : ""}
            </span>
            {c.closesAt && <span className={s.dueChip}>{md(c.closesAt)} 마감</span>}
            {pick && <span className={s.aiChip}>AI 추천 {CIRCLED[pick.rank - 1] ?? pick.rank}</span>}
          </span>
          <span className={s.cardName}>{c.name}</span>
          <span className={s.chips}>
            <span className={s.statusChip} style={{ background: st.bg, color: st.fg }}>
              {c.statusLabel}
            </span>
            <span className={c.verified ? s.verifyOn : s.verifyOff}>{c.verifyLabel}</span>
          </span>
          {pick && <span className={s.cardWhy}>{pick.why}</span>}
        </button>
        {(c.blockedBy.length > 0 || c.blocks.length > 0 || c.leadsTo.length > 0 || c.dupNote) && (
          <div className={s.relations}>
            {c.blockedBy.map((b) => (
              <button key={`by-${b.id}`} type="button" className={s.relBlock} title={`공고: "${b.quote}"`} onClick={() => onSelect(b.id)}>
                ⛔ {b.name} 참여 중이면 신청 제한
              </button>
            ))}
            {c.blocks.map((b) => (
              <button key={`to-${b.id}`} type="button" className={s.relBlock} title={`공고: "${b.quote}"`} onClick={() => onSelect(b.id)}>
                ⛔ 참여하면 {b.name} 제한
              </button>
            ))}
            {c.leadsTo.map((l) => (
              <button key={`lead-${l.id}`} type="button" className={s.relLead} title={`공고: "${l.quote}"`} onClick={() => onSelect(l.id)}>
                ➜ 이수하면 {l.name}로 연계
              </button>
            ))}
            {c.dupNote && (
              <span className={s.relDup} title={c.dupNote}>
                ⚠ 다른 사업과 중복 제한 문구 있음
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderColumn = (col: PipelineColumn) => {
    const cards = [...col.cards].sort(byAi);
    const grouped = new Set(col.exclusiveGroups.flat());
    return (
      <section className={s.stage} aria-label={col.title}>
        <header className={s.dueHead}>
          <div>
            <strong>{col.title}</strong>
            <span>{col.total}개</span>
          </div>
          <div className={s.srcDots}>
            {(Object.entries(col.bySource) as [CardSource, number][]).map(([k, n]) => (
              <span key={k} title={SOURCE[k].label}>
                <i style={{ background: SOURCE[k].color }} />
                {n}
              </span>
            ))}
          </div>
        </header>
        <div className={s.stageBody}>
          {col.exclusiveGroups.map((g) => (
            <div key={g.join(":")} className={s.exclusive}>
              <span className={s.exclusiveHead}>중복 수혜 불가 · 둘 중 하나</span>
              {g.map((id) => cards.find((c) => c.policyId === id)).filter(Boolean).map((c) => renderCard(c!))}
            </div>
          ))}
          {cards.filter((c) => !grouped.has(c.policyId)).map(renderCard)}
          {col.hidden > 0 && (
            <button type="button" className={s.linkButton} onClick={onShowAll}>
              그 외 {col.hidden}개는 기간표에서 보기
            </button>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className={s.pipeWrap}>
      <div className={s.legendRow}>
        {sourcesUsed.map((k) => (
          <span key={k}>
            <i style={{ background: SOURCE[k].color }} />
            {SOURCE[k].label}
          </span>
        ))}
        <span className={s.muted}>· 열은 신청 마감월, 카드 색은 언제부터 신청할 수 있는지</span>
      </div>
      <div className={s.board}>
        {pipeline.columns.map((col, i) => (
          <div key={col.key} className={s.stageWrap}>
            {pipeline.markers
              .filter((m) => m.beforeKey === col.key)
              .map((m) => (
                <div key={m.type} className={s.eventMarker} style={{ background: SOURCE[m.type].color }} title={`${m.date}에 ${m.label.split(" ")[0]}한다고 가정`}>
                  <span>▼</span>
                  {m.label}
                </div>
              ))}
            {renderColumn(col)}
            {i < pipeline.columns.length - 1 && (
              <span className={s.stageArrow} aria-hidden="true">
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
