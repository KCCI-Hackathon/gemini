# SQLite 구축 실행 계획

## 2026-11-19 설계 확정 후 적용할 실행 순서

**[결정] 실행 기준은 [중복수혜 에이전트와 SQLite 통합 구현 계획](./2026-11-19-overlap-agent-implementation-plan.md)이다.** 아래 가로줄 이후는 변경 전 계획의 기록이다. SQL 열과 테스트 기대값이 다르면 통합 계획을 따른다. 기존의 원본 보존·무결성·Windows 교체·재현 검사는 계속 적용한다.

| 기존 작업 | 현재 실행할 내용 |
|---|---|
| Task 1 연결·DDL | 통합 T1·3. 사람 승인 상태·검토자 CHECK를 제거한다. 판정·사유·출처·실행·항목·기간·검증 인용·동명 ID를 저장하고 `agent_clause`를 둔다. |
| Task 2 원천 읽기 | 통합 T2·3·11. 57쌍의 고정 조사본, 조건별 정답, 병합 근거·규칙과 실행 추적 자료를 검사한다. |
| Task 3 적재 | 통합 T11. 인용·정책 불일치 시 적재 실패, 이전 정상 DB 보존. |
| Task 4 시연 원천 | 통합 T2·9·10. 시연 4조건은 기존 57쌍 안의 연구 자료다. 이름·검토일을 받을 필요가 없다. 4번의 2026 회차 적용은 확인 필요다. |
| Task 5 내보내기 | 통합 T12. `blocked`·`needs_check` 모두 대상이고 회차 null도 허용한다. 같은 실행 통과 자료만 agent를 내보내며, 불합격이면 research만 내보낸다. |
| Task 6 빈 상태 재현 | 통합 T14. 저장된 응답부터 재생한 뒤 DB·배포본을 복원한다. 모든 Task는 대상 테스트 2회 연속과 shuffle 1회가 완료 기준이다. |

---

## 변경 전 실행 계획 (기록용)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** git의 JSON 원천(온통청년 스냅샷·기존 검증 자료·중복수혜 규칙)을 명령 한 번으로 SQLite에 적재·검사하고, 승인 규칙만 JSON으로 내보낸다.

**Architecture:** 매 실행마다 빈 임시 DB를 만들고 한 트랜잭션으로 적재 → 검사 → 통과하면 원자적으로 교체한다. git JSON이 원천이고 `.sqlite`는 재생성물(git 제외)이다. 런타임 앱은 이번 계획에서 건드리지 않는다(판정 연결은 다음 계획).

**Tech Stack:** Node 22.22 내장 `node:sqlite`(SQLite 3.51.2), TypeScript, zod 4(설치됨), tsx(스크립트), vitest(테스트). 새 의존성 없음.

**Spec:** [SQLite·서버 계획](./2026-11-19-sqlite-server-plan.md) 1장, [데이터 사전](./2026-11-19-data-schema.md), [교차 검토표](./시연-중복수혜-교차검토.md)

## 확정된 결정 (2026-11-19 사용자 답변)

| 항목 | 결정 |
|---|---|
| 원천 | git JSON. `data/db/`는 `.gitignore`에 추가 |
| Codex 산출물 | 형식 미정. 첫 적재는 아래 4개 규칙을 손으로 작성. Codex에는 Task 2의 `data/overlap/*.json` 형식으로 달라고 요청한다 |
| 교차 검토표 4번 | `on_hold`로 적재(2025 안내 기준, 2026 회차 미확인) |
| 작성자·검토자 | 실명/닉네임으로 기록. **아직 받지 못함 → Task 4 시작 전에 사용자에게 받는다.** 정책 검증 AI 에이전트를 다시 만들지 검토 중(2026-11-19)이라, 에이전트가 근거·규칙 초안을 만들게 되면 Task 2 형식과 `prepared_by` 기록 방식을 그때 다시 정한다 |
| 11/23 새 스냅샷에서 인용·정책 불일치 | 적재 실패로 멈춘다. 해당 `rule_id`를 출력하고 이전 승인본을 유지한다. 사람이 원문을 다시 보고 규칙을 고치거나 보류로 바꾼 뒤 다시 적재한다 |

## Global Constraints

- 정책번호는 20자리 `TEXT`. 숫자로 바꾸지 않는다.
- 원본 레코드는 JSON 그대로 저장. 빈 문자열과 누락 키를 구분해 보존한다.
- `approved` 규칙은 `reviewed_by`·`reviewed_at`가 있고 `reviewed_by <> prepared_by`.
- `target_round_id`가 NULL인 규칙은 내보내지 않는다(회차 불명은 자동 적용 안 함).
- 모든 DB 연결은 `PRAGMA foreign_keys = ON`.
- **테스트 완료 기준(사용자 규칙):** 한 번 통과로 완료라고 하지 않는다. 각 Task는 ① 대상 테스트 2회 연속 통과 ② `--sequence.shuffle`로 1회 통과를 모두 기록해야 완료. 마지막 Task는 빈 상태에서 다시 실행한다.
- 커밋은 사용자가 승인할 때만 한다(초안 문서는 로컬 유지).

## Review Focus

1. **11/23 새 스냅샷에서 규칙 인용문이 바뀌거나 B 정책이 사라짐** → 적재가 실패하고 해당 `rule_id`와 검사 이름을 출력해야 한다. 조용히 빠지면 안 된다. (Task 3 `quote-in-source`, Task 4 실제 데이터 테스트)
2. **같은 정책번호가 두 번 있는 스냅샷**(행 수는 맞음, 학습 노트 1행) → 실패, 이전 DB 유지. (Task 3)
3. **적재 중간 실패** → 이전 `pathfinder.sqlite`가 바이트 그대로 남는다. (Task 3)
4. **DB 파일이 다른 프로그램(DB 뷰어 등)에서 열린 채로 적재** → Windows에서 교체(rename)가 `EPERM`으로 실패한다(2026-11-19 직접 확인). `[replace]` 메시지로 알리고 임시 파일을 지우며 이전 DB를 유지해야 한다. 자기 연결은 교체 전에 `db.close()`. (Task 3)
5. **빈 문자열·누락 키가 섞인 레코드** → 정규화 해시 일치. (Task 3 픽스처)

## 파일 구조

| 파일 | 책임 |
|---|---|
| `lib/db/sqlite.ts` | `node:sqlite` 가져오기와 `openDb` — 가져오는 방법을 바꿔야 할 때 이 파일만 수정 |
| `lib/db/schema.ts` | `SCHEMA_SQL` 문자열(서버 계획 1.2절 DDL 그대로) |
| `lib/db/sources.ts` | 원천 JSON 읽기 + zod 검사 → `Sources` |
| `lib/db/build.ts` | 적재·검사·원자적 교체 |
| `lib/db/export.ts` | 승인 규칙 내보내기·manifest·일치 확인 |
| `scripts/db-build.ts`, `scripts/db-export.ts` | CLI 래퍼 |
| `data/overlap/evidence.json`, `data/overlap/rules.json` | 손으로 작성하는 근거·규칙 원천 |
| `tests/db/fixtures.ts`, `tests/db/*.test.ts` | 정책 3건짜리 작은 픽스처와 테스트 |

---

### Task 1: SQLite 연결과 스키마

**Files:**
- Create: `lib/db/sqlite.ts`, `lib/db/schema.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: `openDb(path: string): DatabaseSync` (`":memory:"` 허용, foreign_keys ON), `SCHEMA_SQL: string`

- [ ] **Step 1: 준비 확인.** `ls node_modules/.bin/vitest node_modules/.bin/tsx`가 둘 다 있어야 한다. 없으면 사용자 승인 후 `npm ci`. (2026-11-19 현재 `node_modules` 없음 — npx로 돌린 결과는 무효, 학습 노트 참조)
- [ ] **Step 2: vitest에서 `node:sqlite` 가져오기 확인.** 테스트 `"node:sqlite를 불러온다"`: `new DatabaseSync(":memory:").prepare("select 1 as x").get()`이 `{ x: 1 }`. 실패하면 `lib/db/sqlite.ts`에서 `process.getBuiltinModule("node:sqlite")`로 가져오고 같은 테스트로 다시 확인. 어느 방식이 됐는지 학습 노트에 기록.
- [ ] **Step 3: 실패하는 제약 테스트 작성** (`tests/db/schema.test.ts`, 각 테스트는 `openDb(":memory:")` + `SCHEMA_SQL` + 정책 2건 삽입으로 시작):
  - `"같은 수집본에 같은 정책번호는 한 번만"` → 두 번째 INSERT가 `/UNIQUE constraint failed: policy_raw.snapshot_id, policy_raw.policy_id/`
  - `"raw_json의 plcyNo와 policy_id가 다르면 거부"` → `/CHECK constraint failed/`
  - `"작성자가 스스로 승인할 수 없다"` → `review_status='approved', prepared_by='kim', reviewed_by='kim'` → `/CHECK constraint failed/`
  - `"승인에는 검토자와 검토일이 필요"` → `reviewed_at` NULL → `/CHECK constraint failed/`
  - `"없는 정책을 가리키는 규칙은 거부"` → `source_policy_id='99999999999999999999'` → `/FOREIGN KEY constraint failed/`
  - `"A와 B가 같은 정책이면 거부"` → `/CHECK constraint failed/`
  - `"api 근거는 source_field 필수"` → `source_kind='api', source_field=NULL` → `/CHECK constraint failed/`
  - `"정상 승인 규칙은 들어간다"` → 예외 없음
- [ ] **Step 4: 실행해 실패 확인.** `npx vitest run tests/db/schema.test.ts` → `SCHEMA_SQL`/`openDb` 없음으로 FAIL
- [ ] **Step 5: 구현.** `SCHEMA_SQL`은 [서버 계획 1.2절](./2026-11-19-sqlite-server-plan.md) DDL을 그대로 옮긴다(2026-11-19에 실행해 제약 동작 확인함). `openDb`는 `new DatabaseSync(path)` 후 `PRAGMA foreign_keys = ON`.
- [ ] **Step 6: 완료 확인.** `npx vitest run tests/db/schema.test.ts` 2회 + `npx vitest run tests/db/schema.test.ts --sequence.shuffle` 1회, 모두 8 passed
- [ ] **Step 7: 커밋(사용자 승인 후)** `feat: SQLite 스키마와 연결`

### Task 2: 원천 JSON 읽기

**Files:**
- Create: `lib/db/sources.ts`, `tests/db/fixtures.ts`
- Test: `tests/db/sources.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type EvidenceRow = { evidence_id: string; policy_id: string; round_id: string | null;
    source_kind: "api" | "official"; source_field: string | null; source_url: string | null;
    quote_text: string; checked_at: string };
  type RuleRow = { rule_id: string; source_policy_id: string; target_policy_id: string;
    target_round_id: string | null; effect_type: EffectType; condition_type: ConditionType;
    reference_event: string | null; condition_params: Record<string, unknown>;
    exception: Record<string, unknown> | null; evidence_id: string; prepared_by: string;
    reviewed_by: string | null; reviewed_at: string | null; review_note: string | null;
    review_status: "draft" | "changes_requested" | "on_hold" | "approved" };
  type Sources = {
    snapshot: { asOf: string; records: Record<string, unknown>[]; fileSha256: string };
    verified: { policyId: string; json: unknown }[];          // data/verified/<20자리>.json
    results: Record<string, unknown>;                          // data/verify-results/index.json
    supporting: Record<SupportingKey, unknown>;
    evidence: EvidenceRow[]; rules: RuleRow[] };
  type SupportingKey = "regions" | "route-links" | "verify-candidates" | "verify-eval-answers" | "verify-replay";
  function readSources(root: string): Sources;
  ```
  `EffectType`·`ConditionType`은 스키마 CHECK의 값 목록과 같은 zod enum.
  `fixtureSources(): Sources` — 정책 3건(`"P1"…` 대신 실제 형식의 20자리 가짜 번호 `00000000000000000001`~`03`), 그중 1건은 빈 문자열 필드와 누락 키를 함께 가진다. 근거 1건(B의 `ptcpPrpTrgtCn`에 실제로 있는 문장), 승인 규칙 1건(A=01 → B=02, round `"2026"`), B의 `verified` 1건(`rounds: [{ id: "2026", status: "approved" }]`), `supporting` 5개 키는 빈 객체.

  실제 데이터 사전 확인(2026-11-19): verified 6건·results 6건·규칙에 쓰는 A/B 6개 정책번호 모두 스냅샷에 있음 → FK 검사에서 막히지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `"실제 저장소를 읽는다"` → `readSources(process.cwd())`: `snapshot.records.length === 4020`, `snapshot.asOf === "2026-11-16"`, `snapshot.fileSha256 === "f4e8075fdbe7204045f4f9c0821a05a204e3e5b8fa0d0d1ba7a3f87cc26bd39d"`, `verified.length === 6`, `Object.keys(results).length === 6`
  - `"rules.json 형식이 틀리면 파일과 위치를 알려준다"` → 임시 폴더에 `effect_type: "block"` 규칙 → `/data\/overlap\/rules\.json.*\[0\]\.effect_type/`
  - `"overlap 파일이 없으면 빈 배열"` → 임시 폴더에 overlap 폴더 없음 → `evidence: [], rules: []`
- [ ] **Step 2: 실행해 실패 확인** `npx vitest run tests/db/sources.test.ts`
  - `"날짜와 정책번호 형식을 검사한다"` → `checked_at: "2026/11/19"` → `/checked_at/`, `target_policy_id: "123"` → `/target_policy_id/`
- [ ] **Step 3: 구현.** zod: 정책번호 `/^\d{20}$/`, `checked_at`·`reviewed_at` `/^\d{4}-\d{2}-\d{2}$/`. 파일 바이트로 sha256을 먼저 구하고 `JSON.parse`. verified는 `/^\d{20}\.json$/`만(index.ts·candidates.json 제외). 데이터셋 경로: regions=`data/regions.json`, route-links=`data/route-links.json`, verify-candidates=`data/verified/candidates.json`, verify-eval-answers=`data/verify-eval/answers.json`, verify-replay=`data/verify-replay/turns.json`. zod 오류는 `${파일 경로} ${issue.path} ${issue.message}`로 throw.
- [ ] **Step 4: 완료 확인** 2회 + shuffle 1회, 3 passed
- [ ] **Step 5: 커밋(사용자 승인 후)** `feat: SQLite 적재용 원천 읽기`

### Task 3: 적재·검사·원자적 교체

**Files:**
- Create: `lib/db/build.ts`, `scripts/db-build.ts`
- Modify: `package.json` scripts에 `"db:build": "tsx --tsconfig tsconfig.json scripts/db-build.ts"`, `.gitignore`에 `/data/db/`
- Test: `tests/db/build.test.ts`

**Interfaces:**
- Consumes: `openDb`, `SCHEMA_SQL`, `Sources`, `fixtureSources`
- Produces:
  ```ts
  type BuildReport = { snapshotId: string; canonicalSha256: string;
    counts: { policies: number; verified: number; results: number; supporting: number;
              evidence: number; rules: number; approvedRules: number } };
  function buildDb(src: Sources, outPath: string): BuildReport;
  ```
  실패 시 `Error` 메시지는 `[검사이름] 내용` 형식. 검사 이름은 아래 표의 것을 그대로 쓴다.

| 검사 이름 | 내용 |
|---|---|
| `unique-ids` | 원본 행 수 = 고유 `plcyNo` 수 (INSERT 전에 확인해 어떤 번호가 중복인지 출력) |
| `canonical-hash` | DB에서 `ordinal` 순으로 다시 만든 `JSON.stringify({asOf, records})`의 sha256 = 원본을 파싱 후 `JSON.stringify`한 sha256. 원본 파일은 Python 형식이라 바이트 비교는 하지 않는다 |
| `foreign-keys` | `PRAGMA foreign_key_check` 결과 0행, `PRAGMA integrity_check` = `ok` |
| `evidence-target` | 규칙의 근거 `policy_id` = `target_policy_id` |
| `quote-in-source` | `source_kind='api'` 근거는 `instr(json_extract(raw_json, '$.' \|\| source_field), quote_text) > 0`. 실패 시 `rule_id`/`evidence_id` 출력 |
| `round-exists` | `target_round_id`가 있으면 대상 정책의 `verified_json.rounds[]`에 같은 `id`가 있다 |

| `replace` | 임시 DB를 `outPath`로 교체하지 못함(`EPERM`·`EBUSY`) → `outPath가 다른 프로그램에서 열려 있음` |

  `snapshot_id`는 `asOf`. 원천 JSON의 근거·규칙에는 `snapshot_id`가 없고, 적재기가 현재 스냅샷의 `asOf`로 채운다. 새 스냅샷에서도 인용이 원문에 남아 있는지는 `quote-in-source`가 다시 확인한다. ID는 데이터 사전의 INTEGER 대신 읽을 수 있는 TEXT(`r-…`, `ev-…`)로 둔다. JSON 원천의 diff에서 어떤 규칙인지 바로 보이게 하기 위해서다. 정규화 결과(`normalize`) 비교는 하지 않는다 — 입력이 `canonical-hash`로 같음이 확인되면 같은 함수의 출력도 같다.

- [ ] **Step 1: 실패하는 테스트 작성** (출력은 `os.tmpdir()` 아래 테스트별 새 폴더)
  - `"픽스처를 적재하고 건수를 보고한다"` → `counts.policies === 3`, `rules === 1`, `approvedRules === 1`, `outPath` 존재, `.tmp`·`-journal` 파일 없음
  - `"같은 경로에 두 번 적재해도 같은 결과"` → 두 보고서 `toEqual`, 두 번째 후에도 `select count(*) from policy_raw` = 3
  - `"빈 문자열과 누락 키를 보존한다"` → DB에서 꺼낸 해당 레코드 `toEqual` 원본(키 목록까지)
  - `"중복 정책번호는 실패하고 이전 DB를 남긴다"` → 정상 적재 → 원본 파일 sha 기록 → 중복 레코드로 재적재 → `/\[unique-ids\] 00000000000000000001/` → 파일 sha 변화 없음, `.tmp` 없음
  - `"인용문이 원본 필드에 없으면 실패"` → `/\[quote-in-source\] r-/`
  - `"근거가 B가 아닌 정책이면 실패"` → `/\[evidence-target\]/`
  - `"없는 회차를 가리키면 실패"` → `/\[round-exists\]/`
  - `"규칙 INSERT 중 FK 실패는 롤백된다"` → `/FOREIGN KEY/`, 이전 DB 그대로
  - `"DB가 다른 연결에 열려 있으면 교체하지 않는다"` (`it.runIf(process.platform === "win32")`) → 정상 적재 → `openDb(outPath)` 연결을 열어 둔 채 재적재 → `/\[replace\]/`, 이전 DB sha 그대로, `.tmp` 없음 → 연결 닫고 재적재하면 성공
- [ ] **Step 2: 실행해 실패 확인** `npx vitest run tests/db/build.test.ts`
- [ ] **Step 3: 구현** `buildDb`: `outPath + ".tmp"` 삭제 → `openDb(tmp)` → `SCHEMA_SQL` → `BEGIN` → INSERT 전부(prepared statement) → 검사 → `COMMIT` → `db.close()` → `fs.renameSync(tmp, outPath)`. 어디서든 throw하면 `ROLLBACK`(열려 있으면) → `close` → tmp 삭제 → 다시 throw. `scripts/db-build.ts`는 `buildDb(readSources(cwd), "data/db/pathfinder.sqlite")` 결과를 JSON으로 출력, 실패 시 메시지 출력 후 `process.exit(1)`.
- [ ] **Step 4: 완료 확인** 2회 + shuffle 1회, 9 passed(Windows 외에서는 8 passed + 1 skipped). 그리고 `npm run db:build` 2회 실행, 두 출력의 `counts`가 같다(`policies: 4020`, 규칙은 Task 4 전이라 0)
- [ ] **Step 5: 커밋(사용자 승인 후)** `feat: SQLite 적재와 적재 후 검사`

### Task 4: 시연 규칙 4건 원천 작성

**시작 전:** 사용자에게 교차 검토표 1~4번의 **작성자·검토자·검토일**을 받는다. 받기 전에는 이 Task를 시작하지 않는다.

**Files:**
- Create: `data/overlap/evidence.json`, `data/overlap/rules.json`
- Test: `tests/db/real-data.test.ts`

**Interfaces:**
- Consumes: `readSources`, `buildDb`

| rule_id | A → B | round | effect / condition | 근거(B 필드 · 인용 원문 그대로) | 예외·메모 | 상태 |
|---|---|---|---|---|---|---|
| `r-110369-110346-receiving` | `20250122005400110369` → `20250122005400110346` | `2026` | `participation_block` / `receiving`, ref `apply_date`, params `{}` | `ev-110346-receiving` · `ptcpPrpTrgtCn` · `구직급여를 받고 있거나` | exception `{"allowed":"다만, 고용보험에 가입되어 구직급여 수급자격을 갖춘 경우라도 구직급여를 수급하지 않으면 참여 가능"}` (원문 그대로) | approved |
| `r-110369-110346-after6m` | 같음 | `2026` | `participation_block` / `within_months_after_end`, ref `apply_date`, params `{"months":6}` | `ev-110346-after6m` · `ptcpPrpTrgtCn` · `구직급여의 지급이 끝난 날부터 6개월이 지나지 아니한 자` | — | approved |
| `r-212410-212442-selected` | `20260406005400212410` → `20260406005400212442` | `2026` | `selection_excluded` / `selected`, ref `screening`, params `{}` | `ev-212442-concurrent` · `ptcpPrpTrgtCn` · `인천 재직청년 복지포인트` | review_note에 인천 FAQ URL(교차 검토표 3번) | approved |
| `r-113348-214655-notice` | `20260821005400113348` → `20261031005400214655` | `null` | `apply_block` / `status_on_notice_date`, ref `notice_date`, params `{}` | `ev-214655-national-work` · `addAplyQlfcCndCn` · `국가근로장학생은 신청불가` | review_note: `2025 안내 기준. 2026 회차 적용 확인 필요. 근로 자격 요건으로 분류` | on_hold |

  근거 4건 모두 `source_kind: "api"`, `round_id`는 규칙의 round와 같게, `checked_at: "2026-11-19"`. 인용 4개가 스냅샷 원문에 그대로 있는 것은 2026-11-19에 확인했다.

- [ ] **Step 1: 실패하는 테스트 작성** `"실제 원천을 적재한다"`: `buildDb(readSources(process.cwd()), tmp)` → `counts.policies === 4020`, `verified === 6`, `results === 6`, `supporting === 5`, `evidence === 4`, `rules === 4`, `approvedRules === 3`
- [ ] **Step 2: 실행해 실패 확인** (규칙 파일 없음 → `rules === 0`)
- [ ] **Step 3: 두 JSON 파일 작성** (위 표 그대로, 사용자에게 받은 이름·날짜)
- [ ] **Step 4: 완료 확인** 2회 + shuffle 1회 통과, `npm run db:build` 2회 출력 동일
- [ ] **Step 5: 커밋(사용자 승인 후)** `data: 시연 중복수혜 규칙 4건`

### Task 5: 승인본 내보내기와 일치 확인

**Files:**
- Create: `lib/db/export.ts`, `scripts/db-export.ts`
- Modify: `package.json` scripts에 `"db:export": "tsx --tsconfig tsconfig.json scripts/db-export.ts"`, `"db:verify": "tsx --tsconfig tsconfig.json scripts/db-export.ts --check"`
- Test: `tests/db/export.test.ts`

**Interfaces:**
- Consumes: `openDb`, `buildDb`, `fixtureSources`
- Produces:
  ```ts
  type ApprovedRule = Omit<RuleRow, "prepared_by" | "reviewed_by" | "reviewed_at" | "review_note" | "review_status">
    & { target_round_id: string; evidence: EvidenceRow };
  type Approved = { snapshotId: string; rules: ApprovedRule[] };      // rule_id 오름차순
  type Manifest = { dataVersion: string; snapshotAsOf: string;
    counts: BuildReport["counts"]; files: Record<string, string> };  // 경로 → sha256, 경로 오름차순
  function exportApproved(dbPath: string, root: string): { approved: Approved; manifest: Manifest; texts: Record<string, string> };
  function writeExport(root: string, texts: Record<string, string>): void;
  function checkExport(root: string, texts: Record<string, string>): string[];   // 다른 파일 경로 목록, 같으면 []
  ```
  `exportApproved`는 DB만 읽는다. `manifest.counts`는 `BuildReport`를 넘겨받지 않고 DB에서 테이블별 `count(*)`로 다시 센다(`approvedRules`는 `review_status='approved'` 수). 해시를 구할 원천 파일은 `root` 기준 경로로 읽는다.
  출력 파일: `data/overlap/approved.json`, `data/release/manifest.json`. 직렬화는 `JSON.stringify(x, null, 1) + "\n"`. `files`에는 `data/snapshot/current.json`, `data/verified/<번호>.json` 6개, `data/verify-results/index.json`, `data/overlap/approved.json`. `dataVersion` = `files`를 `경로:sha` 줄로 이어 붙인 문자열의 sha256 앞 12자.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `"approved이고 회차가 있는 규칙만 나간다"` → 픽스처에 draft·on_hold·round null 규칙 추가 → `approved.rules.map(r => r.rule_id)`가 승인 1건만
  - `"검토자 정보는 내보내지 않는다"` → 내보낸 규칙에 `reviewed_by` 키 없음
  - `"두 번 내보내면 바이트가 같다"` → `texts` 두 번 `toEqual`
  - `"DB를 새로 만들어도 dataVersion이 같다"` → 서로 다른 임시 경로에 `buildDb` 2회 → 두 `manifest.dataVersion` 같음
  - `"checkExport는 바뀐 파일을 알려준다"` → 쓰고 나서 approved.json 한 글자 수정 → `["data/overlap/approved.json"]`
- [ ] **Step 2: 실행해 실패 확인** `npx vitest run tests/db/export.test.ts`
- [ ] **Step 3: 구현.** `scripts/db-export.ts`: `--check`가 없으면 `writeExport`, 있으면 `checkExport` 결과가 비어 있지 않을 때 경로를 출력하고 `exit(1)`.
- [ ] **Step 4: 완료 확인** 2회 + shuffle 1회, 5 passed
- [ ] **Step 5: 커밋(사용자 승인 후)** `feat: 승인 규칙 내보내기와 manifest`

### Task 6: 빈 상태에서 전체 재확인

- [ ] **Step 1:** `rm -rf data/db data/release data/overlap/approved.json`
- [ ] **Step 2:** `npm run db:build` → `npm run db:export` → `npm run db:verify` (출력 기록)
- [ ] **Step 3:** 다시 `npm run db:build` → `npm run db:verify` → 변경 파일 없음. `dataVersion`이 Step 2와 같다
- [ ] **Step 4:** 새 경로 복원 확인: `git worktree add <스크래치 경로> HEAD`(커밋이 있는 경우) 또는 저장소 복사본에서 `npm ci && npm run db:build && npm run db:export`, `manifest.json`이 원래 것과 같은지 `diff`
- [ ] **Step 5:** 전체 테스트 `npm test` 2회 + `npx vitest run --sequence.shuffle` 1회, 기존 테스트 포함 모두 통과. 실행마다 통과 수를 기록
- [ ] **Step 6:** `npm run build` 통과(앱 번들에 영향 없는지)
- [ ] **Step 7:** 이번 작업에서 생긴 실수를 [학습 노트](./backend-lessons.md)에 기록(같은 원인은 기존 행에 합침)

## 다음 계획으로 넘기는 것

- `lib/data/overlap.ts`(approved.json 로드)와 `lib/judge` 연결, `/api/judge` 응답 확장 — [서버 계획 2.2~2.4절](./2026-11-19-sqlite-server-plan.md)
- Codex 산출물 변환(형식이 정해지면 `data/overlap/*.json` 형식으로 맞추거나 변환 단계 추가)
- 서버 계획 3장 수정(Vercel Hobby + CLI 배포)
