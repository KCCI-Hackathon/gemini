# 2차 MVP 화면 — 프론트엔드 인계 (작업 3 · 4)

> 2026-11-22 · 정리 : Jongeume (Claude Code 와 작업) · 브랜치 `frontend/mvp2-screens`
> 화면 시안 : `docs/design/mvp2/app.html` (정적 HTML · 가짜 데이터 — 모양 · 문구 · CSS 값만 가져온다) · 그림 `public/pathfinder/*.png`
> 전체 계획 : `docs/superpowers/plans/2026-11-22-mvp2-screens.md` · 백엔드 몫 : `docs/handoff/2026-11-22-mvp2-backend-features.md`

**한 줄 요약 : 2차 MVP 화면 교체 중 작업 1 · 2(소개 · 로그인 · 앱 껍데기 · 테마)는 이 브랜치에서 끝났다. 남은 작업 3(정책 보드 · 검색 · 별표 · 관심 정책)과 작업 4(로드맵 · 계획 비교 · 인쇄 · 계정 · 길잡이 패널)를 프론트엔드에서 이어서 한다.**

---

## 1. 이미 된 것 (이 브랜치)

{DONE}

---

## 2. 정해진 설계

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


### 지킬 것 (전체 계획 Global Constraints)

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


### 이어서 할 작업에 해당하는 주의점

- 별표한 정책이 새 판정에서 사라짐(회차 마감 등) → 관심 정책 탭에 "지금 판정에 없음" 으로 남고 오류 없음 → Task 3 테스트 `missing starred policy is kept with a note`
- 저장한 계획이 1개뿐일 때 계획 비교 → 버튼 비활성 + 안내 → Task 4 테스트 `compare needs two plans`
- 검색어가 공백 · 특수문자 → 필터가 깨지지 않고 전체 표시 → Task 3 테스트 `blank search shows all`

---

## 3. 남은 작업

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


---

## 4. 끝낼 때

- `npx tsc --noEmit` · `npm run lint` · `npx vitest run --maxWorkers=4 --testTimeout=60000` 통과
- 화면 확인 : `/` · `/login` · `/app` 을 데스크톱 · 모바일(390) 에서. 360px 에서 가로 스크롤 없음 (보드 · 로드맵 내부 스크롤 제외)
- 숨기기로 한 기능(예상 총액 · 필요 서류 · 알림 벨 · 알림 설정 · 최근 알림)이 마크업에 없는지
- 이 브랜치 → `dev` PR
