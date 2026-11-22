# 2차 MVP 화면 교체 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 화면 시안(`docs/design/mvp2/index.html` · `login.html` · `app.html`)의 디자인으로 메인 화면을 바꾸고, 지금 dev 의 실제 기능(판정 · 상담 에이전트 · 저장)에 연결한다.

**Architecture:** 시안은 dev 화면(`app/workspace/*`)을 바탕으로 만든 정적 HTML 이라 CSS 클래스 이름이 대부분 같다. 시안의 CSS 를 `workspace.module.css` 로 옮기고, 시안에만 있는 화면(소개 · 로그인 · 회원가입 · 로딩 · 관심 정책 · 계정 · 계획 비교)을 React 로 만든다. 판정 · 저장 · 에이전트 로직은 바꾸지 않는다.

**Tech Stack:** Next.js App Router · React · CSS Modules · vitest (`renderToStaticMarkup`)

**설계 (사용자 승인 범위, 11-22)**

| 시안 기능 | 처리 |
|---|---|
| 정책 보드 · 내 일정 · 내 계획 · 필터 · AI 추천 경로 · 신청 불가 모아보기 · 상세 · 비교 · 교체 · 로드맵 · 길잡이 패널 · 내 정보 입력 | 디자인만 시안으로. 기능은 지금 코드 |
| 소개 페이지, 로딩 화면, 관심 정책(별표) 탭, 정책 검색, 계획 비교, 인쇄 | 새로 만든다 (브라우저 저장만) |
| 로그인 · 회원가입 | 시연용 흐름. 입력은 어디에도 보내지 않고 "시연용 화면이에요" 표시 |
| 예상 총액(`totalBox`) · 필요 서류(`DOCS`) · 알림 벨 · 알림 설정 · 최근 알림 · 바뀐 공고 표시 | **숨긴다** (백엔드 문서 `docs/handoff/2026-11-22-mvp2-backend-features.md`) |
| 시안 문구 "입력한 정보는 … 외부 AI에는 보내지 않아요" | 실제 동작으로 : "판정은 이 서비스 서버에서 해요. 예시 인물이나 AI 상담에 동의한 경우에만 요약과 질문이 외부 AI(OpenAI)로 가요." |
| 시안 문구 "길잡이는 설명만 해요" | "날짜·자격·중복 판정은 규칙 엔진이 하고, 길잡이는 추가로 물어보고 설명하고 추천해요." |
| 시안의 가짜 정책 데이터(`P`) · 가짜 날짜 | 쓰지 않는다. 화면은 지금처럼 `/api/judge` 의 `plannerV2` 평가를 그린다 |

**Spec:** 위 표 + 시안 파일. 백엔드 몫 : `docs/handoff/2026-11-22-mvp2-backend-features.md`

## Global Constraints

- 고치지 않는 것 : `lib/judge/*`, `lib/data/*`, `lib/plan/*`, `lib/planner/*` 의 판정 · 저장 · 상담 로직 (화면에 필요한 순수 함수 추가는 새 파일로), `app/api/*`, `app/legacy/*`, `app/classic/*`, `scripts/*`, `data/*`
- 경로 : `/` = 소개(시안 `index.html`), `/login` = 로그인(시연용), `/app` = 앱(시안 `app.html`). 시안의 `app.html#signup` → `/app#signup`, `login.html` → `/login`, `index.html` → `/`
- 그림 : `public/pathfinder/*.png` (이미 복사됨). `next/image` 대신 `<img>` 도 허용
- 글꼴 : 시안과 같은 Noto Sans KR. `next/font/google` 로 `app/layout.tsx` 에서 불러온다
- 색 · 간격 · 모양은 시안 CSS 값을 그대로 쓴다. 시안 CSS 가 있는 클래스는 시안 값으로 바꾸고, dev 에만 있는 클래스(`agentClose` · `agentDrawer` · `agentHidden` · `agentOpen` · `calendar` · `columnFooter` · `dayTick` · `error` · `notice` · `org` · `partialNote` · `questionMeta` · `questionWrap` · `robot` · `robotLarge` · `skeleton` · `srOnly`)는 남긴다
- 숨기는 기능은 마크업을 아예 그리지 않는다 (CSS 로 감추지 않는다)
- 기존 테스트는 문구 · 구조 변경 때문에 깨지는 경우만 새 화면에 맞게 고치고, 판정 기대값은 바꾸지 않는다
- 모바일 : 시안의 `@media` 규칙 그대로. 360px 에서 가로 스크롤이 생기지 않는다 (보드 · 로드맵 내부 스크롤 제외)
- 테스트 명령 : `npx vitest run --maxWorkers=4 --testTimeout=60000`, `npx tsc --noEmit`, `npm run lint`
- 커밋은 Claude Code 가 한다

## Review Focus

- 별표한 정책이 새 판정에서 사라짐(회차 마감 등) → 관심 정책 탭에 "지금 판정에 없음" 으로 남고 오류 없음 → Task 3 테스트 `missing starred policy is kept with a note`
- 로그인 · 회원가입 폼에 실제 이메일 · 비밀번호 입력 → 네트워크 요청 0, 저장 0 → Task 1 테스트 `demo login never sends or stores input`
- 저장한 계획이 1개뿐일 때 계획 비교 → 버튼 비활성 + 안내 → Task 4 테스트 `compare needs two plans`
- 검색어가 공백 · 특수문자 → 필터가 깨지지 않고 전체 표시 → Task 3 테스트 `blank search shows all`
- 예시로 둘러보기(PERSONA_A) 흐름이 그대로 → 실데이터 + 시연 인물로 보드가 열림 → Task 2 테스트 `demo entry still opens persona board`

---

### Task 1: 소개 · 로그인 페이지와 경로 정리

**Files:**
- Create: `app/(site)/page.tsx` 또는 `app/page.tsx` 교체(소개), `app/login/page.tsx`, `app/site.module.css`
- Create: `app/app/page.tsx` (지금 `app/page.tsx` 의 Planner 를 옮김)
- Modify: `app/layout.tsx` (Noto Sans KR, 파비콘 `robot-face.png`)
- Test: `tests/site/pages.test.ts`

**Interfaces:**
- Produces: 경로 `/` · `/login` · `/app`. 소개의 버튼 : "로그인" → `/login`, "내 경로 그려 보기" → `/login`, "내 경로 시뮬레이션하기" → `/app#signup`. 로그인 제출 → `/app#building`, 카카오 · 네이버 → "시연용 화면이에요. 입력한 내용은 어디로도 전송되지 않아요." 표시

- [ ] **Step 1: 실패하는 테스트**

```ts
test("landing renders hero and links", () => {
  const html = renderToStaticMarkup(React.createElement(Landing));
  expect(html).toContain("졸업 다음 달,");
  expect(html).toContain('href="/login"');
  expect(html).toContain('href="/app#signup"');
  expect(html).not.toContain(".html");
});
test("demo login never sends or stores input", () => { /* fetch · localStorage · sessionStorage 를 감시하고 LoginForm 의 submit 핸들러 실행 → 호출 0, 이동 대상 "/app#building" */ });
```

- [ ] **Step 2 · 3 · 4** — 실패 확인 → 구현(시안 `index.html` · `login.html` 의 마크업 · CSS · 로딩 · 스크롤 등장 효과를 React 로) → 통과 확인
  - 시안 `index.html` 의 문구 "PathFinder의 AI는 기관 공고를 직접 찾아 읽고 … 받을 수 있는지는 정해진 규칙으로만 계산해요" 는 그대로 둔다 (사실과 맞음)

---

### Task 2: 앱 껍데기 — 회원가입(시연) · 내 정보 · 로딩 · 4개 탭 · 테마

**Files:**
- Modify: `app/workspace/Planner.tsx`, `app/workspace/Dialogs.tsx` (`ProfileForm`), `app/workspace/workspace.module.css`
- Create: `app/workspace/Entry.tsx` (회원가입 · 내 정보 화면), `app/workspace/Building.tsx` (로딩), `app/workspace/Nav.tsx`
- Test: `tests/planner/render.test.ts` (추가)

**Interfaces:**
- Produces:
  - 화면 해시 : `#signup` → 회원가입(시연), `#onboarding` → 내 정보, `#building` → 로딩 뒤 보드, `#board` · `#saved` · `#roadmap` · `#account` → 탭. 해시가 없으면 지금처럼 저장된 초안이 있으면 보드, 없으면 `#signup`
  - 회원가입 : 시안 폼. 제출 · 소셜 버튼 → `#onboarding`. "예시로 둘러보기" → 지금의 예시 시작(PERSONA_A). 입력은 저장 · 전송하지 않는다
  - 내 정보 : 지금 `ProfileForm` 의 칸 · 동작을 시안 모양으로(출생연월, 시군구, 학력, 지금 상태 선택 칩, 앞으로 예정된 일, 관심 분야, 받고 있는 지원 = 지금 수혜 상태 입력). 안내 문구는 설계 표의 새 문구. 제출 → `#building` → 판정이 끝나면 `#board`
  - 로딩 : 시안 `#building` 의 경로 그림 · 핀 · 진행 막대. 실제 판정 요청이 끝날 때까지 보이고 최소 1.2초
  - 왼쪽 메뉴 4개 (정책 선택 · 관심 정책 · 내 정책 로드맵 · 계정). 시안의 SVG 아이콘
  - 테마 : 시안 CSS 로 `workspace.module.css` 교체 (Global Constraints 규칙)

- [ ] **Step 1: 실패하는 테스트**

```ts
test("demo entry still opens persona board", () => { /* Entry 의 "예시로 둘러보기" 핸들러가 지금의 예시 시작 함수를 부른다 (PERSONA_A · PERSONA_DEMO_EVENTS) */ });
test("onboarding notice matches actual ai use", () => {
  const html = renderToStaticMarkup(React.createElement(ProfileForm, { onSave: () => {} }));
  expect(html).not.toContain("외부 AI에는 보내지 않아요");
  expect(html).toContain("AI 상담에 동의한 경우에만");
});
test("nav shows four tabs", () => { /* Nav 렌더 → 정책 선택 · 관심 정책 · 내 정책 로드맵 · 계정, href #board #saved #roadmap #account */ });
```

- [ ] **Step 2 · 3 · 4** — 실패 확인 → 구현 → 통과 확인

---

### Task 3: 정책 보드 — 시안 디자인, 검색, 별표, 관심 정책 탭

**Files:**
- Modify: `app/workspace/Planner.tsx`, `app/workspace/PolicyCard.tsx`, `app/workspace/Schedule.tsx`, `app/workspace/workspace.module.css`
- Create: `lib/planner/stars.ts`, `lib/planner/search.ts`, `app/workspace/Saved.tsx`
- Test: `tests/planner/stars-search.test.ts`, `tests/planner/render.test.ts` (추가)

**Interfaces:**
- Produces:
  - `function matchesSearch(card: Card, query: string): boolean` — 공백 · 대소문자 무시, 제목 · 기관 · 지원 내용에서 찾음. 빈 검색어는 true
  - `function createStarStore(storage: Storage): { list(): string[]; toggle(policyId: string): boolean; has(policyId: string): boolean }` — 키 `pathfinder.stars.v1`, 정책 ID(`policyId`) 단위. 저장 실패해도 화면은 계속
  - 보드 머리 : 시안 `pageHeader`(예시 프로필 배지, 기준일 · 공고 데이터 기준일은 평가의 `today` · `asOf`), 프로필 칩, 내 일정 축(시안 `scheduleAxis` 모양, 지금 일정 칩 기능 · 되돌리기 · 일정 추가), 내 계획(시안 `draftSummary`, **총액 상자 없음**), 도구 줄(검색 · 분야 필터 · AI 추천 경로 보기 · 신청 불가 모아보기), 시점별 보드
  - 카드 : 시안 카드 모양 + 오른쪽 위 별표 버튼. 판정 · 기한 · 사유 · 담기 동작은 지금 `PolicyCard` 그대로
  - 관심 정책 탭 : 별표한 정책을 시안 `savedGrid` 로. 지금 평가에 그 정책 카드가 없으면 "지금 판정에 없어요(회차 마감 등)" 와 별표 해제만
  - "/" 키로 검색 칸 이동 (시안 placeholder)

- [ ] **Step 1: 실패하는 테스트**

```ts
test("blank search shows all", () => { expect(matchesSearch(card, "  ")).toBe(true); expect(matchesSearch(card, "(")).toBe(false); expect(matchesSearch(card, card.title.slice(0, 3))).toBe(true); });
test("stars persist and toggle", () => { const s = createStarStore(memoryStorage()); expect(s.toggle("p1")).toBe(true); expect(s.has("p1")).toBe(true); expect(s.toggle("p1")).toBe(false); });
test("missing starred policy is kept with a note", () => { /* Saved 렌더 : stars 에 평가에 없는 ID → "지금 판정에 없어요" */ });
test("board has no total box or bell", () => { /* 보드 렌더 html 에 totalBox · bell 없음 */ });
```

- [ ] **Step 2 · 3 · 4** — 실패 확인 → 구현 → 통과 확인 (기존 `PolicyCard` 테스트의 D−61 · 기한 문구 기대값은 그대로 통과해야 한다)

---

### Task 4: 로드맵 · 계획 비교 · 인쇄 · 계정 · 길잡이 패널

**Files:**
- Modify: `app/workspace/Roadmap.tsx`, `app/workspace/Agent.tsx`, `app/workspace/Planner.tsx`, `app/workspace/workspace.module.css`
- Create: `lib/planner/compare.ts`, `app/workspace/Account.tsx`, `app/workspace/PlanCompare.tsx`
- Test: `tests/planner/compare.test.ts`, `tests/planner/render.test.ts` (추가)

**Interfaces:**
- Produces:
  - `function comparePlans(a: SavedPlan, b: SavedPlan): { onlyA: string[]; onlyB: string[]; both: string[]; moved: string[] }` — 담은 회차(`offeringId`) 기준, `moved` 는 둘 다 담았지만 시점이 다름
  - 로드맵 : 시안 모양(계획 고르기, 이 계획의 일정, 범례, 막대). "오늘 기준으로 다시 보기" = 지금의 저장 계획 재판정, "복사해 편집" = 지금의 복사 편집, "인쇄 · PDF" = `window.print()` + 인쇄용 CSS(메뉴 · 길잡이 숨김)
  - 계획 비교 : 두 계획을 골라 `comparePlans` 결과를 표로. 계획이 2개 미만이면 버튼 비활성 + "계획을 두 개 이상 저장하면 비교할 수 있어요"
  - 계정 탭 : 시안 `accountGrid` 중 "계정 상태"(저장 방식 = 이 브라우저, 저장한 계획 수, 예시 프로필 배지) · "내 정보"(지금 프로필, 수정 → `#onboarding`) 만. **알림 · 최근 알림 패널 없음**. 로그아웃 → `/login`
  - 길잡이 패널 : 시안 모양(`agentHead` · 예시 버튼 3개 · 입력 · 바닥 문구 = 설계 표의 새 문구). 기능은 지금 `Agent` 그대로(질문 카드 · AI 질문 · 동의 · 추천 · 답변)

- [ ] **Step 1: 실패하는 테스트**

```ts
test("compare finds only, both and moved", () => { /* 계획 A 담음 {x@current, y@current}, B 담음 {y@ev-course, z@current} → onlyA [x], onlyB [z], both [y], moved [y] */ });
test("compare needs two plans", () => { /* 계획 1개로 PlanCompare 렌더 → 버튼 disabled + 안내 문구 */ });
test("agent footer describes real roles", () => { /* Agent 렌더 → "설명만 해요" 없음, "추천해요" 있음 */ });
test("account has no notification panels", () => { /* Account 렌더 → "최근 알림" · "마감 7일 전" 없음 */ });
```

- [ ] **Step 2 · 3 · 4** — 실패 확인 → 구현 → 통과 확인

---

### Task 5: 전체 확인

- [ ] `npx tsc --noEmit` · `npm run lint` · 전체 테스트 통과
- [ ] 독립 검증 (구현과 다른 실행 맥락) — 이 계획의 설계 표 · Review Focus, 시안과의 차이, 고치지 않는 파일 미변경
- [ ] 화면 확인 — Vercel 미리보기(로그인 필요) 또는 로컬에서 `/` · `/login` · `/app` 데스크톱 · 모바일(390)
