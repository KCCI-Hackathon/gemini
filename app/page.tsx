"use client";

import { useMemo, useRef, useState } from "react";
import { regionLabel, regionOptions } from "@/lib/data/regions";
import type { Roadmap, RoadmapCat } from "@/lib/route/roadmap";
import { ChatPanel, DetailPanel, PlanModal, type PlanDraft } from "./planner/Panels";
import { isChanging, RoadmapGrid } from "./planner/Roadmap";
import s from "./planner/planner.module.css";
import { CAT_ORDER, CATS, DEMO, SCHOOLS, addMonthsYmd, type ChatMessage, type ChatQuestion, type Ok, type Profile, type TimelinePlan } from "./planner/shared";

type Answers = Record<string, string>;
type Session = { profile: Profile; plan: TimelinePlan; answers: Answers };

const ALL_CATS: Record<RoadmapCat, boolean> = { job: true, startup: true, housing: true, edu: true, life: true };
const MINE_KEY = "galimgil.mine.v1";

function loadMine(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MINE_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveMine(ids: Set<string>) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify([...ids]));
  } catch {
    /* 저장이 막혀도 화면은 동작한다 */
  }
}

/** 판정이 바뀌는 정보만, 정해 둔 순서로 묻는다. 서버가 고른 질문(영향 큰 순)은 맨 뒤 */
function nextQuestion(sess: Session, asked: Record<string, string>, data: Ok | null): ChatQuestion | null {
  const st = new Set(sess.profile.currentStatus);
  const base = st.has("in_training") && sess.profile.events.some((e) => e.type === "training_completion") ? "수료일" : "오늘";
  if (!asked.status)
    return {
      key: "status",
      text: "지금 어떤 상태인가요? 취업 조건이 있는 정책을 확정하는 데 써요.",
      options: [
        { label: "교육·훈련 수강 중", value: "training" },
        { label: "구직 중", value: "seeking" },
        { label: "재직 중", value: "employed" },
        { label: "사업자등록 있음", value: "business" },
        { label: "모름", value: "unknown" },
      ],
    };
  if (st.has("in_training") && !asked.completion)
    return {
      key: "completion",
      text: "수강 중인 교육은 언제 수료할 예정인가요?",
      options: [
        { label: "1개월 안", value: "1" },
        { label: "3개월 안", value: "3" },
        { label: "6개월 안", value: "6" },
        { label: "모름", value: "unknown" },
      ],
    };
  if (!st.has("employed") && !asked.employ)
    return {
      key: "employ",
      text: `취업은 언제쯤으로 가정해 볼까요? (${base} 기준) 그 시점 앞뒤로 신청 구간이 어떻게 바뀌는지 보여 드려요.`,
      options: [
        { label: `${base} 바로`, value: "0" },
        { label: "3개월 뒤", value: "3" },
        { label: "6개월 뒤", value: "6" },
        { label: "1년 뒤", value: "12" },
        { label: "계획 없음", value: "none" },
      ],
    };
  if (!st.has("business_registered") && !asked.business)
    return {
      key: "business",
      text: "창업(사업자등록)도 계획에 넣어 볼까요?",
      options: [
        { label: "6개월 뒤", value: "6" },
        { label: "1년 뒤", value: "12" },
        { label: "계획 없음", value: "none" },
      ],
    };
  const examPending = data?.roadmap.rows.some((r) => r.reasons.includes("응시일 확인 필요")) || data?.items.some((i) => i.reasons.includes("응시일 확인 필요"));
  if (examPending && !asked.exam)
    return {
      key: "exam",
      text: "응시일을 기준으로 보는 정책이 있어요. 시험을 본(또는 볼) 날짜를 알려 주시면 그날의 상태로 판정해요.",
      options: [{ label: "모름", value: "unknown" }],
      date: true,
    };
  if (!asked.move)
    return {
      key: "move",
      text: "이사할 계획이 있나요? 이사하면 그 달부터 새 지역의 정책으로 다시 계산해요.",
      options: [{ label: "이사 계획 없음", value: "none" }],
      move: true,
    };
  const q = data?.questions.find((x) => !asked[x.key]);
  if (q) return { key: q.key, text: `${q.question} (답하면 정책 ${q.mayChangeCount}개의 판정이 바뀔 수 있어요)`, options: q.options.map((o) => ({ label: o, value: o })) };
  return null;
}

function applyAnswer(sess: Session, key: string, value: string, today: string): Session {
  const profile: Profile = structuredClone(sess.profile);
  const plan = { ...sess.plan };
  const answers = { ...sess.answers };
  const months = (v: string) => (v === "none" || v === "unknown" ? null : Number(v));
  switch (key) {
    case "status": {
      const map: Record<string, Profile["currentStatus"]> = { training: ["in_training", "unemployed"], seeking: ["unemployed"], employed: ["employed"], business: ["business_registered"], unknown: [] };
      profile.currentStatus = map[value];
      if (value !== "training") profile.events = profile.events.filter((e) => e.type !== "training_completion");
      break;
    }
    case "completion": {
      profile.events = profile.events.filter((e) => e.type !== "training_completion");
      const n = months(value);
      if (n != null) profile.events.push({ type: "training_completion", date: addMonthsYmd(today, n), status: "scheduled" });
      break;
    }
    case "exam":
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) profile.examDate = value;
      else delete profile.examDate;
      break;
    case "move": {
      const m = /^(\d{5}):(\d{1,2})$/.exec(value);
      plan.move = m ? { sigungu: m[1], afterMonths: Number(m[2]) } : null;
      break;
    }
    case "employ":
      plan.employAfterMonths = months(value);
      break;
    case "business":
      plan.businessAfterMonths = months(value);
      break;
    default:
      answers[key] = value;
  }
  profile.interest = plan.businessAfterMonths != null && plan.employAfterMonths == null ? "startup" : "job";
  return { profile, plan, answers };
}

function countLine(r: Roadmap): string {
  const n = (st: string) => r.rows.filter((x) => x.status === st).length;
  return `조건 충족 ${n("ok")} · 확인 필요 ${n("check")} · 기간 조건 남음 ${n("wait")}`;
}

export default function Page() {
  const regions = useMemo(() => regionOptions(), []);
  const [form, setForm] = useState({ birth: "", sigungu: "", school: "" });
  const [formError, setFormError] = useState<string | null>(null);

  const [sess, setSess] = useState<Session | null>(null);
  const [data, setData] = useState<Ok | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const nextId = useRef(1);
  const [asked, setAsked] = useState<Record<string, string>>({});
  const [stopped, setStopped] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const [filterCats, setFilterCats] = useState<Record<RoadmapCat, boolean>>(ALL_CATS);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyChanging, setOnlyChanging] = useState(false);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function showToast(t: string) {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  }
  const push = (m: { role: "ai"; text: string; question?: ChatQuestion } | { role: "user"; text: string }) => {
    const msg = { ...m, id: nextId.current++ } as ChatMessage;
    setMessages((ms) => [...ms, msg]);
  };

  async function judge(next: Session): Promise<Ok | null> {
    const id = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      const body = await res.json();
      if (!res.ok || "error" in body) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (id !== seq.current) return null; // 더 늦게 보낸 요청이 있으면 버린다
      setData(body as Ok);
      setSess(next);
      return body as Ok;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      return null;
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }

  function askNext(nextSess: Session, nextAsked: Record<string, string>, body: Ok | null, lead: string) {
    const q = stopped ? null : nextQuestion(nextSess, nextAsked, body);
    push({ role: "ai", text: q ? lead : `${lead}\n더 여쭤볼 것이 없어요. 로드맵에서 정책을 눌러 근거를 확인해 보세요.`, question: q ?? undefined });
  }

  async function start(profile: Profile) {
    setMine(loadMine());
    const first: Session = { profile, plan: {}, answers: {} };
    setMessages([]);
    const preAsked: Record<string, string> = profile.source === "demo_persona" ? { status: "교육·훈련 수강 중", completion: "2026-12-19 수료 예정" } : {};
    setAsked(preAsked);
    setStopped(false);
    const body = await judge(first);
    if (!body) return;
    const who = profile.source === "demo_persona" ? "가상 인물(인천 연수구, 대학 졸업, 국비 교육 수강 중)" : `${regionLabel(profile.sigungu)} · ${SCHOOLS.find((x) => x[0] === profile.school)?.[1] ?? ""}`;
    askNext(first, preAsked, body, `${who} 기준으로 앞으로 12개월 동안 확인할 정책 ${body.roadmap.rows.length}개를 로드맵에 올렸어요.\n${countLine(body.roadmap)}`);
  }

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!form.birth || !form.sigungu || !form.school) {
      setFormError("세 가지를 모두 입력해 주세요.");
      return;
    }
    setFormError(null);
    void start({ birthYm: form.birth.slice(0, 7), sigungu: form.sigungu, school: form.school, currentStatus: [], interest: "job", events: [], participating: [], source: "user" });
  }

  async function answer(q: ChatQuestion, value: string, label: string) {
    if (!sess || !data) return;
    setMessages((ms) => ms.map((m) => (m.role === "ai" && m.question?.key === q.key && !m.answered ? { ...m, answered: label } : m)));
    push({ role: "user", text: label });
    const nextSess = applyAnswer(sess, q.key, value, data.today);
    const nextAsked = { ...asked, [q.key]: label };
    setAsked(nextAsked);
    const body = await judge(nextSess);
    if (!body) return;
    askNext(nextSess, nextAsked, body, `로드맵을 다시 계산했어요. ${countLine(body.roadmap)}`);
  }

  function reask(key: string) {
    if (!sess) return;
    const rest = { ...asked };
    delete rest[key];
    setAsked(rest);
    setStopped(false);
    setMessages((ms) => ms.map((m) => (m.role === "ai" && m.question && !m.answered ? { ...m, answered: "건너뜀" } : m)));
    const q = nextQuestion(sess, rest, data);
    push({ role: "ai", text: "다시 답해 주세요.", question: q ?? undefined });
  }

  const [planBusy, setPlanBusy] = useState(false);
  async function runPlanAgent() {
    if (!sess) return;
    setPlanBusy(true);
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "replan", persona: true, session: sess }) });
      const body = await res.json();
      if (res.status === 503) push({ role: "ai", text: "AI가 꺼져 있어 계획 정리를 할 수 없어요(서버에 API 키가 필요해요). 로드맵과 코드 질문은 그대로 쓸 수 있어요." });
      else if (!res.ok) push({ role: "ai", text: body.error ?? "AI 계획 정리에 실패했어요." });
      else if (body.fallback || !body.plan) push({ role: "ai", text: "AI가 만든 계획에 확인할 수 없는 내용이 있어 쓰지 않았어요. 로드맵을 그대로 봐 주세요." });
      else {
        const lines = (body.plan.stations as { label: string; items: { name: string; why: string }[] }[]).flatMap((st) => [`■ ${st.label}`, ...st.items.map((i) => `· ${i.name} — ${i.why}`)]);
        push({ role: "ai", text: ["[AI 계획 정리 · 판정은 코드 결과 그대로]", body.plan.summary, ...lines].join("\n") });
      }
    } catch {
      push({ role: "ai", text: "AI 계획 정리에 실패했어요." });
    } finally {
      setPlanBusy(false);
    }
  }

  function toggleMine(id: string) {
    const next = new Set(mine);
    const name = data?.roadmap.rows.find((r) => r.policyId === id)?.name ?? "정책";
    if (next.has(id)) {
      next.delete(id);
      showToast(`${name}을(를) 내 계획에서 뺐어요`);
    } else {
      next.add(id);
      showToast(`${name}을(를) 내 계획에 추가했어요`);
    }
    setMine(next);
    saveMine(next);
  }

  async function savePlan(d: PlanDraft) {
    if (!sess) return;
    setModal(false);
    const nextSess: Session = { ...sess, plan: { ...sess.plan, employAfterMonths: d.employ, businessAfterMonths: d.business } };
    nextSess.profile = { ...sess.profile, interest: d.business != null && d.employ == null ? "startup" : "job" };
    setFilterCats(Object.fromEntries(CAT_ORDER.map((k) => [k, d.interests.includes(k)])) as Record<RoadmapCat, boolean>);
    const nextAsked = { ...asked, employ: d.employ == null ? "취업 가정 안 함" : `취업 ${d.employ}개월 뒤`, business: d.business == null ? "창업 가정 안 함" : `창업 ${d.business}개월 뒤` };
    setAsked(nextAsked);
    const body = await judge(nextSess);
    if (body) {
      showToast("계획을 반영해 로드맵을 다시 계산했어요");
      push({ role: "ai", text: `계획 수정을 반영했어요. ${countLine(body.roadmap)}` });
    }
  }

  function reset() {
    setSess(null);
    setData(null);
    setMessages([]);
    setSelectedId(null);
  }

  /* ---------------- 첫 화면: 폼 3개 ---------------- */
  if (!sess || !data) {
    return (
      <div className={s.page}>
        <Header />
        <main className={s.intakeWrap}>
          <section className={s.intake} aria-labelledby="intake-title">
            <h1 id="intake-title">기본 정보 입력</h1>
            <p className={s.muted}>세 가지만 입력하면 앞으로 12개월의 정책 로드맵을 먼저 보여 드려요. 나머지는 상담에서 선택지로 여쭤볼게요.</p>
            <form className={s.form} onSubmit={submitForm}>
              <label>
                생년월일
                <input type="date" value={form.birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setForm({ ...form, birth: e.target.value })} required />
              </label>
              <label>
                현재 시·군·구
                <select value={form.sigungu} onChange={(e) => setForm({ ...form, sigungu: e.target.value })} required>
                  <option value="">시·군·구 선택</option>
                  {regions.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                최종 학력
                <select value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} required>
                  <option value="">학력 선택</option>
                  {SCHOOLS.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {(formError || error) && <p className={s.error}>{formError ?? error}</p>}
              <button className={s.primary} type="submit" disabled={busy}>
                {busy ? "계산 중…" : "기본 계획 보기"}
              </button>
              <button className={s.outline} type="button" disabled={busy} onClick={() => void start(DEMO)}>
                가상 인물로 둘러보기
              </button>
            </form>
            <p className={s.footNote}>입력한 정보는 판정에만 쓰고 저장하거나 외부 AI로 보내지 않아요. 판정은 온통청년 데이터와 사람이 확인한 공고로 계산해요.</p>
          </section>
        </main>
      </div>
    );
  }

  /* ---------------- 대시보드 ---------------- */
  const roadmap = data.roadmap;
  const selected = roadmap.rows.find((r) => r.policyId === selectedId) ?? null;
  const st = new Set(sess.profile.currentStatus);
  const chips = Object.entries(asked).map(([key, label]) => ({ key, label }));
  const offCount = CAT_ORDER.filter((k) => !filterCats[k]).length + (onlyMine ? 1 : 0) + (onlyChanging ? 1 : 0);

  return (
    <div className={s.page}>
      <Header onReset={reset} />
      <div className={s.shell}>
        {chatOpen ? (
          <ChatPanel
            messages={messages}
            busy={busy}
            chips={chips}
            stopped={stopped}
            onAnswer={(q, v, l) => void answer(q, v, l)}
            onReask={reask}
            onStop={() => {
              setStopped(true);
              setMessages((ms) => ms.map((m) => (m.role === "ai" && m.question && !m.answered ? { ...m, answered: "건너뜀" } : m)));
              push({ role: "ai", text: "질문을 멈췄어요. 모르는 정보는 '확인 필요'로 남겨 둘게요." });
            }}
            onResume={() => {
              setStopped(false);
              const q = nextQuestion(sess, asked, data);
              push({ role: "ai", text: q ? "이어서 여쭤볼게요." : "더 여쭤볼 것이 없어요.", question: q ?? undefined });
            }}
            onCollapse={() => setChatOpen(false)}
            aiPlan={sess.profile.source === "demo_persona" ? { busy: planBusy, onRun: () => void runPlanAgent() } : undefined}
          />
        ) : (
          <div className={s.rail}>
            <button type="button" className={s.ghost} aria-label="상담 패널 펼치기" onClick={() => setChatOpen(true)}>
              ⇥
            </button>
            <span className={s.railLabel}>정책 상담</span>
          </div>
        )}

        <main className={s.main}>
          <div className={s.mainHead}>
            <div>
              <h1>내 정책 로드맵</h1>
              <p className={s.muted}>
                기준 {roadmap.months[0]} · 데이터 {data.asOf} · 내 상태 {roadmap.stateLabels[0]}
              </p>
            </div>
            <div className={s.toolbar}>
              <button type="button" className={s.outline} onClick={() => setModal(true)}>
                계획 수정
              </button>
            </div>
          </div>
          <div className={s.filters} aria-label="분류 필터">
            {CAT_ORDER.map((k) => (
              <button key={k} type="button" aria-pressed={filterCats[k]} className={filterCats[k] ? s.optionOn : s.option} onClick={() => setFilterCats({ ...filterCats, [k]: !filterCats[k] })}>
                <span className={s.catDot} style={{ background: CATS[k].fill, borderColor: CATS[k].stroke }} />
                {CATS[k].label}
              </button>
            ))}
            <button type="button" aria-pressed={onlyChanging} className={onlyChanging ? s.optionOn : s.option} onClick={() => setOnlyChanging(!onlyChanging)} title="가정한 수료·취업·창업·이사로 신청 구간이 열리거나 닫히거나 판정이 바뀌는 정책">
              가정으로 바뀌는 정책만 ({roadmap.rows.filter((r) => isChanging(r, roadmap.months)).length})
            </button>
            <button type="button" aria-pressed={onlyMine} className={onlyMine ? s.optionOn : s.option} onClick={() => setOnlyMine(!onlyMine)}>
              내 계획만 ({mine.size})
            </button>
            {offCount > 0 && (
              <button
                type="button"
                className={s.linkButton}
                onClick={() => {
                  setFilterCats(ALL_CATS);
                  setOnlyMine(false);
                  setOnlyChanging(false);
                }}
              >
                필터 초기화
              </button>
            )}
            <span className={s.legend}>
              <span className={s.legendOff} /> 공식 신청 기간 <span className={s.legendOk} /> 내 조건 구간 <span className={s.legendCheck} /> 확인 필요
            </span>
          </div>
          {error && <p className={s.error}>{error}</p>}
          <div className={s.mainBody}>
            <RoadmapGrid
              roadmap={roadmap}
              filterCats={filterCats}
              onlyMine={onlyMine}
              onlyChanging={onlyChanging}
              mine={mine}
              collapsed={collapsed}
              selectedId={selectedId}
              onToggleCat={(c) => setCollapsed({ ...collapsed, [c]: !collapsed[c] })}
              onSelect={setSelectedId}
              onGoalClick={() => setModal(true)}
            />
            {selected && <DetailPanel row={selected} mine={mine.has(selected.policyId)} onClose={() => setSelectedId(null)} onToggleMine={() => toggleMine(selected.policyId)} />}
          </div>
          <p className={s.notice}>{roadmap.notice}</p>
          {toast && (
            <div className={s.toast} role="status">
              {toast}
            </div>
          )}
        </main>
      </div>
      {modal && (
        <PlanModal
          initial={{ employ: sess.plan.employAfterMonths ?? null, business: sess.plan.businessAfterMonths ?? null, interests: CAT_ORDER.filter((k) => filterCats[k]) }}
          baseLabel={roadmap.baseLabel}
          canEmploy={!st.has("employed")}
          canBusiness={!st.has("business_registered")}
          onClose={() => setModal(false)}
          onSave={(d) => void savePlan(d)}
        />
      )}
    </div>
  );
}

function Header({ onReset }: { onReset?: () => void }) {
  return (
    <header className={s.header}>
      <div className={s.brand}>
        <span className={s.logo} aria-hidden="true">
          ⑂
        </span>
        <span>
          <strong>PathFinder</strong>
          <small>청년 정책 플래너</small>
        </span>
      </div>
      {onReset && (
        <button type="button" className={s.ghostText} onClick={onReset}>
          기본 정보 다시 입력
        </button>
      )}
    </header>
  );
}
