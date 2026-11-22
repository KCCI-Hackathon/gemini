"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { regionLabel } from "@/lib/data/regions";
import { toKstDate } from "@/lib/date";
import type { Profile } from "@/lib/judge/types";
import { addDays, dateLabel, fullDate } from "@/lib/planner/dates";
import { PERSONA_DEMO_EVENTS } from "@/lib/planner/fixtures";
import { findNamedCards, parseScheduleTurn, pickExplainTarget } from "@/lib/planner/commands";
import { acceptRevision, applySavedRecheck, changeEvents, createDraft, newId, preserveMissingChoices, savedSnapshot, undoEvents, withChoices } from "@/lib/planner/state";
import { createPlanRepository, DRAFT_KEY, parseDraft, readLegacyPolicies, readLegacySitePlans } from "@/lib/planner/storage";
import { createServerPlanRepository, fetchMe, logoutAccount, type Me } from "@/lib/planner/server-storage";
import { AccountNotifications } from "./AccountNotifications";
import { CATEGORIES, EVENT_NAMES, type Card, type Category, type Choice, type Draft, type Evaluation, type PlanEvent, type PlannerInput, type SavedPlan } from "@/lib/planner/types";
import { requestAiRecommendation } from "@/lib/planner/plan-request";
import { requestCounsel, type CounselTurn } from "@/lib/planner/counsel-client";
import { applyTarget, scheduleNeedsConfirm, validateAnswer, type CounselTarget } from "@/lib/planner/counsel-target";
import type { CounselBody } from "@/lib/plan/counsel";
import type { AiRecommendation } from "@/lib/planner/types";
import { applyAnswer } from "@/lib/planner/answers";
import { Agent, type Message } from "./Agent";
import { recommendationUpdate } from "./counsel-view";
import { Building } from "./Building";
import { DetailDialog, EventDialog, ProfileForm, SaveDialog } from "./Dialogs";
import { demoStart, OnboardingScreen, personaProfile, SignupScreen, startInput } from "./Entry";
import { Modal } from "./Modal";
import { Nav, resolveScreen, screenOf, type Screen, type Tab } from "./Nav";
import { PolicyCard, deadlineText } from "./PolicyCard";
import { Roadmap } from "./Roadmap";
import { Saved } from "./Saved";
import { PlanCompare } from "./PlanCompare";
import { matchesSearch } from "@/lib/planner/search";
import { countEligibilityTabs } from "@/lib/planner/eligibility";
import { createStarStore } from "@/lib/planner/stars";
import { Schedule } from "./Schedule";
import s from "./workspace.module.css";

async function fetchEvaluation(profile: Profile, input: PlannerInput): Promise<Evaluation> {
  const response = await fetch("/api/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, benefits: profile.benefits, plannerV2: input }) });
  const body = await response.json();
  if (!response.ok || !body.plannerV2) throw new Error(body.error ?? "일정을 반영하지 못했어요. 다시 시도해 주세요.");
  return body.plannerV2 as Evaluation;
}
const initialMessage: Message = { id: 0, role: "assistant", text: "안녕하세요! 함께 다음 갈림길을 준비해 봐요.\n\n일정을 바꾸면 신청할 수 있는 정책과 내 기한을 다시 확인해 드릴게요. 마음에 드는 정책은 카드의 ‘담기’를 눌러 주세요." };
type Filter = { category: Category | "all" };
type EligibilityTab = Card["eligibility"];
const ELIGIBILITY_TABS: { id: EligibilityTab; label: string }[] = [
  { id: "blocked", label: "수혜불가능" },
  { id: "needs_check", label: "확인 필요" },
  { id: "eligible", label: "수혜가능" },
];
type PendingSave = { target: Draft; recommendation: boolean; source?: AiRecommendation["source"] };
const cardKey = (c: Choice) => `${c.stageId}|${c.offeringId}`;
// 계정 계획은 하나가 수 MB라, 목록을 열 때 최근 계획만 본문까지 받는다
const ACCOUNT_PLAN_LOAD = 10;

export default function Planner() {
  const [session, setSession] = useState(0);
  return <PlannerSession key={session} onRestart={() => setSession(value => value + 1)} />;
}

function PlannerSession({ onRestart }: { onRestart: () => void }) {
  const [recommendation, setRecommendationState] = useState<AiRecommendation | null>(null);
  // 추천 블록을 붙일 길잡이 메시지 id. 추천이 생긴 그 자리에 한 번만 보이게 한다.
  const [recommendationAt, setRecommendationAt] = useState<number | null>(null);
  const setRecommendation = (next: AiRecommendation | null) => { setRecommendationState(next); setRecommendationAt(next ? messageId.current - 1 : null); };
  const [planLoading, setPlanLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<"message" | "recommend" | "followup">("recommend");
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
    window.location.hash = "signup";
    onRestart();
  }
  const [draft, setDraft] = useState<Draft | null>(null), [pending, setPending] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null), confirmedRef = useRef<Draft | null>(null);
  const [history, setHistory] = useState<PlanEvent[][]>([]), historyRef = useRef<PlanEvent[][]>([]);
  // 화면은 주소 해시로 정한다(#signup · #onboarding · #building · #board · #saved · #roadmap · #account). 해시가 없으면 초안 유무로 정한다
  const [hash, setHash] = useState<Screen | null>(null);
  const screen = resolveScreen(hash, !!draft);
  const route = screen === "roadmap" ? "roadmap" : "select";
  const startKind = useRef<"demo" | "user">("demo");
  const [plans, setPlans] = useState<SavedPlan[]>([]), [example, setExample] = useState<SavedPlan | null>(null);
  // 로그인 상태. null 은 확인 중. 계정이면 계획을 서버에 저장하고, 게스트면 지금처럼 이 브라우저에 저장한다
  const [me, setMe] = useState<Me | null>(null), meRef = useRef<Me | null>(null), [localPlans, setLocalPlans] = useState<SavedPlan[]>([]);
  const [planId, setPlanId] = useState("draft"), [rechecked, setRechecked] = useState<Draft | null>(null);
  const activePlanId = useRef(planId); activePlanId.current = planId;
  const recheckedOwner = useRef(""), recheckSeq = useRef(0), pendingCommand = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const starStore = useRef<ReturnType<typeof createStarStore> | null>(null);
  const [stars, setStars] = useState<string[]>([]);
  const [filter, setFilter] = useState<Filter>({ category: "all" });
  const [eligibilityTab, setEligibilityTab] = useState<EligibilityTab>("blocked");
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
  const [legacyIds, setLegacyIds] = useState<string[]>([]), [toast, setToast] = useState<string | null>(null);
  const [legacySitePlans, setLegacySitePlans] = useState<{ sourceId: string; name: string; needsReselection: boolean }[]>([]);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null), seq = useRef(0), retry = useRef<(() => void) | null>(null);

  function announce(text: string) { setToast(text); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 4500); }
  function say(text: string, role: Message["role"] = "assistant") { const id = messageId.current++; setMessages(ms => [...ms, { id, role, text }]); }
  function navigate(next: "select" | "roadmap") {
    const target: Screen = next === "select" ? "board" : "roadmap";
    setHash(target); window.location.hash = target;
  }
  async function loadAccountPlans() {
    try {
      const repo = createServerPlanRepository(), { plans: list } = await repo.listPlans();
      // 계획 하나가 판정 결과를 포함해 수 MB라 최근 것만 본문까지 받는다
      const full = (await Promise.all(list.slice(0, ACCOUNT_PLAN_LOAD).map(p => repo.getPlan(p.planId).catch(() => null)))).filter((p): p is SavedPlan => !!p);
      setPlans(full);
      setStorageNotice(list.length > full.length ? `계정에 저장한 계획 ${list.length}개 중 최근 ${full.length}개를 불러왔어요.` : null);
    } catch { setStorageNotice("계정에 저장한 계획을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요."); }
    try { setLocalPlans(createPlanRepository(localStorage).listPlans().plans); } catch { setLocalPlans([]); }
  }
  function refreshMe(next?: () => void) {
    fetchMe().then(m => { meRef.current = m; setMe(m); if (m.mode === "account") void loadAccountPlans(); next?.(); })
      .catch(() => { const guest: Me = { mode: "guest" }; meRef.current = guest; setMe(guest); });
  }
  // 첫 화면 효과는 한 번만 돈다. 최신 함수를 ref 로 불러 의존성 없이 로그인 상태를 확인한다
  const refreshMeRef = useRef(refreshMe); refreshMeRef.current = refreshMe;
  async function logout() { await logoutAccount().catch(() => { /* 세션이 이미 없어도 로그인 화면으로 */ }); window.location.href = "/login"; }
  function savePlan(plan: SavedPlan) {
    setSaveDialog(null);
    if (meRef.current?.mode === "account") {
      void createServerPlanRepository().createPlan(plan)
        .then(saved => { setPlans(ps => [saved, ...ps.filter(p => p.planId !== saved.planId)]); announce(`‘${saved.name}’을 내 계정에 저장했어요.`); })
        .catch(e => announce(e instanceof Error ? e.message : "계정에 저장하지 못했어요."));
      return;
    }
    createPlanRepository(localStorage).createPlan(plan); loadPlans(); announce(`‘${plan.name}’을 이 브라우저에 저장했어요.`);
  }
  function importLocal(plan: SavedPlan) {
    void createServerPlanRepository().createPlan(plan)
      .then(saved => { setPlans(ps => [saved, ...ps]); setLocalPlans(ps => ps.filter(p => p.planId !== plan.planId)); announce(`‘${saved.name}’을 내 계정으로 옮겼어요. 이 브라우저의 원본은 그대로 있어요.`); })
      .catch(e => announce(e instanceof Error ? e.message : "계정으로 옮기지 못했어요."));
  }
  function loadPlans() {
    if (meRef.current?.mode === "account") { void loadAccountPlans(); return; }
    try { const result = createPlanRepository(localStorage).listPlans(); setPlans(result.plans); if (result.unreadable) setStorageNotice(`읽을 수 없는 계획 ${result.unreadable}개가 있어요. 정상 계획은 계속 열 수 있어요.`); setLegacyIds(readLegacyPolicies(localStorage)); setLegacySitePlans(readLegacySitePlans(localStorage)); }
    catch { setStorageNotice("브라우저 저장 공간을 읽을 수 없어요. 현재 초안은 계속 편집할 수 있어요."); }
  }
  useEffect(() => {
    // 주소 해시가 바뀌면 화면을 바꾸고 열린 상세는 닫는다
    const syncScreen = () => { setHash(screenOf(window.location.hash)); setDetail(null); };
    syncScreen(); window.addEventListener("hashchange", syncScreen);
    try { const result = createPlanRepository(localStorage).listPlans(); setPlans(result.plans); if (result.unreadable) setStorageNotice(`읽을 수 없는 계획 ${result.unreadable}개가 있어요.`); setLegacyIds(readLegacyPolicies(localStorage)); setLegacySitePlans(readLegacySitePlans(localStorage)); } catch { setStorageNotice("브라우저 저장 공간을 읽을 수 없어요."); }
    try { starStore.current = createStarStore(localStorage); setStars(starStore.current.list()); } catch { /* session remains usable */ }
    const searchShortcut = (event: KeyboardEvent) => { const target = event.target as HTMLElement; if (event.key === "/" && !/INPUT|TEXTAREA/.test(target.tagName) && !target.isContentEditable) { event.preventDefault(); window.location.hash = "board"; requestAnimationFrame(() => searchRef.current?.focus()); } };
    window.addEventListener("keydown", searchShortcut);
    let alive = true, restoredDraft = false;
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const restored = parseDraft(raw); restoredDraft = true;
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
    // 로그인(시연)에서 곧바로 #building 으로 들어오면 초안이 없으므로 예시로 시작한다
    if (!restoredDraft && screenOf(window.location.hash) === "building") demoStart((profile, demo) => void start(profile, demo));
    refreshMeRef.current();
    const storageListener = () => { if (meRef.current?.mode === "account") return; try { const result = createPlanRepository(localStorage).listPlans(); setPlans(result.plans); } catch { /* keep existing in-memory plans */ } };
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
    return () => { window.removeEventListener("keydown", searchShortcut); alive = false; recommendationSeq.current++; window.removeEventListener("hashchange", syncScreen); window.removeEventListener("storage", storageListener); document.removeEventListener("visibilitychange", visibility); if (toastTimer.current) clearTimeout(toastTimer.current); };
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
    const input = startInput(profile, demo, mutedKeys);
    const requestId = ++seq.current; setBusy(true); setError(null);
    try { const evaluation = await fetchEvaluation(profile, input); if (requestId !== seq.current) return; const next = createDraft(profile, input, evaluation); setDraft(next); draftRef.current = next; confirmedRef.current = next; setHistory([]); historyRef.current = []; if (demo) setExample({ ...savedSnapshot({ ...next, input: { ...input, choices: evaluation.recommendations }, evaluation: withChoices(evaluation, evaluation.recommendations) }, "예시 계획", "example"), source: "example" }); }
    catch (err) { setError(err instanceof Error ? err.message : "첫 판정에 실패했어요."); } finally { if (requestId === seq.current) setBusy(false); }
  }
  // 첫 판정을 시작하고 로딩 화면(#building)으로 간다. 판정이 끝나면 로딩 화면이 보드(#board)로 보낸다
  function begin(profile: Profile, demo: boolean, mutedKeys: string[] = []) { startKind.current = demo ? "demo" : "user"; void start(profile, demo, mutedKeys); window.location.hash = "building"; }
  // 첫 판정이 실패하면 입력 화면으로 되돌려 오류를 보여 준다
  useEffect(() => { if (screen === "building" && !busy && !draft && error) window.location.replace(startKind.current === "user" ? "#onboarding" : "#signup"); }, [screen, busy, draft, error]);
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
    if (next) { previousFilter.current = filter; previousScroll.current = boardRef.current?.scrollLeft ?? 0; setFilter({ category: "all" }); setRecommendExpanded(true); setRecommend(true); requestAnimationFrame(() => recommendRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" })); }
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
    navigate("select"); setFilter({ category: "all" }); setEligibilityTab("eligible"); setLimits(prev => ({ ...prev, [choice.stageId]: 10000 })); setFocusedStage(choice.stageId);
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
    const id = ++planSeq.current; setPlanLoading(true); setLoadingAction(action);
    const result = await requestCounsel({ draft: current, action, message, history: counselHistory.current, consent, outOfScopeStreak: outOfScope.current });
    if (id !== planSeq.current) return;
    setPlanLoading(false);
    // 이력에는 원문 대신 짧은 표시만(설계 7.1). 서버도 사용자 원문 이력은 버린다.
    if (message) remember({ role: "user", text: "자유 질문" });
    if (result.notice && result.kind !== "plan" && result.kind !== "fallback") say(result.notice);
    if (result.kind === "out_of_scope") outOfScope.current++; else if (action === "message") outOfScope.current = 0;
    if (result.status === 403) {
      if (result.reason === "consent") { setConsent(false); say("AI 상담을 쓰려면 아래에서 ‘AI 상담 사용’에 동의해 주세요. 동의 전에는 조건 기준 질문과 추천만 보여 드려요."); return; }
      // 운영 스위치가 꺼진 경우: 다시 동의를 요구하지 않고 조건 기준 추천으로 넘어간다.
      if (action === "recommend") setRecommendation({ source: "rule", summary: "", picks: current.evaluation.recommendations.map(c => ({ ...c, why: [] })), notice: "지금은 AI 상담이 꺼져 있어 조건 기준 경로를 표시해요" });
      say("지금은 AI 상담이 꺼져 있어요. 조건 기준 질문과 추천으로 안내해 드릴게요. 일정 바꾸기(“취업을 2월 19일로 옮겨줘”)와 기한 설명은 그대로 쓸 수 있어요.");
      return;
    }
    if (result.kind === "question" && result.target) { setAiQuestion(result as CounselBody & { target: CounselTarget }); badAnswers.current = 0; remember({ role: "assistant", text: `질문: ${result.text}` }); return; }
    if (result.kind === "parsed" && result.target && result.value) { await answerAi(result.target, result.value); return; }
    if (result.kind === "answer") { say(`${result.text}${result.citations?.length ? `\n근거: ${result.citations.map(c => c.label).join(" · ")}` : ""}${result.source === "ai" ? "\n(AI 정리)" : ""}`); remember({ role: "assistant", text: `답변: ${(result.text ?? "").slice(0, 120)}` }); return; }
    if (result.kind === "plan" || result.kind === "fallback") {
      // ‘추천해줘’가 아닌 대화에서는 추천 경로를 다시 띄우지 않는다(채팅마다 반복되던 문제).
      const update = recommendationUpdate(action, result.kind, !!recommendation);
      if (result.kind === "plan") say(`${result.summary}\n(AI 정리 · 판정은 카드의 코드 값 그대로예요)`); else if (update.set && result.notice) say(result.notice);
      else if (action === "message") say("지금은 AI 답변을 정리하지 못했어요. 정책 카드의 사유와 공고 원문을 확인해 주세요.");
      if (update.set) setRecommendation({ source: result.source === "ai" ? "ai" : "rule", summary: result.summary ?? "", picks: result.picks ?? [], notice: result.notice ?? null });
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
      setPlanLoading(true); setLoadingAction("recommend");
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
  const filteredCards = evaluation?.cards.filter(c => matchesSearch(c, query) && (filter.category === "all" || c.category === filter.category)) ?? [];
  const uniqueFilteredCards = [...new Map(filteredCards.map(card => [cardKey(card), card])).values()];
  const eligibilityCounts = countEligibilityTabs(uniqueFilteredCards);
  const visibleCards = (stageId: string) => uniqueFilteredCards.filter(c => c.stageId === stageId && c.eligibility === eligibilityTab);
  function toggleStar(id: string) {
    if (starStore.current) { starStore.current.toggle(id); setStars(starStore.current.list()); return; }
    setStars(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    setStorageNotice("관심 정책을 브라우저에 저장하지 못했어요. 이 탭에서는 계속 사용할 수 있어요.");
  }
  function renderCard(card: Card, surface = "board") { return <PolicyCard key={cardKey(card)} card={card} today={evaluation!.today} recommended={recommend && picks.some(c => cardKey(c) === cardKey(card))} onDetail={setDetail} onChoose={c => void choose(c)} disabled={busy || readOnly} surface={surface} starred={stars.includes(card.policyId)} onStar={() => toggleStar(card.policyId)} />; }
  // 계정과 저장 공간 : 회원가입 화면의 모달과 #account 탭이 같은 내용을 쓴다 (탭 내용은 Task 4 에서 시안 모양으로)
  const accountPanel = (inline: boolean): ReactNode => <>{me?.mode === "account" ? <><p><strong>{me.displayName}</strong> · 내 계정에 저장 <button className={s.textButton} onClick={() => void logout()}>로그아웃</button></p><p className={s.emptyHint}>로그인하면 다른 기기에서도 같은 계획을 열 수 있어요.{me.durable ? "" : " 지금 서버는 시연용이라 재시작하면 저장한 내용이 사라질 수 있어요."}</p>{localPlans.length > 0 && <div className={s.checkNote}><strong>이 브라우저에만 있는 계획 {localPlans.length}개</strong>{localPlans.map(p => <p key={p.planId}>{p.name} · {p.input.choices.length}개 <button className={s.textButton} onClick={() => importLocal(p)}>계정으로 옮기기</button></p>)}</div>}</> : <><p><strong>{draft?.input.demoId ? "시연 인물" : "게스트"}</strong> · 이 브라우저에 저장 <a href="/login">로그인</a></p><p className={s.emptyHint}>계획은 현재 기기의 이 브라우저에서만 열 수 있어요. 로그인하면 내 계정에 저장할 수 있어요.</p></>}{storageNotice && <p className={s.warningText}>{storageNotice}</p>}<ul className={s.saveItems}>{plans.map(p => <li key={p.planId}><button className={s.textButton} onClick={() => { if (!draft) { const seed = createDraft(p.profileSnapshot, p.input, p.savedEvaluation); setDraft(seed); draftRef.current = seed; confirmedRef.current = seed; } setPlanId(p.planId); setRechecked(null); navigate("roadmap"); setAccount(false); }}>{p.name} · {p.input.choices.length}개<small>{new Date(p.createdAt).toLocaleString("ko-KR")}</small></button></li>)}</ul>{!plans.length && <p className={s.emptyHint}>저장한 계획이 없어요.</p>}{legacySitePlans.length > 0 && <div className={s.checkNote}><strong>이전 버전에서 저장한 계획</strong>{legacySitePlans.map(p => <p key={p.sourceId}>{p.name} · 회차·시점 다시 선택</p>)}<p>원본은 보존했어요. 현재 보드에서 정책과 시점을 골라 새 계획으로 저장해 주세요.</p></div>}{legacyIds.length > 0 && <div className={s.checkNote}><strong>이전에 담은 정책 {legacyIds.length}개</strong><p>예전 목록에는 회차와 시점이 없어 자동으로 옮기지 않았어요. 보드에서 다시 골라 주세요.</p>{legacyIds.map(id => <p key={id}>{draft?.evaluation.cards.find(c => c.policyId === id)?.title ?? id} · 회차·시점 재선택</p>)}</div>}<div className={s.dialogActions}>{draft && <button className={s.primaryButton} onClick={() => { setAccount(false); setEditProfile(true); }}>내 정보 편집</button>}{draft && <button className={s.outlineButton} disabled={busy} onClick={restart}>처음으로</button>}{!inline && <button className={s.outlineButton} onClick={() => setAccount(false)}>닫기</button>}</div></>;
  const showDialogs = (): ReactNode => <>
    {account && <Modal title="내 계정과 저장 공간" onClose={() => setAccount(false)}>{accountPanel(false)}</Modal>}
    {editProfile && draft && <Modal title="내 정보 편집" onClose={() => setEditProfile(false)}><ProfileForm mutedKeys={draft.input.mutedKeys} initial={draft.profileSnapshot} submitLabel="현재 초안에 반영" onSave={(profile, unknownKeys) => { void mutate({ mutedKeys: [...new Set([...draft.input.mutedKeys.filter(k => !["status", "participation"].includes(k)), ...unknownKeys])] }, profile); setEditProfile(false); }} /></Modal>}
    {chipMenu && draft && <Modal title="이 계획의 조건" onClose={() => setChipMenu(null)}><p>조건을 끄면 해당 판단은 ‘확인 필요’로 남고 추천에서 제외될 수 있어요.</p>{chipMenu === "interest" && <label className={s.form}>관심 분야<select className={s.picker} value={draft.input.preferredCategory} onChange={e => { void mutate({ preferredCategory: e.target.value as Category | "all" }); setChipMenu(null); }}><option value="all">전체 분야</option>{Object.entries(CATEGORIES).map(([key, cat]) => <option key={key} value={key}>{cat.label}</option>)}</select></label>}<div className={s.dialogActions}><button className={s.outlineButton} onClick={() => { void mutate({ mutedKeys: draft.input.mutedKeys.includes(chipMenu) ? draft.input.mutedKeys.filter(k => k !== chipMenu) : [...draft.input.mutedKeys, chipMenu] }); setChipMenu(null); }}>{draft.input.mutedKeys.includes(chipMenu) ? "다시 켜기" : "이 계획에서 잠시 끄기"}</button><button className={s.primaryButton} onClick={() => { setChipMenu(null); setEditProfile(true); }}>수정하기</button></div></Modal>}
    {eventDialog && draft && <EventDialog event={eventDialog === "new" ? null : eventDialog} events={draft.input.events ?? []} today={draft.evaluation.today} onClose={() => setEventDialog(null)} onApply={events => void updateEvents(events)} />}
    {gridStage && evaluation && <Modal title={`${stageLabel(gridStage)} · 정책 ${visibleCards(gridStage).length}개 전체 보기`} wide onClose={() => setGridStage(null)}><p className={s.emptyHint}>보드와 같은 필터·기한 순서로 보여드려요.</p><div className={s.dialogGrid}>{visibleCards(gridStage).map(c => renderCard(c, "grid"))}</div>{visibleCards(gridStage).length === 0 && <p className={s.emptyState}>현재 필터에 해당하는 정책이 없어요.</p>}</Modal>}
    {detailCard && evaluation && <DetailDialog card={detailCard} today={evaluation.today} stageLabel={stageLabel(detailCard.stageId)} busy={busy} readOnly={readOnly} onClose={() => setDetail(null)} onChoose={c => void choose(c)} />}
    {compareCard && draft && <Modal title={compareCard.conflicts.length ? "정책 비교·교체" : "담은 시점 변경"} onClose={() => setCompare(null)}><p className={s.emptyHint}>확인하기 전에는 현재 초안이 바뀌지 않아요.</p><div className={s.compareGrid}><div className={s.compareItem}><h3>현재 내 계획</h3>{draft.input.choices.filter(c => compareCard.conflicts.includes(c.offeringId) || c.offeringId === compareCard.offeringId).map(c => { const item = draft.evaluation.cards.find(p => cardKey(p) === cardKey(c)); return <div key={c.offeringId}><strong>{item?.title ?? c.offeringId}</strong><p>{item?.support}</p><p>{item && deadlineText(item, draft.evaluation.today)}</p><p>{stageLabel(c.stageId)} · 공고 마감 {dateLabel(item?.official.end ?? null)}</p></div>; })}</div><div className={s.compareItem}><h3>새로 담을 정책</h3><strong>{compareCard.title}</strong><p>{compareCard.support}</p><p>{deadlineText(compareCard, draft.evaluation.today)}</p><p>{stageLabel(compareCard.stageId)} · 공고 마감 {dateLabel(compareCard.official.end)}</p></div></div>{compareCard.reasons.map((r, i) => <p key={i} className={s.warningText}>{r.message}</p>)}{compareCard.evidence.filter(e => compareCard.reasons.some(r => r.evidenceId === e.evidenceId)).map(e => <blockquote key={e.evidenceId} className={s.evidence}>{e.quote}</blockquote>)}<div className={s.dialogActions}><button className={s.outlineButton} onClick={() => setCompare(null)}>취소</button><button className={s.primaryButton} disabled={busy || (compareCard.availability === "blocked" && !compareCard.canReplace)} onClick={() => { const next = draft.input.choices.filter(c => c.offeringId !== compareCard.offeringId && !compareCard.conflicts.includes(c.offeringId)); void mutate({ choices: [...next, { offeringId: compareCard.offeringId, stageId: compareCard.stageId }] }); setCompare(null); }}>{compareCard.conflicts.length ? "기존 정책 대신 이 정책 담기" : "이 시점으로 옮기기"}</button></div></Modal>}
    {saveDialog && draft && <SaveDialog target={saveDialog.target} manual={draft} recommendation={saveDialog.recommendation} account={me?.mode === "account"} onClose={() => setSaveDialog(null)} onSave={name => { const plan = savedSnapshot(saveDialog.target, name, saveDialog.recommendation ? "recommendation" : "manual"); if (saveDialog.source) plan.recommendationSource = saveDialog.source; savePlan(plan); }} />}
    {copyPlan && <Modal title="새 복사본으로 편집할까요?" onClose={() => setCopyPlan(null)}><p>현재 초안에 저장하지 않은 변경이 있을 수 있어요. 복사본을 열면 현재 초안 자리를 새 복사본으로 바꿉니다. 저장된 원본은 유지돼요.</p><div className={s.dialogActions}><button className={s.outlineButton} onClick={() => setCopyPlan(null)}>현재 초안 계속</button><button className={s.primaryButton} disabled={busy} onClick={() => void openCopy(copyPlan)}>복사본 열기</button></div></Modal>}
  </>;

  // 입력 화면 3개(회원가입 · 내 정보 · 로딩). 초안이 없으면 어떤 해시여도 회원가입으로 온다
  const frame = (body: ReactNode) => <div className={s.app}>{body}{showDialogs()}</div>;
  if (screen === "building") return frame(<Building ready={!!draft && !busy} onDone={() => window.location.replace("#board")} />);
  if (screen === "onboarding") return frame(<OnboardingScreen onSave={(profile, muted) => begin(profile, false, muted)} onBack={() => { window.location.hash = "signup"; }} error={error} />);
  if (!draft || !evaluation || !view || screen === "signup") return frame(<SignupScreen me={me} onNext={() => { window.location.hash = "onboarding"; }} onDemo={() => demoStart(begin)} onSaved={() => setAccount(true)} onSignedUp={() => refreshMe(() => { window.location.hash = "onboarding"; })} onLogout={() => void logout()} savedCount={plans.length} error={error} />);
  const tab = screen as Tab;

  return <div className={`${s.app} ${agentOpen ? s.agentDrawer : ""} ${agentHidden ? s.agentHidden : ""}`}><div className={`${s.shell} ${tab === "account" ? s.noagent : ""}`}><Nav active={tab} />
    <main className={s.workspace} aria-busy={busy}>{tab === "saved" ? <><header className={s.pageHeader}><div><p className={s.eyebrow}>관심 정책</p><h1>별표한 정책을 모아 봐요</h1></div></header><Saved stars={stars} evaluation={evaluation} onToggle={toggleStar} onDetail={setDetail} onChoose={c => void choose(c)} busy={busy || readOnly} /></> : tab === "account" ? <><header className={s.pageHeader}><div><p className={s.eyebrow}>계정</p><h1>내 정보와 저장 위치</h1></div></header><div className={s.accountGrid}><section className={s.panel}><h2>계정 상태</h2><p>{me?.mode === "account" ? `${me.displayName} · 저장 방식 · 내 계정${me.durable ? "" : " (시연용 서버)"}` : "게스트 · 저장 방식 · 이 브라우저"}</p><p>저장한 계획 {plans.length}개</p><p>{draft.input.demoId ? "예시 프로필" : "내 프로필"}</p></section><section className={s.panel}><h2>내 정보</h2><p>{regionLabel(draft.profileSnapshot.sigungu)} · {draft.profileSnapshot.birthYm}</p><button className={s.primaryButton} onClick={() => { window.location.hash = "onboarding"; }}>내 정보 수정</button>{me?.mode === "account" ? <button className={s.textButton} onClick={() => void logout()}>로그아웃</button> : <a href="/login">로그인</a>}</section>{me?.mode === "account" && <AccountNotifications />}</div></> : <><header className={s.pageHeader}><div><p className={s.eyebrow}>나의 다음을 준비하는 공간</p><h1>{route === "select" ? "정책 선택하기" : "내 정책 로드맵"}</h1><p className={s.subtitle}>{evaluation.demo && <span className={s.demoBadge}>시연 인물</span>}{route === "select" ? "내 일정에 맞는 정책을 살펴보고, 나만의 계획에 담아보세요." : "내가 고른 정책을 하나의 시간 위에서 확인해 보세요."}</p><p className={s.emptyHint}>기준일 {evaluation.today} · 공고 데이터 기준 {evaluation.asOf}</p></div><div className={s.inlineActions}><button className={`${s.outlineButton} ${s.agentOpen}`} onClick={() => { setAgentOpen(true); setAgentHidden(false); }}>길잡이 열기</button><button className={s.textButton} onClick={() => { setAgentHidden(v => !v); setAgentOpen(v => !v); }} aria-label="길잡이 패널 표시 전환">☷</button></div></header>
    {route === "roadmap" && <div className={s.roadmapHeader}><label className={s.srOnly} htmlFor="plan-picker">로드맵 계획 선택</label><select id="plan-picker" className={s.picker} value={planId} onChange={e => { setPlanId(e.target.value); activePlanId.current = e.target.value; setRechecked(null); setDetail(null); setError(null); retry.current = null; }}><option value="draft">편집 중인 내 계획 · {draft.input.choices.length}개</option>{plans.length > 0 && <optgroup label="이 브라우저에 저장한 계획">{plans.map(p => <option key={p.planId} value={p.planId}>{p.name} · {p.input.choices.length}개 · {new Date(p.createdAt).toLocaleString("ko-KR")}</option>)}</optgroup>}{example && <option value="example">예시 계획</option>}</select>{route === "roadmap" && <button className={s.outlineButton} onClick={() => window.print()}>인쇄 · PDF</button>}{readOnly && selectedSaved && <><button className={s.outlineButton} disabled={busy} onClick={() => setCopyPlan(selectedSaved)}>복사해 편집</button><button className={s.textButton} disabled={busy} onClick={() => void reevaluate()}>오늘 기준으로 다시 보기</button></>}</div>}
    {route === "roadmap" && <PlanCompare plans={plans} />}{readOnly && <div className={s.banner}><span>{rechecked ? `오늘 기준 재판정 · 저장 당시 ${selectedSaved?.savedEvaluation.today}` : `저장 당시 기준 ${fullDate(evaluation.today)}`} · {selectedSaved?.name}</span>{rechecked && <button className={s.outlineButton} onClick={() => setSaveDialog({ target: rechecked, recommendation: false })}>새 계획으로 저장</button>}</div>}
    <div className={s.profileChips} aria-label="이 계획의 프로필 조건">{[{ key: "residence", label: `${regionLabel(view.profileSnapshot.sigungu)} 거주` }, { key: "status", label: view.profileSnapshot.currentStatus.includes("in_training") ? "교육 수강 중" : view.profileSnapshot.currentStatus.includes("employed") ? "재직 중" : view.profileSnapshot.currentStatus.includes("unemployed") ? "구직 중" : "현재 상태 확인" }, { key: "participation", label: view.profileSnapshot.benefits?.length ? `수혜 내역 ${view.profileSnapshot.benefits.length}개` : view.profileSnapshot.participating.length ? `수혜 중 ${view.profileSnapshot.participating.length}개` : "수혜 내역" }, { key: "interest", label: `관심: ${view.input.preferredCategory === "all" ? "전체 분야" : CATEGORIES[view.input.preferredCategory].label}` }].map(chip => <button key={chip.key} disabled={readOnly || busy} className={`${s.profileChip} ${view.input.mutedKeys.includes(chip.key) ? s.mutedChip : ""}`} onClick={() => setChipMenu(chip.key)}>{chip.label}{view.input.mutedKeys.includes(chip.key) ? " · 꺼짐" : ""}</button>)}</div>
    {busy && <div className={s.banner} role="status">일정 반영 중… 직전 판정 결과를 표시합니다.</div>}{error && <div className={s.error} role="alert">{error}{retry.current && <button className={s.textButton} onClick={() => retry.current?.()}>다시 시도</button>}</div>}{storageNotice && <p className={s.warningText}>{storageNotice}</p>}
    <Schedule evaluation={evaluation} events={(pending && !readOnly ? pending : view).input.events ?? []} onEdit={setEventDialog} onAdd={() => setEventDialog("new")} onUndo={undo} canUndo={history.length > 0} readOnly={readOnly} busy={busy} focusedStage={focusedStage} onFocus={focusStage} />
    <section className={s.draftSummary} aria-label="내 계획"><div className={s.sectionHeader}><h2>내 계획 <span>{view.input.choices.length}</span></h2>{!readOnly && <button className={s.primaryButton} disabled={busy || !view.input.choices.length} onClick={() => void previewSave(false)}>계획 저장</button>}</div>{view.input.choices.length === 0 ? <p className={s.emptyHint}>카드에서 담기를 눌러 시작하세요. 내 계획이 비어 있어도 모든 정책을 둘러볼 수 있어요.</p> : <div className={s.choiceList}>{view.input.choices.map(choice => { const card = evaluation.cards.find(c => cardKey(c) === cardKey(choice)); const warning = evaluation.choiceWarnings.find(w => w.offeringId === choice.offeringId); return <div key={choice.offeringId} className={`${s.choiceChip} ${warning ? s.choiceWarning : ""}`}><div><button className={s.textButton} onClick={() => card ? setDetail(choice) : announce("저장한 회차나 시점을 찾을 수 없어요. 다시 선택해 주세요.")}>{card?.title ?? warning?.title ?? choice.offeringId}</button><small>{stageLabel(choice.stageId)}{card?.personalWindow?.end ? ` · ${dateLabel(card.personalWindow.end)}` : ""}</small>{warning && <p className={s.warningText}>{warning.message}</p>}</div>{!readOnly && <button className={s.iconButton} disabled={busy} aria-label={`${card?.title ?? choice.offeringId} 내 계획에서 빼기`} onClick={() => void mutate({ choices: draft.input.choices.filter(c => c.offeringId !== choice.offeringId) })}>×</button>}</div>; })}</div>}{evaluation.choiceWarnings.length > 0 && <p className={s.warningText}>확인할 정책 {evaluation.choiceWarnings.length}개 · 선택한 정책은 자동으로 삭제하지 않아요.</p>}</section>
    {route === "select" ? <><div className={s.toolbar}><label className={s.srOnly} htmlFor="policy-search">정책 검색</label><input ref={searchRef} id="policy-search" className={s.search} type="search" placeholder="정책 이름 검색  ( / )" value={query} onChange={e => setQuery(e.target.value)} /><div className={s.categoryFilters} role="group" aria-label="분야 필터">{(["all", ...Object.keys(CATEGORIES)] as (Category | "all")[]).map(cat => <button key={cat} className={`${s.filter} ${filter.category === cat ? s.filterActive : ""}`} aria-pressed={filter.category === cat} onClick={() => setFilter({ ...filter, category: cat })}>{cat === "all" ? "전체" : CATEGORIES[cat].label}</button>)}</div><div className={s.inlineActions}><button className={recommend ? s.primaryButton : s.outlineButton} aria-pressed={recommend} onClick={() => toggleRecommendation()}>✦ {recommend ? "추천 경로 닫기" : "AI 추천 경로 보기"}</button></div></div><div className={s.categoryFilters} role="tablist" aria-label="수혜 가능성 분류">{ELIGIBILITY_TABS.map((item, index) => <button key={item.id} id={`eligibility-tab-${item.id}`} role="tab" aria-selected={eligibilityTab === item.id} aria-controls="eligibility-policy-board" tabIndex={eligibilityTab === item.id ? 0 : -1} className={`${s.filter} ${eligibilityTab === item.id ? s.filterActive : ""}`} onKeyDown={event => { if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? ELIGIBILITY_TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : ELIGIBILITY_TABS.length - 1)) % ELIGIBILITY_TABS.length; setEligibilityTab(ELIGIBILITY_TABS[next].id); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus(); }} onClick={() => setEligibilityTab(item.id)}>{item.label} <span aria-label={`${eligibilityCounts[item.id]}개`}>{eligibilityCounts[item.id]}</span></button>)}</div><p className={s.emptyHint}>자격 분류와 공고 검증 배지는 별도로 표시해요. 탭 개수는 검색·분야 필터가 적용된 전체 회차·시점 수예요.</p>
    {recommend && <section ref={recommendRef} className={s.recommendSummary} aria-label={recommendationLabel + " 경로"}><div className={s.sectionHeader}><button className={s.textButton} aria-expanded={recommendExpanded} onClick={() => setRecommendExpanded(v => !v)}><strong>{recommendationLabel} · {picks.length}개</strong> {recommendExpanded ? "접기" : "경로 보기"}</button><button className={s.primaryButton} disabled={busy || !picks.length} onClick={() => void previewSave(true)}>새 계획으로 저장</button></div><p className={s.emptyHint}>{activeRecommendation?.notice ?? activeRecommendation?.summary ?? "현재 조건으로 확인한 경로예요."}</p>{recommendExpanded && <div className={s.recommendLinks}>{picks.map(choice => { const card = evaluation.cards.find(c => cardKey(c) === cardKey(choice)); if (!card) return null; const hidden = eligibilityTab !== card.eligibility || (filter.category !== "all" && filter.category !== card.category); return <button key={cardKey(choice)} className={s.recommendLink} onClick={() => { if (hidden) { setDetail(choice); announce("현재 탭이나 분야 필터에서 숨김 상태예요. 상세에서 확인하거나 분류·분야를 바꿔 주세요."); } else locate(choice); }}>{card.title}<small>{stageLabel(choice.stageId)} · {hidden ? "현재 필터에서 숨김" : card.conflicts.length ? "별도 계획에서 가능" : deadlineText(card, evaluation.today)}</small></button>; })}{!picks.length && <p>현재 확인된 조건으로 추천할 수 있는 정책이 없어요. 확인 필요 정책은 직접 살펴보고 담을 수 있어요.</p>}</div>}</section>}
    <div className={s.boardScroll} id="eligibility-policy-board" role="tabpanel" aria-labelledby={`eligibility-tab-${eligibilityTab}`} ref={boardRef} aria-label="시점별 정책 보드"><div className={s.board}>{evaluation.stages.map(stage => { const cards = visibleCards(stage.stageId); const limit = limits[stage.stageId] ?? 4; return <section key={stage.stageId} id={`stage-${stage.stageId}`} className={`${s.column} ${focusedStage === stage.stageId ? s.focusedColumn : ""}`}><button className={s.columnHeader} aria-label={`${stage.label}, 정책 ${cards.length}개 전체 보기`} onClick={() => setGridStage(stage.stageId)}><h2>{stage.label}<span>{cards.length}</span></h2><p>{dateLabel(stage.start)} {stage.endExclusive ? `~ ${dateLabel(addDays(stage.endExclusive, -1))}` : "이후"} <span aria-hidden="true">⊞</span></p></button><div className={s.columnCards}>{cards.slice(0, limit).map(card => renderCard(card))}</div>{cards.length === 0 && <div className={s.emptyState}>이 시점과 선택한 분류에 해당하는 정책이 없어요.<button className={s.textButton} onClick={() => { setQuery(""); setFilter({ category: "all" }); setEligibilityTab(ELIGIBILITY_TABS.find(item => eligibilityCounts[item.id] > 0)?.id ?? "needs_check"); }}>필터 해제</button></div>}{cards.length > limit && <button data-stage={stage.stageId} className={s.moreButton} onClick={() => setLimits(prev => ({ ...prev, [stage.stageId]: limit + 4 }))}>정책 더 보기 · {cards.length - limit}개 남음</button>}<p className={s.columnFooter}>{Math.min(limit, cards.length)} / {cards.length}개 표시</p></section>; })}</div></div></> : <Roadmap plan={view} onDetail={setDetail} />}
    <p className={s.notice}>기준일 {fullDate(evaluation.today)} · 공고 데이터 기준 {evaluation.asOf} · 현재 공고와 입력한 예정일을 기준으로 계산한 결과입니다. 신청 전 공식 공고를 확인해 주세요.</p>
    </>}</main>{tab !== "account" && <Agent today={evaluation.today} recommendation={activeRecommendation} recommendationAt={recommendationAt} cards={evaluation.cards} planLoading={planLoading && !readOnly} loadingAction={loadingAction} aiQuestion={readOnly ? null : aiQuestion} onAiAnswer={value => { if (aiQuestion) void answerAi(aiQuestion.target, value); }} onAiSkip={() => setAiQuestion(null)}
      consentNeeded={!readOnly && !!draft && !draft.input.demoId && !consent} onConsent={() => { setConsent(true); say("AI 상담을 켰어요. 패널의 ‘AI 상담 끄기’로 언제든 끌 수 있어요."); }}
      consentOn={!readOnly && !!draft && !draft.input.demoId && consent} onConsentOff={() => { setConsent(false); setAiQuestion(null); counselHistory.current = []; say("AI 상담을 껐어요. 조건 기준 질문과 추천만 보여 드려요."); }}
      questions={readOnly ? [] : evaluation.questions} onAnswer={(question, answer) => {
      const profile = draft.profileSnapshot;
      void mutate({ mutedKeys: draft.input.mutedKeys.filter(key => key !== "participation") }, {
        ...profile, benefits: applyAnswer(profile.benefits ?? [], question, answer),
      });
    }} messages={messages} onSend={send} busy={busy} onClose={() => { setAgentOpen(false); setAgentHidden(true); }} />}</div>{showDialogs()}{toast && <div className={s.toast} role="status">{toast}</div>}</div>;
}
