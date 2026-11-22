"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { regionHierarchy, regionSelectionForCode } from "@/lib/data/regions";
import { toKstDate } from "@/lib/date";
import { addDays } from "@/lib/planner/dates";
import s from "./workspace.module.css";

const pad = (value: number) => String(value).padStart(2, "0");
function monthOf(value: string, fallback: string) { return /^\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?$/.test(value) ? `${value.slice(0, 7)}-01` : fallback; }

export function BirthDateField({ value, legacyBirthYm = "", onChange, error }: { value: string; legacyBirthYm?: string; onChange: (date: string) => void; error?: string }) {
  const today = toKstDate(new Date());
  const todayYear = Number(today.slice(0, 4));
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(value || legacyBirthYm, `${Math.max(1900, todayYear - 25)}-01-01`));
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const yearRef = useRef<HTMLSelectElement>(null);
  const openerRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null);
  const suppressFocusOpen = useRef(false);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dayCells = [
    ...Array.from({ length: firstDay }, (_, index) => `empty-${index}`),
    ...Array.from({ length: dayCount }, (_, index) => addDays(month, index)),
  ];
  useEffect(() => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setMonth(`${value.slice(0, 7)}-01`); }, [value]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); setOpen(false);
      requestAnimationFrame(() => { suppressFocusOpen.current = true; openerRef.current?.focus(); suppressFocusOpen.current = false; });
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  function openPicker(opener: HTMLInputElement | HTMLButtonElement, focusYear: boolean) {
    openerRef.current = opener;
    setOpen(true);
    if (focusYear) requestAnimationFrame(() => yearRef.current?.focus());
  }
  function selectYear(nextYear: number) { setMonth(`${nextYear}-${pad(monthNumber)}-01`); }
  function selectMonth(nextMonth: number) { setMonth(`${year}-${pad(nextMonth)}-01`); }
  return <div className={s.profileInputGroup}>
    <label htmlFor="profile-birth-date">생년월일<input ref={inputRef} id="profile-birth-date" type="text" inputMode="numeric" autoComplete="bday" placeholder="YYYY-MM-DD" value={value} aria-invalid={!!error} aria-describedby={error ? "profile-birth-date-error" : "profile-birth-date-help"}
      onFocus={event => { if (!suppressFocusOpen.current) openPicker(event.currentTarget, false); }} onClick={event => openPicker(event.currentTarget, false)} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.altKey && event.key === "ArrowDown") { event.preventDefault(); openPicker(event.currentTarget, true); } }} /></label>
    <button ref={triggerRef} type="button" className={s.calendarTrigger} aria-label="달력 열기" aria-expanded={open} aria-controls="birth-date-calendar" onClick={event => openPicker(event.currentTarget, true)}>▦</button>
    {!error && <p id="profile-birth-date-help" className={s.hint}>{legacyBirthYm && !value ? "기존 정보에는 생일의 날짜가 없어요. 정확한 생년월일을 입력해 주세요." : "YYYY-MM-DD 형식으로 입력하거나 달력에서 선택해 주세요."}</p>}
    {error && <p id="profile-birth-date-error" className={s.error} role="alert">{error}</p>}
    {open && <div id="birth-date-calendar" className={s.dateCalendar} role="dialog" aria-label="생년월일 선택">
      <div className={s.dateSelectors}><label>연도<select ref={yearRef} aria-label="연도 선택" value={year} onChange={event => selectYear(Number(event.target.value))}>{Array.from({ length: todayYear - 1899 }, (_, index) => todayYear - index).map(item => <option key={item} value={item}>{item}년</option>)}</select></label>
        <label>월<select aria-label="월 선택" value={monthNumber} onChange={event => selectMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map(item => <option key={item} value={item}>{item}월</option>)}</select></label></div>
      <div className={s.dateWeekdays} aria-hidden="true">{["일", "월", "화", "수", "목", "금", "토"].map(day => <span key={day}>{day}</span>)}</div>
      <div className={s.dateGrid}>{dayCells.map(cell => cell.startsWith("empty-") ? <span key={cell} /> : <button key={cell} type="button" className={`${s.dateDay} ${cell === value ? s.dateDaySelected : ""}`} aria-label={`${cell} 선택`} aria-pressed={cell === value} disabled={cell > today} onClick={() => { onChange(cell); setOpen(false); requestAnimationFrame(() => { suppressFocusOpen.current = true; inputRef.current?.focus(); suppressFocusOpen.current = false; }); }}>{Number(cell.slice(-2))}</button>)}</div>
      <div className={s.dateActions}><button type="button" className={s.textButton} onClick={() => setMonth(`${today.slice(0, 7)}-01`)}>이번 달로</button><button type="button" className={s.outlineButton} onClick={() => { setOpen(false); requestAnimationFrame(() => { suppressFocusOpen.current = true; openerRef.current?.focus(); suppressFocusOpen.current = false; }); }}>닫기</button></div>
    </div>}
  </div>;
}

export function RegionPicker({ value, onChange, error, idPrefix = "profile-region" }: { value: string; onChange: (code: string) => void; error?: string; idPrefix?: string }) {
  const regions = useMemo(() => regionHierarchy(), []);
  const initial = regionSelectionForCode(value);
  const [sidoCode, setSido] = useState(initial?.sidoCode ?? "");
  const [areaKey, setArea] = useState(initial?.areaKey ?? "");
  const [districtCode, setDistrict] = useState(initial?.districtCode ?? "");
  const previousValue = useRef(value);
  const localValue = useRef<string | null>(null);
  const sido = regions.find(item => item.code === sidoCode);
  const area = sido?.areas.find(item => item.key === areaKey);
  const needsDistrict = !!area?.districts.length;
  const districtOptions = area ? [...(area.wholeCode ? [{ code: area.wholeCode, label: `${area.label} 전체` }] : []), ...area.districts] : [];
  useEffect(() => {
    if (value === previousValue.current) return;
    previousValue.current = value;
    if (localValue.current === value) { localValue.current = null; return; }
    const restored = regionSelectionForCode(value);
    setSido(restored?.sidoCode ?? ""); setArea(restored?.areaKey ?? ""); setDistrict(restored?.districtCode ?? "");
  }, [value]);
  function emit(code: string) { localValue.current = code; onChange(code); }
  return <div className={s.regionPicker}>
    <label htmlFor={`${idPrefix}-sido`}>시·도<select id={`${idPrefix}-sido`} aria-label="시·도" required value={sidoCode} aria-invalid={!!error} onChange={event => { setSido(event.target.value); setArea(""); setDistrict(""); emit(""); }}><option value="">시·도 선택</option>{regions.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
    <label htmlFor={`${idPrefix}-area`}>시·군·구<select id={`${idPrefix}-area`} aria-label="시·군·구" required disabled={!sido} value={areaKey} aria-invalid={!!error} onChange={event => { const next = sido?.areas.find(item => item.key === event.target.value); setArea(event.target.value); setDistrict(""); emit(next && !next.districts.length ? next.code ?? "" : ""); }}><option value="">{sido ? "시·군·구 선택" : "시·도를 먼저 선택해 주세요"}</option>{sido?.areas.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    {needsDistrict && <label htmlFor={`${idPrefix}-district`}>구·세부 지역<select id={`${idPrefix}-district`} aria-label="구·세부 지역" required value={districtCode} aria-invalid={!!error} onChange={event => { setDistrict(event.target.value); emit(event.target.value); }}><option value="">구·세부 지역 선택</option>{districtOptions.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>}
    {error && <p className={s.error} role="alert">{error}</p>}
  </div>;
}
