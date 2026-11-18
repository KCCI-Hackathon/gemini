"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./page.module.css";
import { regionOptions } from "@/lib/data/regions";
import type { JudgeBody, JudgeItem } from "@/lib/judge/handler";
import type { Profile } from "@/lib/judge/types";
import type { Route } from "@/lib/route/build";
import type { CellState, Timeline, TimelinePlan } from "@/lib/route/timeline";
import type { VerifyResult } from "@/lib/verify/run";

type Transition = "complete_training" | "get_employed" | "register_business";
type Ok = Extract<JudgeBody, { items: unknown }>;
type VerifyState = { status: "loading" | "done" | "error"; result?: VerifyResult; source?: string; error?: string };

const STORAGE_KEY = "galimgil.profile.v1";

const DEMO: Profile = {
  birthYm: "1999-03",
  sigungu: "28185",
  school: "0049007",
  currentStatus: ["in_training", "unemployed"],
  interest: "job",
  events: [{ type: "training_completion", date: "2026-12-19", status: "scheduled" }],
  participating: [],
  source: "demo_persona",
};

const EMPTY: Profile = { ...DEMO, birthYm: "", sigungu: "", events: [], source: "user" };

const PERSONAL: Record<string, { label: string; cls: string }> = {
  eligible: { label: "조건상 해당", cls: "ok" },
  code_met_unreviewed: { label: "코드 조건 충족(본문 미검토)", cls: "info" },
  needs_check: { label: "확인 필요", cls: "warn" },
  ineligible: { label: "조건상 비해당", cls: "no" },
};
const RECRUIT: Record<string, string> = { open: "모집 중", upcoming: "모집 예정", closed: "모집 종료", always: "상시", unknown: "기간 확인 필요" };
const TRANSITIONS: { key: Transition; label: string }[] = [
  { key: "complete_training", label: "수료 상태로 변경" },
  { key: "get_employed", label: "취업 상태로 변경" },
  { key: "register_business", label: "사업자등록 상태로 변경" },
];
const SCHOOLS = [
  ["0049004", "고교 졸업"],
  ["0049005", "대학 재학"],
  ["0049006", "대졸 예정"],
  ["0049007", "대학 졸업"],
  ["0049008", "석·박사"],
];
const STATUSES: [Profile["currentStatus"][number], string][] = [
  ["in_training", "국비 교육과정 수강 중"],
  ["unemployed", "미취업(구직 중)"],
  ["employed", "재직 중"],
  ["business_registered", "사업자등록 있음"],
];
const MISMATCH: Record<string, string> = {
  recruitment_status: "모집 상태가 다름",
  region_scope: "시행 지역이 다름",
  reference_date_wording: "기준 시점 문구가 다름",
  different_program: "링크가 다른 사업을 가리킴",
  notice_only_condition: "공고에만 있는 조건",
};
const VERDICT: Record<string, string> = { matching_notice: "맞는 공고", site_home: "사이트 첫 화면", different_program: "다른 사업", error: "접속 오류" };

function loadProfile(): Profile | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? (JSON.parse(s) as Profile) : null;
  } catch {
    return null;
  }
}
function saveProfile(p: Profile | null) {
  try {
    if (p) localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 저장이 막혀도 동작한다 */
  }
}

export default function Page() {
  const regions = useMemo(() => regionOptions(), []);
  const [profile, setProfile] = useState<Profile>(EMPTY);
  const [data, setData] = useState<Ok | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  // 상담 질문의 답(질문 key → 예/아니오/모름). 모름·건너뛰기도 기록해 다시 묻지 않는다
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 마지막으로 판정을 요청한 프로필. 편집 중인 값이 아니라 이 값으로 상태 변경·질문을 다시 계산한다
  const [judged, setJudged] = useState<Profile | null>(null);
  // 루트에서 누른 정책: 그 상태의 목록이 도착한 뒤 펼쳐서 보여준다
  const [pendingShow, setPendingShow] = useState<string | null>(null);
  const requestSeq = useRef(0);
  // 시뮬레이션의 가정: 기준일(수료일 또는 오늘)로부터 몇 개월 뒤 취업·사업자등록인지
  const [plan, setPlan] = useState<TimelinePlan>({});
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [verify, setVerify] = useState<Record<string, VerifyState>>({});
  const [agent, setAgent] = useState<{ loading: boolean; fallback?: boolean; summary?: string; cards?: { policyId: string; name: string; checkNextInOrder: string[]; rationale: string }[]; log?: { tool: string; summary: string }[]; error?: string } | null>(null);

  async function askAgent() {
    setAgent({ loading: true });
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personaId: "demo-1" }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setAgent({ loading: false, ...body });
    } catch (e) {
      setAgent({ loading: false, error: String(e instanceof Error ? e.message : e) });
    }
  }

  useEffect(() => {
    const p = loadProfile();
    if (p) setProfile(p);
  }, []);

  async function judge(p: Profile, ts: Transition[], ans: Record<string, string>, pl: TimelinePlan = plan) {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setJudged(p);
    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: p, transitions: ts, answers: ans, plan: pl }),
      });
      const body = (await res.json()) as JudgeBody;
      if ("error" in body) throw new Error(body.error);
      if (seq !== requestSeq.current) return; // 더 늦게 보낸 요청이 있으면 이 응답은 버린다
      setData(body);
      if (body.needsVerification.length) runVerifications(body.needsVerification);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }

  async function verifyOne(id: string) {
    setVerify((v) => ({ ...v, [id]: { status: "loading" } }));
    try {
      const res = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ policyId: id }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setVerify((v) => ({ ...v, [id]: { status: "done", result: body.result, source: body.source } }));
    } catch (e) {
      setVerify((v) => ({ ...v, [id]: { status: "error", error: String(e instanceof Error ? e.message : e) } }));
    }
  }

  function runVerifications(ids: string[]) {
    for (const id of ids) if (!verify[id] || verify[id].status === "error") void verifyOne(id);
  }

  function update(patch: Partial<Profile>) {
    const next = { ...profile, ...patch, source: "user" as const };
    setProfile(next);
  }

  function submit() {
    if (!profile.birthYm || !profile.sigungu) {
      setError("생년월과 거주 시군구를 입력해 주세요.");
      return;
    }
    if (profile.source === "user") saveProfile(profile);
    setTransitions([]);
    setAnswers({}); // 프로필을 바꿔 다시 판정하면 이전 답은 쓰지 않는다
    setPlan({});
    void judge(profile, [], {}, {});
  }

  function useDemo() {
    setProfile(DEMO);
    setTransitions([]);
    setAnswers({});
    setPlan({});
    void judge(DEMO, [], {}, {});
  }

  function clearMine() {
    saveProfile(null);
    setProfile(EMPTY);
    setData(null);
    setTransitions([]);
    setAnswers({});
    setVerify({});
  }

  function addTransition(t: Transition) {
    const next = [...transitions, t];
    setTransitions(next);
    void judge(judged ?? profile, next, answers);
  }

  function resetTransitions() {
    setTransitions([]);
    void judge(judged ?? profile, [], answers);
  }

  function changePlan(next: TimelinePlan) {
    setPlan(next);
    void judge(judged ?? profile, transitions, answers, next);
  }

  /** 루트의 마디를 눌렀을 때: 그 마디까지의 상태 변화를 한 번에 적용해 아래 목록을 그 상태로 본다 */
  function goToNode(path: Transition[]) {
    setTransitions(path);
    void judge(judged ?? profile, path, answers);
  }

  function answerQuestion(key: string, a: string) {
    const next = { ...answers, [key]: a };
    setAnswers(next);
    if (a !== "모름") void judge(judged ?? profile, transitions, next);
  }

  /** 루트에서 정책을 눌렀을 때: 그 마디의 상태로 목록을 맞춘 뒤 펼친다(루트의 판정과 목록의 판정이 같은 상태 기준이 되게) */
  function showPolicy(id: string, path: Transition[]) {
    const sameState = path.length === transitions.length && path.every((t, i) => t === transitions[i]);
    setPendingShow(id);
    if (!sameState) goToNode(path);
  }

  useEffect(() => {
    if (!pendingShow || loading || !data) return;
    const id = pendingShow;
    setPendingShow(null);
    if (!data.items.some((i) => i.id === id)) return;
    setShowAll(true);
    setOpen((o) => ({ ...o, [id]: true }));
    requestAnimationFrame(() => document.getElementById(`p-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [pendingShow, loading, data]);

  const visibleIds = new Set(data?.defaultVisible ?? []);
  const items = data ? (showAll ? data.items : data.items.filter((i) => visibleIds.has(i.id))) : [];
  const sorted = [...items].sort((a, b) => Number(!!b.change) - Number(!!a.change) || Number(b.verified) - Number(a.verified));
  const openQuestions = (data?.questions ?? []).filter((x) => !(x.key in answers));
  const q = openQuestions[0];
  const answeredCount = Object.values(answers).filter((a) => a !== "모름").length;
  const targets = data?.needsVerification ?? [];
  const checking = targets.filter((id) => verify[id]?.status === "loading").length;
  const verified = targets.filter((id) => verify[id]?.status === "done" && verify[id]?.result?.outcome === "verified_against_notice").length;
  const notFound = targets.filter((id) => verify[id]?.status === "done" && verify[id]?.result?.outcome !== "verified_against_notice").length;
  const failed = targets.filter((id) => verify[id]?.status === "error").length;
  const regionLabelOf = regions.find((r) => r.code === profile.sigungu)?.label;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>갈림길</h1>
          <p className={styles.tagline}>취업·수료·창업이라는 갈림길에서, 내 정책 자격이 실제로 어떻게 바뀌는지 공식 공고 근거로 확인합니다.</p>
        </div>
        <span className={`${styles.mode} ${profile.source === "demo_persona" ? styles.modeDemo : ""}`}>
          {profile.source === "demo_persona" ? "가상 인물 모드" : "내 정보 모드 · 외부 AI로 개인정보를 보내지 않음"}
        </span>
      </header>

      <section className={styles.panel} aria-labelledby="profile-h">
        <div className={styles.panelHead}>
          <h2 id="profile-h">나의 현재 상태</h2>
          <div className={styles.row}>
            <button className={styles.ghost} onClick={useDemo}>가상 인물로 보기</button>
            <button className={styles.ghost} onClick={clearMine}>내 정보 지우기</button>
          </div>
        </div>
        <div className={styles.form}>
          <label>
            생년월
            <input type="month" value={profile.birthYm} onChange={(e) => update({ birthYm: e.target.value })} />
          </label>
          <label>
            거주 시군구
            <select value={profile.sigungu} onChange={(e) => update({ sigungu: e.target.value })}>
              <option value="">선택</option>
              {regions.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </label>
          <label>
            학력
            <select value={profile.school} onChange={(e) => update({ school: e.target.value })}>
              {SCHOOLS.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            관심 있는 전환
            <select value={profile.interest} onChange={(e) => update({ interest: e.target.value as Profile["interest"] })}>
              <option value="job">취업</option>
              <option value="keep_searching">계속 구직</option>
              <option value="startup">창업</option>
            </select>
          </label>
          <fieldset className={styles.statuses}>
            <legend>현재 상태</legend>
            {STATUSES.map(([k, l]) => (
              <label key={k} className={styles.check}>
                <input
                  type="checkbox"
                  checked={profile.currentStatus.includes(k)}
                  onChange={(e) => update({ currentStatus: e.target.checked ? [...profile.currentStatus, k] : profile.currentStatus.filter((s) => s !== k) })}
                />
                {l}
              </label>
            ))}
          </fieldset>
          <label>
            수료(예정)일 <span className={styles.hint}>선택</span>
            <input
              type="date"
              value={profile.events.find((e) => e.type === "training_completion")?.date ?? ""}
              onChange={(e) =>
                update({
                  events: [
                    ...profile.events.filter((x) => x.type !== "training_completion"),
                    ...(e.target.value ? [{ type: "training_completion" as const, date: e.target.value, status: "scheduled" as const }] : []),
                  ],
                })
              }
            />
          </label>
        </div>
        <div className={styles.row}>
          <button className={styles.primary} onClick={submit} disabled={loading}>{loading ? "판정 중…" : "내 정책 판정하기"}</button>
          {regionLabelOf && <span className={styles.hint}>{regionLabelOf} 기준</span>}
        </div>
        {error && <p className={styles.error}>{error}</p>}
      </section>

      {data && (
        <>
          <section className={styles.panel} aria-labelledby="result-h">
            <div className={styles.panelHead}>
              <h2 id="result-h">
                {data.lastTransition ? `${TRANSITIONS.find((t) => t.key === data.lastTransition)?.label.replace(" 상태로 변경", "")} 이후의 판정` : "지금 판정"}
              </h2>
              <span className={styles.hint}>데이터 기준일 {data.asOf} · 판정 기준일 {data.today}</span>
            </div>
            <div className={styles.summary}>
              {(["eligible", "code_met_unreviewed", "needs_check", "ineligible"] as const).map((k) => (
                <div key={k} className={`${styles.stat} ${styles[PERSONAL[k].cls]}`}>
                  <strong>{data.summary[k]}</strong>
                  <span>{PERSONAL[k].label}</span>
                </div>
              ))}
            </div>

            {q && (
              <div className={styles.question}>
                <span className={styles.cardLabel}>상담 질문 {openQuestions.length > 1 ? `(남은 질문 ${openQuestions.length}개)` : ""}</span>
                <span>
                  <b>{q.question}</b> 답하시면 정책 {q.mayChangeCount}개의 판정과 아래 루트의 순서를 더 정확히 볼 수 있습니다.
                </span>
                <div className={styles.row}>
                  {q.options.filter((o) => o !== "모름").map((o) => (
                    <button key={o} className={styles.ghost} disabled={loading} onClick={() => answerQuestion(q.key, o)}>{o}</button>
                  ))}
                  <button className={styles.link} onClick={() => answerQuestion(q.key, "모름")}>잘 모르겠어요</button>
                </div>
                <span className={styles.hint}>답은 판정 계산에만 쓰이고 저장하거나 외부 AI로 보내지 않습니다.</span>
              </div>
            )}
            {!q && answeredCount > 0 && <p className={styles.hint}>상담 질문 {answeredCount}개의 답을 판정과 루트에 반영했습니다.</p>}

            <SimulationView timeline={data.timeline} route={data.route} plan={plan} status={(judged ?? profile).currentStatus} loading={loading} onPlan={changePlan} onShow={(id) => showPolicy(id, transitions)} />

            <div className={styles.transitions}>
              <span className={styles.hint}>상태가 바뀌면? (오늘 바뀐다고 가정, 저장된 정보는 바뀌지 않음)</span>
              <div className={styles.row}>
                {TRANSITIONS.map((t) => (
                  <button key={t.key} className={styles.secondary} disabled={loading || transitions.includes(t.key)} onClick={() => addTransition(t.key)}>
                    {t.label}
                  </button>
                ))}
                {transitions.length > 0 && <button className={styles.link} onClick={resetTransitions}>처음 상태로</button>}
              </div>
              {transitions.length > 0 && <p className={styles.hint}>적용한 순서: {transitions.map((t) => TRANSITIONS.find((x) => x.key === t)?.label.replace(" 상태로 변경", "")).join(" → ")}</p>}
            </div>

            {data.needsVerification.length > 0 && (
              <div className={styles.agentBanner}>
                {checking > 0
                  ? `에이전트가 ${checking}건의 공식 공고를 찾아 확인하는 중입니다…`
                  : `상태 변화로 다시 봐야 할 정책 ${targets.length}건 중 ${verified}건을 에이전트가 공식 공고와 대조했습니다.${notFound ? ` ${notFound}건은 공식 공고를 찾지 못해 확인 필요로 둡니다.` : ""}${failed ? ` ${failed}건은 확인하지 못해 확인 필요로 둡니다(${verify[targets.find((id) => verify[id]?.status === "error")!]?.error ?? ""}).` : ""}`}
              </div>
            )}

            <ul className={styles.list}>
              {sorted.map((i) => (
                <PolicyRow key={i.id} item={i} open={!!open[i.id]} onToggle={() => setOpen((o) => ({ ...o, [i.id]: !o[i.id] }))} verify={verify[i.id]} onVerify={() => verifyOne(i.id)} />
              ))}
            </ul>
            {!showAll && data.items.length > items.length && (
              <button className={styles.link} onClick={() => setShowAll(true)}>나머지 {data.items.length - items.length}건 보기</button>
            )}
            {data.historyCount > 0 && <p className={styles.hint}>이미 마감된 지난 공고 {data.historyCount}건은 현재 판정에 쓰지 않습니다.</p>}
          </section>

          {profile.source === "demo_persona" && (
            <section className={styles.panel} aria-labelledby="agent-h">
              <div className={styles.panelHead}>
                <h2 id="agent-h">상담 에이전트 <span className={styles.aiTag}>가상 인물 시연</span></h2>
                <button className={styles.secondary} onClick={askAgent} disabled={agent?.loading}>{agent?.loading ? "확인 중…" : "먼저 확인할 일 정리 받기"}</button>
              </div>
              <p className={styles.hint}>가상 인물의 판정 결과로만 동작합니다. 내 정보를 입력한 경우에는 외부 AI를 부르지 않습니다.</p>
              {agent?.error && <p className={styles.error}>{agent.error}</p>}
              {agent && !agent.loading && !agent.error && (
                <div className={styles.verify}>
                  {agent.fallback ? (
                    <p className={styles.hint}>AI 응답 대신 검증 정책의 확인 순서를 보여줍니다(AI 꺼짐 또는 응답 검사 실패).</p>
                  ) : (
                    agent.summary && <p>{agent.summary} <span className={styles.aiTag}>AI 생성</span></p>
                  )}
                  <ul>
                    {agent.cards?.map((c) => (
                      <li key={c.policyId}><b>{c.name}</b>: {c.checkNextInOrder.join(" → ")}</li>
                    ))}
                  </ul>
                  {!!agent.log?.length && (
                    <details>
                      <summary>에이전트가 한 일 ({agent.log.length}단계)</summary>
                      <ol>{agent.log.map((l, k) => <li key={k}>{l.tool} · {l.summary}</li>)}</ol>
                    </details>
                  )}
                </div>
              )}
            </section>
          )}

          <section className={styles.panel} aria-labelledby="cards-h">
            <h2 id="cards-h">검증된 정책의 행동 카드</h2>
            <p className={styles.hint}>사람이 공식 공고와 대조해 확정한 정책입니다. 다음에 확인할 일을 먼저 풀어야 할 순서대로 보여줍니다.</p>
            <div className={styles.cards}>
              {data.cards.map((c) => (
                <article key={c.policyId} className={styles.card}>
                  <h3>{c.name}</h3>
                  <ul className={styles.facts}>
                    {c.confirmed.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                  <p className={styles.cardLabel}>다음에 확인할 사항</p>
                  <ol>
                    {c.checkNextInOrder.map((t) => <li key={t}>{t}</li>)}
                  </ol>
                  {c.rationale && <p className={styles.rationale}>판단 근거: {c.rationale}</p>}
                  {c.quotes.length > 0 && (
                    <details>
                      <summary>원문 인용</summary>
                      {c.quotes.map((t) => <blockquote key={t}>{t}</blockquote>)}
                    </details>
                  )}
                  {c.link && <a href={c.link} target="_blank" rel="noreferrer">공식 공고 열기</a>}
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <footer className={styles.footer}>
        모집 상태는 오늘 날짜로 계산하지만 데이터 기준일 이후의 신규·변경 공고는 반영되지 않습니다 · &lsquo;조건상 해당&rsquo;은 선정을 보장하지 않으며 최종 자격은 담당 기관에서 확인하세요 · AI 생성 문장에는 표시가 붙습니다 · 데이터: 온통청년 청년정책 API(한국고용정보원)
      </footer>
    </main>
  );
}

const CELL: Record<CellState, { label: string; cls: string }> = {
  ok: { label: "신청 구간(조건 충족)", cls: "cellOk" },
  check: { label: "신청 구간(확인할 것 있음)", cls: "cellCheck" },
  wait: { label: "기간 조건이 남음", cls: "cellWait" },
  closed: { label: "모집 기간 아님", cls: "cellClosed" },
  no: { label: "조건상 비해당", cls: "cellNo" },
};
const MOMENT_MARK = { life: "●", open: "＋", close: "－" } as const;
const ym = (d: string) => `${d.slice(0, 4)}년 ${Number(d.slice(5, 7))}월`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function SimulationView({ timeline: t, route, plan, status, loading, onPlan, onShow }: { timeline: Timeline; route: Route; plan: TimelinePlan; status: Profile["currentStatus"]; loading: boolean; onPlan: (p: TimelinePlan) => void; onShow: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = t.months.length - 1;

  useEffect(() => {
    if (!playing) return;
    if (step >= last) {
      setPlaying(false);
      return;
    }
    const id = setTimeout(() => setStep((x) => Math.min(last, x + 1)), 1400);
    return () => clearTimeout(id);
  }, [playing, step, last]);

  const from = t.months[step];
  const until = t.months[step + 1] ?? "9999-12-31";
  const moments = t.moments.filter((m) => m.date >= from && m.date < until);
  const openNow = t.rows.filter((r) => r.cells[step] === "ok" || r.cells[step] === "check");
  const waiting = t.rows.filter((r) => r.cells[step] === "wait");
  const monthsOptions = Array.from({ length: 13 }, (_, k) => k);
  const pick = (v: string) => (v === "" ? null : Number(v));
  const optionLabel = (k: number) => (k === 0 ? `${t.baseLabel} 당일` : `${t.baseLabel}부터 ${k}개월 뒤`);
  const hasLife = (k: number) => t.moments.some((m) => m.kind === "life" && m.date >= t.months[k] && m.date < (t.months[k + 1] ?? "9999-12-31"));

  return (
    <section className={styles.sim} aria-label="시간 흐름 시뮬레이션">
      <div className={styles.panelHead}>
        <h3 className={styles.routeTitle}>시뮬레이션: 앞으로 12개월</h3>
        <span className={styles.hint}>한 달씩 넘기며 내 정책의 신청 구간이 언제 열리고 닫히는지 봅니다</span>
      </div>

      <div className={styles.simPlan}>
        <span className={styles.cardLabel}>가정 바꾸기</span>
        {!status.includes("employed") && (
          <label>
            취업
            <select value={plan.employAfterMonths ?? ""} disabled={loading} onChange={(e) => onPlan({ ...plan, employAfterMonths: pick(e.target.value) })}>
              <option value="">가정하지 않음</option>
              {monthsOptions.map((k) => <option key={k} value={k}>{optionLabel(k)}</option>)}
            </select>
          </label>
        )}
        {!status.includes("business_registered") && (
          <label>
            사업자등록
            <select value={plan.businessAfterMonths ?? ""} disabled={loading} onChange={(e) => onPlan({ ...plan, businessAfterMonths: pick(e.target.value) })}>
              <option value="">가정하지 않음</option>
              {monthsOptions.map((k) => <option key={k} value={k}>{optionLabel(k)}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className={styles.simStage} aria-live="polite">
        <div>
          <div className={styles.simMonth}>{ym(from)}</div>
          <div className={styles.simState}>상태: <b>{t.stateLabels[step]}</b>{step === 0 ? " · 오늘" : ` · 오늘부터 ${step}개월 뒤`}</div>
        </div>
        <div className={styles.row}>
          <button className={styles.ghost} disabled={step === 0} onClick={() => { setPlaying(false); setStep(step - 1); }}>◀ 이전 달</button>
          <button className={styles.primary} onClick={() => { if (step >= last) setStep(0); setPlaying(!playing); }}>{playing ? "⏸ 멈춤" : step >= last ? "↺ 처음부터" : "▶ 흘려보기"}</button>
          <button className={styles.ghost} disabled={step === last} onClick={() => { setPlaying(false); setStep(step + 1); }}>다음 달 ▶</button>
        </div>
      </div>

      <div className={styles.simStrip} role="tablist" aria-label="달 고르기">
        {t.months.map((m, k) => (
          <button key={m} role="tab" aria-selected={k === step} className={`${styles.simTick} ${k === step ? styles.simTickOn : ""} ${k < step ? styles.simTickPast : ""}`} onClick={() => { setPlaying(false); setStep(k); }}>
            {Number(m.slice(5, 7))}월
            {hasLife(k) && <span className={styles.simDot} aria-label="상태 변화가 있는 달" />}
          </button>
        ))}
      </div>

      <div className={styles.simCols}>
        <div className={styles.simBox}>
          <span className={styles.cardLabel}>이 달에 일어나는 일</span>
          {moments.length === 0 && <p className={styles.hint}>이 달에는 변화가 없습니다.</p>}
          <ul className={styles.simMoments}>
            {moments.map((m) => (
              <li key={`${m.date}-${m.kind}-${m.text}`} className={styles[`moment_${m.kind}`]}>
                <span className={styles.simMark} aria-hidden="true">{MOMENT_MARK[m.kind]}</span>
                <span><b>{md(m.date)}</b> {m.policyId ? <button className={styles.routeName} onClick={() => onShow(m.policyId!)}>{m.text}</button> : m.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.simBox}>
          <span className={styles.cardLabel}>이 달에 신청 구간이 열려 있는 정책 {openNow.length}개</span>
          {openNow.length === 0 && <p className={styles.hint}>이 달에 열려 있는 신청 구간이 없습니다.</p>}
          <ul className={styles.simOpen}>
            {openNow.map((r) => (
              <li key={r.policyId}>
                <span className={styles.routeNum}>{r.order}</span>
                <div className={styles.routeBody}>
                  <button className={styles.routeName} onClick={() => onShow(r.policyId)}>
                    {r.name}
                    {r.verified && <span className={styles.verifiedTag}>검증됨</span>}
                  </button>
                  <span className={styles.badges}>
                    <span className={`${styles.badge} ${r.cells[step] === "ok" ? (r.verified ? styles.ok : styles.info) : styles.warn}`}>{r.cells[step] === "ok" ? (r.verified ? "조건 충족" : "코드 조건 충족(본문 미검토)") : "확인할 것 있음"}</span>
                  </span>
                  <span className={styles.hint}>{r.summary}</span>
                </div>
              </li>
            ))}
          </ul>
          {waiting.length > 0 && <p className={styles.hint}>기간 조건이 남은 정책: {waiting.map((r) => r.name).join(", ")}</p>}
        </div>
      </div>

      <details className={styles.simAll}>
        <summary>전체 기간 한눈에 보기 (정책 {t.rows.length}개)</summary>
        <div className={styles.simLegend}>
          {(Object.keys(CELL) as CellState[]).map((k) => (
            <span key={k}><i className={`${styles.cell} ${styles[CELL[k].cls]}`} /> {CELL[k].label}</span>
          ))}
        </div>
        <ul className={styles.gantt}>
          {t.rows.map((r) => (
            <li key={r.policyId}>
              <div className={styles.ganttName}>
                <span className={styles.ganttOrder}>{r.order ?? "–"}</span>
                <button className={styles.routeName} onClick={() => onShow(r.policyId)}>{r.name}{r.verified && <span className={styles.verifiedTag}>검증됨</span>}</button>
              </div>
              <div className={styles.ganttCells} role="img" aria-label={r.summary}>
                {r.cells.map((c, k) => <i key={k} title={`${ym(t.months[k])}: ${CELL[c].label}`} className={`${styles.cell} ${styles[CELL[c].cls]} ${k === step ? styles.cellNow : ""}`} />)}
              </div>
              <span className={styles.hint}>{r.summary}</span>
            </li>
          ))}
        </ul>
      </details>

      {route.links.length > 0 && (
        <details className={styles.simAll}>
          <summary>원문에 적힌 정책 사이의 관계 ({route.links.length}개)</summary>
          <ul className={styles.routeLinks}>
            {route.links.map((l) => (
              <li key={`${l.kind}-${l.from}-${l.to}-${l.quote.slice(0, 12)}`}>
                {l.kind === "leads_to" ? <>{l.fromName} <b>→</b> {l.toName} <span className={styles.badge}>이어짐</span></> : <>{l.fromName} 참여 중이면 {l.toName} <span className={`${styles.badge} ${styles.no}`}>제한</span></>}
                <blockquote>
                  {l.quote}
                  <span className={styles.hint}>
                    {" "}— {l.source === "official" ? "공식 공고" : "온통청년 API의 정책 설명"}
                    {l.checkedAt ? ` (${l.checkedAt} 확인)` : ""}
                    {l.sourceUrl && <> · <a href={l.sourceUrl} target="_blank" rel="noreferrer">출처 보기</a></>}
                  </span>
                </blockquote>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className={styles.hint}>{t.notice}</p>
    </section>
  );
}

function PolicyRow({ item, open, onToggle, verify, onVerify }: { item: JudgeItem; open: boolean; onToggle: () => void; verify?: VerifyState; onVerify: () => void }) {
  const p = PERSONAL[item.personal];
  return (
    <li className={styles.item} id={`p-${item.id}`}>
      <button className={styles.itemHead} onClick={onToggle} aria-expanded={open}>
        <span className={styles.itemName}>
          {item.name}
          {item.verified && <span className={styles.verifiedTag}>검증됨</span>}
        </span>
        <span className={styles.badges}>
          <span className={`${styles.badge} ${styles[p.cls]}`}>자격: {p.label}</span>
          <span className={styles.badge}>모집: {RECRUIT[item.recruitment]}{item.deadline ? ` ~${item.deadline.slice(5)}` : ""}</span>
          {item.change && <span className={`${styles.badge} ${styles.change}`}>{item.change}</span>}
          {verify?.status === "loading" && <span className={styles.badge}>공고 확인 중…</span>}
        </span>
      </button>
      {open && (
        <div className={styles.itemBody}>
          <p className={styles.hint}>{item.org}</p>
          {item.reasons.length > 0 && <p>사유: {item.reasons.join(" · ")}</p>}
          {item.timeNote && <p>시간 조건: {item.timeNote}</p>}
          {item.restrictionQuotes.length > 0 && (
            <p>
              {item.restriction === "applies" ? "제한 적용됨: " : item.restriction === "confirmed_relation" ? "확인된 중복 제한: " : "원문 제한 문구: "}
              {item.restrictionQuotes.join(" / ")}
            </p>
          )}
          <div className={styles.row}>
            {item.link && <a href={item.link} target="_blank" rel="noreferrer">공고 링크</a>}
            {!item.verified && (!verify || verify.status === "error") && (
              <button className={styles.ghost} onClick={onVerify}>에이전트에게 공식 공고 확인 요청</button>
            )}
          </div>
          {verify?.status === "error" && <p className={styles.error}>{verify.error}</p>}
          {verify?.status === "done" && verify.result && <VerifyView r={verify.result} source={verify.source} />}
        </div>
      )}
    </li>
  );
}

function VerifyView({ r, source }: { r: VerifyResult; source?: string }) {
  return (
    <div className={styles.verify}>
      <p className={styles.cardLabel}>
        공식 공고 기준 AI 확인(사람 검토 전) <span className={styles.aiTag}>AI 생성</span>
        {source === "saved" && <span className={styles.hint}> · 저장된 실행</span>}
        {r.producedBy === "claude_code_session" && <span className={styles.hint}> · 개발 도구(Claude Code)가 같은 도구·검사 규칙으로 사전 실행</span>}
      </p>
      {r.outcome === "verified_against_notice" ? (
        <p>근거 공고: <a href={r.noticeUrl ?? "#"} target="_blank" rel="noreferrer">{r.noticeUrl}</a></p>
      ) : (
        <p>공식 공고를 확인하지 못했습니다. 이 정책은 확인 필요로 둡니다.</p>
      )}
      {r.findings.length > 0 && (
        <ul>
          {r.findings.map((f, k) => (
            <li key={k}>{f.text} <blockquote>{f.quote}</blockquote></li>
          ))}
        </ul>
      )}
      {r.mismatches.length > 0 && (
        <ul>
          {r.mismatches.map((m, k) => (
            <li key={k}><b>{MISMATCH[m.kind]}</b>: API {m.apiValue} → 공고 {m.noticeValue}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>에이전트가 한 일 ({r.trail.length}단계)</summary>
        <ol>
          {r.trail.map((s) => (
            <li key={s.step}>
              {s.action === "open" ? "페이지 열기" : s.action === "judge" ? `판단: ${VERDICT[s.judgement?.verdict ?? ""] ?? ""}` : s.action === "search" ? "검색" : s.action === "finish" ? "종료" : s.action === "reject" ? "거부됨" : "중단"}
              {" "}<span className={styles.hint}>{s.target.slice(0, 80)} {s.reason && `· ${s.reason.slice(0, 80)}`}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
