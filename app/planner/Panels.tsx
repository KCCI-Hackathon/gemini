"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { regionOptions } from "@/lib/data/regions";
import type { RoadmapCat, RoadmapRow } from "@/lib/route/roadmap";
import s from "./planner.module.css";
import { STATUS_NAME } from "@/lib/judge/rules";
import { CAT_ORDER, CATS, CIRCLED, STATUS_STYLE, periodLabel, type AiPick, type ChatMessage, type ChatQuestion } from "./shared";

const OUTCOME = { met: "충족", unmet: "어긋남", check: "확인 필요" } as const;

/* ---------------- 채팅: 코드가 정한 질문과 선택지 ---------------- */

export function ChatPanel(props: {
  messages: ChatMessage[];
  busy: boolean;
  chips: { key: string; label: string }[];
  stopped: boolean;
  onAnswer: (q: ChatQuestion, value: string, label: string) => void;
  onReask: (key: string) => void;
  onStop: () => void;
  onResume: () => void;
  onCollapse: () => void;
  /** 가상 인물일 때만: AI 계획 정리 */
  aiPlan?: { busy: boolean; onRun: () => void };
}) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.messages, props.busy]);
  const lastQuestionId = [...props.messages].reverse().find((m) => m.role === "ai" && m.question && !m.answered)?.id;

  return (
    <section className={s.chat} aria-label="정책 상담">
      <div className={s.chatHead}>
        <span className={s.chatIcon} aria-hidden="true">
          ✦
        </span>
        <h2>정책 상담</h2>
        {props.aiPlan ? (
          <span className={s.modeBadge} title="가상 인물 시연에서는 계획 에이전트(AI)를 쓸 수 있습니다. 판정은 코드가 합니다.">
            가상 인물 · AI 정리 가능
          </span>
        ) : (
          <span className={s.modeBadge} title="실제 사용자 정보는 외부 AI로 보내지 않습니다. 질문과 선택지는 코드가 정합니다.">
            AI 꺼짐 · 코드 질문
          </span>
        )}
        <button type="button" className={s.ghost} aria-label="상담 패널 접기" onClick={props.onCollapse}>
          ⇤
        </button>
      </div>
      {props.chips.length > 0 && (
        <div className={s.answerChips} aria-label="답한 정보 (누르면 다시 답할 수 있어요)">
          {props.chips.map((c) => (
            <button key={c.key} type="button" className={s.answerChip} onClick={() => props.onReask(c.key)} title="다시 답하기">
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div ref={logRef} className={s.chatLog} role="log" aria-live="polite">
        {props.messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className={s.userMsg}>
              <div>{m.text}</div>
            </div>
          ) : (
            <div key={m.id} className={s.aiMsg}>
              <span className={s.aiAvatar} aria-hidden="true">
                ✦
              </span>
              <div className={s.aiBody}>
                <div className={s.aiText}>{m.text}</div>
                {m.question && (
                  <div className={s.qBox}>
                    <div className={s.qText}>{m.question.text}</div>
                    {m.question.move && !m.answered && m.id === lastQuestionId && <MoveAnswer disabled={props.busy} onPick={(v, l) => props.onAnswer(m.question!, v, l)} />}
                    {m.question.date && !m.answered && m.id === lastQuestionId && <DateAnswer disabled={props.busy} onPick={(d) => props.onAnswer(m.question!, d, d)} />}
                    <div className={s.options}>
                      {m.question.options.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          className={m.answered === o.label ? s.optionOn : s.option}
                          disabled={!!m.answered || props.busy || m.id !== lastQuestionId}
                          onClick={() => props.onAnswer(m.question!, o.value, o.label)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        {props.busy && (
          <div className={s.aiMsg} aria-label="로드맵을 다시 계산하는 중">
            <span className={s.aiAvatar} aria-hidden="true">
              ✦
            </span>
            <div className={s.typing}>
              <span />
              <span />
              <span />
            </div>
          </div>
        )}
      </div>
      <div className={s.chatFoot}>
        {props.aiPlan && (
          <button type="button" className={s.primary} disabled={props.aiPlan.busy || props.busy} onClick={props.aiPlan.onRun}>
            {props.aiPlan.busy ? "AI가 계획을 정리하는 중…" : "AI로 계획 정리 (가상 인물)"}
          </button>
        )}
        <div className={s.inputRow}>
          <input disabled placeholder="자유 입력은 AI 사용이 허용된 뒤 열려요" aria-label="자유 입력 (지금은 사용할 수 없음)" />
          {props.stopped ? (
            <button type="button" className={s.outline} onClick={props.onResume}>
              다시 묻기
            </button>
          ) : (
            <button type="button" className={s.outline} onClick={props.onStop}>
              그만 물어보기
            </button>
          )}
        </div>
        <p className={s.footNote}>답은 이 브라우저에서만 쓰고 외부 AI로 보내지 않아요. 판정은 코드가 하며 신청 결과를 예측하지 않아요.</p>
      </div>
    </section>
  );
}

function MoveAnswer({ disabled, onPick }: { disabled: boolean; onPick: (value: string, label: string) => void }) {
  const regions = useMemo(() => regionOptions(), []);
  const [code, setCode] = useState("");
  const [months, setMonths] = useState("3");
  const name = regions.find((r) => r.code === code)?.label ?? "";
  return (
    <div className={s.inputRow}>
      <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="이사할 시·군·구">
        <option value="">이사할 시·군·구</option>
        {regions.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label}
          </option>
        ))}
      </select>
      <select value={months} onChange={(e) => setMonths(e.target.value)} aria-label="이사 시점">
        {["1", "3", "6", "12"].map((n) => (
          <option key={n} value={n}>
            {n}개월 뒤
          </option>
        ))}
      </select>
      <button type="button" className={s.outline} disabled={disabled || !code} onClick={() => onPick(`${code}:${months}`, `${name}로 ${months}개월 뒤 이사`)}>
        확인
      </button>
    </div>
  );
}

function DateAnswer({ disabled, onPick }: { disabled: boolean; onPick: (ymd: string) => void }) {
  const [v, setV] = useState("");
  return (
    <div className={s.inputRow}>
      <input type="date" value={v} onChange={(e) => setV(e.target.value)} aria-label="날짜" />
      <button type="button" className={s.outline} disabled={disabled || !v} onClick={() => onPick(v)}>
        확인
      </button>
    </div>
  );
}

/* ---------------- 정책 상세 ---------------- */

export function DetailPanel({ row, mine, pick, onClose, onToggleMine }: { row: RoadmapRow; mine: boolean; pick?: AiPick; onClose: () => void; onToggleMine: () => void }) {
  const c = CATS[row.cat];
  const st = STATUS_STYLE[row.status];
  return (
    <aside className={s.detail} role="dialog" aria-label="정책 상세">
      <div className={s.detailHead}>
        <div className={s.chips}>
          <span className={s.catChip} style={{ background: c.fill, color: c.text }}>
            {c.label}
          </span>
          <span className={s.statusChip} style={{ background: st.bg, color: st.fg }}>
            {row.statusLabel}
          </span>
          <span className={row.verified ? s.verifyOn : s.verifyOff}>{row.verifyLabel}</span>
          <button type="button" className={s.ghost} aria-label="상세 닫기" onClick={onClose} style={{ marginLeft: "auto" }}>
            ✕
          </button>
        </div>
        <h2>{row.name}</h2>
        {row.org && <p className={s.muted}>{row.org}</p>}
      </div>
      <div className={s.detailBody}>
        {pick && (
          <div className={s.aiReason}>
            <strong>
              AI 추천 {CIRCLED[pick.rank - 1] ?? pick.rank} · {pick.station}
            </strong>
            <p>{pick.why}</p>
            <span className={s.muted}>AI가 확인 순서를 고르고 이유를 쓴 것이에요. 자격 판정(아래)은 코드가 공고 근거로 계산한 결과 그대로예요.</span>
          </div>
        )}
        <dl className={s.dl}>
          <dt>공식 신청 기간</dt>
          <dd>{periodLabel(row.official)}</dd>
          <dt>내 조건 구간</dt>
          <dd>{row.summary}</dd>
          <dt>판정 사유</dt>
          <dd>
            {row.reasons.length ? (
              <ul className={s.reasons}>
                {row.reasons.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : (
              <span className={s.muted}>코드로 확인할 수 있는 조건은 모두 맞아요.</span>
            )}
          </dd>
          {row.fieldNotes.length > 0 && (
            <>
              <dt>공고 대조</dt>
              <dd>
                {row.fieldNotes.map((n) => (
                  <div key={n}>{n}</div>
                ))}
              </dd>
            </>
          )}
          {row.boundaries.length > 0 && (
            <>
              <dt>경계 달</dt>
              <dd>
                {row.boundaries.map((b) => (
                  <div key={b.date}>
                    {b.date.slice(0, 7)}: {b.text}
                  </div>
                ))}
              </dd>
            </>
          )}
          <dt>지원 내용</dt>
          <dd>{row.support || <span className={s.muted}>API에 적힌 내용이 없어요.</span>}</dd>
          {row.evidence.length > 0 && (
            <>
              <dt>조건별 근거</dt>
              <dd>
                <ul className={s.evidence}>
                  {row.evidence.map((e) => (
                    <li key={`${e.kind}-${e.key}`}>
                      <div className={s.evidenceHead}>
                        <strong>
                          {STATUS_NAME[e.key] ?? e.key} {e.kind === "requires" ? "필요" : "제외"}
                        </strong>
                        <span>{e.basisLabel}</span>
                        <span>{OUTCOME[e.outcome]}</span>
                      </div>
                      <blockquote>“{e.quote.text}”</blockquote>
                      <div className={s.muted}>
                        {e.round} · {e.confirmed ? "사람이 조건과 근거 연결을 확인함" : "조건별 사람 확인 대기"}
                        {e.quote.url && (
                          <>
                            {" · "}
                            <a href={e.quote.url} target="_blank" rel="noreferrer">
                              원문
                            </a>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          )}
          <dt>근거</dt>
          <dd>
            {row.verifyLabel === "근거 확인 대기" ? "회차별 규칙으로 판정했어요. 조건마다 사람이 근거를 다시 확인하는 중이에요." : row.verified ? "사람이 공식 공고와 대조해 확인한 정책이에요." : "온통청년 API 값만으로 판정했어요. 공고 본문은 아직 확인하지 않았어요."}
            {row.link && (
              <>
                {" "}
                <a href={row.link.url} target="_blank" rel="noreferrer">
                  {row.link.kind === "official" ? "공식 출처 열기" : "온통청년 등록 링크(미검증)"}
                </a>
              </>
            )}
          </dd>
        </dl>
        <p className={s.footNote}>조건 충족은 선정을 뜻하지 않아요. 신청 전에 공식 공고를 꼭 확인하세요.</p>
      </div>
      <div className={s.detailFoot}>
        <button type="button" className={mine ? s.outline : s.primary} onClick={onToggleMine}>
          {mine ? "내 계획에서 빼기" : "내 계획에 추가"}
        </button>
      </div>
    </aside>
  );
}

/* ---------------- 계획 수정 ---------------- */

export type PlanDraft = { employ: number | null; business: number | null; interests: RoadmapCat[] };

export function PlanModal({ initial, baseLabel, canEmploy, canBusiness, onClose, onSave }: { initial: PlanDraft; baseLabel: string; canEmploy: boolean; canBusiness: boolean; onClose: () => void; onSave: (d: PlanDraft) => void }) {
  const [d, setD] = useState<PlanDraft>(initial);
  const clamp = (n: number) => Math.max(0, Math.min(12, n));
  const label = (n: number | null) => (n == null ? "가정 안 함" : n === 0 ? `${baseLabel} 바로` : `${baseLabel}부터 ${n}개월 뒤`);

  const stepper = (key: "employ" | "business", title: string, enabled: boolean) => (
    <div className={s.field}>
      <div className={s.fieldHead}>
        <span>{title}</span>
        <label className={s.check}>
          <input type="checkbox" disabled={!enabled} checked={d[key] != null} onChange={(e) => setD({ ...d, [key]: e.target.checked ? 3 : null })} />
          가정하기
        </label>
      </div>
      <div className={s.stepper}>
        <button type="button" className={s.outline} aria-label={`${title} 한 달 앞당기기`} disabled={d[key] == null || d[key] === 0} onClick={() => setD({ ...d, [key]: clamp((d[key] ?? 0) - 1) })}>
          ‹
        </button>
        <div aria-live="polite" className={d[key] == null ? s.stepOff : s.stepOn}>
          {enabled ? label(d[key]) : "이미 그 상태예요"}
        </div>
        <button type="button" className={s.outline} aria-label={`${title} 한 달 미루기`} disabled={d[key] == null || d[key] === 12} onClick={() => setD({ ...d, [key]: clamp((d[key] ?? 0) + 1) })}>
          ›
        </button>
      </div>
    </div>
  );

  return (
    <div className={s.scrim} onClick={onClose}>
      <div className={s.modal} role="dialog" aria-modal="true" aria-label="계획 수정" onClick={(e) => e.stopPropagation()}>
        <div className={s.modalHead}>
          <h2>계획 수정</h2>
          <button type="button" className={s.ghost} aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className={s.modalBody}>
          {stepper("employ", "취업 시점", canEmploy)}
          {stepper("business", "창업(사업자등록) 시점", canBusiness)}
          <div className={s.field}>
            <div className={s.fieldHead}>
              <span>관심 분야 (로드맵에 보일 분류)</span>
            </div>
            <div className={s.options}>
              {CAT_ORDER.map((k) => {
                const on = d.interests.includes(k);
                return (
                  <button key={k} type="button" aria-pressed={on} className={on ? s.optionOn : s.option} onClick={() => setD({ ...d, interests: on ? d.interests.filter((x) => x !== k) : [...d.interests, k] })}>
                    <span className={s.catDot} style={{ background: CATS[k].fill, borderColor: CATS[k].stroke }} />
                    {CATS[k].label}
                  </button>
                );
              })}
            </div>
          </div>
          <p className={s.footNote}>시점을 바꾸면 그 날짜 기준으로 정책마다 신청할 수 있는 구간을 다시 계산해요. 정책의 공식 신청 기간은 바뀌지 않고, 언제가 더 낫다는 뜻도 아니에요.</p>
        </div>
        <div className={s.modalFoot}>
          <button type="button" className={s.outline} onClick={onClose}>
            취소
          </button>
          <button type="button" className={s.primary} onClick={() => onSave(d)}>
            다시 계산
          </button>
        </div>
      </div>
    </div>
  );
}
