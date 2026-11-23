# SQLite 구축 · 백엔드 아키텍처 · 서버 구축 계획

2026-11-19 · 백엔드 담당 초안 · 11월 23일 정오 제출 기준 · 근거 노트: [백엔드 계획](./2026-11-19-backend-plan.md), [데이터 사전](./2026-11-19-data-schema.md), [교차 검토표](./시연-중복수혜-교차검토.md)

**요약.** SQLite는 **빌드 시점의 적재·검증·내보내기 도구**로 쓴다. 서비스(배포된 서버)는 SQLite를 열지 않고, SQLite가 내보낸 승인본 JSON을 번들로 읽는다. 서버는 이미 있는 Next.js API 4개(`/api/judge`, `/plan`, `/verify`, `/agent`)를 Vercel에 그대로 올린다. 새 서버를 따로 만들지 않는다. 사용자 데이터는 저장하지 않으므로 런타임 DB가 필요 없다.

## 0. 확인한 사실 (2026-11-19 직접 실행)

| 사실 | 계획에 주는 영향 |
|---|---|
| 로컬 Node 22.22.2에 `node:sqlite`(SQLite 3.51.2)가 내장돼 있다. 실행 시 ExperimentalWarning만 나온다. | **의존성 추가 없음.** `better-sqlite3` 등 설치 불필요. 스크립트 전용이라 실험 기능 경고는 허용. |
| 스냅샷 4,020건을 한 트랜잭션으로 넣고 다시 읽는 데 112ms. `json_valid`·`plcyNo = policy_id` CHECK 통과. | 매번 DB를 새로 만들어도 부담 없음 → 증분 적재 대신 **전체 재생성**. |
| `data/snapshot/current.json`은 Python 형식(`", "`, `": "`)으로 저장돼 있어 `JSON.stringify` 재출력과 바이트가 다르다(5,226,760 vs 5,009,692 bytes). | 왕복 비교는 **바이트가 아니라 정규화 JSON 해시**로 한다. 원본 파일 해시는 `snapshot.source_sha256`에 따로 보존. |
| 런타임은 JSON을 `import`로 읽는다(`lib/data/snapshot.ts`, `lib/data/verified.ts`, `lib/verify/saved.ts`, `lib/route/build.ts`, `lib/data/regions.ts`). | 내보내기를 **같은 파일 형식**으로 맞추면 기존 판정 코드는 손대지 않는다. 새로 읽는 파일은 중복수혜 규칙 하나뿐. |
| 현재 제한 판정(`lib/judge/index.ts` `restrictionAxis`)은 `restrictionQuotes[].mentions`와 `profile.participating`만 본다. 시점·예외·효과 구분이 없다. | 승인 규칙을 평가하는 작은 모듈을 추가하고 `restrictionAxis`에 연결한다(2.3절). |
| 설계 문서상 배포는 Vercel(`docs/2026-11-16-policy-twin-design.md`). 호출 한도는 인스턴스 메모리(`lib/limits.ts`). | 서버 구축 = Vercel 배포 + 환경변수 + 데이터 버전 고정. |

---

## 1. SQLite 구축 계획 (1순위)

### 1.1 역할 분담과 진실의 원천

```
[온통청년 API] → scripts/fetch-snapshot.ts → data/snapshot/current.json ─┐
[Codex 전처리] → data/prep/*.json (근거·규칙 후보, 형식은 1.4) ───────────┤
[사람 검토] → data/overlap/rules.json (승인 상태·검토자 기록) ─────────────┤
[기존 JSON] → data/verified/*, verify-results, regions, route-links … ─────┘
                       ↓ npm run db:build  (빈 DB 생성 → 한 트랜잭션 적재 → 검사)
                data/db/pathfinder.sqlite   (git 제외, 제출 시 백업)
                       ↓ npm run db:export (approved만)
                data/overlap/approved.json + data/release/manifest.json  → 앱 번들
```

- **git에 있는 JSON이 원천, SQLite는 매번 재생성하는 검증·조회본**이다. 규칙의 승인 상태도 `rules.json`에 기록해 PR diff로 검토한다.
  - 이유: DB 파일 안에서 직접 고친 내용은 diff·리뷰가 안 되고, 재적재 때 사라질 위험이 있다. 전체 재생성이면 "두 번 적재해도 4,020건", "실패 시 이전 상태 유지"가 자동으로 성립한다.
  - 백엔드 계획 3절의 "SQLite에서 적재·검토"는 그대로 지킨다. 검토는 SQLite 쿼리(역추적·누락 확인)로 하고, 결정 기록만 JSON에 남긴다.
- **Codex 산출물은 `data/prep/`에만 쓴다.** 로더가 형식을 검사하므로 형식이 틀리면 적재가 실패하고, 이전 DB와 승인본은 그대로 남는다.

### 1.2 스키마 (`db/schema.sql`)

데이터 사전 1·6절을 그대로 따르되, 저장만 하는 구조는 JSON 열로 두고 **조회·검증에 쓰는 키에만** 열과 제약을 둔다.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE snapshot (
  snapshot_id   TEXT PRIMARY KEY,              -- 기준일, 예: '2026-11-16'
  as_of         TEXT NOT NULL,
  source_sha256 TEXT NOT NULL UNIQUE           -- 원본 파일 바이트 해시
) STRICT;

CREATE TABLE policy_raw (
  snapshot_id TEXT NOT NULL REFERENCES snapshot,
  policy_id   TEXT NOT NULL CHECK (length(policy_id) = 20),
  ordinal     INTEGER NOT NULL,
  raw_json    TEXT NOT NULL CHECK (json_valid(raw_json)),
  PRIMARY KEY (snapshot_id, policy_id),
  UNIQUE (snapshot_id, ordinal),
  CHECK (policy_id = json_extract(raw_json, '$.plcyNo'))
) STRICT;

CREATE TABLE verified_policy (           -- data/verified/*.json 6건
  snapshot_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  verified_json TEXT NOT NULL CHECK (json_valid(verified_json)),
  PRIMARY KEY (snapshot_id, policy_id),
  FOREIGN KEY (snapshot_id, policy_id) REFERENCES policy_raw
) STRICT;

CREATE TABLE verification_result (       -- data/verify-results/index.json
  snapshot_id TEXT NOT NULL, policy_id TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  PRIMARY KEY (snapshot_id, policy_id),
  FOREIGN KEY (snapshot_id, policy_id) REFERENCES policy_raw
) STRICT;

CREATE TABLE supporting_data (           -- regions, route-links, candidates, eval answers, replay
  snapshot_id TEXT NOT NULL REFERENCES snapshot,
  dataset_key TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (snapshot_id, dataset_key)
) STRICT;

CREATE TABLE evidence (
  evidence_id  TEXT PRIMARY KEY,           -- 사람이 읽을 수 있는 ID, 예: 'ev-110346-ptcp-1'
  snapshot_id  TEXT NOT NULL, policy_id TEXT NOT NULL,
  round_id     TEXT,                       -- 정책 안에서 해석
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('api','official')),
  source_field TEXT,                       -- api일 때 원본 키, 예: 'ptcpPrpTrgtCn'
  source_url   TEXT,
  quote_text   TEXT NOT NULL CHECK (length(quote_text) > 0),
  checked_at   TEXT NOT NULL,
  FOREIGN KEY (snapshot_id, policy_id) REFERENCES policy_raw,
  CHECK ((source_kind = 'api' AND source_field IS NOT NULL) OR (source_kind = 'official' AND source_url IS NOT NULL))
) STRICT;

CREATE TABLE policy_overlap_rule (
  rule_id          TEXT PRIMARY KEY,       -- 예: 'r-110369-110346-receiving'
  snapshot_id      TEXT NOT NULL,
  source_policy_id TEXT NOT NULL,          -- A
  target_policy_id TEXT NOT NULL,          -- B
  target_round_id  TEXT,                   -- NULL = 회차 불명 → 자동 적용 안 함
  effect_type      TEXT NOT NULL CHECK (effect_type IN
    ('participation_block','personal_payment_block','selection_excluded','apply_block','allowance_choice','amount_deduction')),
  condition_type   TEXT NOT NULL CHECK (condition_type IN
    ('receiving','within_months_after_end','selected','status_on_notice_date','period_overlap')),
  reference_event  TEXT,                   -- 'apply_date' | 'notice_date' | 'training_start' …
  condition_params_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(condition_params_json)),
  exception_json   TEXT CHECK (exception_json IS NULL OR json_valid(exception_json)),
  evidence_id      TEXT NOT NULL REFERENCES evidence,
  prepared_by      TEXT NOT NULL,
  reviewed_by      TEXT, reviewed_at TEXT, review_note TEXT,
  review_status    TEXT NOT NULL CHECK (review_status IN ('draft','changes_requested','on_hold','approved')),
  FOREIGN KEY (snapshot_id, source_policy_id) REFERENCES policy_raw,
  FOREIGN KEY (snapshot_id, target_policy_id) REFERENCES policy_raw,
  CHECK (source_policy_id <> target_policy_id),
  -- 교차 승인: 승인이면 검토자·검토일이 있고 작성자와 다르다
  CHECK (review_status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by <> prepared_by))
) STRICT;
```

- 같은 A→B에 규칙 여러 개 허용(1번 "수급 중"과 2번 "종료 후 6개월"이 별도 행).
- 근거가 B의 것인지는 CHECK로 못 거므로 적재 후 검사(1.3 ⑤)로 확인한다.
- 정책 원본에 없는 대상(표 2의 "상대 레코드 없음")은 이번 규칙 테이블에 넣지 않는다. 원문 이름만 있는 후보는 `data/prep/`에 남기고 화면에는 "확인 필요"로만 쓴다.
- `effect_type`/`condition_type` 코드는 교차 검토표 4건을 표현할 수 있는 최소 집합이다. 프론트·AI와 API 계약을 합의할 때 확정한다(백엔드 계획 4절).

### 1.3 적재 명령 `npm run db:build` (`scripts/db-build.ts`)

1. `data/db/pathfinder.sqlite.tmp`를 새로 만들고 스키마 실행.
2. **한 트랜잭션**으로 snapshot → policy_raw → verified/result/supporting → evidence → rules 순서 적재. 하나라도 실패하면 ROLLBACK, tmp 삭제, 종료 코드 1.
3. 적재 후 검사(모두 통과해야 다음 단계):
   - ① `policy_raw` 행 수 = 원본 `records.length` = 고유 `plcyNo` 수 (학습 노트: 행 수만 맞고 ID 중복인 경우 차단)
   - ② 정규화 JSON 해시: DB에서 다시 만든 `{asOf, records}`의 해시 = 원본 파싱 후 정규화 해시 (빈 문자열·누락 키 보존 확인)
   - ③ verified 6건·결과 6건·지역표 등 자료별 건수와 정책번호 대조
   - ④ `PRAGMA foreign_key_check` 결과 없음, `PRAGMA integrity_check` = ok
   - ⑤ 규칙의 `evidence.policy_id = target_policy_id`, `source_kind='api'`이면 `quote_text`가 B 원본의 `source_field` 값에 실제로 포함되는지 `instr(json_extract(...), quote_text) > 0`
   - ⑥ 기존 `loadSnapshot()` 결과와, DB에서 꺼낸 원본에 `normalize`를 적용한 결과가 같은지 (앱 구조 재현)
4. 통과하면 tmp를 `pathfinder.sqlite`로 rename(원자적 교체). 실패 시 이전 DB 파일이 그대로 남는다.

### 1.4 Codex와 합의할 인계 형식 (전처리 → 적재)

Codex 쪽 전처리 결과를 아래 두 파일 형식으로 받는다. 형식이 다르면 로더가 zod 오류 위치를 출력하고 적재를 중단한다.

```jsonc
// data/prep/evidence.json
[{ "evidence_id": "ev-110346-ptcp-1", "policy_id": "20250122005400110346", "round_id": null,
   "source_kind": "api", "source_field": "ptcpPrpTrgtCn", "source_url": null,
   "quote_text": "구직급여를 받고 있거나", "checked_at": "2026-11-19" }]

// data/overlap/rules.json  (Codex는 draft까지만 작성, 승인 필드는 사람이 채움)
[{ "rule_id": "r-110369-110346-receiving", "source_policy_id": "20250122005400110369",
   "target_policy_id": "20250122005400110346", "target_round_id": "2026-1",
   "effect_type": "participation_block", "condition_type": "receiving", "reference_event": "apply_date",
   "condition_params": {}, "exception": { "note": "수급자격만 있고 미수급이면 참여 가능" },
   "evidence_id": "ev-110346-ptcp-1", "prepared_by": "백엔드", "review_status": "draft" }]
```

Codex에 먼저 확인할 것: 산출 위치·형식이 이와 다르면 맞출지, 아니면 로더에 변환 한 단계를 둘지. 스냅샷 원본 자체는 전처리하지 않고 그대로 적재한다(백엔드 계획 첫 문단).

### 1.5 내보내기 `npm run db:export` (`scripts/db-export.ts`)

- `data/overlap/approved.json`: `review_status='approved'`이고 `target_round_id`가 있는 규칙 + 참조 근거만. draft·보류·회차 불명은 나가지 않는다.
- `data/release/manifest.json`: `{ dataVersion, snapshotAsOf, counts: {...}, files: { 경로: sha256 } }`. `dataVersion`은 내보낸 파일 해시들의 해시 앞 12자리.
- 스냅샷·검증 JSON은 git의 원천 파일을 그대로 번들에 쓰므로 다시 쓰지 않는다. manifest에 해시만 기록한다.
- `npm run db:verify`: 백업 SQLite만으로 내보내기를 다시 실행해 manifest 해시가 커밋된 것과 같은지 확인(백엔드 계획 7단계 "새 경로에서 복원").

### 1.6 테스트 (`tests/db/*.test.ts`, vitest, `:memory:` DB)

| 시나리오 | 기대 결과 |
|---|---|
| 정상 스냅샷 2회 적재 | 두 번 다 4,020행, manifest 해시 동일 |
| 같은 `plcyNo` 2번 포함 | 적재 실패, 이전 DB 파일 유지 |
| 승인인데 `reviewed_by = prepared_by` | CHECK 실패 |
| 규칙이 존재하지 않는 정책 참조 | FK 실패 |
| 인용문이 B 원본 필드에 없음 | 검사 ⑤ 실패 |
| draft·on_hold·회차 불명 규칙 | approved.json에 없음 |
| 빈 문자열 필드와 누락 키가 섞인 레코드 | 정규화 해시 일치 |

---

## 2. 백엔드 아키텍처 (2순위)

### 2.1 전체 구성

```
 빌드 시점(로컬·백엔드 담당)                       런타임(Vercel, 상태 없음)
 ─────────────────────────────                  ──────────────────────────────────────────────
 fetch-snapshot ─┐                               브라우저 ──POST /api/judge──▶ lib/judge (코드 판정, 외부 AI 없음)
 Codex 전처리 ───┼─▶ db:build ─▶ SQLite          │        ──POST /api/plan ──▶ lib/plan  (판정 결과 요약 → AI, 플래그)
 사람 검토 ──────┘      │                        │        ──POST /api/verify─▶ lib/verify (공고 대조 에이전트, 한도)
                        └─▶ db:export ─▶ JSON ───┘        ──POST /api/agent ─▶ lib/agent (가상 인물 상담)
                               (git 커밋 = 데이터 버전)    모든 응답에 dataVersion 포함
```

- **저장소 계층:** 정책·근거·규칙은 읽기 전용 번들 JSON(약 5MB). 사용자 프로필·채팅·실제 수혜 내역은 **요청 본문으로만 오가고 저장하지 않는다**(데이터 사전 7절, `/api/judge` 주석의 "저장·기록하지 않는다" 유지).
- **런타임에 SQLite를 쓰지 않는 이유:** ① 쓰기 작업이 없다 ② Vercel 함수 파일시스템은 읽기 전용·인스턴스별이라 DB 파일을 둘 이유가 없다 ③ `node:sqlite`가 실험 기능이다 ④ 지금처럼 `import`하면 콜드 스타트 외 비용이 없다.
- **바꿀 시점:** 계정·저장된 계획처럼 사용자 데이터를 서버에 남겨야 하면 그때 관리형 Postgres를 붙인다. 이번 제출 범위가 아니다.

### 2.2 새로 생기는 코드 (최소)

| 파일 | 역할 |
|---|---|
| `db/schema.sql` | 1.2절 DDL |
| `scripts/db-build.ts`, `scripts/db-export.ts` | 1.3·1.5절. `package.json`에 `db:build`, `db:export`, `db:verify` 스크립트 |
| `lib/data/overlap.ts` | `data/overlap/approved.json`을 zod로 검사해 로드(`lib/data/verified.ts`와 같은 패턴), `target_policy_id`별 Map |
| `lib/judge/overlap.ts` | 규칙 평가 순수 함수 `evaluateRules(rules, benefits, plannedBenefits, now)` |
| `lib/judge/index.ts` `restrictionAxis` | 승인 규칙이 있는 B는 평가 결과 우선, 없으면 기존 인용·키워드 경로 유지 |
| `lib/judge/handler.ts` | 요청에 `benefits`, 응답에 `restrictions`·`dataVersion` 추가 |

### 2.3 규칙 평가 의미 (교차 검토표 4건 기준)

[결정 3A · 2026-11-20] `benefits[]`는 선택 입력이다. `policyId`와 함께 현재 상태·마지막 지급일·예정 기간, 자격만 있고 실제 미수급인 상태, 공고일 당시 신분, 해당 월 지급액을 받을 수 있다. 기존 `participating[]`는 이전 화면의 참여 목록으로 유지하고, 개인에게 새 확정 규칙을 적용할 때는 명시한 사실만 사용한다. [필드 계약과 테스트](./2026-11-19-overlap-agent-implementation-plan.md#t13-규칙을-개인-상태와-대조하고-api에-연결)

| condition_type | 적용(`applies`) | 적용 안 함(`not_applies`) | 정보 부족(`needs_info`) → 질문 |
|---|---|---|---|
| `receiving` | A가 `receiving` | A가 `applied`·`ended`, 또는 "수급자격만 있음" | A가 `unknown`("모름") |
| `within_months_after_end` | `ended`이고 기준일 − `lastPaymentDate` < months | 경과 ≥ months | `ended`인데 날짜 없음 → "마지막 지급일" 질문 |
| `selected` | A가 `selected`·`receiving` | A가 `applied`(선정 대기) | — |
| `status_on_notice_date` | 공고일에 A 상태 | 과거에만 해당 | 공고일 미상 |
| `period_overlap` | `planned` 기간이 겹침 → `planned_conflicts` | 겹치지 않음 | 계획 기간 미정 |

- 결과는 `current_restrictions`(실제 수혜 기준)와 `planned_conflicts`(예정 수혜 기준)로 나눈다. 같은 규칙을 둘 다에 재사용한다.
- `needs_info`·`unknown`은 **절대 차단하지 않는다**. 카드에는 "확인 필요"와 필요한 질문 하나만 표시한다(백엔드 계획 4절 인계 실패 조건).
- `exception`은 효과 범위를 좁힌다. 예: 미래내일 일경험은 `personal_payment_block` + 예외 "팀 지원금 허용" → 정책 전체가 아니라 개인 지원금 항목만 제한.

### 2.4 API 계약 변경안 (`POST /api/judge`, 하위 호환)

```jsonc
// 요청 추가
"benefits": [{ "policyId": "20250122005400110369", "status": "ended", "lastPaymentDate": "2026-07-15" }]

// 응답: 정책 항목마다 추가
"restrictions": [{
  "ruleId": "r-110369-110346-after6m", "sourceId": "20250122005400110369", "sourceName": "구직급여",
  "effect": "participation_block", "state": "applies",            // applies | not_applies | needs_info
  "reason": "구직급여 지급 종료 후 6개월이 지나지 않음(2027-01-15까지)",
  "evidence": { "field": "ptcpPrpTrgtCn", "quote": "구직급여의 지급이 끝난 날부터 6개월이 지나지 아니한 자", "url": null, "checkedAt": "2026-11-19" },
  "question": null
}],
// 응답 최상위 추가
"dataVersion": "a1b2c3d4e5f6"
```

- `/api/plan`의 캐시 키에 `dataVersion`과 최종 판정 해시를 추가한다(백엔드 계획 "확정한 사용자 흐름").
- 프론트·AI에 넘길 예시 4종: 적용 / 적용 안 함 / 정보 부족 / 승인 근거 없음(규칙 없음).

---

## 3. 서버 구축 계획 (3순위)

새 서버를 만들지 않고 **기존 Next.js 앱을 Vercel에 배포**한다. API는 이미 `runtime = "nodejs"`로 선언돼 있다.

| 순서  | 작업                                                                                                                                    | 완료 기준                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Vercel 프로젝트 연결(GitHub 저장소, Production 브랜치 `main`), 함수 리전을 서울(`icn1`)로 지정                                                              | 프리뷰 배포 URL에서 첫 화면이 열림                                         |
| 2   | 환경변수: `ANTHROPIC_API_KEY`, `EXTERNAL_AI_ENABLED`, `PLAN_AI_FOR_USERS`. **`YOUTH_POLICY_API_KEY`는 넣지 않는다**(수집 전용) | `.env.example`과 키 목록 일치, 저장소에 키 없음(`git grep "sk-ant"` 결과 없음) |
| 3   | 요금제 한도 확인: `/api/verify`·`/api/agent`의 `maxDuration = 120`이 허용되는지, 번들 크기(스냅샷 5MB 포함)                                                  | 허용 안 되면 60으로 낮추고 검증 에이전트 마감시간(`DEFAULT_DEADLINE_MS`)도 맞춤      |
| 4   | 배포 전 게이트: `npm run db:build && npm run db:export && npm test && npm run build`. manifest 변경은 커밋에 포함                                   | 로컬에서 4개 모두 통과                                                 |
| 5   | 배포 후 스모크: 시연 3지역 가상 인물로 `/api/judge` 호출, 응답의 `dataVersion`이 manifest와 같은지, 교차 검토표 4건의 적용/비적용 입력 결과                                    | 8개 입력 모두 기대값, 로그아웃·휴대폰에서 접속                                   |
| 6   | 되돌리기: 데이터 문제는 이전 커밋의 `approved.json`·manifest로 재배포, 앱 문제는 Vercel 이전 배포로 즉시 롤백                                                         | 11/22 연습 때 한 번 실행해 봄                                          |
| 7   | 제출: `submission-2026-11-23` 태그 + `pathfinder.sqlite` 백업 파일과 sha256 보관                                                                 | 백업에서 `db:verify` 통과                                           |

**AI 호출량:** 앱 자체 IP별·전체 일일 횟수 제한은 두지 않는다. 실제 과금·사용량·속도 제한은 AI 제공자 설정과 콘솔에서 관리하고, 전체 AI 호출은 `EXTERNAL_AI_ENABLED`로 차단할 수 있다.

---

## 4. 일정 (백엔드 계획 5절과 맞춤)

| 날짜 | 작업 |
|---|---|
| 11/19 | 이 계획 합의. Codex와 1.4 형식 확정. 프론트·AI와 2.4 예시 4종 합의 |
| 11/20 | `schema.sql`, `db:build`, 검사 ①~⑥, 1.6 테스트. 교차 검토표 4건을 `rules.json`에 승인 상태로 기록 |
| 11/21 | `db:export`, `lib/data/overlap.ts`, `lib/judge/overlap.ts`, `restrictionAxis` 연결, API 응답 확장. Vercel 프리뷰 배포(3장 1~3) |
| 11/22 | 3지역 시연·경계값(마감 당일, 6개월 경계)·백업 복원 시험, 롤백 연습 |
| 11/23 오전 | 최종 스냅샷 → `db:build`/`db:export` → 게이트 → 배포 → 스모크 → 태그·백업 |

## 5. 결정이 필요한 것

1. **규칙·승인 기록의 원천을 git JSON으로 둘지**(이 계획의 권장) 아니면 SQLite 파일 자체로 둘지. 후자면 SQLite 파일을 커밋하고 재생성 대신 증분 적재·마이그레이션이 필요하다.
2. Codex 전처리 산출물의 위치·형식(1.4).
3. `effect_type`·`condition_type` 코드값과 `/api/judge` 응답 형태(2.4)를 프론트·AI 담당자와 확정.
