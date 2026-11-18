"use client";

// 파이프라인 보기: 기간(지금 → 수료 후 → 취업 후 → 창업 후)마다 먼저 볼 정책 몇 장,
// 그리고 정책 사이의 중복 수혜 제한(공고 인용)·연계를 따로 그린다. 판정은 코드 결과 그대로.
import type { Pipeline, PipelineCard } from "@/lib/route/pipeline";
import s from "./planner.module.css";
import { CATS, CIRCLED, STATUS_STYLE, type AiPicks } from "./shared";

const TONE: Record<string, string> = { now: "tone_now", training_completion: "tone_event", employment: "tone_event", business_registration: "tone_startup", relocation: "tone_later" };

export function PipelineBoard({ pipeline, aiPicks, selectedId, onSelect, onShowAll, onPlanEdit }: { pipeline: Pipeline; aiPicks: AiPicks; selectedId: string | null; onSelect: (id: string) => void; onShowAll: () => void; onPlanEdit: () => void }) {
  const hasAi = Object.keys(aiPicks).length > 0;
  const byAi = (a: PipelineCard, b: PipelineCard) => (aiPicks[a.policyId]?.rank ?? 999) - (aiPicks[b.policyId]?.rank ?? 999);

  const renderCard = (c: PipelineCard) => {
    const pick = aiPicks[c.policyId];
    const st = STATUS_STYLE[c.status];
    return (
      <div key={c.policyId} className={`${s.card} ${selectedId === c.policyId ? s.cardSelected : ""} ${pick ? s.cardAi : ""} ${hasAi && !pick ? s.cardDim : ""}`} style={{ borderLeftColor: CATS[c.cat].stroke }}>
        <button type="button" className={s.cardMain} onClick={() => onSelect(c.policyId)}>
          <span className={s.chips}>
            {c.opensAt && <span className={s.tagLater}>{c.opensAt.slice(0, 7).replace("-", ".")}부터 열림</span>}
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

  return (
    <div className={s.board}>
      {pipeline.stages.map((st, i) => {
        const cards = [...st.cards].sort(byAi);
        const grouped = new Set(st.exclusiveGroups.flat());
        return (
          <div key={st.key} className={s.stageWrap}>
            <section className={s.stage} aria-label={`${st.title} ${st.when}`}>
              <header className={`${s.stageHead} ${s[TONE[st.key] ?? "tone_event"]}`}>
                <div>
                  <strong>{st.title}</strong>
                  <span>{st.when}</span>
                </div>
                <div className={s.stageCounts}>
                  <span>{st.key === "now" ? `${st.total}개 중 ${st.cards.length}` : `새로 열림 ${st.total}`}</span>
                </div>
              </header>
              <div className={s.stageBody}>
                {st.total === 0 && (
                  <p className={s.muted}>
                    이 시점 뒤에 새로 열리는 정책이 없어요.{" "}
                    <button type="button" className={s.linkButton} onClick={onPlanEdit}>
                      시점 바꾸기
                    </button>
                  </p>
                )}
                {st.exclusiveGroups.map((g) => (
                  <div key={g.join(":")} className={s.exclusive}>
                    <span className={s.exclusiveHead}>중복 수혜 불가 · 둘 중 하나</span>
                    {g.map((id) => cards.find((c) => c.policyId === id)).filter(Boolean).map((c) => renderCard(c!))}
                  </div>
                ))}
                {cards.filter((c) => !grouped.has(c.policyId)).map(renderCard)}
                {st.hidden > 0 && (
                  <button type="button" className={s.linkButton} onClick={onShowAll}>
                    그 외 {st.hidden}개는 기간표에서 보기
                  </button>
                )}
              </div>
            </section>
            {i < pipeline.stages.length - 1 && (
              <span className={s.stageArrow} aria-hidden="true">
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
