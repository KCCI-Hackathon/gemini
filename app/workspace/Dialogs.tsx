"use client";
import { useEffect, useRef, useState } from "react";
import type { Benefit, Profile } from "@/lib/judge/types";
import { BirthDateField, RegionPicker } from "./ProfileInputs";
import { birthYmForDate, isValidBirthDate } from "@/lib/judge/birth-date";
import { addMonths, toKstDate } from "@/lib/date";
import { addDays, fullDate, isDate } from "@/lib/planner/dates";
import { CATEGORIES, EVENT_NAMES, type Card, type Draft, type PlanEvent } from "@/lib/planner/types";
import { newId, recommendationDiff } from "@/lib/planner/state";
import { actionText, deadlineText } from "./PolicyCard";
import type { VerifyResult } from "@/lib/verify/run";
import { Modal } from "./Modal";
import s from "./workspace.module.css";

export function EventDialog({ event, events, today, onClose, onApply }: { event: PlanEvent | null; events: PlanEvent[]; today: string; onClose: () => void; onApply: (events: PlanEvent[]) => void }) {
  const [date, setDate] = useState(event?.date ?? today);
  const [month, setMonth] = useState(`${(event?.date ?? today).slice(0, 7)}-01`);
  const [type, setType] = useState<PlanEvent["type"]>(event?.type ?? (Object.keys(EVENT_NAMES) as PlanEvent["type"][]).find(key => key === "relocation" || !events.some(e => e.type === key))!);
  const [sigungu, setSigungu] = useState(event?.sigungu ?? "");
  const [error, setError] = useState("");
  const offset = new Date(`${month}T12:00:00Z`).getUTCDay();
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  function apply(value: string) {
    if (!isDate(value)) { setError("실제 달력 날짜를 선택해 주세요."); return; }
    if (type === "relocation" && !sigungu) { setError("이사할 시·군·구를 선택해 주세요."); return; }
    const next: PlanEvent = { id: event?.id ?? newId(), type, date: value, status: value <= today ? "completed" : "scheduled", ...(type === "relocation" ? { sigungu } : {}) };
    onApply(event ? events.map(e => e.id === event.id ? next : e) : [...events, next]); onClose();
  }
  return <Modal title={event ? `${EVENT_NAMES[event.type]} 날짜 변경` : "내 일정 추가"} onClose={onClose}><p className={s.emptyHint}>{event ? "달력에서 날짜를 한 번 누르면 바로 반영돼요." : "어떤 변화가 예정되어 있나요? 정확한 날짜를 선택해 주세요."}</p><div className={s.form}>
    {!event && <label>생활 변화<select value={type} onChange={e => setType(e.target.value as PlanEvent["type"])}>{Object.entries(EVENT_NAMES).filter(([key]) => key === "relocation" || !events.some(e => e.type === key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
    {type === "relocation" && <fieldset className={s.regionFieldset}><legend>이사할 거주지</legend><RegionPicker value={sigungu} onChange={setSigungu} idPrefix="relocation-region" /></fieldset>}
    <label>정확한 날짜<input type="date" min="1900-01-01" max="2200-12-31" value={date} onChange={e => { setDate(e.target.value); if (isDate(e.target.value)) { setMonth(`${e.target.value.slice(0, 7)}-01`); if (event && type !== "relocation") apply(e.target.value); } }} /></label></div>
    <div className={s.calendar}><div className={s.calendarHeader}><button className={s.iconButton} aria-label="이전 달" onClick={() => setMonth(addMonths(month, -1))}>‹</button><strong>{month.slice(0, 4)}년 {Number(month.slice(5, 7))}월</strong><button className={s.iconButton} aria-label="다음 달" onClick={() => setMonth(addMonths(month, 1))}>›</button></div><div className={s.calendarGrid}>{["일", "월", "화", "수", "목", "금", "토"].map(d => <span key={d}>{d}</span>)}{Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}{Array.from({ length: days }, (_, i) => { const value = addDays(month, i); return <button key={value} aria-label={`${value} 선택`} aria-pressed={date === value} className={`${s.calendarDay} ${date === value ? s.calendarSelected : ""}`} onClick={() => { setDate(value); if (event) apply(value); }}>{i + 1}</button>; })}</div></div>
    {error && <p className={s.error} role="alert">{error}</p>}<div className={s.dialogActions}>{event && <button className={s.textButton} onClick={() => { onApply(events.filter(e => e.id !== event.id)); onClose(); }}>이 일정 제거</button>}<button className={s.outlineButton} onClick={onClose}>닫기</button>{(!event || type === "relocation") && <button className={s.primaryButton} onClick={() => apply(date)}>{event ? "일정 변경" : "일정 추가"}</button>}</div>
  </Modal>;
}

/** 정책별 AI 공고 확인 상태(/api/verify 응답) */
export type VerifyState = { status: "loading" | "done" | "error"; result?: VerifyResult; source?: string; error?: string };

const MISMATCH: Record<string, string> = { recruitment_status: "모집 상태가 다름", region_scope: "시행 지역이 다름", reference_date_wording: "기준 시점 문구가 다름", different_program: "링크가 다른 사업을 가리킴", notice_only_condition: "공고에만 있는 조건" };
const VERDICT: Record<string, string> = { matching_notice: "맞는 공고", site_home: "사이트 첫 화면", different_program: "다른 사업", error: "접속 오류" };
const isHttp = (url: string | null | undefined): url is string => !!url && url.startsWith("http");

/** AI 공고 확인 결과: 판정 · 근거 인용 · 출처 · 확인한 링크 (사람 미확인) */
function VerifyView({ r, source }: { r: VerifyResult; source?: string }) {
  return <div className={s.evidence}>
    <strong>AI 대조 결과(사람 미확인)</strong>{source === "saved" && <span className={s.hint}> · 저장된 실행</span>}
    {r.outcome === "verified_against_notice" ? <p>판정: 공식 공고와 대조함{isHttp(r.noticeUrl) && <> · <a href={r.noticeUrl} target="_blank" rel="noopener noreferrer">근거 공고 열기</a></>}</p> : <p>판정: 공식 공고를 확인하지 못했어요. 이 정책은 확인 필요로 둬요.</p>}
    {r.findings.map((f, i) => <blockquote key={i}>{f.quote}</blockquote>)}
    {r.mismatches.map((m, i) => <div key={i}><b>{MISMATCH[m.kind] ?? m.kind}</b><blockquote>{m.quote}</blockquote>{m.kind === "different_program" && isHttp(m.noticeUrl) && <a href={m.noticeUrl} target="_blank" rel="noopener noreferrer">다른 사업 공고 원문</a>}</div>)}
    <details><summary>확인한 링크와 에이전트가 한 일 ({r.trail.length}단계)</summary><ol>{r.trail.map(t => <li key={t.step}>{t.action === "open" ? "페이지 열기" : t.action === "judge" ? `판단: ${VERDICT[t.judgement?.verdict ?? ""] ?? ""}` : t.action === "search" ? "검색" : t.action === "finish" ? "종료" : t.action === "reject" ? "거부됨" : "중단"} <span className={s.hint}>{t.target.slice(0, 80)}{t.reason && ` · ${t.reason.slice(0, 80)}`}</span></li>)}</ol></details>
    <p className={s.hint}>AI가 만든 결과예요. 판정(신청 가능 여부)은 바꾸지 않았어요.</p>
  </div>;
}

export function DetailDialog({ card, today, stageLabel, busy, readOnly, verify, onVerify, onClose, onChoose }: { card: Card; today: string; stageLabel: string; busy: boolean; readOnly: boolean; verify?: VerifyState; onVerify?: () => void; onClose: () => void; onChoose: (c: Card) => void }) {
  const eligibilityLabel = card.eligibility === "blocked" ? "신청 제한" : card.eligibility === "needs_check" ? "확인 필요" : "신청 가능";
  const overlapStatus = card.overlapAssessment === "no_restriction_found" ? "확인한 원문과 검토 자료에서 중복수혜 제한 정보를 찾지 못했어요." : card.overlapAssessment === "reviewed_rules" ? "구조화된 중복수혜 규칙을 입력한 수혜 사실·시점과 대조했어요." : "중복수혜 문구 또는 적용 근거가 충분히 확인되지 않았어요.";
  return <Modal title={card.title} onClose={onClose}><span className={s.demoBadge}>{CATEGORIES[card.category].label}</span><span className={s.emptyHint}>{card.roundLabel}</span><section className={s.detailSection}><h3>지원 내용</h3><p>{card.support || card.summary || "공식 공고에서 지원 내용을 확인해 주세요."}</p></section><dl className={s.facts}><dt>해당 시점</dt><dd>{stageLabel}</dd><dt>공식 접수 시작</dt><dd>{card.official.start ? fullDate(card.official.start) : "공고 확인 필요"}</dd><dt>공식 마감</dt><dd>{card.official.end ? `${fullDate(card.official.end)} ${card.official.closeAt ? `${card.official.closeAt} (한국 시간)` : "당일 포함"}` : card.official.kind === "rolling" ? "상시 모집" : card.official.kind === "budget" ? "예산 소진 시" : "공고 확인 필요"}</dd><dt>이 열의 신청 시작</dt><dd>{card.stageWindow ? fullDate(card.stageWindow.start) : "현재 일정으로 신청 불가"}</dd><dt>이어지는 내 기한</dt><dd>{deadlineText(card, today)}</dd><dt>담은 시점</dt><dd>{card.selectedStageId === card.stageId ? "이 시점에 담음" : card.selectedStageId ? "다른 시점에 담음" : "아직 담지 않음"}</dd></dl><section className={s.detailSection}><h3>수혜 분류와 판정 시점</h3><p><strong>{eligibilityLabel}</strong> · {card.eligibilityReason}</p><p>판정 기준일 {today} · {stageLabel}</p><p>{overlapStatus}</p></section><section className={s.detailSection}><h3>내 신청 가능한 구간</h3>{card.applicationWindows.length ? card.applicationWindows.map((w, i) => <p key={i}>{fullDate(w.start)} ~ {w.end ? fullDate(w.end) : "기한 미정"}</p>) : <p>현재 일정에서 확인된 신청 구간이 없어요.</p>}</section><section className={s.detailSection}><h3>판정 이유와 확인할 항목</h3>{card.reasons.length ? card.reasons.map((r, i) => <p key={`${r.code}-${i}`}>{r.message}</p>) : <p>확인된 조건과 이 계획의 예정일을 기준으로 계산했어요.</p>}</section><section className={s.detailSection}><h3>공식 근거와 검토 상태</h3>{card.verifyLabel && <span className={s.demoBadge}>{card.verifyLabel}</span>}{card.verifyLabel === "미검증(API)" && onVerify && <button className={s.outlineButton} disabled={verify?.status === "loading"} onClick={onVerify}>{verify?.status === "error" ? "AI로 공고 다시 확인" : "AI로 공고 확인"}</button>}{verify?.status === "loading" && <p className={s.emptyHint} role="status">공고를 확인하는 중이에요(최대 몇 분)</p>}{verify?.status === "error" && <p className={s.error} role="alert">{verify.error}</p>}{verify?.status === "done" && verify.result && <VerifyView r={verify.result} source={verify.source} />}{card.evidence.length ? card.evidence.map(e => <div className={s.evidence} key={e.evidenceId}><strong>{e.title}</strong><blockquote>{e.quote}</blockquote><p>{e.reviewed ? "근거 확인됨" : "공고 확인 필요"} · 확인 {e.reviewedAt}</p>{e.overlapReview && <p>{e.overlapReview.source === "agent" ? `조항 근거 검토 · ${e.overlapReview.model ?? "배치 에이전트"} · ${e.overlapReview.verdict ?? "결과 없음"}` : "조사 자료로 구조화된 규칙"} · 사용자 판정 {e.overlapReview.judgement === "blocked" ? "금지 규칙" : "추가 확인 필요"}{e.overlapReview.reason ? ` · ${e.overlapReview.reason}` : ""}</p>}{e.url && /^https?:\/\//.test(e.url) && <a href={e.url} target="_blank" rel="noopener noreferrer">공식 원문 열기</a>}</div>) : <p>검토된 근거가 아직 없어요. 신청 전 기관에 대상 조건과 기준일을 확인해 주세요.</p>}<p>{card.org} · 공고 데이터 기준 {card.dataVersion}</p></section><div className={s.dialogActions}><button className={s.outlineButton} onClick={onClose}>닫기</button>{!readOnly && <button className={s.primaryButton} disabled={busy || (card.availability === "blocked" && !card.canReplace && card.selectedStageId !== card.stageId)} onClick={() => onChoose(card)}>{actionText(card)}</button>}</div></Modal>;
}

export function SaveDialog({ target, manual, recommendation, onClose, onSave, account = false }: { target: Draft; manual: Draft; recommendation: boolean; onClose: () => void; onSave: (name: string) => void; account?: boolean }) {
  const [name, setName] = useState(recommendation ? "추천 경로" : "나의 첫 계획");
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const diff = recommendationDiff(manual.input.choices, target.input.choices);
  const title = (id: string) => target.evaluation.cards.find(c => c.offeringId === id)?.title ?? manual.evaluation.cards.find(c => c.offeringId === id)?.title ?? id;
  const warnings = target.evaluation.choiceWarnings;
  return <Modal title={recommendation ? "추천을 새 계획으로 저장" : "내 계획 저장"} onClose={onClose}><p className={s.emptyHint}>{account ? "내 계정에 저장해요. 다른 기기에서 로그인해도 열 수 있어요." : "이 브라우저에 저장해요."} 저장할 때마다 별도의 계획이 만들어져요.</p><form className={s.form} onSubmit={e => { e.preventDefault(); if (submitting.current) return; submitting.current = true; try { onSave(name); } catch (err) { setError(err instanceof Error && (err.name === "QuotaExceededError" || /quota/i.test(err.message)) ? "브라우저 저장 공간이 가득 찼어요. 저장 공간을 확보한 뒤 다시 시도해 주세요." : err instanceof Error ? err.message : "저장하지 못했어요. 다시 시도해 주세요."); submitting.current = false; } }}><label>계획 이름<input autoComplete="off" value={name} onChange={e => setName(e.target.value)} maxLength={35} required /></label><ul className={s.saveItems}>{target.input.choices.map(c => <li key={c.offeringId}>{title(c.offeringId)}<small>{target.evaluation.stages.find(st => st.stageId === c.stageId)?.label ?? "시점 다시 선택"} · {(target.evaluation.cards.find(card => card.offeringId === c.offeringId && card.stageId === c.stageId) ? deadlineText(target.evaluation.cards.find(card => card.offeringId === c.offeringId && card.stageId === c.stageId)!, target.evaluation.today) : "공고·시점 다시 확인")}</small></li>)}</ul>{recommendation && <div className={s.evidence}><strong>직접 만든 초안과 다른 점</strong><p>추가: {diff.added.map(title).join(", ") || "없음"}</p><p>빠짐: {diff.removed.map(title).join(", ") || "없음"}</p><p>시점 이동: {diff.moved.map(title).join(", ") || "없음"}</p><p>직접 만든 초안은 계속 편집할 수 있어요.</p></div>}{warnings.length > 0 && <div className={s.checkNote}><strong>확인할 정책 {warnings.length}개</strong>{warnings.map(w => <p key={w.offeringId}>{w.title}: {w.message}</p>)}<label className={s.checkboxLabel}><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />경고를 확인했고 이 상태로 보관할게요.</label></div>}{error && <p className={s.error} role="alert">{error}</p>}<div className={s.dialogActions}><button type="button" className={s.outlineButton} onClick={onClose}>취소</button><button className={s.primaryButton} disabled={!name.trim() || !target.input.choices.length || (warnings.length > 0 && !acknowledged)}>{account ? "내 계정에 저장" : "이 브라우저에 저장"}</button></div></form></Modal>;
}

const benefitStatuses = {
  receiving: "받는 중", ended: "끝남", selected: "선정됨", applied: "신청함", eligible_unpaid: "자격만 있음",
};

function BenefitFields({ benefits, onChange }: { benefits: Benefit[]; onChange: (rows: Benefit[]) => void }) {
  const [sources, setSources] = useState<{ policyId: string; name: string; asksAmount?: boolean }[]>([]);
  const month = toKstDate(new Date()).slice(0, 7);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/overlap/sources", { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json();
        if (!controller.signal.aborted) setSources(body.sources);
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  function update(index: number, row: Benefit) {
    const before = benefits[index];
    const statusChanged = before.status !== row.status;
    onChange(benefits.flatMap((current, i) => i === index ? [row]
      : statusChanged && current.policyId === row.policyId && current.monthlyPayment && current.monthlyPayment.month !== month ? [] : [current]));
  }
  // 같은 정책에 다른 달 지급 기록 줄이 따로 있으면(에이전트 질문으로 답한 달) 편집 줄이 아니라 기록으로 보여 준다.
  const isOtherMonth = (row: Benefit, i: number) => !!row.monthlyPayment && row.monthlyPayment.month !== month
    && benefits.some((other, j) => j !== i && other.policyId === row.policyId);
  const monthName = `${Number(month.slice(5))}월`;
  return <fieldset><legend>지금 받고 있거나 받았던 정책</legend>
    {benefits.map((row, i) => isOtherMonth(row, i) ? <p key={`${row.policyId}:${row.monthlyPayment!.month}`} className={s.emptyHint}>
      {sources.find(source => source.policyId === row.policyId)?.name ?? row.policyId} · {Number(row.monthlyPayment!.month.slice(5))}월 지급액 {row.monthlyPayment!.amountWon.toLocaleString()}원 (질문에 답한 값)
      <button type="button" onClick={() => onChange(benefits.filter((_, index) => index !== i))}>삭제</button></p> : <fieldset key={`${row.policyId}:${i}`}>
      <legend>{sources.find(source => source.policyId === row.policyId)?.name ?? row.policyId}</legend>
      <label>수혜 상태<select value={row.status ?? ""} onChange={e => {
        update(i, { ...row, status: e.target.value as keyof typeof benefitStatuses, lastPaymentDate: undefined, ...(e.target.value === "receiving" ? {} : { monthlyPayment: undefined }) });
      }}>
        {!(row.status && row.status in benefitStatuses) && <option value={row.status ?? ""}>기존 상태 유지</option>}
        {Object.entries(benefitStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {row.status === "receiving" && sources.find(source => source.policyId === row.policyId)?.asksAmount && <label>{monthName}에 받은 금액(원)
        <input type="number" inputMode="numeric" min={0} step={1} value={row.monthlyPayment?.month === month ? row.monthlyPayment.amountWon : ""}
          onChange={e => {
            const amountWon = Number(e.target.value);
            if (e.target.value === "") update(i, { ...row, monthlyPayment: undefined });
            else if (Number.isInteger(amountWon) && amountWon >= 0) update(i, { ...row, monthlyPayment: { month, amountWon } });
          }} /></label>}
      {row.status === "ended" && <label>마지막 지급일<input type="date" value={row.lastPaymentDate ?? ""}
        onChange={e => update(i, { ...row, lastPaymentDate: e.target.value || undefined })} /></label>}
      <button type="button" onClick={() => onChange(benefits.filter((_, index) => index !== i))}>삭제</button>
    </fieldset>)}
    <label>정책 추가<select value="" onChange={e => onChange([...benefits, { policyId: e.target.value, status: "receiving" }])}>
      <option value="" disabled>정책 선택</option>
      {sources.filter(source => !benefits.some(row => row.policyId === source.policyId))
        .map(source => <option key={source.policyId} value={source.policyId}>{source.name}</option>)}
    </select></label>
    {error && <p role="alert">정책 목록을 불러오지 못했어요.</p>}
  </fieldset>;
}

const statusOptions = [["unknown", "모름 · 나중에 확인"], ["training", "교육·훈련 수강 중"], ["unemployed", "미취업·구직 중"], ["employed", "재직 중"], ["business", "사업자등록 있음"]] as const;
// 외부 AI 사용 안내 : 시연 인물은 AI 경로 추천에 요약이 가고, 그 밖에는 AI 상담에 동의한 경우에만 간다
const privacyNotice = (demo: boolean) => demo
  ? "시연 인물로 AI 경로 추천을 쓰면 나이대·지역·학력·일정 요약과 판정 결과만 외부 AI로 가요. 수혜 입력은 판정에만 써요."
  : "판정은 이 서비스 서버에서 해요. 예시 인물이나 AI 상담에 동의한 경우에만 요약과 질문이 해외 AI 제공자(OpenAI 또는 Google)로 가요. 이름 · 상세 주소 · 연락처는 지우고 보내요.";

export function ProfileForm({ initial, onSave, onBack, submitLabel = "정책 찾아보기", policyOptions, mutedKeys = [], showStatus = true }: { initial?: Profile; onSave: (profile: Profile, mutedKeys: string[]) => void; onBack?: () => void; submitLabel?: string; policyOptions?: { policyId: string; title: string }[]; mutedKeys?: string[]; showStatus?: boolean }) {
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? "");
  const [birthError, setBirthError] = useState("");
  const [regionError, setRegionError] = useState("");
  const [schoolError, setSchoolError] = useState("");
  const [sigungu, setRegion] = useState(initial?.sigungu ?? "");
  const [school, setSchool] = useState(initial?.school ?? "");
  const [status, setStatus] = useState(initial?.currentStatus.includes("in_training") ? "training" : initial?.currentStatus.includes("employed") ? "employed" : initial?.currentStatus.includes("business_registered") ? "business" : initial?.currentStatus.includes("unemployed") ? "unemployed" : "unknown");
  const [participation, setParticipation] = useState(initial?.participating ?? []);
  const [participationKnown, setParticipationKnown] = useState(!!initial && !mutedKeys.includes("participation"));
  const [benefits, setBenefits] = useState<Benefit[]>(initial?.benefits ?? []);
  return <form className={s.form} noValidate onSubmit={e => {
    e.preventDefault();
    if (!isValidBirthDate(birthDate)) { setBirthError(!birthDate ? "생년월일을 입력해 주세요." : "실제 날짜를 YYYY-MM-DD 형식으로 입력하고, 미래 날짜는 선택하지 마세요."); return; }
    if (!sigungu) { setRegionError("시·도와 시·군·구를 모두 선택해 주세요."); return; }
    if (!school) { setSchoolError("최종 학력을 선택해 주세요."); return; }
    setBirthError(""); setRegionError(""); setSchoolError("");
    onSave({ ...(initial ?? {}), birthYm: birthYmForDate(birthDate), birthDate, sigungu, school, // 회원가입에서는 현재 상태를 묻지 않고 다음 "계획" 단계의 답으로 정한다
    currentStatus: !showStatus ? initial?.currentStatus ?? [] : status === "training" ? ["in_training", "unemployed"] : status === "employed" ? ["employed", "health_insured_employee"] : status === "business" ? ["business_registered"] : status === "unemployed" ? ["unemployed"] : [], interest: initial?.interest ?? "job", participating: policyOptions && participationKnown ? participation : [], benefits, events: initial?.events ?? [], source: initial?.source ?? "user" }, [...(status === "unknown" ? ["status"] : []), ...(policyOptions && !participationKnown ? ["participation"] : [])]);
  }}>
    <BirthDateField value={birthDate} legacyBirthYm={initial?.birthDate ? "" : initial?.birthYm ?? ""} onChange={value => { setBirthDate(value); if (birthError) setBirthError(isValidBirthDate(value) ? "" : "YYYY-MM-DD 형식의 실제 날짜를 입력해 주세요."); }} error={birthError} />
    <fieldset className={s.regionFieldset}><legend>현재 거주지</legend><RegionPicker value={sigungu} onChange={value => { setRegion(value); if (value) setRegionError(""); }} error={regionError} /></fieldset>
    <label>최종 학력<select value={school} aria-invalid={!!schoolError} aria-describedby={schoolError ? "profile-school-error" : undefined} onChange={e => { setSchool(e.target.value); if (e.target.value) setSchoolError(""); }} required><option value="">학력 선택</option><option value="0049003">고등학교 졸업</option><option value="0049005">대학 재학</option><option value="0049007">대학교 졸업</option><option value="0049008">대학원 재학·졸업</option><option value="0049010">기타</option></select>{schoolError && <span id="profile-school-error" className={s.error} role="alert">{schoolError}</span>}</label>
    {showStatus && <div className={s.fieldGroup}><span id="profile-status">현재 상태 <span className={s.hint}>하나를 골라요</span></span><div className={s.choiceRow} role="group" aria-labelledby="profile-status">{statusOptions.map(([value, label]) => <button key={value} type="button" className={status === value ? s.on : ""} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</button>)}</div></div>}
    {policyOptions && <><label>현재 수혜 중인 정책 (여러 개 선택 가능)<select multiple value={participation} onChange={e => { setParticipation(Array.from(e.target.selectedOptions, option => option.value)); setParticipationKnown(true); }}>{policyOptions.map(p => <option key={p.policyId} value={p.policyId}>{p.title}</option>)}</select></label><label className={s.checkboxLabel}><input type="checkbox" checked={participationKnown} onChange={e => setParticipationKnown(e.target.checked)} />현재 수혜 내역을 확인했어요 (없음 포함)</label></>}
    <BenefitFields benefits={benefits} onChange={setBenefits} />
    <p className={s.emptyHint}>모르는 조건은 확인 필요로 남겨요. {privacyNotice(initial?.source === "demo_persona")}</p>
    <div className={`${s.inlineActions} ${s.spread}`}>{onBack ? <button type="button" className={s.textButton} onClick={onBack}>이전</button> : <span />}<button className={s.primaryButton}>{submitLabel}</button></div>
  </form>;
}
