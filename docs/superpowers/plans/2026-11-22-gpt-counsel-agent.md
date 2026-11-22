# GPT 상담 · 추천 에이전트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/plan` 의 계획 에이전트를 GPT 로 돌리는 상담 · 추천 에이전트로 바꿔, 1차 판정(코드) 위에서 더 물을 정보를 고르고 · 사용자 질문에 답하고 · 시점별 정책을 추천한다.

**Architecture:** 모델 공급자는 `AnthropicLike` 어댑터 뒤에 숨긴다(OpenAI 어댑터 추가). `/api/plan` 은 옛 형식을 그대로 받고, `version: 2` 요청은 새 핸들러 `handleCounsel` 이 새 화면 판정(`plannerV2`) 위에서 도구 호출 루프를 돈다. AI 출력은 코드 검사를 통과한 것만 화면에 간다.

**Tech Stack:** Next.js App Router · TypeScript · zod · vitest · OpenAI Chat Completions(함수 호출)

**Spec:** `docs/superpowers/specs/2026-11-22-gpt-counsel-agent-design.md` (승인 11-22)

**기준 브랜치 :** 팀원이 MVP(`agent/planner-backend-link`)를 `dev` 에 머지한 뒤의 `dev`. 머지 전이면 `agent/planner-backend-link`. 작업 브랜치 `agent/gpt-counsel-agent`.

## Global Constraints

- 자격 판정(신청 가능 · 확인 필요 · 불가)은 코드 값만 쓴다. AI 출력으로 카드 판정을 바꾸지 않는다.
- 고치지 않는 것 : `lib/judge/*`, `lib/data/*`, `scripts/overlap/*`, `data/*`, `lib/verify/*`, 옛 `/api/plan` 요청 형식의 동작 (`app/legacy/page.tsx` · `tests/plan/*` 가 그대로 통과해야 한다)
- 공급자 선택 : `PLAN_AI_PROVIDER` (없으면 `AI_PROVIDER`). 값 `openai` 이면 `OPENAI_API_KEY`, `OPENAI_MODEL` 필수. 모델 이름을 코드에 고정하지 않는다.
- AI 를 부르는 조건 : `aiConfigured` 참 **그리고** (시연 세션 **또는** (`PLAN_AI_FOR_USERS === "true"` **그리고** `consent === true`))
- 시연 세션 = `demoId === "pathfinder-demo-2026"` 이고 프로필의 `birthYm` · `sigungu` · `school` · `source` 가 `PERSONA_A` 와 같음. 상태 · 일정 · 수혜는 달라도 된다.
- 실사용자에게 보내는 정보 : 만 나이 범위, 시군구 이름, 학력, 상태, 일정 · 개인 기한은 "오늘부터 N일 뒤", 공고 공식 날짜는 그대로, 수혜 정책 이름 · 상태. 자유 입력 · 이력은 `scrubPII` 를 거친다.
- 요청 한도 : 대화 이력 최대 6턴, 사용자 메시지 500자, 도구 턴 최대 6, 시간 55초, 하루 횟수는 기존 `takeQuota`. 자유 질문 · 이력이 있는 요청은 캐시하지 않는다.
- 화면 자동 재호출 : AI 가 질문하고 사용자가 답한 경우에만 1회, 연속 최대 3회.
- 테스트 명령 : `npx vitest run <파일> --testTimeout=60000`, 전체 `npx vitest run --maxWorkers=4 --testTimeout=60000`, `npx tsc --noEmit`, `npm run lint`
- 실제 네트워크 호출 테스트 금지. 모델은 가짜 클라이언트 · 가짜 fetch 로.
- 커밋은 Claude Code 가 한다.

## Review Focus

- 사용자가 "아무거나 추천해줘" 를 보냈는데 모든 카드가 `blocked` → `finish_plan` 이 비면 규칙 추천(`evaluation.recommendations`)과 출처 문구 → Task 4 테스트 `empty ai plan falls back to rule`
- 사용자 메시지가 일정 명령("취업을 2월 19일로 옮겨줘") → AI 를 부르지 않고 기존 코드 명령 경로 → Task 5 테스트 `schedule command never reaches counsel`
- 시연 인물이 답해 상태가 바뀜 → 시연 세션 유지, AI 계속 사용 → Task 3 테스트 `answered persona stays a demo session`
- AI 가 같은 질문을 되풀이 → 이력에 있는 같은 `target` 질문은 거절 → Task 4 테스트 `repeated question is rejected`
- 동의 철회 후 메시지 → GPT 호출 0회 → Task 5 테스트 `withdrawn consent never calls counsel`

---

### Task 1: OpenAI 어댑터와 용도별 공급자 선택

**Files:**
- Create: `lib/ai/openai.ts`
- Modify: `lib/ai/client.ts`
- Test: `tests/ai/openai.test.ts`

**Interfaces:**
- Produces:
  - `function openaiClient(opts: { apiKey: string; model: string; fetcher?: typeof fetch; baseUrl?: string }): AnthropicLike` — `beta.messages.create(params)` 의 `system` · `messages`(text · tool_use · tool_result 블록) · `tools`(`input_schema`) · `max_tokens` 를 Chat Completions 요청으로 바꾸고, 응답을 `BetaMessage` 모양(`content`: `text` · `tool_use` 블록, `stop_reason`: `end_turn` | `tool_use` | `max_tokens` | `refusal`)으로 돌린다. `betas` · `fallbacks` · `output_config` 는 무시한다.
  - `type AiPurpose = "plan" | "verify"`
  - `aiConfigured(env, purpose: AiPurpose = "verify"): boolean`, `makeAiClient(env, purpose: AiPurpose = "verify"): AnthropicLike` — `purpose === "plan"` 이면 `PLAN_AI_PROVIDER ?? AI_PROVIDER` 로 고른다. 기존 호출(인자 없음)의 동작은 그대로.

- [ ] **Step 1: 실패하는 테스트**

```ts
test("tools and tool results round-trip through chat completions", async () => {
  const calls: any[] = [];
  const fetcher = async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_evaluation", arguments: "{}" } }] } }] })); };
  const client = openaiClient({ apiKey: "k", model: "m", fetcher: fetcher as typeof fetch });
  const res = await client.beta.messages.create({ system: "S", max_tokens: 100, tools: [{ name: "get_evaluation", description: "d", input_schema: { type: "object", properties: {} } }], messages: [{ role: "user", content: "hi" }] });
  expect(calls[0].model).toBe("m");
  expect(calls[0].messages[0]).toEqual({ role: "system", content: "S" });
  expect(calls[0].tools[0].function.name).toBe("get_evaluation");
  expect(res.stop_reason).toBe("tool_use");
  expect(res.content[0]).toMatchObject({ type: "tool_use", id: "c1", name: "get_evaluation", input: {} });
});
test("tool_result blocks become tool messages", async () => { /* assistant tool_use + user tool_result 를 보내면 요청에 { role: "tool", tool_call_id: "c1", content } 가 있다 */ });
test("http error throws so the caller falls back", async () => { /* 429 응답 → reject */ });
test("plan purpose picks PLAN_AI_PROVIDER", () => {
  expect(aiConfigured({ EXTERNAL_AI_ENABLED: "true", PLAN_AI_PROVIDER: "openai", OPENAI_API_KEY: "k", OPENAI_MODEL: "m" }, "plan")).toBe(true);
  expect(aiConfigured({ EXTERNAL_AI_ENABLED: "true", PLAN_AI_PROVIDER: "openai", OPENAI_API_KEY: "k" }, "plan")).toBe(false);
  expect(aiConfigured({ EXTERNAL_AI_ENABLED: "true", AI_PROVIDER: "gemini", GEMINI_API_KEY: "g" })).toBe(true);
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run tests/ai/openai.test.ts --testTimeout=60000` → FAIL
- [ ] **Step 3: 구현** — 호출 주소 기본값 `https://api.openai.com/v1/chat/completions`, `Authorization: Bearer`. 도구 `input_schema` 는 `parameters` 로 그대로(필요한 변환만). `signal` · `timeout` 은 fetch 에 넘긴다. `finish_reason`: `tool_calls` → `tool_use`, `stop` → `end_turn`, `length` → `max_tokens`, `content_filter` → `refusal`.
- [ ] **Step 4: 통과 확인** — 같은 명령 PASS, 전체 테스트 PASS

---

### Task 2: AI 로 보내는 판정 요약과 식별 정보 지우기

**Files:**
- Create: `lib/plan/scrub.ts`, `lib/plan/evaluation-summary.ts`
- Test: `tests/plan/counsel-privacy.test.ts`

**Interfaces:**
- Produces:
  - `function scrubPII(text: string): { text: string; removed: boolean }` — 휴대전화 · 일반 전화번호, 주민등록번호(앞 6 · 뒤 7), 이메일, 계좌번호 모양(숫자 10~14자리, 하이픈 포함)을 `[개인정보]` 로
  - `type EvalForAI = { today: string | null; stages: { stageId: string; label: string; startsIn: string }[]; cards: { offeringId: string; stageId: string; policyId: string; title: string; availability: Card["availability"]; reasons: string[]; deadline: string | null; officialEnd: string | null; verifyLabel: string | null; chosen: boolean }[]; questions: { id: string; text: string; target: AskTarget }[] }`
  - `function summarizeEvaluation(evaluation: Evaluation, opts: { demo: boolean; maxCards?: number }): EvalForAI` — `demo` 이면 날짜 그대로, 아니면 `today: null`, 일정 · 개인 기한은 `"N일 뒤"`, `officialEnd` 는 공식 날짜 그대로. `blocked` 카드는 제목 · 판정 · 사유 1개만. 기본 `maxCards` 40 (신청 가능 → 확인 필요 → 불가, 마감 빠른 순)
  - `type AskTarget = { kind: "profile"; field: "currentStatus" | "recentHistory" } | { kind: "event"; eventType: "training_completion" | "employment" | "business_registration" | "relocation" } | { kind: "benefit"; policyId: string; need: Need; month?: string }` — `lib/plan/evaluation-summary.ts` 에서 export (`Need` 는 `lib/judge/overlap.ts`)

- [ ] **Step 1: 실패하는 테스트**

```ts
test("phone, resident id, email, account are removed", () => {
  const out = scrubPII("제 번호는 010-1234-5678, 주민 990101-1234567, a@b.com, 계좌 110-123-456789 요");
  expect(out.removed).toBe(true);
  expect(out.text).not.toMatch(/010-1234-5678|990101-1234567|a@b\.com|110-123-456789/);
});
test("plain question is untouched", () => { expect(scrubPII("청년도전지원사업은 왜 확인 필요예요?")).toEqual({ text: "청년도전지원사업은 왜 확인 필요예요?", removed: false }); });
test("real user summary has no exact personal dates", () => {
  const s = summarizeEvaluation(evaluationFixture, { demo: false });  // 실데이터 PERSONA_A 평가 (2026-11-22, 수료 12/19)
  expect(s.today).toBeNull();
  expect(JSON.stringify(s.stages)).not.toContain("2026-12-19");
  expect(s.stages.find(st => st.stageId !== "current")?.startsIn).toBe("27일 뒤");
});
test("demo summary keeps dates", () => { expect(summarizeEvaluation(evaluationFixture, { demo: true }).today).toBe("2026-11-22"); });
```

- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `questions` 는 `evaluation.questions` 를 `target: { kind: "benefit", policyId: q.sourcePolicyId, need, month }` 로 바꾸고 `id = questionKey(q)` (`lib/planner/questions.ts`). `need` 는 `answerKind` 에서 : `receiving` → `receiving`, `selected` → `selected`, `ended_date` → `ended`, `monthly_amount` → `monthly_amount`.
- [ ] **Step 4: 통과 확인**

---

### Task 3: 시연 세션 판단과 질문 칸 검사

**Files:**
- Create: `lib/plan/counsel-guard.ts`
- Test: `tests/plan/counsel-guard.test.ts`

**Interfaces:**
- Consumes: `AskTarget` (Task 2), `PERSONA_A` (`lib/judge/personas.ts`), `guardResponse` (`lib/agent/guard.ts`)
- Produces:
  - `function isDemoSession(profile: Profile, demoId?: string): boolean`
  - `function validTarget(target: unknown, evaluation: Evaluation): AskTarget | null` — `profile` 은 두 칸만, `event` 는 네 종류, `benefit` 은 `evaluation.questions` 의 원인 정책이거나 `/api/overlap/sources` 와 같은 승인 규칙 원인 정책일 때만
  - `function checkPlan(picks: { offeringId: string; stageId: string; why: string }[], evaluation: Evaluation): { kept: { offeringId: string; stageId: string; why: string }[]; dropped: number }` — 지금 평가에 없거나 `blocked` 인 카드 버림, `why` 가 `guardResponse` 에 걸리면 `why` 를 코드 사유(그 카드 `reasons[0].message`)로 바꿈
  - `function checkAnswer(text: string, citations: string[], allowed: { evidenceIds: Set<string>; offeringIds: Set<string> }): { ok: true } | { ok: false; reason: string }` — 인용 0개 · 모르는 인용 · `guardResponse` 실패면 거절

- [ ] **Step 1: 실패하는 테스트**

```ts
test("answered persona stays a demo session", () => {
  expect(isDemoSession({ ...PERSONA_A, currentStatus: ["unemployed"], benefits: [{ policyId: "20260710005400113256", status: "receiving" }] }, "pathfinder-demo-2026")).toBe(true);
  expect(isDemoSession({ ...PERSONA_A, sigungu: "11110" }, "pathfinder-demo-2026")).toBe(false);
  expect(isDemoSession(PERSONA_A, undefined)).toBe(false);
});
test("profile base fields cannot be asked", () => {
  expect(validTarget({ kind: "profile", field: "birthYm" }, ev)).toBeNull();
  expect(validTarget({ kind: "event", eventType: "employment" }, ev)).toEqual({ kind: "event", eventType: "employment" });
});
test("blocked and unknown picks are dropped", () => {
  const out = checkPlan([{ offeringId: blockedCard.offeringId, stageId: blockedCard.stageId, why: "x" }, { offeringId: "nope", stageId: "current", why: "x" }, { offeringId: okCard.offeringId, stageId: okCard.stageId, why: "먼저 확인해 보세요" }], ev);
  expect(out.kept.map(p => p.offeringId)).toEqual([okCard.offeringId]);
  expect(out.dropped).toBe(2);
});
test("answer without citations is rejected", () => { expect(checkAnswer("받을 수 있어요", [], allowed).ok).toBe(false); });
```

- [ ] **Step 2 · 3 · 4** — 실패 확인 → 구현 → 통과 확인

---

### Task 4: `version: 2` 상담 핸들러

**Files:**
- Create: `lib/plan/counsel.ts`
- Modify: `lib/plan/handler.ts` (맨 앞에서 `version === 2` 이면 `handleCounsel` 로 넘김 — 그 밖의 줄은 바꾸지 않음), `app/api/plan/route.ts` (`makeClient: () => makeAiClient(process.env, "plan")`)
- Test: `tests/plan/counsel.test.ts`

**Interfaces:**
- Consumes: Task 1~3 전부, `evaluateRequest` (`lib/planner/catalog.ts`), `takeQuota`, `withDeadline`
- Produces:
  - 요청 `CounselRequestSchema` : `{ version: 2; action: "message" | "recommend" | "continue"; demoId?: "pathfinder-demo-2026"; consent?: boolean; profile: ProfileSnapshot; input: PlannerInput; benefits?: Benefit[]; message?: string (≤500); history: { role: "user" | "assistant"; text: string }[] (≤6) }`
  - 응답 `CounselBody` : `{ kind: "question"; text: string; target: AskTarget; questionId: string }` | `{ kind: "answer"; text: string; citations: string[] }` | `{ kind: "plan"; summary: string; picks: { offeringId: string; stageId: string; why: string }[]; dropped: number }` | `{ kind: "none" }` | `{ fallback: true; reason: "timeout" | "error" | "empty" }` | `{ disabled: true; error: string }`
  - `async function handleCounsel(raw: unknown, ctx: Ctx): Promise<{ status: number; body: CounselBody }>`
  - 도구 : `get_evaluation`, `get_policy_evidence { offering_id }` (카드 근거 + `evidenceId`), `get_open_questions`, `ask_user { target, text }`, `answer_user { text, citations }`, `finish_plan { summary, picks: [{ offering_id, stage_id, why }] }`, `parse_other_answer { target, value }`, `no_more_questions`
  - 시스템 프롬프트 : 설계 4 · 5장 규칙 (판정하지 않음, 근거 밖 사실 금지, 판정을 바꾸는 표현 금지, 질문은 `target` 필수, 이력의 같은 질문 금지)

- [ ] **Step 1: 실패하는 테스트** — 가짜 `AnthropicLike` 로 도구 호출 순서를 정해 둔다.

```ts
test("G1 recommend returns only open cards", async () => { /* 가짜 모델 : get_evaluation → finish_plan(열린 카드 1 + blocked 1) → body.kind "plan", picks 1, dropped 1 */ });
test("G2 free question is answered with citations", async () => { /* get_policy_evidence → answer_user(citations: [그 evidenceId]) → kind "answer" */ });
test("G4 uncited answer is replaced", async () => { /* answer_user(citations: []) → kind "answer", text 가 "판정 결과에서 확인할 수 없는 내용이에요" */ });
test("empty ai plan falls back to rule", async () => { /* finish_plan 에 blocked 만 → { fallback: true, reason: "empty" } */ });
test("repeated question is rejected", async () => { /* history 마지막 assistant 질문과 같은 target 의 ask_user → 도구 오류로 거절, 다음 턴 no_more_questions → kind "none" */ });
test("G5 real user without consent never calls the model", async () => { /* demoId 없음, consent 없음 → status 403, makeClient 호출 0 */ });
test("G6 message is scrubbed before the model sees it", async () => { /* 실사용자 + 동의 + PLAN_AI_FOR_USERS, message "010-1234-5678 ..." → 모델이 받은 messages 에 번호 없음 */ });
test("G7 timeout falls back", async () => { /* 모델이 deadline 넘김 → { fallback: true, reason: "timeout" } */ });
test("legacy request shape still works", async () => { /* version 없는 옛 요청 → 기존 handlePlan 경로 (tests/plan/* 그대로 통과로도 확인) */ });
```

- [ ] **Step 2 · 3 · 4** — 실패 확인 → 구현 → `npx vitest run tests/plan --testTimeout=60000` 전부 PASS

---

### Task 5: 화면 — 에이전트 패널을 상담 에이전트에 연결

**Files:**
- Create: `lib/planner/counsel-request.ts`
- Modify: `app/workspace/Agent.tsx`, `app/workspace/Planner.tsx`, `app/workspace/Dialogs.tsx` (동의 창)
- Test: `tests/planner/counsel-request.test.ts`, `tests/planner/render.test.ts` (추가)

**Interfaces:**
- Consumes: `CounselBody` · `AskTarget` (Task 2 · 4), `applyAnswer` (`lib/planner/answers.ts`), `parseScheduleTurn` (`lib/planner/commands.ts`)
- Produces:
  - `type CounselTurn = { role: "user" | "assistant"; text: string }`
  - `async function requestCounsel(args: { action: "message" | "recommend" | "continue"; message?: string; profile: Profile; input: PlannerInput; history: CounselTurn[]; demo: boolean; consent: boolean; seq: number; currentSeq: () => number; fetcher?: typeof fetch; timeoutMs?: number }): Promise<CounselBody | null>` — 순번이 바뀌면 `null`. 실사용자이고 `consent` 거짓이면 fetch 없이 `{ disabled: true, error: … }`
  - `function routeMessage(text: string, events: PlanEvent[]): "command" | "counsel"` — `parseScheduleTurn` 이 일정 명령으로 읽으면 `command`
  - `function shouldAutoContinue(last: CounselBody, autoCount: number): boolean` — 직전 응답이 질문이었고 사용자가 답했으며 `autoCount < 3`

- [ ] **Step 1: 실패하는 테스트**

```ts
test("schedule command never reaches counsel", () => { expect(routeMessage("취업을 2월 19일로 옮겨줘", events)).toBe("command"); expect(routeMessage("청년도전지원사업은 왜 확인 필요예요?", events)).toBe("counsel"); });
test("withdrawn consent never calls counsel", async () => { let n = 0; await requestCounsel({ ...base, demo: false, consent: false, fetcher: (async () => { n++; return new Response("{}"); }) as typeof fetch }); expect(n).toBe(0); });
test("auto continue stops after three", () => { expect(shouldAutoContinue(question, 2)).toBe(true); expect(shouldAutoContinue(question, 3)).toBe(false); expect(shouldAutoContinue(answer, 0)).toBe(false); });
test("stale counsel response is dropped", async () => { /* seq 1 로 시작, currentSeq 2 → null */ });
test("agent renders an answer with its citations", () => { /* 렌더 : 답 문장과 인용 카드 제목 */ });
test("G8 benefit answer re-judges the card", () => { /* target { kind: "benefit", policyId: "20260710005400113256", need: "receiving" } 에 "받고 있어요" → applyAnswer → evaluateRequest → 청년도전지원사업(20250122005400110346) 수료 후 카드 blocked */ });
```

- [ ] **Step 2 · 3 · 4** — 실패 확인 → 구현 → 통과 확인
  - 자유 입력 : `routeMessage` 가 `command` 면 지금처럼, `counsel` 이면 `requestCounsel({ action: "message" })`
  - "나에게 맞는 경로 추천해줘" 버튼 : `requestCounsel({ action: "recommend" })`. `kind: "plan"` 이면 지금의 AI 추천 표시(`AiRecommendation`, `source: "ai"`, `why` 는 응답 `why`)로, 실패 · 비면 지금처럼 규칙 추천
  - `kind: "question"` : 질문 카드에 표시. 답 칸은 `target` 으로 — `benefit` 은 지금 질문 카드(답 종류는 `need`), `event` 는 날짜 입력(지금 일정 대화상자 재사용), `profile` 은 선택지. 답하면 기존 재판정 경로 → `shouldAutoContinue` 면 `action: "continue"`
  - `kind: "answer"` : 말풍선 + 인용(근거 제목 · 카드 링크)
  - 실사용자가 처음 AI 를 쓰려 할 때 동의 창 (설계 7장 문구). 동의 상태는 탭 초안과 같이 저장, 언제든 끄기
  - 이력 : 최근 6턴만 보냄. 일정 · 담기 · 프로필이 바뀌면 순번 증가 (늦은 응답 버림)
  - 코드 질문 카드(`evaluation.questions`)는 AI 를 부르지 않은 동안 지금처럼 보인다

---

### Task 6: 전체 확인

- [ ] `npx tsc --noEmit` · `npm run lint` · `npx vitest run --maxWorkers=4 --testTimeout=60000` 전부 통과
- [ ] 독립 검증 (구현과 다른 실행 맥락) — 설계 9장 G1~G10, 이 계획의 Review Focus, 고치지 않는 파일 미변경
- [ ] 실호출 확인 (팀이 `OPENAI_API_KEY` · `OPENAI_MODEL` 을 정한 뒤) : 시연 인물로 G1 · G2 를 실제 GPT 로 한 번씩
