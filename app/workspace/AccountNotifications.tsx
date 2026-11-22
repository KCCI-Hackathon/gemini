"use client";
import { useEffect, useState } from "react";
import { fetchNotifications, fetchNotificationSettings, markNotificationsRead, saveNotificationSettings, type AccountNotification, type NotificationSettings } from "@/lib/planner/server-storage";
import s from "./workspace.module.css";

const TOGGLES: { key: keyof NotificationSettings; label: string }[] = [
  { key: "deadline", label: "담은 정책 마감 7일 전" },
  { key: "noticeChange", label: "담은 정책의 공고가 바뀌었을 때" },
  { key: "newPolicy", label: "새로 신청할 수 있게 된 정책" },
];

// 계정 탭의 알림 : 서버가 저장 계획을 다시 판정해 쌓은 알림과 알림 설정
export function AccountNotifications() {
  const [items, setItems] = useState<AccountNotification[] | null>(null), [unread, setUnread] = useState(0);
  const [settings, setSettings] = useState<NotificationSettings | null>(null), [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchNotifications().then(r => { if (alive) { setItems(r.notifications); setUnread(r.unread); } }).catch(e => alive && setError(e instanceof Error ? e.message : "알림을 불러오지 못했어요."));
    fetchNotificationSettings().then(r => alive && setSettings(r)).catch(() => { /* 설정은 기본값으로 둔다 */ });
    return () => { alive = false; };
  }, []);
  async function readAll() {
    try { const r = await markNotificationsRead("all"); setUnread(r.unread); setItems(list => list?.map(n => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null); }
    catch (e) { setError(e instanceof Error ? e.message : "읽음 처리하지 못했어요."); }
  }
  async function toggle(key: keyof NotificationSettings) {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    try { setSettings(await saveNotificationSettings(next)); } catch { setSettings(settings); setError("알림 설정을 저장하지 못했어요."); }
  }
  return <>
    <section className={s.panel}>
      <h2>알림 {unread > 0 && <small>읽지 않음 {unread}</small>}</h2>
      {error && <p className={s.warningText}>{error}</p>}
      {items === null && !error && <p className={s.emptyHint}>저장한 계획을 오늘 기준으로 확인하는 중이에요…</p>}
      {items?.length === 0 && <p className={s.emptyHint}>새 알림이 없어요. 계획을 저장하면 마감이 다가오거나 공고가 바뀔 때 여기에 알려 드려요.</p>}
      {!!items?.length && <ul className={s.saveItems}>{items.map(n => <li key={n.id}><strong>{n.readAt ? "" : "● "}{n.title}</strong><small>{n.body} · {new Date(n.createdAt).toLocaleString("ko-KR")}</small></li>)}</ul>}
      {unread > 0 && <button className={s.textButton} onClick={() => void readAll()}>모두 읽음</button>}
    </section>
    <section className={s.panel}>
      <h2>알림 설정</h2>
      {settings ? <div className={s.form}>{TOGGLES.map(t => <label key={t.key} className={s.checkboxLabel}><input type="checkbox" checked={settings[t.key]} onChange={() => void toggle(t.key)} /> {t.label}</label>)}</div> : <p className={s.emptyHint}>설정을 불러오는 중이에요…</p>}
      <p className={s.emptyHint}>알림은 이 화면에서만 보여 드려요. 이메일이나 메시지로 보내지 않아요.</p>
    </section>
  </>;
}
