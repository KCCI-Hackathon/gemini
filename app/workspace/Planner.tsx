"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { regionLabel } from "@/lib/data/regions";
import { toKstDate } from "@/lib/date";
import type { Profile } from "@/lib/judge/types";
import { addDays, dateLabel, fullDate } from "@/lib/planner/dates";
import { PERSONA_A } from "@/lib/judge/personas";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import { findNamedCards, parseScheduleTurn, pickExplainTarget } from "@/lib/planner/commands";
import { acceptRevision, applySavedRecheck, changeEvents, createDraft, newId, preserveMissingChoices, savedSnapshot, undoEvents, withChoices } from "@/lib/planner/state";
import { createPlanRepository, DRAFT_KEY, parseDraft, readLegacyPolicies, readLegacySitePlans } from "@/lib/planner/storage";
import { CATEGORIES, EVENT_NAMES, type Card, type Category, type Choice, type Draft, type Evaluation, type PlanEvent, type PlannerInput, type SavedPlan } from "@/lib/planner/types";
import { requestAiRecommendation } from "@/lib/planner/plan-request";
import { requestCounsel, type CounselTurn } from "@/lib/planner/counsel-client";
import { applyTarget, scheduleNeedsConfirm, validateAnswer, type CounselTarget } from "@/lib/planner/counsel-target";
import type { CounselBody } from "@/lib/plan/counsel";
import type { AiRecommendation } from "@/lib/planner/types";
import { applyAnswer } from "@/lib/planner/answers";
import { Agent, type Message } from "./Agent";
import { DetailDialog, EventDialog, ProfileForm, SaveDialog } from "./Dialogs";
import { Modal } from "./Modal";
import { PolicyCard, deadlineText } from "./PolicyCard";
import { Roadmap } from "./Roadmap";
import { Robot } from "./Robot";
import { Schedule } from "./Schedule";
import s from "./workspace.module.css";

const personaProfile: Profile = { ...PERSONA_A, events: [] };

async function fetchEvaluation(profile: Profile, input: PlannerInput): Promise<Evaluation> {
  const response = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, benefits: profile.benefits, plannerV2: input }) });
  const body = await response.json();
  if (!response.ok || !body.plannerV2) throw new Error(body.error ?? "일정을 반영하지 못했어요. 다시 시도해 주세요.");
  return body.plannerV2 as Evaluation;
}
const initialMessage: Message = { id: 0, role: "assistant", text: "안녕하세요! 함께 다음 갈림길을 준비해 봐요.\n\n일정을 바꾸면 신청할 수 있는 정책과 내 기한을 다시 확인해 드릴게요. 마음에 드는 정책은 카드의 ‘담기’를 눌러 주세요." };
type Filter = { category: Category | "all"; unavailable: boolean };
type PendingSave = { target: Draft; recommendation: boolean; source?: AiRecommendation["source"] };
const cardKey = (c: Choice) => `${c.stageId}|${c.offeringId}`;

export default function Planner() {
  const [session, setSession] = useState(0);
  return <PlannerSession key={session} onRestart={() => setSession(value => value + 1)} />;
}

function PlannerSession({ onRestart }: { onRestart: () => void }) {
  const [recommendation, setRecommendation] = useState<AiRecommendation | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const planSeq = useRef(0);
  // 상담 · 추천 에이전트(GPT 재설계): 동의 · AI 질문 · 최근 대화 · 자동 재호출 횟수 · 주제 밖 연속 횟수
  const [consent, setConsent] = useState(false);
  const [aiQuestion, setAiQuestion] = useState<(CounselBody & { target: CounselTarget }) | null>(null);
  const counselHistory = useRef<CounselTurn[]>([]), autoCalls = useRef(0), outOfScope = useRef(0), badAnswers = useRef(0);
  function clearRecommendation() {
    planSeq.current++;
    setRecommendation(null);
    setPlanLoading(false);
  }
  function restart() {
    try { sessionStorage.removeItem(DRAFT_KEY); }
    catch { setStorageNotice("임시 초안을 지우지 못했어요."); return; }
    clearRecommendation();
    seq.current++;
    onRestart();
  }
  const [draft, setDraft] = useState<Draft | null>(null), [pending, setPending] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null), confirmedRef = useRef<Draft | null>(null);
  const [history, setHistory] = useState<PlanEvent[][]>([]), historyRef = useRef<PlanEvent[][]>([]);
  const [route, setRoute] = useState<"select" | "roadmap">("select");
  const [plans, setPlans] = useState<SavedPlan[]>([]), [example, setExample] = useState<SavedPlan | null>(null);
  const [planId, setPlanId] = useState("draft"), [rechecked, setRechecked] = useState<Draft | null>(null);
  const activePlanId = useRef(planId); activePlanId.current = planId;
  const recheckedOwner = useRef(""), recheckSeq = useRef(0), pendingCommand = useRef<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ category: "all", unavailable: false });
  const [recommend, setRecommend] = useState(false), [recommendExpanded, setRecommendExpanded] = useState(true);
  const previousFilter = useRef<Filter | null>(null), previousScroll = useRef(0), boardRef = useRef<HTMLDivElement>(null), recommendRef = useRef<HTMLElement>(null);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [focusedStage, setFocusedStage] = useState<string | null>(null);
  const [gridStage, setGridStage] = useState<string | null>(null), [detail, setDetail] = useState<Choice | null>(null), [compare, setCompare] = useState<Choice | null>(null);
  const [eventDialog, setEventDialog] = useState<PlanEvent | "new" | null>(null);
  const [saveDialog, setSaveDialog] = useState<PendingSave | null>(null);
  const [account, setAccount] = useState(false), [editProfile, setEditProfile] = useState(false), [chipMenu, setChipMenu] = useState<string | null>(null), [copyPlan, setCopyPlan] = useState<SavedPlan | null>(null);
  const [agentOpen, setAgentOpen] = useState(false), [agentHidden, setAgentHidden] = useState(false);
  const [messages, setMessages] = useState<Message[]>([initialMessage]); const messageId = useRef(1);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [storageNotice, setStorageNotice] = useState<string | null>(null);
  const [legacyIds, setLegacyIds] = useState<string[]>([]), [entryForm, setEntryForm] = useState(false), [toast, setToast] = useState<string | null>(null);
  const [legacySitePlans, setLegacySitePlans] = useState<{ sourceId: string; name: string; needsReselection: boolean }[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null), seq = useRef(0), retry = useRef<(() => void) | null>(null);

  function announce(text: string) { setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4500); }
  function say(text: string, role: Message["role"] = "assistant") { setMessages(ms => [...ms, { id: messageId.current++, role, text }]); }
  function navigate(next: "select" | "roadmap") {
    if (next !== route) {
      const state = { ...window.history.state, pathfinderRoute: next };
      const hasModal = !!state.pathfinderModal; delete state.pathfinderModal;
      if (hasModal) window.history.replaceState(state, ""); else window.history.pushState(state, "");
    }
    setRoute(next);
  }
  function loadPlans() {
    try { const result = createPlanRepository(localStorage).listPlans(); setPlans(result.plans); if (result.unreadable) setStorageNotice(`읽을 수 없는 계획 ${result.unreadable}개가 있어요. 정상 계획은 계속 열 수 있어요.`); setLegacyIds(readLegacyPolicies(localStorage)); setLegacySitePlans(readLegacySitePlans(localStorage)); }
    catch { setStorageNotice("브라우저 저장 공간을 읽을 수 없어요. 현재 초안은 계속 편집할 수 있어요."); }
  }
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, pathfinderRoute: "select" }, "");
    const popRoute = (event: PopStateEvent) => { if (event.state?.pathfinderRoute) setRoute(event.state.pathfinderRoute); };
    window.addEventListener("popstate", popRoute);
    try { const result = createPlanRepository(localStorage).listPlans(); setPlans(result.plans); if (result.unreadable) setStorageNotice(`읽을 수 없는 계획 ${result.unreadable}개가 있어요.`); setLegacyIds(readLegacyPolicies(localStorage)); setLegacySitePlans(readLegacySitePlans(localStorage)); } catch { setStorageNotice("브라우저 저장 공간을 읽을 수 없어요."); }
    let alive = true;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const restored = parseDraft(raw);
        if (!restored) throw new Error("invalid draft");
        setDraft(restored); confirmedRef.current = restored; draftRef.current = restored; setBusy(true);
        const requestId = ++seq.current;
        fetchEvaluation(restored.profileSnapshot, restored.input).then(evaluation => { if (alive && seq.current === requestId) { const next = { ...restored, evaluation: preserveMissingChoices(restored.evaluation, evaluation, restored.input.choices) }; setDraft(next); confirmedRef.current = next; draftRef.current = next; } }).catch(() => { if (alive) setError("초안을 복원했지만 최신 판정에 실패했어요. 일정이나 프로필을 다시 반영해 주세요."); }).finally(() => { if (alive && seq.current === requestId) setBusy(false); });
        if (restored.input.demoId) {
          const exampleInput: PlannerInput = { ...restored.input, revision: 0, events: PERSONA_DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all" };
          fetchEvaluation(personaProfile, exampleInput).then(evaluation => { if (alive) { const input = { ...exampleInput, choices: evaluation.recommendations }; const next = createDraft(personaProfile, input, withChoices(evaluation, input.choices)); setExample(savedSnapshot(next, "예시 계획", "example")); } }).catch(() => { /* regular draft remains available */ });
        }
      }
    } catch { setStorageNotice("이 탭의 임시 초안을 복원하지 못했어요. 저장한 계획은 계정 메뉴에서 확인할 수 있어요."); }
    const storageListener = () => { try { const result = createPlanRepository(localStorage).listPlans(); setPlans(result.plans); } catch { /* keep existing in-memory plans */ } };
    const visibility = () => {
      const current = confirmedRef.current;
      if (document.visibilityState !== "visible" || !current || toKstDate(new Date()) === current.evaluation.today) return;
      clearRecommendation();
      const id = ++seq.current; setBusy(true);
      fetchEvaluation(current.profileSnapshot, current.input).then(evaluation => { if (alive && seq.current === id) { const next = { ...current, evaluation }; setDraft(next); confirmedRef.current = next; draftRef.current = next; } }).catch(() => setError("오늘 기준 판정에 실패했어요. 직전 결과를 표시합니다.")).finally(() => { if (alive && seq.current === id) setBusy(false); });
    };
    window.addEventListener("storage", storageListener); document.addEventListener("visibilitychange", visibility);
    // 화면을 떠나면 진행 중인 추천 요청을 무효로 만든다(늦게 온 응답이 상태를 바꾸지 않게).
    // 숫자를 복사하면 무효화가 사라지므로 ref 객체 자체를 잡아 둔다.
    const recommendationSeq = planSeq;
    return () => { alive = false; recommendationSeq.current++; window.removeEventListener("popstate", popRoute); window.removeEventListener("storage", storageListener); document.removeEventListener("visibilitychange", visibility); if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, []);
  useEffect(() => { if (!draft) return; try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch { setStorageNotice("임시 초안을 저장하지 못했어요. 새로고침 전에 계획 저장을 시도해 주세요."); } }, [draft]);
  // Each sentinel loads only its own column; the full server result still owns counts/recommendations.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { const id = (e.target as HTMLElement).dataset.stage; if (id) setLimits(prev => ({ ...prev, [id]: (prev[id] ?? 4) + 4 })); } }, { threshold: .2 });
    boardRef.current?.querySelectorAll("[data-stage]").forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [draft?.evaluation, limits, filter, route]);

  async function commit(next: Draft, nextHistory: PlanEvent[][] = historyRef.current, success?: string): Promise<Draft | null> {
    const requestId = ++seq.current;
    clearRecommendation();
    draftRef.current = next; setPending(next); setBusy(true); setError(null); retry.current = null;
    try {
      const evaluation = await fetchEvaluation(next.profileSnapshot, next.input);
      if (requestId !== seq.current || !acceptRevision(next.input.revision, evaluation)) return null;
      const resolved = { ...next, evaluation: preserveMissingChoices(next.evaluation, evaluation, next.input.choices) };
      setDraft(resolved); draftRef.current = resolved; confirmedRef.current = resolved;
      setHistory(nextHistory); historyRef.current = nextHistory;
      if (success) announce(success);
      return resolved;
    } catch (err) {
      if (requestId === seq.current) { setError(err instanceof Error ? err.message : "판정 요청에 실패했어요."); draftRef.current = confirmedRef.current; retry.current = () => { void commit(next, nextHistory, success); }; }
      return null;
    } finally { if (requestId === seq.current) { setPending(null); setBusy(false); } }
  }
  async function start(profile: Profile, demo: boolean, mutedKeys: string[] = []) {
    const input: PlannerInput = { revision: 0, events: demo ? structuredClone(PERSONA_DEMO_EVENTS) : [], choices: [], mutedKeys: [...new Set([...mutedKeys, ...(profile.currentStatus.length ? [] : ["status"])])], preferredCategory: "all", ...(demo ? { demoId: "pathfinder-demo-2026" as const } : {}) };
    const requestId = ++seq.current; setBusy(true); setError(null);
    try { const evaluation = await fetchEvaluation(profile, input); if (requestId !== seq.current) return; const next = createDraft(profile, input, evaluation); setDraft(next); draftRef.current = next; confirmedRef.current = next; setHistory([]); historyRef.current = []; if (demo) setExample({ ...savedSnapshot({ ...next, input: { ...input, choices: evaluation.recommendations }, evaluation: withChoices(evaluation, evaluation.recommendations) }, "예시 계획", "example"), source: "example" }); }
    catch (err) { setError(err instanceof Error ? err.message : "첫 판정에 실패했어요."); } finally { if (requestId === seq.current) setBusy(false); }
  }
  function mutate(patch: Partial<PlannerInput>, profile?: Profile) { const current = draftRef.current; if (!current) return; return commit({ ...current, profileSnapshot: profile ?? current.profileSnapshot, input: { ...current.input, ...patch, revision: current.input.revision + 1 } }); }
  async function updateEvents(events: PlanEvent[], undo = false) {
    const current = draftRef.current; if (!current) return;
    if (JSON.stringify(events) === JSON.stringify(current.input.events ?? [])) { announce("이미 같은 일정이에요."); return; }
    const change = undo ? undoEvents(current, historyRef.current) : changeEvents(current, events, historyRef.current);
    const before = current.evaluation;
    const result = await commit(change.draft, change.history, undo ? "직전 일정으로 되돌렸어요" : "일정과 내 기한을 다시 계산했어요");
    if (result) {
      const affected = result.evaluation.cards.filter(c => { const old = before.cards.find(p => cardKey(p) === cardKey(c)); return old && (old.personalWindow?.end !== c.personalWindow?.end || old.availability !== c.availability); }).length;
      const changed = events.find(e => current.input.events?.find(old => old.id === e.id)?.date !== e.date);
      const old = changed && current.input.events?.find(e => e.id === changed.id);
      say(`${undo ? "직전 일정을 복원했어요." : changed ? `${EVENT_NAMES[changed.type]} 예정일을 ${old?.date ?? "미정"}에서 ${changed.date}로 반영했어요.` : "일정을 제거했어요."}\n영향받은 정책 카드 ${affected}개를 다시 확인했어요.${result.evaluation.choiceWarnings.length ? ` 확인할 정책 ${result.evaluation.choiceWarnings.length}개가 있어요.` : ""}\n‘되돌리기’로 이전 일정을 복원할 수 있어요.`);
      const stage = changed && result.evaluation.stages.find(st => st.eventIds.includes(changed.id)); if (stage) focusStage(stage.stageId);
    }
  }
  function undo() { if (historyRef.current.length) void updateEvents(historyRef.current[historyRef.current.length - 1], true); }
  function focusStage(id: string) { setFocusedStage(id); requestAnimationFrame(() => { document.getElementById(`stage-${id}`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" }); }); }
  function toggleRecommendation(force?: boolean) {
    const next = force ?? !recommend;
    if (next === recommend) { recommendRef.current?.scrollIntoView({ block: "nearest" }); return; }
    if (next) { previousFilter.current = filter; previousScroll.current = boardRef.current?.scrollLeft ?? 0; setFilter({ category: "all", unavailable: false }); setRecommendExpanded(true); setRecommend(true); requestAnimationFrame(() => recommendRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" })); }
    else { setRecommend(false); if (previousFilter.current) setFilter(previousFilter.current); requestAnimationFrame(() => { if (boardRef.current) boardRef.current.scrollLeft = previousScroll.current; }); }
  }
  async function previewSave(recommendation: boolean) {
    if (!draft || busy) return;
    if (!recommendation) { setSaveDialog({ target: structuredClone(draft), recommendation: false }); return; }
    setBusy(true); retry.current = null; setError(null);
    try { const input = { ...draft.input, choices: picks.map(({ offeringId, stageId }) => ({ offeringId, stageId })) }; const evaluation = await fetchEvaluation(draft.profileSnapshot, input); setSaveDialog({ target: { ...draft, input, evaluation }, recommendation: true, source: recommendationSource }); }
    catch (err) { setError(err instanceof Error ? err.message : "추천 경로를 확인하지 못했어요."); } finally { setBusy(false); }
  }
  async function choose(card: Card) {
    if (!draft || busy) return;
    if (card.selectedStageId === card.stageId) { await mutate({ choices: draft.input.choices.filter(c => c.offeringId !== card.offeringId) }); return; }
    if (card.canReplace || card.selectedStageId) { setCompare({ offeringId: card.offeringId, stageId: card.stageId }); return; }
    if (card.availability === "blocked") { setDetail(card); return; }
    await mutate({ choices: [...draft.input.choices.filter(c => c.offeringId !== card.offeringId), { offeringId: card.offeringId, stageId: card.stageId }] });
  }
  function locate(choice: Choice) {
    navigate("select"); setFilter({ category: "all", unavailable: false }); setLimits(prev => ({ ...prev, [choice.stageId]: 10000 })); setFocusedStage(choice.stageId);
    requestAnimationFrame(() => { const el = document.getElementById(`board-${choice.stageId}-${choice.offeringId}`); el?.scrollIntoView({ block: "center", inline: "center", behavior: "auto" }); el?.querySelector<HTMLButtonElement>("button")?.focus(); });
  }
  async function openCopy(plan: SavedPlan) {
    const next = createDraft(plan.profileSnapshot, { ...plan.input, revision: 0 }, plan.savedEvaluation);
    const result = await commit(next, [], "복사본을 편집 중이에요. 저장한 원본은 그대로예요.");
    if (result) { setPlanId("draft"); setRechecked(null); navigate("select"); setCopyPlan(null); }
  }
  async function reevaluate() {
    if (!view || busy) return;
    const targetId = planId, request = ++recheckSeq.current;
    setBusy(true); setError(null); retry.current = null;
    try {
      const evaluation = await fetchEvaluation(view.profileSnapshot, view.input);
      const accepted = applySavedRecheck(activePlanId.current, { planId: targetId, evaluation });
      if (!accepted || request !== recheckSeq.current) return;
      recheckedOwner.current = targetId;
      setRechecked({ ...view, evaluation: preserveMissingChoices(view.evaluation, accepted, view.input.choices) });
      announce("오늘 기준 결과를 표시해요. 새 계획으로 저장해야 보관됩니다.");
    } catch (err) { if (activePlanId.current === targetId) setError(err instanceof Error ? err.message : "재판정에 실패했어요."); }
    finally { if (request === recheckSeq.current) setBusy(false); }
  }
  const canCounsel = (d: Draft | null) => !!d && (!!d.input.demoId || consent);
  function remember(turn: CounselTurn) { counselHistory.current = [...counselHistory.current, turn].slice(-6); }
  async function counsel(action: "message" | "recommend" | "followup", message?: string) {
    const current = draftRef.current; if (!current) return;
    if (action === "recommend") { navigate("select"); toggleRecommendation(true); }
    if (action !== "followup") autoCalls.current = 0;
    const id = ++planSeq.current; setPlanLoading(true);
    const result = await requestCounsel({ draft: current, action, message, history: counselHistory.current, consent, outOfScopeStreak: outOfScope.current });
    if (id !== planSeq.current) return;
    setPlanLoading(false);
    if (message) remember({ role: "user", text: message });
    if (result.notice && result.kind !== "plan" && result.kind !== "fallback") say(result.notice);
    if (result.kind === "out_of_scope") outOfScope.current++; else if (action === "message") outOfScope.current = 0;
    if (result.status === 403) { say("AI 상담을 쓰려면 아래에서 ‘AI 상담 사용’에 동의해 주세요. 동의 전에는 조건 기준 질문과 추천만 보여 드려요."); return; }
    if (result.kind === "question" && result.target) { setAiQuestion(result as CounselBody & { target: CounselTarget }); badAnswers.current = 0; remember({ role: "assistant", text: `질문: ${result.text}` }); return; }
    if (result.kind === "parsed" && result.target && result.value) { await answerAi(result.target, result.value); return; }
    if (result.kind === "answer") { say(`${result.text}${result.citations?.length ? `\n근거: ${result.citations.map(c => c.label).join(" · ")}` : ""}${result.source === "ai" ? "\n(AI 정리)" : ""}`); remember({ role: "assistant", text: `답변: ${(result.text ?? "").slice(0, 120)}` }); return; }
    if (result.kind === "plan" || result.kind === "fallback") {
      if (action !== "recommend") toggleRecommendation(true);
      setRecommendation({ source: result.source === "ai" ? "ai" : "rule", summary: result.summary ?? "", picks: result.picks ?? [], notice: result.notice ?? null });
      if (result.kind === "plan") say(`${result.summary}\n(AI 정리 · 판정은 카드의 코드 값 그대로예요)`); else if (result.notice) say(result.notice);
      remember({ role: "assistant", text: result.kind === "plan" ? `추천 ${result.picks?.length ?? 0}개` : "조건 기준 추천" });
      return;
    }
    if (result.text) say(result.text);
    else if (result.kind === "none") say(result.error ?? "지금은 더 여쭤볼 것이 없어요. 아래 질문 카드나 정책 카드에서 이어서 확인해 주세요.");
  }
  async function answerAi(target: CounselTarget, value: string) {
    const current = draftRef.current; if (!current) return;
    const valid = validateAnswer(target, value, current.evaluation.today);
    if (!valid.ok) {
      badAnswers.current++;
      if (badAnswers.current >= 2) { setAiQuestion(null); say(`${valid.message} 이 질문은 나중에 답해도 돼요.`); } else say(valid.message);
      return;
    }
    setAiQuestion(null);
    const next = applyTarget(current.profileSnapshot, current.input, target, value);
    remember({ role: "user", text: `답: ${target.kind === "benefit" ? target.answer : target.kind} = ${value}` });
    const result = await commit({ ...current, profileSnapshot: next.profile, input: { ...next.input, revision: current.input.revision + 1 } }, undefined, "답을 반영해 다시 판정했어요");
    if (!result) return;
    const confirm = scheduleNeedsConfirm(next.input); if (confirm) say(confirm);
    // AI 가 물은 질문에 답했으면 한 번 더 부른다. 연속 자동 호출은 3번까지.
    if (autoCalls.current < 3) { autoCalls.current++; void counsel("followup"); }
  }
  function send(text: string) {
    say(text, "user"); const current = readOnly ? view : draftRef.current;
    if (!current) return;
    const turn = parseScheduleTurn(text, current.input.events ?? [], pendingCommand.current);
    const command = turn.command; pendingCommand.current = turn.pending;
    // 일정 명령은 코드가 먼저. 명령이 아니거나 설명을 묻는 글은 상담 에이전트로(시연 인물 · 동의한 사용자).
    const notACommand = command.type === "clarify" && !turn.pending?.match(/이사|취업|수료|창업|사업자/) && !/이사|취업|수료|창업|사업자/.test(text);
    if (!readOnly && (notACommand || command.type === "explain") && canCounsel(draftRef.current)) { void counsel("message", text); return; }
    if (command.type === "clarify") { say(notACommand && !consent && !draftRef.current?.input.demoId ? `${command.message}\n자유 질문은 아래 ‘AI 상담 사용’에 동의하면 답해 드려요.` : command.message); return; }
    if (command.type === "recommend") {
      if (readOnly) {
        say("이 계획의 추천 경로를 보려면 ‘복사해 편집’을 눌러 주세요.");
        return;
      }
      if (!draft) return;
      if (canCounsel(draft)) { void counsel("recommend"); return; }
      navigate("select");
      toggleRecommendation(true);
      const id = ++planSeq.current;
      setPlanLoading(true);
      void requestAiRecommendation({
        profile: draft.profileSnapshot, events: draft.input.events ?? [], evaluation: draft.evaluation,
        seq: id, currentSeq: () => planSeq.current,
      }).then(result => {
        if (result && id === planSeq.current) {
          setRecommendation(result);
          setPlanLoading(false);
        }
      });
      return;
    }
    const named = findNamedCards(text, current.evaluation, current.input.choices);
    const target = named[0] ?? (detail ? current.evaluation.cards.find(c => cardKey(c) === cardKey(detail)) : current.evaluation.cards.find(c => c.offeringId === current.input.choices[0]?.offeringId && c.stageId === current.input.choices[0]?.stageId) ?? current.evaluation.cards.find(c => c.deadlineKind === "personal_estimate"));
    if (command.type === "locate_card") {
      if (target) { if (readOnly) setDetail(target); else locate(target); say(`${target.title}의 위치를 안내했어요. ‘담기’는 직접 눌러 주세요.${readOnly ? " 저장본은 복사해 편집할 수 있어요." : ""}`); }
      else say("어떤 정책을 담고 싶으세요? 정책 제목을 알려 주시거나 카드를 먼저 눌러 주세요.");
      return;
    }
    if (command.type === "explain") {
      const target = named[0] ?? pickExplainTarget(current.evaluation, current.input.choices, detail);
      const eul = (w: string) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return c >= 0 && c < 11172 && c % 28 === 0 ? "를" : "을"; };
      const picked = !named[0] && !detail && target ? `${target.title}${eul(target.title)} 예로 설명할게요. 다른 정책은 제목을 말씀해 주세요.\n` : "";
      if (target) {
        setDetail(target);
        if (named.length > 1) {
          const other = named[1];
          const relation = [...target.restrictions, ...other.restrictions].find(r => [other.offeringId, other.policyId, target.offeringId, target.policyId].includes(r.otherId));
          const evidence = [...target.evidence, ...other.evidence].find(e => e.evidenceId === relation?.evidenceId);
          say(`${target.title} · ${other.title}\n${relation?.reviewed && (relation.action === "application" || (relation.period && relation.otherPeriod)) ? `공고의 ${relation.action === "benefit" ? "동시 수혜" : "중복 신청"} 제한을 확인해 주세요.` : "확정할 수 있는 중복 제한·수혜 기간 정보가 부족해요. 기관에 적용 기간과 대상을 확인해 주세요."}${evidence ? `\n근거: ${evidence.quote}` : ""}`);
        } else say(`${picked}${target.title}\n공식 접수: ${target.official.start ?? "시작 미정"} ~ ${target.official.end ?? "상시 또는 미정"}\n${deadlineText(target, current.evaluation.today)}\n${target.reasons.map(r => r.message).join("\n") || "이 계획의 조건과 공식 접수 기간을 교차한 결과예요."}`);
      } else say("정책 제목을 눌러 대상을 선택해 주세요. 상세에서 계산 이유와 제한 근거를 함께 확인할 수 있어요.");
      return;
    }
    if (route === "roadmap" && planId !== "draft") { say("지금은 저장한 계획을 보고 있어요. ‘복사해 편집’을 누르면 그 계획의 일정을 바꿀 수 있어요."); return; }
    if (command.type === "undo") { undo(); return; }
    if (command.type === "update_event") void updateEvents((current.input.events ?? []).map(e => e.id === command.eventId ? { ...e, date: command.date } : e));
    else if (command.type === "add_event") void updateEvents([...(current.input.events ?? []), { id: newId(), type: command.eventType, date: command.date, status: "scheduled", ...(command.sigungu ? { sigungu: command.sigungu } : {}) }]);
  }

  const selectedSaved = planId === "example" ? example : plans.find(p => p.planId === planId) ?? null;
  const readOnly = route === "roadmap" && planId !== "draft";
  const checkedView = rechecked && applySavedRecheck(planId, { planId: recheckedOwner.current, evaluation: rechecked.evaluation }) ? rechecked : null;
  const view: Draft | null = readOnly && selectedSaved ? checkedView ?? { draftId: selectedSaved.planId, profileSnapshot: selectedSaved.profileSnapshot, input: selectedSaved.input, evaluation: selectedSaved.savedEvaluation } : draft;
  const evaluation = view?.evaluation;
  const activeRecommendation = readOnly ? null : recommendation;
  const recommendationSource = activeRecommendation?.source ?? "rule";
  const recommendationLabel = recommendationSource === "ai" ? "AI 추천" : "조건 기준 추천";
  const picks = activeRecommendation?.picks ?? evaluation?.recommendations ?? [];
  const detailCard = detail && evaluation?.cards.find(c => cardKey(c) === cardKey(detail));
  const compareCard = compare && draft?.evaluation.cards.find(c => cardKey(c) === cardKey(compare));
  const stageLabel = (id: string) => evaluation?.stages.find(st => st.stageId === id)?.label ?? "시점 다시 선택";
  const visibleCards = (stageId: string) => evaluation?.cards.filter(c => c.stageId === stageId && (filter.category === "all" || c.category === filter.category) && (filter.unavailable ? c.availability === "blocked" : c.availability !== "blocked" || c.conflicts.length > 0 || c.reasons.some(r => r.code === "PARTICIPATION_CONFLICT") || c.selectedStageId === c.stageId)) ?? [];
  function renderCard(card: Card, surface = "board") { return <PolicyCard key={cardKey(card)} card={card} today={evaluation!.today} recommended={recommend && picks.some(c => cardKey(c) === cardKey(card))} onDetail={setDetail} onChoose={c => void choose(c)} disabled={busy || readOnly} surface={surface} />; }
  function navIcon(type: "select" | "roadmap" | "account") { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{type === "select" ? <><rect x="3" y="4" width="7" height="16" rx="2" /><rect x="14" y="4" width="7" height="10" rx="2" /></> : type === "roadmap" ? <><path d="M4 5v15h16M9 7h10M9 12h6M9 17h9" /><circle cx="7" cy="7" r="1" /></> : <><circle cx="12" cy="8" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></>}</svg>; }
  const showDialogs = (): ReactNode => <>
    {account && <Modal title="내 계정과 저장 공간" onClose={() => setAccount(false)}><p><strong>{draft?.input.demoId ? "시연 인물" : "게스트"}</strong> · 이 브라우저에 저장</p><p className={s.emptyHint}>계획은 현재 기기의 이 브라우저에서만 열 수 있어요. 다른 기기나 계정으로 자동 동기화되지 않아요.</p>{storageNotice && <p className={s.warningText}>{storageNotice}</p>}<ul className={s.saveItems}>{plans.map(p => <li key={p.planId}><button className={s.textButton} onClick={() => { if (!draft) { const seed = createDraft(p.profileSnapshot, p.input, p.savedEvaluation); setDraft(seed); draftRef.current = seed; confirmedRef.current = seed; } setPlanId(p.planId); setRechecked(null); navigate("roadmap"); setAccount(false); }}>{p.name} · {p.input.choices.length}개<small>{new Date(p.createdAt).toLocaleString("ko-KR")}</small></button></li>)}</ul>{!plans.length && <p className={s.emptyHint}>저장한 계획이 없어요.</p>}{legacySitePlans.length > 0 && <div className={s.checkNote}><strong>이전 버전에서 저장한 계획</strong>{legacySitePlans.map(p => <p key={p.sourceId}>{p.name} · 회차·시점 다시 선택</p>)}<p>원본은 보존했어요. 현재 보드에서 정책과 시점을 골라 새 계획으로 저장해 주세요.</p></div>}{legacyIds.length > 0 && <div className={s.checkNote}><strong>이전에 담은 정책 {legacyIds.length}개</strong><p>예전 목록에는 회차와 시점이 없어 자동으로 옮기지 않았어요. 보드에서 다시 골라 주세요.</p>{legacyIds.map(id => <p key={id}>{draft?.evaluation.cards.find(c => c.policyId === id)?.title ?? id} · 회차·시점 재선택</p>)}</div>}<div className={s.dialogActions}>{draft && <button className={s.primaryButton} onClick={() => { setAccount(false); setEditProfile(true); }}>내 정보 편집</button>}{draft && <button className={s.outlineButton} disabled={busy} onClick={restart}>처음으로</button>}<button className={s.outlineButton} onClick={() => setAccount(false)}>닫기</button></div></Modal>}
    {editProfile && draft && <Modal title="내 정보 편집" onClose={() => setEditProfile(false)}><ProfileForm mutedKeys={draft.input.mutedKeys} initial={draft.profileSnapshot} submitLabel="현재 초안에 반영" onSave={(profile, unknownKeys) => { void mutate({ mutedKeys: [...new Set([...draft.input.mutedKeys.filter(k => !["status", "participation"].includes(k)), ...unknownKeys])] }, profile); setEditProfile(false); }} /></Modal>}
    {chipMenu && draft && <Modal title="이 계획의 조건" onClose={() => setChipMenu(null)}><p>조건을 끄면 해당 판단은 ‘확인 필요’로 남고 추천에서 제외될 수 있어요.</p>{chipMenu === "interest" && <label className={s.form}>관심 분야<select className={s.picker} value={draft.input.preferredCategory} onChange={e => { void mutate({ preferredCategory: e.target.value as Category | "all" }); setChipMenu(null); }}><option value="all">전체 분야</option>{Object.entries(CATEGORIES).map(([key, cat]) => <option key={key} value={key}>{cat.label}</option>)}</select></label>}<div className={s.dialogActions}><button className={s.outlineButton} onClick={() => { void mutate({ mutedKeys: draft.input.mutedKeys.includes(chipMenu) ? draft.input.mutedKeys.filter(k => k !== chipMenu) : [...draft.input.mutedKeys, chipMenu] }); setChipMenu(null); }}>{draft.input.mutedKeys.includes(chipMenu) ? "다시 켜기" : "이 계획에서 잠시 끄기"}</button><button className={s.primaryButton} onClick={() => { setChipMenu(null); setEditProfile(true); }}>수정하기</button></div></Modal>}
    {eventDialog && draft && <EventDialog event={eventDialog === "new" ? null : eventDialog} events={draft.input.events ?? []} today={draft.evaluation.today} onClose={() => setEventDialog(null)} onApply={events => void updateEvents(events)} />}
    {gridStage && evaluation && <Modal title={`${stageLabel(gridStage)} · 정책 ${visibleCards(gridStage).length}개 전체 보기`} wide onClose={() => setGridStage(null)}><p className={s.emptyHint}>보드와 같은 필터·기한 순서로 보여드려요.</p><div className={s.dialogGrid}>{visibleCards(gridStage).map(c => renderCard(c, "grid"))}</div>{visibleCards(gridStage).length === 0 && <p className={s.emptyState}>현재 필터에 해당하는 정책이 없어요.</p>}</Modal>}
    {detailCard && evaluation && <DetailDialog card={detailCard} today={evaluation.today} stageLabel={stageLabel(detailCard.stageId)} busy={busy} readOnly={readOnly} onClose={() => setDetail(null)} onChoose={c => void choose(c)} />}
    {compareCard && draft && <Modal title={compareCard.conflicts.length ? "정책 비교·교체" : "담은 시점 변경"} onClose={() => setCompare(null)}><p className={s.emptyHint}>확인하기 전에는 현재 초안이 바뀌지 않아요.</p><div className={s.compareGrid}><div className={s.compareItem}><h3>현재 내 계획</h3>{draft.input.choices.filter(c => compareCard.conflicts.includes(c.offeringId) || c.offeringId === compareCard.offeringId).map(c => { const item = draft.evaluation.cards.find(p => cardKey(p) === cardKey(c)); return <div key={c.offeringId}><strong>{item?.title ?? c.offeringId}</strong><p>{item?.support}</p><p>{item && deadlineText(item, draft.evaluation.today)}</p><p>{stageLabel(c.stageId)} · 공고 마감 {dateLabel(item?.official.end ?? null)}</p></div>; })}</div><div className={s.compareItem}><h3>새로 담을 정책</h3><strong>{compareCard.title}</strong><p>{compareCard.support}</p><p>{deadlineText(compareCard, draft.evaluation.today)}</p><p>{stageLabel(compareCard.stageId)} · 공고 마감 {dateLabel(compareCard.official.end)}</p></div></div>{compareCard.reasons.map((r, i) => <p key={i} className={s.warningText}>{r.message}</p>)}{compareCard.evidence.filter(e => compareCard.reasons.some(r => r.evidenceId === e.evidenceId)).map(e => <blockquote key={e.evidenceId} className={s.evidence}>{e.quote}</blockquote>)}<div className={s.dialogActions}><button className={s.outlineButton} onClick={() => setCompare(null)}>취소</button><button className={s.primaryButton} disabled={busy || (compareCard.availability === "blocked" && !compareCard.canReplace)} onClick={() => { const next = draft.input.choices.filter(c => c.offeringId !== compareCard.offeringId && !compareCard.conflicts.includes(c.offeringId)); void mutate({ choices: [...next, { offeringId: compareCard.offeringId, stageId: compareCard.stageId }] }); setCompare(null); }}>{compareCard.conflicts.length ? "기존 정책 대신 이 정책 담기" : "이 시점으로 옮기기"}</button></div></Modal>}
    {saveDialog && draft && <SaveDialog target={saveDialog.target} manual={draft} recommendation={saveDialog.recommendation} onClose={() => setSaveDialog(null)} onSave={name => { const plan = savedSnapshot(saveDialog.target, name, saveDialog.recommendation ? "recommendation" : "manual"); if (saveDialog.source) plan.recommendationSource = saveDialog.source; createPlanRepository(localStorage).createPlan(plan); loadPlans(); setSaveDialog(null); announce(`‘${plan.name}’을 이 브라우저에 저장했어요.`); }} />}
    {copyPlan && <Modal title="새 복사본으로 편집할까요?" onClose={() => setCopyPlan(null)}><p>현재 초안에 저장하지 않은 변경이 있을 수 있어요. 복사본을 열면 현재 초안 자리를 새 복사본으로 바꿉니다. 저장된 원본은 유지돼요.</p><div className={s.dialogActions}><button className={s.outlineButton} onClick={() => setCopyPlan(null)}>현재 초안 계속</button><button className={s.primaryButton} disabled={busy} onClick={() => void openCopy(copyPlan)}>복사본 열기</button></div></Modal>}
  </>;

  if (!draft || !evaluation || !view) return <div className={s.app}><main className={s.entry}><section className={s.entryHero}><span className={s.entryLogo}>Pathfinder · 갈림길</span><Robot large /><h1>다음 갈림길에도,<br />나에게 맞는 길.</h1><p>취업하면, 수료하면, 이사하면.<br />달라지는 청년 정책을 내 일정에 맞춰 살펴보세요.</p></section><section className={s.entryContent}><p className={s.eyebrow}>나의 내일을 준비하는 정책 플래너</p><h2>{entryForm ? "내 정보로 시작하기" : "어디서부터 시작할까요?"}</h2><p>몇 가지 정보와 앞으로의 일정으로<br />나만의 정책 계획을 만들 수 있어요.</p>{busy ? <><p role="status">정책과 일정을 확인하고 있어요…</p><div className={s.skeleton} /></> : entryForm ? <><ProfileForm onSave={(profile, muted) => void start(profile, false, muted)} /><button className={s.textButton} onClick={() => setEntryForm(false)}>돌아가기</button></> : <div className={s.entryButtons}><button className={s.primaryButton} onClick={() => void start(structuredClone(personaProfile), true)}>예시로 둘러보기</button><button className={s.outlineButton} onClick={() => setEntryForm(true)}>내 정보로 시작</button><button className={s.textButton} onClick={() => setAccount(true)}>저장한 계획 확인 ({plans.length})</button></div>}{error && <p className={s.error} role="alert">{error}</p>}<p className={s.notice}>계획은 이 브라우저에 저장돼요.</p></section></main>{showDialogs()}</div>;

  return <div className={`${s.app} ${agentOpen ? s.agentDrawer : ""} ${agentHidden ? s.agentHidden : ""}`}><div className={s.shell}><nav className={s.nav} aria-label="주 메뉴"><div className={s.brand}><Robot /><div><strong>Pathfinder</strong><small>나의 정책 갈림길</small></div></div><button className={`${s.navButton} ${route === "select" ? s.navActive : ""}`} aria-current={route === "select" ? "page" : undefined} onClick={() => { navigate("select"); setDetail(null); }}>{navIcon("select")}정책 선택하기</button><button className={`${s.navButton} ${route === "roadmap" ? s.navActive : ""}`} aria-current={route === "roadmap" ? "page" : undefined} onClick={() => { navigate("roadmap"); setDetail(null); }}>{navIcon("roadmap")}내 정책 로드맵</button><button className={`${s.navButton} ${s.accountButton}`} onClick={() => setAccount(true)}>{navIcon("account")}내 계정</button></nav>
    <main className={s.workspace} aria-busy={busy}><header className={s.pageHeader}><div><p className={s.eyebrow}>나의 다음을 준비하는 공간</p><h1>{route === "select" ? "정책 선택하기" : "내 정책 로드맵"}</h1><p className={s.subtitle}>{evaluation.demo && <span className={s.demoBadge}>시연 인물</span>}{route === "select" ? "내 일정에 맞는 정책을 살펴보고, 나만의 계획에 담아보세요." : "내가 고른 정책을 하나의 시간 위에서 확인해 보세요."}</p></div><div className={s.inlineActions}><button className={`${s.outlineButton} ${s.agentOpen}`} onClick={() => { setAgentOpen(true); setAgentHidden(false); }}>길잡이 열기</button><button className={s.textButton} onClick={() => { setAgentHidden(v => !v); setAgentOpen(v => !v); }} aria-label="길잡이 패널 표시 전환">☷</button></div></header>
    {route === "roadmap" && <div className={s.roadmapHeader}><label className={s.srOnly} htmlFor="plan-picker">로드맵 계획 선택</label><select id="plan-picker" className={s.picker} value={planId} onChange={e => { setPlanId(e.target.value); activePlanId.current = e.target.value; setRechecked(null); setDetail(null); setError(null); retry.current = null; }}><option value="draft">편집 중인 내 계획 · {draft.input.choices.length}개</option>{plans.length > 0 && <optgroup label="이 브라우저에 저장한 계획">{plans.map(p => <option key={p.planId} value={p.planId}>{p.name} · {p.input.choices.length}개 · {new Date(p.createdAt).toLocaleString("ko-KR")}</option>)}</optgroup>}{example && <option value="example">예시 계획</option>}</select>{readOnly && selectedSaved && <><button className={s.outlineButton} disabled={busy} onClick={() => setCopyPlan(selectedSaved)}>복사해 편집</button><button className={s.textButton} disabled={busy} onClick={() => void reevaluate()}>오늘 기준으로 다시 보기</button></>}</div>}
    {readOnly && <div className={s.banner}><span>{rechecked ? `오늘 기준 재판정 · 저장 당시 ${selectedSaved?.savedEvaluation.today}` : `저장 당시 기준 ${fullDate(evaluation.today)}`} · {selectedSaved?.name}</span>{rechecked && <button className={s.outlineButton} onClick={() => setSaveDialog({ target: rechecked, recommendation: false })}>새 계획으로 저장</button>}</div>}
    <div className={s.profileChips} aria-label="이 계획의 프로필 조건">{[{ key: "residence", label: `${regionLabel(view.profileSnapshot.sigungu)} 거주` }, { key: "status", label: view.profileSnapshot.currentStatus.includes("in_training") ? "교육 수강 중" : view.profileSnapshot.currentStatus.includes("employed") ? "재직 중" : view.profileSnapshot.currentStatus.includes("unemployed") ? "구직 중" : "현재 상태 확인" }, { key: "participation", label: view.profileSnapshot.benefits?.length ? `수혜 내역 ${view.profileSnapshot.benefits.length}개` : view.profileSnapshot.participating.length ? `수혜 중 ${view.profileSnapshot.participating.length}개` : "수혜 내역" }, { key: "interest", label: `관심: ${view.input.preferredCategory === "all" ? "전체 분야" : CATEGORIES[view.input.preferredCategory].label}` }].map(chip => <button key={chip.key} disabled={readOnly || busy} className={`${s.profileChip} ${view.input.mutedKeys.includes(chip.key) ? s.mutedChip : ""}`} onClick={() => setChipMenu(chip.key)}>{chip.label}{view.input.mutedKeys.includes(chip.key) ? " · 꺼짐" : ""}</button>)}</div>
    {busy && <div className={s.banner} role="status">일정 반영 중… 직전 판정 결과를 표시합니다.</div>}{error && <div className={s.error} role="alert">{error}{retry.current && <button className={s.textButton} onClick={() => retry.current?.()}>다시 시도</button>}</div>}{storageNotice && <p className={s.warningText}>{storageNotice}</p>}
    <Schedule evaluation={evaluation} events={(pending && !readOnly ? pending : view).input.events ?? []} onEdit={setEventDialog} onAdd={() => setEventDialog("new")} onUndo={undo} canUndo={history.length > 0} readOnly={readOnly} busy={busy} focusedStage={focusedStage} onFocus={focusStage} />
    <section className={s.draftSummary} aria-label="내 계획"><div className={s.sectionHeader}><h2>내 계획 <span>{view.input.choices.length}</span></h2>{!readOnly && <button className={s.primaryButton} disabled={busy || !view.input.choices.length} onClick={() => void previewSave(false)}>계획 저장</button>}</div>{view.input.choices.length === 0 ? <p className={s.emptyHint}>카드에서 담기를 눌러 시작하세요. 내 계획이 비어 있어도 모든 정책을 둘러볼 수 있어요.</p> : <div className={s.choiceList}>{view.input.choices.map(choice => { const card = evaluation.cards.find(c => cardKey(c) === cardKey(choice)); const warning = evaluation.choiceWarnings.find(w => w.offeringId === choice.offeringId); return <div key={choice.offeringId} className={`${s.choiceChip} ${warning ? s.choiceWarning : ""}`}><div><button className={s.textButton} onClick={() => card ? setDetail(choice) : announce("저장한 회차나 시점을 찾을 수 없어요. 다시 선택해 주세요.")}>{card?.title ?? warning?.title ?? choice.offeringId}</button><small>{stageLabel(choice.stageId)}{card?.personalWindow?.end ? ` · ${dateLabel(card.personalWindow.end)}` : ""}</small>{warning && <p className={s.warningText}>{warning.message}</p>}</div>{!readOnly && <button className={s.iconButton} disabled={busy} aria-label={`${card?.title ?? choice.offeringId} 내 계획에서 빼기`} onClick={() => void mutate({ choices: draft.input.choices.filter(c => c.offeringId !== choice.offeringId) })}>×</button>}</div>; })}</div>}{evaluation.choiceWarnings.length > 0 && <p className={s.warningText}>확인할 정책 {evaluation.choiceWarnings.length}개 · 선택한 정책은 자동으로 삭제하지 않아요.</p>}</section>
    {route === "select" ? <><div className={s.toolbar}><div className={s.categoryFilters} role="group" aria-label="분야 필터">{(["all", ...Object.keys(CATEGORIES)] as (Category | "all")[]).map(cat => <button key={cat} className={`${s.filter} ${filter.category === cat ? s.filterActive : ""}`} aria-pressed={filter.category === cat} onClick={() => setFilter({ ...filter, category: cat })}>{cat === "all" ? "전체" : CATEGORIES[cat].label}</button>)}</div><div className={s.inlineActions}><label className={s.toggle}><input type="checkbox" checked={filter.unavailable} onChange={e => setFilter({ ...filter, unavailable: e.target.checked })} />신청 불가 모아보기</label><button className={recommend ? s.primaryButton : s.outlineButton} aria-pressed={recommend} onClick={() => toggleRecommendation()}>✦ {recommend ? "추천 경로 닫기" : "AI 추천 경로 보기"}</button></div></div>
    {recommend && <section ref={recommendRef} className={s.recommendSummary} aria-label={recommendationLabel + " 경로"}><div className={s.sectionHeader}><button className={s.textButton} aria-expanded={recommendExpanded} onClick={() => setRecommendExpanded(v => !v)}><strong>{recommendationLabel} · {picks.length}개</strong> {recommendExpanded ? "접기" : "경로 보기"}</button><button className={s.primaryButton} disabled={busy || !picks.length} onClick={() => void previewSave(true)}>새 계획으로 저장</button></div><p className={s.emptyHint}>{activeRecommendation?.notice ?? activeRecommendation?.summary ?? "현재 조건으로 확인한 경로예요."}</p>{recommendExpanded && <div className={s.recommendLinks}>{picks.map(choice => { const card = evaluation.cards.find(c => cardKey(c) === cardKey(choice)); if (!card) return null; const hidden = filter.unavailable || (filter.category !== "all" && filter.category !== card.category); return <button key={cardKey(choice)} className={s.recommendLink} onClick={() => { if (hidden) { setDetail(choice); announce("현재 필터에서 숨김 상태예요. 상세에서 확인하거나 전체 분야로 바꿔 주세요."); } else locate(choice); }}>{card.title}<small>{stageLabel(choice.stageId)} · {hidden ? "현재 필터에서 숨김" : card.conflicts.length ? "별도 계획에서 가능" : deadlineText(card, evaluation.today)}</small></button>; })}{!picks.length && <p>현재 확인된 조건으로 추천할 수 있는 정책이 없어요. 확인 필요 정책은 직접 살펴보고 담을 수 있어요.</p>}</div>}</section>}
    <div className={s.boardScroll} ref={boardRef} aria-label="시점별 정책 보드"><div className={s.board}>{evaluation.stages.map(stage => { const cards = visibleCards(stage.stageId); const limit = limits[stage.stageId] ?? 4; return <section key={stage.stageId} id={`stage-${stage.stageId}`} className={`${s.column} ${focusedStage === stage.stageId ? s.focusedColumn : ""}`}><button className={s.columnHeader} aria-label={`${stage.label}, 정책 ${cards.length}개 전체 보기`} onClick={() => setGridStage(stage.stageId)}><h2>{stage.label}<span>{cards.length}</span></h2><p>{dateLabel(stage.start)} {stage.endExclusive ? `~ ${dateLabel(addDays(stage.endExclusive, -1))}` : "이후"} <span aria-hidden="true">⊞</span></p></button><div className={s.columnCards}>{cards.slice(0, limit).map(card => renderCard(card))}</div>{cards.length === 0 && <div className={s.emptyState}>{filter.unavailable ? "현재 조건에서 신청 불가로 확인된 정책이 없어요." : `이 시점에는 ${filter.category === "all" ? "표시할" : CATEGORIES[filter.category].label} 정책이 없어요.`}<button className={s.textButton} onClick={() => setFilter({ category: "all", unavailable: false })}>전체 보기</button></div>}{cards.length > limit && <button data-stage={stage.stageId} className={s.moreButton} onClick={() => setLimits(prev => ({ ...prev, [stage.stageId]: limit + 4 }))}>정책 더 보기 · {cards.length - limit}개 남음</button>}<p className={s.columnFooter}>{Math.min(limit, cards.length)} / {cards.length}개 표시</p></section>; })}</div></div></> : <Roadmap plan={view} onDetail={setDetail} />}
    <p className={s.notice}>기준일 {fullDate(evaluation.today)} · 공고 데이터 기준 {evaluation.asOf} · 현재 공고와 입력한 예정일을 기준으로 계산한 결과입니다. 신청 전 공식 공고를 확인해 주세요.</p>
    </main><Agent today={evaluation.today} recommendation={activeRecommendation} cards={evaluation.cards} planLoading={planLoading && !readOnly} aiQuestion={readOnly ? null : aiQuestion} onAiAnswer={value => { if (aiQuestion) void answerAi(aiQuestion.target, value); }} onAiSkip={() => setAiQuestion(null)}
      consentNeeded={!readOnly && !!draft && !draft.input.demoId && !consent} onConsent={() => { setConsent(true); say("AI 상담을 켰어요. 언제든 계정 메뉴에서 끌 수 있어요."); }}
      questions={readOnly ? [] : evaluation.questions} onAnswer={(question, answer) => {
      const profile = draft.profileSnapshot;
      void mutate({ mutedKeys: draft.input.mutedKeys.filter(key => key !== "participation") }, {
        ...profile, benefits: applyAnswer(profile.benefits ?? [], question, answer),
      });
    }} messages={messages} onSend={send} busy={busy} onClose={() => { setAgentOpen(false); setAgentHidden(true); }} /></div>{showDialogs()}{toast && <div className={s.toast} role="status">{toast}</div>}</div>;
}
