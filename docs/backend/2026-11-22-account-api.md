# 계정·계정 저장 계획·알림 API (2차 MVP 백엔드)

프론트에서 넘겨받은 "2차 MVP — 백엔드 새 기능 설계"(2026-11-22) 3.1~3.3절의 구현이다. 프론트 명세 `docs/superpowers/specs/2026-11-21-pathfinder.md` 9.2절의 요청 모양을 따른다. 예상 총액(3.4)과 필요 서류(3.5)는 아직 구현하지 않았다.

## 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 로그인 | 이메일·비밀번호. 카카오·네이버·매직 링크는 구현하지 않음 | 외부 앱 등록·메일 발송 서비스 없이 동작 |
| 비밀번호 | scrypt(무작위 salt 16바이트, 키 64바이트) 해시만 저장. 8~128자 | Node 기본 모듈만 사용, 새 의존성 없음 |
| 세션 | 무작위 32바이트 토큰을 `pf_session` 쿠키(HttpOnly, SameSite=Lax, 운영은 Secure)로 주고 서버에는 SHA-256 해시만 저장. 30일 | 쿠키가 새도 DB에서 토큰을 복원할 수 없음 |
| 저장소 | `AccountStore` 인터페이스 + SQLite 구현 하나(`lib/account/store.ts`) | 운영 DB 미정. 정하면 같은 메서드의 구현을 추가 |
| CSRF | 쓰기 요청은 같은 출처의 `application/json`만 받음 | SameSite=Lax와 함께 다른 사이트의 폼·요청 차단 |

## 저장 위치와 한계

| 환경 | 파일 | 유지 |
|---|---|---|
| 로컬 | `data/db/accounts.sqlite` (git 제외) 또는 `ACCOUNT_DB_PATH` | 유지됨 |
| Vercel | `/tmp/pathfinder-accounts.sqlite` | **인스턴스가 바뀌면 사라짐.** `/api/account/me`의 `durable: false`로 화면에 알린다 |

- 운영 DB를 정하기 전까지 배포본의 계정·계획·알림은 시연용이다.
- 로그인 실패 제한(같은 주소·이메일 10회 → 15분)과 계획 저장 횟수 제한(사용자당 분당 10회)은 인스턴스 메모리에 센다. `lib/limits.ts`와 같은 한계다.
- 계획은 사용자당 50개까지, 요청 본문은 20만 자까지 받는다. 같은 재시도 키의 재전송은 다시 판정하지 않고 한도에도 세지 않는다.
- 가입은 이미 있는 이메일에 409를 돌려주므로 가입 여부가 드러난다. 로그인은 가입 여부를 구분하지 않는다. 가입 화면에서 안내가 필요해 받아들인 절충이다.
- 쓰기 요청의 출처 검사는 `Origin`과 요청 URL의 출처를 비교한다. Vercel에서는 같지만, 호스트를 바꾸는 역방향 프록시 뒤에 두면 맞춰야 한다.
- 계획을 저장할 때 서버가 전체 판정을 다시 돌린다(로컬 약 0.3~0.7초). 저장본 하나는 판정 결과를 포함해 약 3MB다.

## 시연 계정

`data/account/seed-accounts.json`의 계정은 저장소를 열 때마다(새 Vercel 인스턴스 포함) 넣는다. `/tmp`가 비어도 이 계정으로는 항상 로그인할 수 있다. 파일에는 scrypt 해시만 있고 비밀번호 원문은 저장소에 두지 않는다. 이 계정이 저장한 계획과 알림은 다른 계정처럼 인스턴스가 바뀌면 사라진다.

## API

**모든 계정 API는 한 경로 `/api/account/...`에서 처리한다**(`app/api/account/[...path]/route.ts` → `lib/account/router.ts`). Vercel은 설정이 다른 API 경로를 서로 다른 함수로 올리고 함수마다 `/tmp`가 따로라서, 2026-11-23 미리보기 배포에서 가입 함수의 세션을 계획 함수가 몰라 `/api/plans`가 401을 돌려줬다. 계정 기능을 다른 경로로 나누지 않는다. 한 함수로 모아도 인스턴스가 늘거나 바뀌면 저장소는 다시 갈라지므로, 운영 DB 전까지는 짧은 시연용이다.

모든 응답은 JSON, `cache-control: no-store`. 오류는 `{ "error": "사용자에게 보여 줄 문장" }`.

### 계정

| 요청 | 본문 | 응답 |
|---|---|---|
| `POST /api/account/signup` | `{ email, password, displayName? }` | 201 `{ mode: "account", userId, displayName }` + 세션 쿠키. 400 형식 오류, 409 이미 가입 |
| `POST /api/account/login` | `{ email, password }` | 200 위와 같음 + 쿠키. 401 불일치(가입 여부를 구분하지 않음), 429 시도 초과 |
| `POST /api/account/logout` | `{}` | 200 `{ mode: "guest" }`, 쿠키 삭제·세션 폐기 |
| `GET /api/account/me` | | `{ mode: "guest" }` 또는 `{ mode: "account", userId, displayName, durable }` |

### 계정 저장 계획

| 요청 | 입력 | 응답 |
|---|---|---|
| `POST /api/account/plans` | 헤더 `Idempotency-Key`(영숫자·`_`·`-` 8~100자), 본문 `{ name(1~35자), source: "manual"\|"recommendation", recommendationSource?, profileSnapshot, input }` | 201 `{ planId, createdAt }`. 같은 키·같은 본문 재전송은 200과 기존 결과, 같은 키·다른 본문은 409. 담은 정책 0개는 400. 미로그인 401 |
| `GET /api/account/plans?cursor=` | | 200 `{ plans: [{ planId, name, source, createdAt, dataVersion, choiceCount }], nextCursor }`. 생성일 역순 20개. **요약만** 준다 |
| `GET /api/account/plans/:id` | | 200 `SavedPlan` 전체(`savedEvaluation`은 서버가 저장 시점에 다시 판정한 결과). 없음·다른 소유자 모두 404 |

화면 연결용 클라이언트는 `lib/planner/server-storage.ts`의 `createServerPlanRepository()`다. 브라우저 저장소(`createPlanRepository`)와 같은 세 메서드를 비동기로 제공하되, `listPlans()`는 요약 목록을 돌려준다. 계획을 열 때 `getPlan(id)`로 본문을 받는다. `createPlan(plan)`은 화면이 만든 `planId`를 재시도 키로 쓰고 서버가 판정한 저장본을 돌려준다. `fetchMe`·`signupAccount`·`loginAccount`·`logoutAccount`도 같은 파일에 있다.

### 알림

| 요청 | 본문 | 응답 |
|---|---|---|
| `GET /api/account/notifications` | | `{ notifications: [{ id, kind, planId, policyId, title, body, createdAt, readAt }], unread }` 최근 50개 |
| `POST /api/account/notifications/read` | `{ ids: [...] }` 또는 `{ all: true }` | `{ updated, unread }` |
| `GET /api/account/notification-settings` | | `{ deadline, noticeChange, newPolicy }` 기본값 모두 `true` |
| `PUT /api/account/notification-settings` | 위와 같은 세 값 | 저장한 값 |
| `GET /api/account/cron/notifications` | 헤더 `Authorization: Bearer <CRON_SECRET>` | `{ plans, created, failed }`. `CRON_SECRET`이 없으면 503 |

정기 작업은 저장 계획마다 오늘 기준으로 다시 판정해 저장 당시 결과와 비교한다(`lib/account/notifications.ts`). 가장 오래 확인하지 않은 계획부터 하나씩 읽고 45초 안에서만 처리한다. 못 끝낸 계획은 다음 실행에서 먼저 처리되고, 응답의 `complete`가 끝까지 처리했는지 알려 준다.

| 종류 | 조건 | 중복 방지 키 |
|---|---|---|
| `deadline` | 담은 정책이 신청 불가가 아니고 남은 날이 0~7일 | 계획·회차·마감일 |
| `notice_change` | 데이터 기준일이 저장 당시와 다르고, 담은 정책의 판정이나 공고 마감이 바뀌었거나 회차가 사라짐 | 계획·기준일·회차 |
| `new_policy` | 저장 당시 같은 시점에서 신청 가능이 아니던 정책이 신청 가능이 됨. 계획마다 마감이 가까운 3개까지 | 계획·시점·회차 |

같은 키의 알림은 한 번만 쌓인다. 한 계획의 판정이 실패해도 다른 계획은 계속 처리한다. 발송은 화면 안 알림(벨)만 한다.

정기 실행을 켜려면 Vercel 환경변수에 `CRON_SECRET`을 넣고 `vercel.json`에 `"crons": [{ "path": "/api/account/cron/notifications", "schedule": "0 0 * * *" }]`(매일 09:00 KST)를 추가한다. 운영 DB 없이 켜면 알림이 인스턴스와 함께 사라지므로 아직 추가하지 않았다.

## 남은 일

| 항목 | 상태 |
|---|---|
| 운영 DB 구현(`AccountStore`) | DB 결정 필요 |
| 화면 연결(로그인 폼, 계정 탭, 벨, 저장 방식 전환) | 프론트 담당 |
| 게스트 계획 가져오기 | 화면에서 `createPlan`을 건별 호출하면 됨. 서버 추가 작업 없음 |
| 예상 총액·필요 서류 (설계 3.4·3.5) | 공고에서 확인한 금액·서류 데이터가 먼저 필요 |
| 계정 삭제·보관 기간 | 운영사무국 기준 확인 필요 |
