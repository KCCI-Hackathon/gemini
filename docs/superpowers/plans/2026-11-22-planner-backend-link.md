# 메인 화면 백엔드 · 에이전트 연결 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 Planner 화면(`/`)의 카드 · 비교 · 에이전트 패널이 백엔드 자격 판정, 중복수혜 판정, AI 계획 결과를 그대로 보여 준다.

**Architecture:** 백엔드 판정 함수(`judgePolicy`, `evaluateRules`, `/api/plan`)는 고치지 않는다. 새 화면의 서버 판정(`lib/planner/catalog.ts`)이 백엔드 결과를 카드 형식으로 옮기는 변환 모듈(`lib/planner/overlap-bridge.ts`)을 거친다. 화면은 개인 수혜 상태를 보내고, 질문 · AI 추천을 에이전트 패널에서 다룬다.

**Tech Stack:** Next.js App Router · React · TypeScript · zod · vitest

**Spec:** `docs/superpowers/specs/2026-11-22-planner-backend-link-design.md` (승인 11-22)

## Global Constraints

- 고치지 않는 파일 : `lib/judge/overlap.ts`, `lib/judge/index.ts`, `lib/judge/personal.ts`, `lib/data/overlap.ts`, `lib/plan/*`, `scripts/overlap/*`, `data/overlap/*`, `data/verified/*`
- 새 화면을 만들지 않는다. 기존 프로필 폼 · 카드 · 상세 · 비교 · 교체 · 에이전트 패널 자리를 쓴다.
- 카드 판정은 백엔드 `personal` 값을 따른다 : `eligible` → `eligible`, `code_met_unreviewed` → `needs_check`, `needs_check` → `needs_check`, `ineligible` → `blocked`
- `code_met_unreviewed` 사유 문구는 정확히 `일부 조건 충족 · 공고 확인 필요`
- 수혜 목록에 없는 정책은 "모름". 변환 코드에서 백엔드 결과를 거르지 않는다.
- 부분 제한(전체 차단이 아닌 `applies`)은 판정을 낮추지 않는다.
- "안 받아요" 답은 `{ policyId, status: "eligible_unpaid" }` 로 저장한다.
- 실사용자 자유 입력은 외부 AI 로 보내지 않는다. AI 계획은 시연 인물일 때만 부른다.
- 기준 테스트 시각 : `new Date("2026-11-22T12:00:00+09:00")`, 시연 인물 : `PERSONA_A` (`lib/judge/personas.ts`), 수료 예정일 `2026-12-19`
- 테스트 명령 : `npx vitest run <파일> --testTimeout=60000`, 전체 : `npx vitest run --maxWorkers=4 --testTimeout=60000`
- 커밋은 Claude Code 가 한다. 구현자는 커밋하지 않는다.

## Review Focus

- 같은 정책에 전체 차단과 부분 제한이 함께 걸림 → 전체 차단이 이긴다 (`blocked`), 부분 제한 사유도 상세에 남는다 → Task 2 테스트 `full block wins over partial`
- 담은 정책이 상시 모집이라 신청 구간 끝이 없음 → 담은 정책끼리 충돌은 `needs_check` + 질문 없음, 막지 않는다 → Task 3 테스트 `open-ended window is not blocked`
- AI 응답이 오기 전에 일정을 바꿈 → 늦은 응답은 버리고 AI 추천을 지운다 → Task 6 테스트 `stale plan response is dropped`
- 시연 중 생년 · 지역을 바꿔 시연 인물과 달라짐 → AI 버튼 대신 규칙 추천, `/api/plan` 을 부르지 않는다 → Task 6 테스트 `non-persona never calls plan api`
- 저장해 둔 옛 계획(수혜 상태 없음)을 다시 엶 → 스키마 오류 없이 열리고 수혜는 "모름" → Task 4 테스트 `saved plan without benefits still loads`

---

### Task 1: 카드 판정을 백엔드 자격 판정으로 바꾸고 검증 배지 분리

**Files:**
- Modify: `lib/planner/types.ts` (`Card` 에 `verifyLabel: string | null` 추가)
- Modify: `lib/planner/schema.ts` (`CardSchema` 에 `verifyLabel: z.string().nullable()`)
- Modify: `lib/planner/catalog.ts` (`baseEvaluator`, 카드 생성부)
- Modify: `lib/planner/evaluate.ts` (`fixtureVerdict` 경로는 `verifyLabel: null`)
- Modify: `app/workspace/PolicyCard.tsx`, `app/workspace/Dialogs.tsx` (`DetailDialog`) — 배지 표시
- Test: `tests/planner/backend-verdict.test.ts`

**Interfaces:**
- Produces: `Card.verifyLabel: string | null` — 백엔드 `policyNotice(p, v, date).verifyLabel` (`lib/route/roadmap.ts`). 가상 카탈로그는 `null`.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/planner/backend-verdict.test.ts`

```ts
const now = new Date("2026-11-22T12:00:00+09:00");
const input = { revision: 0, events: [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }], choices: [], mutedKeys: [], preferredCategory: "all" } as const;
const ev = evaluateRequest({ ...PERSONA_A, events: [] }, structuredClone(input) as PlannerInput, now);
test("backend eligible policy is eligible with its verify badge", () => {
  const card = ev.cards.find(c => c.title === "청년 자격증 응시료 지원(인천)" && c.stageId === "current")!;
  expect(card.availability).toBe("eligible");
  expect(card.verifyLabel).toBe("근거 확인 대기");
  expect(card.reasons.map(r => r.code)).not.toContain("UNREVIEWED");
});
test("code_met_unreviewed keeps the spec wording", () => {
  const card = ev.cards.find(c => c.availability === "needs_check" && c.reasons.some(r => r.message === "일부 조건 충족 · 공고 확인 필요"));
  expect(card).toBeDefined();
});
test("at least one rule recommendation exists for the persona", () => {
  expect(ev.recommendations.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/planner/backend-verdict.test.ts --testTimeout=60000` → FAIL (`availability` 가 `needs_check`)

- [ ] **Step 3: 구현**
  - `baseEvaluator` : `availability` 를 Global Constraints 의 대응표로 정한다. `o.reviewed` 조건을 판정에서 뺀다.
  - `UNREVIEWED` 사유는 `axes.personal.value === "code_met_unreviewed"` 일 때만, 문구 `일부 조건 충족 · 공고 확인 필요`.
  - 기존 `axes.restriction.value === "applies"` → `RESTRICTION_REVIEW` 줄은 이 Task 에서 그대로 둔다 (Task 2 가 바꾼다).
  - `deadlineKind` 의 `!o.reviewed` 규칙은 그대로 둔다.
  - 카드의 `verifyLabel` 은 offering 단위로 한 번 계산해 모든 시점 카드에 같은 값.
  - 화면 : 카드 제목 옆 작은 배지, 상세의 "공식 근거와 검토 상태" 절 첫 줄. `verifyLabel` 이 `null` 이면 표시 안 함.

- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS. 그리고 `npx vitest run tests/planner --testTimeout=60000` → 기존 planner 테스트 모두 PASS

---

### Task 2: 실제 수혜 충돌 · 부분 제한 · 질문을 백엔드 결과로

**Files:**
- Create: `lib/planner/overlap-bridge.ts`
- Modify: `lib/planner/types.ts` (`Evaluation.questions`, `BenefitQuestion` 타입)
- Modify: `lib/planner/schema.ts` (`EvaluationSchema.questions`)
- Modify: `lib/planner/catalog.ts` (`baseEvaluator` 가 bridge 사용, `RESTRICTION_REVIEW` 줄 제거)
- Modify: `lib/planner/evaluate.ts` (`BaseVerdict` 에 `evidence?`, `questions?` 추가 · `applyConflicts` 의 `participating` 비교를 `options.backendOverlap` 일 때 건너뜀 · `evaluatePlanner` 가 `questions` 를 모아 반환)
- Test: `tests/planner/overlap-bridge.test.ts`

**Interfaces:**
- Consumes: `Restriction`, `blocksParticipation` (`lib/judge/overlap.ts`), `loadOverlap` (`lib/data/overlap.ts`)
- Produces:
  - `type AnswerKind = "receiving" | "selected" | "ended_date"`
  - `type BenefitQuestion = { policyId: string; sourcePolicyId: string; sourceName: string; ruleId: string; question: string; answerKind: AnswerKind }`
  - `function restrictionVerdict(list: Restriction[], targetPolicyId: string, kind: "current" | "planned"): { availability: "blocked" | "needs_check" | null; reasons: Reason[]; evidence: Evidence[]; questions: BenefitQuestion[] }`
  - `Evaluation.questions: BenefitQuestion[]` (정책 · 질문 중복 없이)
  - `evaluatePlanner(..., options?: { backendOverlap?: boolean; draftConflict?: DraftConflictEvaluator })` — 마지막 인자로 추가 (Task 3 이 `draftConflict` 를 씀)

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/planner/overlap-bridge.test.ts`. 실데이터, `now`, `input` 은 Task 1 과 같다.

```ts
const run = (benefits?: Benefit[]) => evaluateRequest({ ...PERSONA_A, events: [], ...(benefits ? { benefits } : {}) }, structuredClone(input) as PlannerInput, now);
const card = (ev: Evaluation, policyId: string, stageId = "ev-course") => ev.cards.find(c => c.policyId === policyId && c.stageId === stageId)!;
const CHALLENGE = "20250122005400110346", NATIONAL = "20260710005400113256", JOBSEEK = "20250122005400110369";
const RENT_SRC = "20250617005400110952", RENT_YEONSU = "20260406005400212400"; // 승인 규칙 personal_payment_block · restricted_item "해당 월 청년월세 지급액"
test("I1 receiving national program blocks challenge support", () => {
  const c = card(run([{ policyId: NATIONAL, status: "receiving" }]), CHALLENGE);
  expect(c.availability).toBe("blocked");
  expect(c.reasons[0]).toMatchObject({ code: "PARTICIPATION_CONFLICT" });
  expect(c.reasons[0].message).toContain("국민취업지원제도");
});
test("I2 partial restriction does not lower the verdict", () => {
  const before = card(run([{ policyId: RENT_SRC, status: "eligible_unpaid" }]), RENT_YEONSU, "current");
  const after = card(run([{ policyId: RENT_SRC, status: "receiving" }]), RENT_YEONSU, "current");
  expect(after.reasons.some(r => r.code === "PARTIAL_RESTRICTION" && r.message.includes("청년월세"))).toBe(true);
  expect(after.availability).toBe(before.availability);
});
test("I3 six months after last payment releases the block", () => {
  expect(card(run([{ policyId: JOBSEEK, status: "ended", lastPaymentDate: "2026-08-01" }]), CHALLENGE).availability).toBe("blocked");
  expect(card(run([{ policyId: JOBSEEK, status: "ended", lastPaymentDate: "2026-05-01" }]), CHALLENGE).reasons.map(r => r.code)).not.toContain("PARTICIPATION_CONFLICT");
});
test("I5 unknown benefit produces an answerable question", () => {
  const ev = run();
  expect(card(ev, CHALLENGE).availability).toBe("needs_check");
  expect(ev.questions.some(q => q.policyId === CHALLENGE && q.answerKind === "receiving")).toBe(true);
  const answered = run([{ policyId: NATIONAL, status: "eligible_unpaid" }, { policyId: JOBSEEK, status: "eligible_unpaid" }]);
  expect(answered.questions.filter(q => q.policyId === CHALLENGE && [NATIONAL, JOBSEEK].includes(q.sourcePolicyId))).toEqual([]);
});
test("full block wins over partial", () => {
  const out = restrictionVerdict([fullBlock, partial], "target", "current"); // 두 Restriction 은 테스트 안에서 직접 만든다
  expect(out.availability).toBe("blocked");
  expect(out.reasons.map(r => r.code)).toEqual(expect.arrayContaining(["PARTICIPATION_CONFLICT", "PARTIAL_RESTRICTION"]));
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run tests/planner/overlap-bridge.test.ts --testTimeout=60000` → FAIL (`restrictionVerdict` 없음)

- [ ] **Step 3: `restrictionVerdict` 구현** — 대응표 (설계 6.3):

| 입력 | 결과 |
|---|---|
| `applies` 이고 `blocksParticipation(r)` | `availability: "blocked"`, 사유 `{ code: kind === "current" ? "PARTICIPATION_CONFLICT" : "DRAFT_CONFLICT", message: \`${kind === "current" ? "현재 수혜 중인" : "계획에 담은"} ${r.sourceName}과 중복 불가\` }` |
| `applies` 이고 전체 차단 아님 | 판정 그대로(`null`), 사유 `{ code: "PARTIAL_RESTRICTION", message: r.reason }` |
| `needs_info` | `restricted_item` 이 없으면 `needs_check`, 있으면 판정 그대로(`null`) — 백엔드 `judgePolicy` 와 같은 기준. 사유 `{ code: "RESTRICTION_QUESTION", message: r.question ?? r.reason }`. `r.question` 이 있고 규칙 `condition_type` 이 `receiving` · `selected` · `within_months_after_end` 이면 `questions` 에 넣고, 아니면 사유 문구를 `기관 확인 필요 · ${r.reason}` 로 |
| `not_applies` | 아무것도 없음 |

  - 근거 : `r.evidence` → `{ evidenceId: \`overlap:${r.ruleId}\`, title: \`중복 수혜 제한 · ${r.sourceName}\`, quote, url, reviewedAt: checkedAt, reviewed: true }`
  - `condition_type` 은 `loadOverlap().get(targetPolicyId)` 에서 `rule_id` 로 찾는다. `answerKind` : `receiving` → `"receiving"`, `selected` → `"selected"`, `within_months_after_end` → `"ended_date"`

- [ ] **Step 4: `catalog.ts` 연결**
  - `baseEvaluator` 에서 `axes.restriction.current_restrictions` 가 있으면 `restrictionVerdict(…, p.id, "current")` 를 적용하고 `RESTRICTION_REVIEW` 줄을 없앤다.
  - `judgePolicy` 가 전체 차단으로 이미 `ineligible` 이면 `blocked` 유지, 사유 맨 앞에 `PARTICIPATION_CONFLICT`.
  - `judgePolicy` 가 `needs_info` 때문에 붙인 "중복수혜 제한 조건 확인 필요" 사유는 bridge 사유와 겹치므로 뺀다 (판정 값은 그대로).
  - `evaluatePlanner(..., { backendOverlap: true })` 로 불러 `participating` 기반 `restrictionBetween` 비교를 건너뛴다. 가상 카탈로그 경로는 그대로.

- [ ] **Step 5: 통과 확인** — 같은 명령 → PASS, `npx vitest run tests/planner --testTimeout=60000` → 모두 PASS

---

### Task 3: 담은 정책끼리 충돌을 백엔드 `planned_conflicts` 로

**Files:**
- Modify: `lib/planner/evaluate.ts` (`applyConflicts` 가 `options.draftConflict` 사용)
- Modify: `lib/planner/catalog.ts` (`draftConflict` 구현 전달)
- Modify: `lib/planner/overlap-bridge.ts` (`plannedFor` 추가)
- Test: `tests/planner/draft-conflict.test.ts`

**Interfaces:**
- Consumes: `restrictionVerdict` (Task 2), `evaluateRules` (`lib/judge/overlap.ts`)
- Produces:
  - `type DraftConflictEvaluator = (card: Card, chosen: Card[]) => { blocked: boolean; uncertain: boolean; reasons: Reason[]; evidence: Evidence[]; conflicts: string[] }`
  - `function plannedFor(card: Card, chosen: Card[]): Benefit[]` — 담은 카드마다(카드 자신 포함) `{ policyId, status: "planned", plannedStart: stageWindow.start, plannedEnd: stageWindow.end ?? official.end }`. 끝이 둘 다 없으면 `plannedEnd` 를 넣지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/planner/draft-conflict.test.ts`. 승인 규칙 `20260406005400212410 → 20260406005400212442` (`selection_excluded`, `selected`) 를 쓴다. 공고 날짜와 무관하게 하려고 `Card` 두 장을 테스트 안에서 만든다 (`stageWindow` 2027-01-01~2027-03-31 로 겹치게).

```ts
test("I4 overlapping planned windows conflict through backend rules", () => {
  const out = backendDraftConflict(now)(dream, [welfare]);
  expect(out.blocked || out.uncertain).toBe(true);
  expect(out.reasons[0].code).toMatch(/DRAFT_CONFLICT|RESTRICTION_QUESTION/);
});
test("non-overlapping windows do not conflict", () => {
  const out = backendDraftConflict(now)(dream, [{ ...welfare, stageWindow: { start: "2027-06-01", end: "2027-06-30" } }]);
  expect(out.blocked).toBe(false);
});
test("open-ended window is not blocked", () => {
  const out = backendDraftConflict(now)(dream, [{ ...welfare, stageWindow: { start: "2027-01-01", end: null }, official: { ...welfare.official, end: null } }]);
  expect(out.blocked).toBe(false);
});
```

- [ ] **Step 2: 실행해 실패 확인** → FAIL (`backendDraftConflict` 없음)

- [ ] **Step 3: 구현** — `catalog.ts` 에 `export function backendDraftConflict(now: Date, benefits: Benefit[] = []): DraftConflictEvaluator`. 카드 정책의 승인 규칙이 없으면 `{ blocked: false, uncertain: false, … }`. 있으면 `evaluateRules(rules, benefits, plannedFor(card, chosen), now)` 의 `planned_conflicts` 를 `restrictionVerdict(…, "planned")` 로 옮기고, 전체 차단을 일으킨 `sourceId` 와 같은 정책의 담은 카드 `offeringId` 를 `conflicts` 에 넣는다.
  - `applyConflicts` : `options.draftConflict` 가 있으면 `restrictionBetween` 대신 이것을 쓰고, `canReplace` 는 지금 규칙(`originallyAllowed && !actualConflict && conflicts.length > 0`) 그대로.
  - 규칙 추천 루프도 같은 `applyConflicts` 를 쓰므로 따로 고치지 않는다.

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/planner --testTimeout=60000` → 모두 PASS

---

### Task 4: 개인 수혜 상태 입력 · 전송 · 저장 · 질문 답

**Files:**
- Create: `app/api/overlap/sources/route.ts` — `GET` → `{ sources: { policyId: string; name: string }[] }` (승인 규칙의 `source_policy_id` 중복 제거, 이름은 스냅샷, 이름순)
- Modify: `lib/planner/schema.ts` (`ProfileSnapshotSchema` 에 `benefits: BenefitsSchema.optional()`)
- Modify: `app/workspace/Dialogs.tsx` (`ProfileForm` 에 "지금 받고 있거나 받았던 정책" 칸)
- Modify: `app/workspace/Planner.tsx` (`fetchEvaluation` 이 `benefits: profile.benefits` 를 같이 보냄)
- Modify: `app/workspace/Agent.tsx` (질문 카드 · 답 버튼)
- Create: `lib/planner/answers.ts`
- Test: `tests/planner/answers.test.ts`, `tests/planner/render.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: `BenefitQuestion` (Task 2)
- Produces:
  - `type BenefitAnswer = { kind: "receiving" } | { kind: "not_receiving" } | { kind: "selected" } | { kind: "not_selected" } | { kind: "ended"; lastPaymentDate: string }`
  - `function applyAnswer(benefits: Benefit[], q: BenefitQuestion, a: BenefitAnswer): Benefit[]` — 같은 `sourcePolicyId` 행을 바꾸거나 추가. `receiving` → `status: "receiving"`, `not_receiving` · `not_selected` → `status: "eligible_unpaid"`, `selected` → `status: "selected"`, `ended` → `status: "ended", lastPaymentDate`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/planner/answers.test.ts
test("not receiving is stored as eligible_unpaid", () => {
  expect(applyAnswer([], q("receiving"), { kind: "not_receiving" })).toEqual([{ policyId: SRC, status: "eligible_unpaid" }]);
});
test("ended answer replaces an earlier receiving row", () => {
  expect(applyAnswer([{ policyId: SRC, status: "receiving" }], q("ended_date"), { kind: "ended", lastPaymentDate: "2026-08-01" })).toEqual([{ policyId: SRC, status: "ended", lastPaymentDate: "2026-08-01" }]);
});
test("saved plan without benefits still loads", () => {
  expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A }).success).toBe(true);
  expect(ProfileSnapshotSchema.safeParse({ ...PERSONA_A, benefits: [{ policyId: SRC, status: "receiving" }] }).success).toBe(true);
});
// tests/planner/render.test.ts
test("agent shows a benefit question with its answer buttons", () => { /* Agent 를 questions 하나와 렌더 → 질문 문구와 "받고 있어요" · "안 받아요" 버튼 */ });
```

- [ ] **Step 2: 실행해 실패 확인** → FAIL

- [ ] **Step 3: 구현**
  - 프로필 폼 칸 : `/api/overlap/sources` 목록에서 정책 고르기 + 상태 5개(`receiving` 받는 중 · `ended` 끝남 · `selected` 선정됨 · `applied` 신청함 · `eligible_unpaid` 자격만 있음) + 끝남일 때 마지막 지급일. 여러 줄.
  - 에이전트 패널 : `evaluation.questions` 가 있으면 첫 질문을 메시지 목록 위에 카드로. 버튼은 `answerKind` 별 — `receiving` : 받고 있어요 / 안 받아요, `selected` : 선정됐어요 / 아니에요, `ended_date` : 받고 있어요 / 끝났어요(날짜 입력) / 안 받아요. 답하면 `applyAnswer` → 프로필 `benefits` 갱신 → 기존 일정 변경과 같은 재판정 경로(`revision` 증가). 자유 입력으로는 답하지 않는다.
  - 저장 계획 · 초안 직렬화에 `benefits` 가 같이 들어간다.

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/planner --testTimeout=60000` → 모두 PASS

---

### Task 5: 시연 입구를 실데이터 + PERSONA_A 로

**Files:**
- Modify: `lib/planner/catalog.ts` (`evaluateRequest` 의 `demoId` 분기 : 가상 카탈로그 · 고정 시계 대신 실데이터, `demo: true` 표시만 유지)
- Modify: `lib/planner/fixtures.ts` (`DEMO_PROFILE` · `DEMO_EVENTS` 는 테스트용으로 남김, 새 export `PERSONA_DEMO_EVENTS: PlanEvent[] = [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }]`)
- Modify: `app/workspace/Planner.tsx` ("예시로 둘러보기" → `{ ...PERSONA_A, events: [] }` + `PERSONA_DEMO_EVENTS`, 고정 시계 안내 문구 삭제, 계정 창 "예시 프로필" → "시연 인물")
- Modify: `tests/planner/api.test.ts` (가상 데이터 기대값 → 실데이터 기대값)
- Test: `tests/planner/api.test.ts`

**Interfaces:**
- Consumes: `PERSONA_A` (`lib/judge/personas.ts`)
- Produces: `evaluateRequest` 의 `demoId` 경로가 실데이터 카탈로그를 쓰고 `Evaluation.demo === true`, `today` 는 실제 `now` 기준

- [ ] **Step 1: 테스트 수정** — `api.test.ts` 첫 테스트를 다음으로 바꾼다.

```ts
const now = new Date("2026-11-22T12:00:00+09:00");
const plannerV2 = { revision: 7, events: PERSONA_DEMO_EVENTS, choices: [], mutedKeys: [], preferredCategory: "all", demoId: "pathfinder-demo-2026" };
test("demo entry uses real data with the registered persona", () => {
  const out = handleJudge({ profile: { ...PERSONA_A, events: [] }, plannerV2 }, now);
  expect(out.status).toBe(200);
  expect(out.body).toHaveProperty("plannerV2.today", "2026-11-22");
  expect(out.body).toHaveProperty("plannerV2.demo", true);
  expect((out.body as any).plannerV2.cards.some((c: any) => c.offeringId.startsWith("demo-"))).toBe(false);
});
```

  두 번째 테스트(잘못된 날짜 400 + `field`)는 프로필만 `PERSONA_A` 로 바꾸고 유지.

- [ ] **Step 2: 실행해 실패 확인** → FAIL (`today` 가 `2026-11-19`)

- [ ] **Step 3: 구현** — 위 Files 대로. `tests/planner/evaluate.test.ts` 는 `evaluatePlanner` 에 가상 카탈로그를 직접 넣으므로 고치지 않는다.

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/planner --testTimeout=60000` → 모두 PASS

---

### Task 6: 에이전트 패널에서 AI 계획 연결

**Files:**
- Create: `lib/planner/plan-request.ts`
- Modify: `app/workspace/Planner.tsx` (AI 요청 상태 · 순번 · 결과 표시)
- Modify: `app/workspace/Agent.tsx` ("나에게 맞는 경로 추천해줘" 를 AI 계획 요청으로)
- Modify: `lib/planner/types.ts` (`AiRecommendation` 타입)
- Test: `tests/planner/plan-request.test.ts`

**Interfaces:**
- Consumes: `/api/plan` (`lib/plan/handler.ts` — 요청 `{ mode: "replan", persona: true, session: { profile, plan, answers: {}, benefits } }`, 응답 `200 { plan: { summary, stations: { label, items: { policyId, name, why }[] }[] } }` · `200 { fallback: true, timedOut?: true }` · `503` · `403` · `400`), `findRegisteredPersona` (`lib/judge/personas.ts`), `groupPlanPicks` (`app/planner/shared.ts`)
- Produces:
  - `function toLegacyPlan(events: PlanEvent[], today: string): { employAfterMonths: number | null; businessAfterMonths: number | null; move: { sigungu: string; afterMonths: number } | null }` — 기준일 = 수료 예정일(없으면 `today`). 취업 · 창업 = 기준일부터 예정일까지 개월 수 내림, 0~12 로 자름. 이사 = `today` 부터 개월 수 내림, 0~12.
  - `function canUseAi(profile: Profile): boolean` — `findRegisteredPersona(profile) !== undefined`
  - `type AiRecommendation = { source: "ai" | "rule"; summary: string; picks: { offeringId: string; stageId: string; why: string[] }[]; notice: string | null }`
  - `function attachPicks(stations: { label: string; items: { policyId: string; why: string }[] }[], evaluation: Evaluation): AiRecommendation` — 설계 10장 규칙 : 정거장 월과 같은 달에 시작하는 시점의 카드, 없으면 같은 정책의 가장 이른 막히지 않은 카드, 그 카드가 `blocked` 면 빼고 `notice: "AI 추천 일부가 지금 일정과 맞지 않아요"`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
test("dates become legacy month offsets", () => {
  expect(toLegacyPlan([{ id: "c", type: "training_completion", date: "2026-12-19", status: "scheduled" }, { id: "e", type: "employment", date: "2027-06-20", status: "scheduled" }], "2026-11-22")).toEqual({ employAfterMonths: 6, businessAfterMonths: null, move: null });
  expect(toLegacyPlan([{ id: "e", type: "employment", date: "2028-06-01", status: "scheduled" }], "2026-11-22").employAfterMonths).toBe(12);
});
test("persona gate", () => {
  expect(canUseAi({ ...PERSONA_A, events: [] })).toBe(true);
  expect(canUseAi({ ...PERSONA_A, birthYm: "2000-01", events: [] })).toBe(false);
});
test("blocked AI pick is dropped with a notice", () => { /* evaluation 하나를 만들고 blocked 카드 정책을 stations 에 넣음 → picks 에 없음, notice 있음 */ });
test("non-persona never calls plan api", () => { /* fetch 를 가짜로 두고 canUseAi false 인 요청 함수 실행 → fetch 호출 0, source "rule" */ });
test("stale plan response is dropped", () => { /* requestPlan 을 순번 1 로 시작, 순번을 2 로 올린 뒤 응답 → 결과 null */ });
```

  마지막 두 테스트를 위해 `lib/planner/plan-request.ts` 에 화면과 분리된 함수를 둔다 : `async function requestAiRecommendation(args: { profile: Profile; events: PlanEvent[]; evaluation: Evaluation; seq: number; currentSeq: () => number; fetcher?: typeof fetch; timeoutMs?: number }): Promise<AiRecommendation | null>` — 순번이 바뀌었으면 `null`.

- [ ] **Step 2: 실행해 실패 확인** → FAIL

- [ ] **Step 3: 구현** — 응답별 결과 :

| 응답 | `AiRecommendation` |
|---|---|
| 200 + `plan` | `attachPicks` 결과, `source: "ai"`, `summary: plan.summary` |
| 200 + `timedOut` | 규칙 추천, `notice: "AI 계획 정리 제한 시간을 넘겼어요. 조건 기준 경로를 표시해요."` |
| 200 + `fallback` (시간 초과 아님) | 규칙 추천, `notice: "AI 설명을 불러오지 못해 조건 기준 경로를 표시해요"` |
| 503 | 규칙 추천, `notice: "AI가 꺼져 있어 조건 기준 경로를 표시해요"` |
| 403 · `canUseAi` false | 규칙 추천, `notice: "실제 정보로는 AI 계획을 쓰지 않아요. 조건 기준 경로를 표시해요."`, fetch 안 함 |
| 네트워크 오류 · 클라이언트 시간 초과(60초) | 규칙 추천, 첫 줄과 같은 `fallback` 문구 |

  - 규칙 추천 = `evaluation.recommendations`, `why: []`.
  - 화면 : 보드의 "AI 추천 경로 보기" 가 `AiRecommendation.picks` 를 쓴다. 에이전트 패널에 `summary` 와 정책별 이유(정거장별로 나눔)를 보여 준다. 출처(`source`)를 문구로 밝힌다.
  - 일정 · 담기 · 프로필 · 수혜 상태가 바뀌면 AI 추천을 지우고 순번을 올린다. "처음으로" 에서도 지운다.
  - "추천을 새 계획으로 저장" 은 보고 있는 추천의 `picks` 를 저장한다.
  - `canUseAi` 가 false 면 "나에게 맞는 경로 추천해줘" 는 규칙 추천만 보여 준다 (버튼은 남김).

- [ ] **Step 4: 통과 확인** — `npx vitest run tests/planner --testTimeout=60000` → 모두 PASS

---

### Task 7: 전체 확인

- [ ] **Step 1:** `npx tsc --noEmit` → 오류 0
- [ ] **Step 2:** `npm run lint` → 통과
- [ ] **Step 3:** `npx vitest run --maxWorkers=4 --testTimeout=60000` → 전부 PASS
- [ ] **Step 4:** 독립 검증 (구현과 다른 실행 맥락) — 설계 7장 I1~I8 과 이 계획의 Review Focus 를 브라우저와 API 로 확인
