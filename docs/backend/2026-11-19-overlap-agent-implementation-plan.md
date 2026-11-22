# 중복수혜 판정 에이전트와 SQLite 구현 계획

2026-11-19 작성 · 로컬 초안 · 제출 2026-11-23 12:00 KST · 2026-11-20 사용자 결정 반영

**목표**　공개 정책 원문에서 근거가 있는 중복수혜 규칙을 찾아, 개인에게 실제로 막히는 항목과 더 확인할 사실을 `/api/judge`가 설명하게 한다.

**구조**　로컬 에이전트가 같은 원문을 두 번 읽고 다른 역할로 검증한다. 코드는 이름·연도·인용을 대조하고 에이전트 단독 결과를 채점한 뒤 기존 조사와 합친다. SQLite는 git에 둘 JSON으로 재구축하고, 서버는 배포용 JSON만 읽어 사용자 상태를 대조한다.

**기술**　Next.js 15.5.29, TypeScript strict, Node 22 내장 `node:sqlite`·`fetch`·`crypto`, zod 4, tsx, Vitest. 기준은 [확정 설계 2·6~10장](./2026-11-19-overlap-agent-design.md)이며 [SQLite 실행 계획](./2026-11-19-sqlite-build-plan.md)과 [서버 계획 1.2·2.2~2.4절](./2026-11-19-sqlite-server-plan.md)을 아래 변경표와 함께 읽는다.

## 전역 제약

- [결정] 대상은 `zipCd`에 47111·28185·41111·41113·41115·41117 중 하나가 있는 정책이다. 전국 정책도 같은 기준이다.
- [결정] `ptcpPrpTrgtCn`·`addAplyQlfcCndCn`의 비지 않은 전문과 제한어가 있는 `plcySprtCn` 전문을 보낸다. 한 필드는 나누지 않는다.
- [결정 · 11/20 갱신] 로컬 무료 텍스트 호출은 Gemini 3.6 Flash를 먼저 쓰고 해당 모델의 일일 요청 한도(RPD)를 소진하면 Gemini 3 Flash로 전환한다. 모델 선택은 설계서 2·8장의 종전 단일 모델 결정보다 이 계획을 우선한다. 신규 패키지·유료 서비스·서버 호출·공고 웹 수집은 범위 밖이다.
- [결정] 모델에는 공개 정책에서 나온 정보만 보낸다. 프로필·수혜 정보·자유 입력·키는 입력 자료나 실행 보고에 기록하지 않는다.
- [결정] 추출은 독립 2회, 묶음 약 6,000자. 실제 요청 사이는 최소 13초. 재시도 대기와 중단 상태는 T5 기준을 따른다.
- [결정] 운영자 승인 절차는 없다. 에이전트 확정은 7가지 검사, 개인 적용은 별도 사실 검사다. 화면에서 출처별 등급을 나누지 않는다.
- [결정] 연구 57쌍은 정답과 서비스 규칙 양쪽에 쓰되, 채점에는 합치기 전 결과만 넣는다. 실행마다 오답 3개를 섞고 확정 오판 0건을 요구한다.
- [결정] 같은 실행이 통과했을 때만 에이전트 규칙을 제공한다. 불합격이면 조사 출처만 제공한다. 정책번호는 20자리 문자열이다.
- [결정] `data/db/`는 git 제외. 11/23 인용·정책이 어긋나면 적재 실패로 멈추고 이전 정상 배포본을 보존한다.
- [결정] 이번에는 문서·로컬 읽기 검증까지다. 구현 시 각 Task는 대상 테스트 2회 연속 + 무작위 순서 1회, 마지막은 빈 상태에서 재현한다. 커밋은 사용자 승인 후, 이번에는 커밋·푸시·PR이 없다.
- [결정] 확인하지 못한 사실은 사용자 질문에 남긴다. 작업 중 실수는 [학습 노트](./backend-lessons.md)의 같은 원인 행에 관찰·다음 조치·근거를 합친다.
- [변경 가능] 파일 분할·묶음 순서·제목 기호·보고서 서식은 구현 세부다. 아래 [제안]은 승인된 사업 기준과 구분한다.

## 파일 구조와 자료의 소유자

아래는 **구현 시점**의 파일이다. `S`는 `scripts/overlap/`, `O`는 `data/overlap/`, `A`는 `data/overlap-agent/`를 뜻한다.

| 만들거나 고칠 파일 | 책임 |
|---|---|
| `scripts/overlap-agent.ts` | 로컬 CLI, 단계 순서·저장본 재현·실행 식별 |
| `S/select.ts`, `S/gemini.ts` | 각각 대상·묶음 구성, 공개 요청 전송·재시도·저장 |
| `S/extract.ts`, `S/link.ts` | 각각 시범 프롬프트·응답 검사·원문 대조, 사업명 연결 |
| `S/verify.ts`, `S/decide.ts` | 각각 반례를 섞은 자가 검증, 두 결과 비교와 확정 사유 |
| `S/score.ts`, `S/merge.ts` | 각각 독립 채점·실행 보고, 조사 우선 병합 |
| `A/cases.json`, `A/research.json` | 각각 조건별 기대값, 조사 규칙과 인용의 고정 원천. [제안] 빈 상태에서 병합을 다시 하도록 조사본을 따로 둔다 |
| `A/responses/<sha256>.json`, `A/report-<run_id>.md` | 각각 요청별 원 응답, 해당 실행의 점수·통과 근거 |
| `A/runs/<run_id>.json` | 중단된 실행과 오프라인 재생에 필요한 요청 순서·모델·해시. 보고서를 다시 만들 때도 보존하는 입력 |
| `A/clauses.json` | [제안] `agent_clause`를 재적재할 추적 자료. 원 응답 파일과 연결 |
| `O/evidence.json`, `O/rules.json` | 각각 B의 인용 근거, 조건별 규칙. 병합 후 DB 적재 원천 |
| `lib/data/overlap-schema.ts` | T2부터 공유하는 열거값·사례·규칙·근거의 zod 계약. 앱에서 가져와도 SQLite를 불러오지 않는다 |
| `lib/db/sqlite.ts`, `lib/db/schema.ts` | 각각 SQLite 연결, STRICT DDL |
| `lib/db/sources.ts`, `lib/db/build.ts`, `lib/db/export.ts` | 각각 JSON 계약과 검사, 임시 DB 적재·교체, 배포본·manifest 생성/대조 |
| `scripts/db-build.ts`, `scripts/db-export.ts` | 각각 적재 CLI, 내보내기·일치 확인 CLI |
| `O/approved.json`, `data/release/manifest.json` | 각각 앱이 읽을 규칙·근거, 버전·건수·파일 해시 |
| `lib/data/overlap.ts`, `lib/judge/overlap.ts` | 각각 정적 JSON 검사·B별 색인, 개인별 규칙 평가 |
| `lib/judge/types.ts`, `lib/judge/index.ts`, `lib/judge/handler.ts` | 각각 사실·판정 타입, 제한 축 연결, API 입력·응답 |
| `lib/plan/handler.ts`, `lib/plan/summary.ts` | 서버 측 판정 캐시 키 및 세션 입력 타입 연결. 외부 AI 요약에는 수혜 사실을 추가하지 않는다 |
| `package.json`, `.gitignore` | 로컬 CLI 명령 등록, `/data/db/` 제외 |
| `tests/db/fixtures.ts`, `tests/db/*.test.ts` | 세 정책·빈 값·누락 키가 있는 DB 픽스처, 제약·왕복·내보내기 검사 |
| `tests/overlap/*.test.ts`, `tests/judge/handler.test.ts`, `tests/plan/plan.test.ts` | 각각 단계별 가짜 응답, 실제 API 진입점, 캐시 회귀 검사 |

## Review Focus

| 놓치기 쉬운 입력 | 기대 동작과 테스트 |
|---|---|
| 행복씨앗통장의 한 줄에 생계·의료 제한과 주거·교육 허용 | 사업별로 나눠 허용을 오판으로 세지 않는다. T2·T10 `한 줄의 두 급여` |
| 같은 이름의 청년내일저축계좌 두 번호 중 AI가 하나를 선택 | 같은 이름 묶음을 보존하고 확인 필요. T7 `두 기관의 같은 이름` |
| 드림For 한 필드에서 다른 제목에만 ‘공고문’이 있음 | 복지포인트 인용의 제목과 인용 줄만 검사. T9 `다른 제목의 공고문` |
| 지급 종료일이 없거나 정확히 6개월이 되는 날 신청 | 각각 질문 하나, 해당 제한 해소. T13 `달력 경계와 날짜 누락` |
| 11/23 스냅샷에서 B 삭제 또는 같은 번호의 인용 변경 | 규칙 ID를 내고 빌드 실패, 이전 DB와 배포본 해시 유지. T11·T14 `새 스냅샷 불일치` |

## 실행 순서와 공통 완료 기준

각 Task의 **검증**에 쓴 `V 경로`는 `npm test -- 경로`를 연속 두 번, 이어 `npm test -- 경로 --sequence.shuffle`를 한 번 실행한다는 뜻이다. 경로가 여러 개면 한 명령에 모두 넣는다. 성공 출력은 매번 `Test Files … passed`, `Tests … passed`와 종료 코드 0이다. 실패·누락된 실행은 완료 횟수에 넣지 않는다. RED는 같은 대상에서 명시한 단언 또는 미구현 진입점 때문에 실패하는지 먼저 확인한다. 아래 모든 Task의 마지막 단계는 **커밋 — 사용자 승인 후**다. 출력은 미래의 기대값이다.

### T1. 설치와 SQLite 실행 환경

- **Files**　생성 `lib/db/sqlite.ts`, `tests/db/sqlite.test.ts`. 변경할 패키지 없음.
- **Interfaces**　Node 22 → `openDb(path: string): DatabaseSync` (T3·T11·T12).
- [ ] `Test-Path node_modules/.bin/vitest`와 `Test-Path node_modules/.bin/tsx` 확인. 없으면 **사용자 승인 후** `npm ci`. `npx`의 임시 설치로 대체하지 않는다.
- [ ] RED `메모리 DB에서 1을 읽는다` 및 `외래 키를 켠다`. Vitest 안에서 먼저 `import { DatabaseSync } from "node:sqlite"`를 시험한다. 로딩 실패 시에만 `process.getBuiltinModule("node:sqlite")`로 바꾸고 이유를 기록한다.
- [ ] 연결마다 `PRAGMA foreign_keys=ON`. `SELECT 1 AS x`가 `{x:1}`, FK 조회값 1. **검증** `V tests/db/sqlite.test.ts`.

### T2. 조사 57쌍과 표 3을 조건별 정답으로 옮기기

- **Files**　생성 `lib/data/overlap-schema.ts`, `A/cases.json`, `A/research.json`, `tests/overlap/cases.test.ts`. 자료는 [표 1·2·3](./2026-11-19-demo-overlap.md)과 [교차 검토표 마지막 설명](./시연-중복수혜-교차검토.md).
- **Interfaces**　표 1의 A→B와 최종 열, 표 3의 조건, 원문 → `Case[]` 및 `Research = {evidence: EvidenceRow[], rules: RuleRow[]}`. T3의 열 정의를 기준으로 이 Task에서 공통 JSON 타입을 먼저 선언한다. T3는 같은 계약을 SQL로 검사한다. T10의 정답 입력은 모델에 보내지 않는다.
- [ ] RED `57개 서로 다른 방향쌍`, `한 줄의 두 급여`, `표 2는 none`, `구직급여 3조건`. 같은 A→B에 수급 중·종료 후 6개월 미만·자격만 있고 미수급을 각각 둔다. `57`은 규칙/사례 행 수가 아니다.
- [ ] 구현 담당자가 표 1의 각 A·B 열에서 번호를 읽고 마지막 열을 **조건 단위로** 전사한다. `Case = {b:string, a?:string, mention?:string, phrase:string, condition?:{type:Condition|null,params:Record<string,unknown>,exception?:boolean}, expect_kind:Kind[], expect_effect?:Effect, expect_item?:string,expect_link?:"none",expect_judgement?:Judgement,source_row:string}`. `a` 또는 `mention` 필수. `expect_judgement`로 `needs_check` 기대와 추출 `kind`를 독립 표현하고 `source_row:string`으로 표·행을 역추적한다. 표 2는 `a` 없이 언급·원문과 `expect_link:"none"`를 둔다. 조건을 분리할 때 참조한 원문은 `phrase`에 둔다. `within_months_after_end`의 `months:6` 자리에 5가 오면 T10에서 미일치다.
- [ ] 표 1 ‘직접 연결 제외’·‘확인 필요’ 조건은 `expect_judgement=needs_check`, 연구 규칙도 같은 결론. 공식 자료와 API가 다르면 그 차이를 근거에 남긴다. 효과·예외가 조건별로 다르면 분리한다. 표 3 세 소제목의 모든 행·복수 B를 풀고 개인/기업, 같은 달/다른 달, 반환/예외를 구분한다. 표 3 130행에는 월차임분 20만 원 이상/미만의 출처 있는 조사 결론이 있다. API에서 알 수 없는 금액별 결론은 모델의 확정 근거로 쓰지 않는다.
- [ ] `phrase`는 해당 B의 실제 필드에서 고른다. 원문에 공식 자료의 세부 효과가 없으면 억지 인용을 만들지 않고 공식 근거와 원문 한계를 기록한다. 행복씨앗통장 생계·의료와 주거·교육을 별개 언급으로 채점한다. 시범 14건은 출발점이다. 표·행·조건 대응표로 누락, 중복, 순방향을 검사한다. 남는 해석은 사용자 질문에 넣고 그 조건은 자동 확정 보류. 이를 운영자 검증 절차로 만들지 않는다. 표 2의 ‘지역 안에 A가 있지만 회차가 다른’ 사례도 최종 연결 기대값은 `none`이다. 조사 노트 92행의 국가근로장학금처럼 번호가 본문에 있어도 정답 A로 복사하지 않는다. T7·T9는 근거가 명시한 과거 회차에 다른 회차의 A를 대입한 경우와 단순 연도 미상을 별도로 검사한다.
- [ ] **검증** `V tests/overlap/cases.test.ts`. 기대값은 57개 쌍의 출처 대응, 표 3 누락 0, 뒤집힌 방향 0, A 없는 표 2에 생성 정책번호 0.

### T3. SQLite 스키마와 자료 계약

- **Files**　생성 `lib/db/schema.ts`, `lib/db/sources.ts`, `tests/db/fixtures.ts`, `tests/db/schema.test.ts`. T11에서 원천 로더를 완성한다.
- **Interfaces**　`openDb` + 서버 계획 1.2 DDL → `SCHEMA_SQL:string`, `EvidenceRow`, `RuleRow`, `ClauseRow`. `Judgement = "blocked" | "needs_check"`. `Kind` 6개·`Effect` 6개·`Condition` 5개는 T6 목록을 한 곳에서 선언해 zod·SQL·추출 검사가 공유한다.
- [ ] RED `검토자 없는 research 허용`, `agent는 model·run_id 필수`, `불명 사유 없는 needs_check 거부`, `원문 ID·FK·자기쌍 거부`. 잘못된 enum·JSON, B와 무관한 근거, 없는 A도 대상이다.
- [ ] `snapshot, policy_raw, verified_policy, verification_result, supporting_data, evidence, policy_overlap_rule` 유지. 각 연결 FK ON, `(snapshot_id,policy_id)` 유일, 순번 유일, 원본 JSON 내부 ID와 같음. `EvidenceRow`는 기존 `evidence_id, policy_id, round_id, source_kind, source_field, source_url, quote_text, checked_at` 그대로. api는 필드, official은 URL 필수.
- [ ] `RuleRow`에는 `rule_id,source_policy_id,target_policy_id,target_round_id,evidence_id,kind,effect_type,condition_type,condition_params,reference_event,exception`를 둔다. `effect_type:Effect|null`, `condition_type:Condition|null`, `condition_params:Record<string,unknown>`, `exception:string|null`(원문)으로 시범의 null도 보존한다. DB에서는 기존 `condition_params_json`·`exception_json`으로 왕복한다. `target_round_id:string|null`은 부가 정보다. 연구 규칙은 B의 API 인용과 공식 대조 결과를 구분한다. 조사 노트 12행의 ‘선정 시 제외’는 인천 FAQ에서 확인한 결론이다. `evidence_id`로 B 인용을 보존하고, [제안] `research_basis?:{source_row:string,url:string,conclusion:string}`에 조사 행·공식 URL·조사 결론을 담아 DB와 배포본에 왕복한다. `source_row`는 T2의 출처 행이다. T13은 연구 결론을 근거 설명에, 원문을 인용에 표시한다. `선정됐고 첫 지급 전` 테스트로 신청·선정의 차이, API 인용과 공식 출처 URL을 함께 단언한다.
- [ ] `judgement:Judgement, needs_check_reason:string|null, source:"research"|"agent", model:string|null, run_id:string|null, restricted_item:string|null, period_text:string|null, verify_verdict:Verdict|null, verify_quote:string|null, a_group_ids:string[]` 추가. ID 배열은 SQL의 같은 이름 JSON TEXT 열에 정렬 저장. 연구본에 가짜 모델·실행·검증값을 채우지 않는다. `review_status`·작성자/검토자 승인 CHECK 및 필수 검토자 열 제거.
- [ ] `agent_clause`는 `clause_id`(PK), `run_id`, B·필드, 회차·응답 해시, 원문 대조된 조항·언급, 연결 결과, 검증/탈락 사유를 저장한다. `ClauseRow`가 JSON↔SQL 단위다. `allowed,not_restriction`, 미연결·반박 사례를 추적하고 화면용 쌍에서는 제외한다. 틀린 인용은 원 응답 해시·오류 위치만 남긴다.
- [ ] **검증** `V tests/db/schema.test.ts`. `PRAGMA foreign_key_check` 0행, 각 잘못된 픽스처만 실패.

### T4. ① 대상 선별과 묶음

- **Files**　생성 `S/select.ts`, `tests/overlap/select.test.ts`.
- **Interfaces**　원본 `RawPolicy[]` → `selectFields(records:RawPolicy[]):PublicField[]`, `batchFields(fields:PublicField[]):PublicField[][]`. `PublicField={b_policy_id:string,name:string,field:Field,text:string}`, `Field`는 전역 제약의 세 키다. A 색인은 필드가 비어 있는 정책까지 포함한 지역 전체로 만든다.
- [ ] RED `전국 포함 1127·246/447/93`, `제목 다음 줄 사업명까지 전달`, `한 필드가 6000자를 초과`. 지역 코드는 쉼표 분해 후 정확히 일치, 필드 원문은 그대로 보존한다.
- [ ] `pilot.mjs:15–17` 제한어 식 사용. B 번호·고정 필드 순으로 안정적으로 담아 약 6,000자, 긴 단일 필드는 단독 묶음. 시범처럼 줄 단위로 거르면 설계 4장 기록상 21쌍을 놓친다.
- [ ] **검증** `V tests/overlap/select.test.ts`. 현재 기준 786개 필드, 중복·누락·분할 0. 갱신된 스냅샷에는 날짜별 기준을 적용한다.

### T5. 로컬 요청·재시도·저장본 재현

- **Files**　생성 `S/gemini.ts`, `tests/overlap/gemini.test.ts`, 실행 시 `A/responses/`.
- **Interfaces**　`ModelId="gemini-3.6-flash"|"gemini-3-flash-preview"`, `RequestSpec={model:ModelId,stage:"extract"|"link"|"verify",pass:1|2,repair:0|1,prompt:string}` → `generate(req:RequestSpec, io:CallIO):Promise<SavedResponse>`. `CallIO`에 fetch·시계·sleep·저장 경로·replayOnly를 주입. `SavedResponse`는 요청 해시·모델·호출 시각·원 응답을 보존한다. 공개 입력과 프롬프트 전체가 `prompt`에 들어간다.
- [ ] RED 가짜 fetch `503 → 응답 없음 → 성공`, `분당 제한 429·500은 같은 모델 재시도`, `3.6 일일 소진 → 3 Flash 성공`, `양쪽 일일 소진 → 초기화까지 대기 → 3.6 재개`, `종류 불명 429는 전환하지 않음`, `400·403·404 한 번만`, `동일 요청 저장본 재사용`, `모델/순번/원문/프롬프트/수정 요청 중 하나만 달라도 다른 해시`. 가짜 fetch가 받은 모든 body를 검사해 B 번호·정책명·필드·전문과 여기서 나온 후보·판정 외에 profile·benefits·자유 입력·키가 없음을 단언한다. 해시 함수 수준에서 모델 변경을 시험하고 전송은 이 두 모델만 허용한다.
- [ ] `POST /v1beta/models/{model}:generateContent`, `x-goog-api-key`, `generationConfig.responseMimeType="application/json"`. 키는 로컬 `.env.local`의 `GEMINI_API_KEY`. 3.6은 `gemini-3.6-flash`, 3 Flash는 `gemini-3-flash-preview`로 지정한다. [Google 모델 목록](https://ai.google.dev/gemini-api/docs/models)
- [ ] 모델별 **일일** 소진은 429의 할당량 상세에서 해당 모델의 일일 요청 제한이 확인되거나 AI Studio에서 해당 일자 RPD가 한도에 도달했을 때 처리한다. 3.6 소진 시 같은 작업을 3 Flash로 이어 간다. 두 모델 모두 소진되면 태평양 시간 자정까지 대기하고 3.6부터 재개한다. 소진 모델과 초기화 시각을 실행 기록에 남겨 재시작해도 반복 전환하지 않는다. [Google API 한도](https://ai.google.dev/gemini-api/docs/rate-limits)
- [ ] 분당 제한·종류 불명 429, 응답 없음·503·500은 같은 모델에서 1→2→4→8→10분(이후 10분) 간격으로 재시도한다. 연속 요청은 최소 13초 간격. 400·403·404는 즉시 중단하고 오류를 기록한다. 정상 원 응답은 파싱 전에 원자적으로 저장한다.
- [ ] SHA-256 입력은 모델·역할·순번·repair·REST 본문 전체(전문 포함). 다른 묶음의 변경은 그 요청과 하류 입력만 무효화한다. 재시작은 정확히 같은 해시만 재사용. `replayOnly`에서 누락이면 해시와 단계 출력 후 종료, 네트워크 0회. **검증** `V tests/overlap/gemini.test.ts`.
- [ ] [제안] `A/runs/<run_id>.json`에 스냅샷·cases·연구본 해시, 시작 시각, 단계별 논리 요청(묶음·pass·repair), 실제 모델·요청 해시·소진/초기화 상태를 기록한다. 보내기 전 요청을 기록하고 성공 응답을 저장한 뒤 완료 표시를 원자적으로 갱신한다. `원 응답 저장 직후 중단` 테스트에서 재개는 해당 해시 파일을 읽고 추가 호출 0회, `--replay`는 과거 모델 선택을 그대로 따른다. 라이브 CLI에서만 로컬 `.env.local`을 명시적으로 읽는다. 저장본 재생에는 키가 필요 없다.

### T6. ② 독립 추출과 ③ 인용 검사

- **Files**　생성 `S/extract.ts`, `tests/overlap/extract.test.ts`. `lib/verify/web.ts:28`의 `normalizeSpace` 재사용.
- **Interfaces**　`PublicField[][]` + `generate` → `extract(batch:PublicField[],pass:1|2,io:CallIO):Promise<Extraction>`. `Extraction`은 유효 `Clause[]`, 실패 위치 및 `SavedResponse` 참조. `Clause`는 설계 6장 JSON의 모든 키와 원문 위치·응답 해시·pass를 가진다. 한 묶음의 두 추출은 같은 모델로 맞춘다. 3.6의 1차 직후 일일 한도가 소진되면 그 묶음만 3 Flash로 1·2차를 확보한다. 앞서 완성된 묶음은 재사용한다. 재현은 실행 기록에 저장한 각 pass의 모델·요청 해시를 따른다.
- [ ] RED `같은 모델의 서로 다른 두 실제 요청`, `모델 전환 중 두 모델의 표를 합산하지 않음`, `없는 B/다른 필드/빈 인용 거부`, `공백만 다른 인용 원문 위치 복구`, `틀린 인용 묶음 한 번만 재질문`, `partial 항목 누락`. 다른 회차의 응답·같은 캐시 두 번 읽기는 2표가 아니다.
- [ ] `pilot.mjs:53–104`에서 원문 동사·목록·수급 지위·기관 분리 예시를 옮긴다. `mentions:{text,org,type:"program"|"category"|"law"}[]`. `Kind` = blocks, partial, history, allowed, org_decides, not_restriction. `Effect` = participation_block, personal_payment_block, selection_excluded, apply_block, allowance_choice, amount_deduction. `Condition` = receiving, within_months_after_end, selected, status_on_notice_date, period_overlap. 기간 개월은 양의 정수, 없는 조건·효과는 null. `partial`에는 `restricted_item` 원문 필수. 예외·기간 문구도 원문으로 기록한다.
- [ ] 해당 요청의 B·필드에서 공백만 접어 연속 포함을 검사한다. 빈 인용은 거부한다. 검증되는 원래 문자열을 저장해 DB와 같은 근거가 되게 한다. 틀린 인용은 동일 묶음·동일 pass에 `repair=1`로 1회 재질문, 첫 응답의 유효 건은 유지하며 중복 제거. 재실패는 실패 목록에만 기록한다. 형식 오류·누락을 정상 응답으로 채점하지 않는다.
- [ ] **검증** `V tests/overlap/extract.test.ts`. 허용·비제한도 평가 배열에는 남고, 없는 문장을 근거로 저장한 건수 0.

### T7. ④ 언급한 사업을 A에 연결

- **Files**　생성 `S/link.ts`, `tests/overlap/link.test.ts`.
- **Interfaces**　`Clause[]`, 지역 `RawPolicy[]`, `generate` → `linkMentions(clauses:Clause[],region:RawPolicy[],io:CallIO):Promise<LinkedMention[]>`. `LinkedMention`은 조항·개별 언급, `a:string|null, method:"exact"|"ai"|"none", a_group_ids:string[], orgMatches:boolean`을 담는다.
- [ ] RED `두 기관의 같은 이름`(청년내일저축계좌 두 번호), `부분 일치 한 건은 exact가 아님`, `후보 밖 ID·자기 자신·전국/지역 동일 안내 거부`, `표 2·사업군·법률은 가짜 A 없음`.
- [ ] `pilot.mjs:205–213`의 연도·괄호·공백 정리와 두 글자 조각 Dice 유사도는 후보 찾기에 쓴다. 정확 연결은 기관을 분리한 실제 사업명과 원래 정책명의 일치, 같은 정규화명 그룹 크기 1, 명시 기관과 `sprvsnInstCdNm/rgtrHghrkInstCdNm` 일치를 별도로 검사한다. 기관명 제거 때문에 지역 간 다른 사업이 확정되지 않게 한다.
- [ ] 불일치·다수 후보만 상위 5개(동점은 정책번호 순)와 `none`을 묶어 AI에 묻는다. 입력별 후보 ID 외 응답은 거부. 같은 이름은 선택된 A와 나머지 번호 전체를 보존한다. `a_group_ids`에는 선택된 A를 제외한 같은 이름 번호를 정렬한다. AI 선택은 맞아도 확인 필요. 명백히 같은 사업의 중복 안내는 쌍을 만들지 않고 추적한다. `category/law`는 호출 없이 B 쪽 원문 안내로만 남긴다.
- [ ] **검증** `V tests/overlap/link.test.ts`. 정확 단독 일치에 네트워크 0회, 미연결 `a=null`.

### T8. ⑤ 다른 역할로 자가 검증

- **Files**　생성 `S/verify.ts`, `tests/overlap/verify.test.ts`.
- **Interfaces**　`LinkedMention[]` + B 전문 → `verifyClaims(claims:LinkedMention[],fields:PublicField[],io:CallIO):Promise<Verification[]>`. `Verification`은 claim 식별자·`verdict:Verdict`·이유 한 줄·`verify_quote`·인용 유효 여부·내부 반례 식별자. `Verdict="supported"|"contradicted"|"insufficient"`.
- [ ] RED `차감·중복가능·예외를 전체 제한으로 바꾼 3건`, `틀린 근거 인용`, `누락·중복 index`. `pilot.mjs:115–139`의 세 반례를 일반 판정에 섞고 정답·반례 표시를 모델에 노출하지 않는다. 검증 도중 모델이 바뀌면 두 번째 모델의 첫 검증 묶음에도 **같은 세 반례**를 섞는다. 반례 유형은 여전히 3개다. T10은 실제 검증을 맡은 모델별로 각각 세 응답과 인용을 확인한다.
- [ ] B 전문, A 언급, 판정 종류·효과·조건·조건값·예외·제한 항목·인용을 검증 전용 프롬프트로 약 40건씩 보낸다. 각 판정에 하나의 응답을 대응시키며 `verify_quote`를 B의 같은 필드와 대조한다. 반박은 버리고 추적만, 근거 부족은 확인 필요. `supported`도 인용이 없으면 확정 불가. 반례·실제 건·연구 정답을 보고서에서 구분한다.
- [ ] **검증** `V tests/overlap/verify.test.ts`. 각 검증 모델에서 테스트 반례 3개 모두 채점에 전달, 일반 규칙에 섞인 반례 0.

### T9. ⑥ 규칙 확정

- **Files**　생성 `S/decide.ts`, `tests/overlap/decide.test.ts`.
- **Interfaces**　독립 pass별 `LinkedMention[]` + `Verification[]` + 원문 → `decide(first:LinkedMention[],second:LinkedMention[],checks:Verification[],region:RawPolicy[],run:RunContext):{rules:RuleRow[],evidence:EvidenceRow[],clauses:ClauseRow[]}`. `rules`는 출처 agent의 서비스 후보, `clauses`는 평가·추적용이다.
- [ ] RED `일곱 조건 각각 하나씩 제거`. 기준은 (1) B 인용 유효 (2) `kind=blocks` (3) 프로그램 정확 단독 연결·기관 일치 (4) 신청 연도 일치 또는 한쪽 상시 (5) 독립 2회 종류별 일치 (6) 기간 문구가 없거나 기준 사건과 개월 수가 원문대로 구조화된 상대기간이고, 해당 항목에 참조어 없음 (7) `supported`이며 검증 인용 유효. 실패한 조건별 한국어 사유를 남긴다.
- [ ] (4)는 `aplyYmd` 또는 정책명에 명시한 연도, `normalize.ts:36–39`의 상시만 인정한다. 불명·충돌한 연도는 확인 필요. `plcyNo` 연도를 모집 연도로 쓰지 않는다. (5)는 A→B·kind·언급 단위로 대응시키고 여러 조건을 일대일로 비교한다. `blocks`는 효과·조건·키 순서를 무시한 조건값·예외 유무, `partial`은 여기에 `restricted_item`. 예외 표현 차이는 검증에서 내용 확인. 한쪽 누락·다른 결과는 확인 필요다.
- [ ] `다른 제목의 공고문`은 실제 인천 B로 검사. 가장 가까운 앞 제목(○·□·■ 등)과 인용에 걸친 줄에서만 `별표|첨부|공고문|지침|상세내용` 검사. 반복 인용이 여러 항목에 걸려 위치가 확정되지 않으면 확인 필요. [결정 2A] `period_text`에 원문을 보존한다. T9 테스트에서 ‘지급이 끝난 날부터 6개월’과 `within_months_after_end`, `months:6`이 일치하면 ⑥ 통과. 기준 사건 누락·개월값 불일치·별표 참조·해석되지 않은 기간이나 선후 관계가 하나라도 남으면 확인 필요다.
- [ ] T10 CLI가 만든 `RunContext={run_id:string,startedAt:string}`를 받아 모든 agent 행에 같은 실행 ID를 찍는다. `RuleRow.model`에는 해당 규칙의 두 추출에 사용한 실제 모델을 기록하고 이름 연결·자가 검증 모델은 각 응답 해시로 추적한다. 인용 실패는 규칙·근거에서 제외, `contradicted`는 추적만, `allowed/not_restriction`과 A 없는 언급은 `agent_clause`에만 저장. 연결된 `history/org_decides`는 확인 필요. [결정 1B] 두 호출이 항목까지 일치하고 검증이 지지해도 agent의 `partial`은 `needs_check`로 저장한다. 이 조건을 테스트하고 T13에서 항목과 확인 필요 사유를 표시한다.
- [ ] **검증** `V tests/overlap/decide.test.ts`. 같은 이름·AI 연결·불명 연도·한 표·외부 지침·검증 인용 실패의 확정 건수 각각 0.

### T10. 에이전트 단독 채점, ⑦ 조사 우선 병합

- **Files**　생성 `S/score.ts`, `S/merge.ts`, `scripts/overlap-agent.ts`, `tests/overlap/score.test.ts`, `tests/overlap/merge.test.ts`. `package.json`에 `overlap:agent` 등록. 출력 `A/report-<run_id>.md`, `A/clauses.json`, `O/evidence.json`, `O/rules.json`.
- **Interfaces**　`score(cases:Case[],agent:ReturnType<typeof decide>,checks:Verification[],run:RunContext):RunReport`. `merge(research:Research,agent:ReturnType<typeof decide>):{evidence:EvidenceRow[],rules:RuleRow[],clauses:ClauseRow[]}`. `RunReport`는 `run_id,modelsUsed:ModelId[],실행일,snapshotSha256,요청별 모델·단계·해시 목록,정답 버전,covered/total,falseBlocked,wrongSupported,wrongTotal,complete,passed` 및 아래 지표를 갖는다. [제안] 보고서 안 고정 JSON 코드 블록 하나를 기계 판독해 T12까지 같은 판정을 쓴다.
- [ ] RED `연구본을 합치면 맞는 쌍도 단독 점수는 0`, `한 줄의 두 급여`, `오판 하나/반례 supported 하나면 불합격`, `다른 run의 통과 차용 금지`, `불완전 응답으로 0/0 통과 금지`.
- [ ] 정답별 방향·조건·언급·기대 kind 및 지정 효과·항목을 맞춘 건수/전체를 기록한다. 예외 문장에 포함된 허용도 같은 언급·조건인지 본다. 기대 `needs_check`, 허용, 부분 제한 또는 비제한을 전체 차단하면 확정 오판이다. 미검출은 재현율 분모에 남긴다. 표 2 번호 연결 오류도 개별 기록한다. 정답 없는 신규 쌍은 자가 검증 분포, 올바른 사례의 supported 비율, 반례 contradicted 비율을 분모와 함께 낸다. 정답의 조건·효과를 서로 다른 추출 행에서 하나씩 가져와 한 건의 정답으로 조립하지 않는다. 같은 언급·조건에 정답과 잘못된 전체 차단이 동시에 있으면 오판도 센다.
- [ ] 통과는 완료된 동일 실행의 `falseBlocked===0 && wrongTotal===3 && wrongSupported===0`. `wrongTotal`은 고유 반례 유형 수, `wrongSupported`는 검증에 사용한 모든 모델에서 세 반례를 잘못 지지한 응답의 총수다. `complete`는 실행 기록상 필수 묶음·pass의 처리 상태와 각 검증 모델의 서로 다른 세 반례 응답·유효 근거를 모두 확인했을 때만 참이다. RED 테스트에 `같은 반례 ID 세 번`, `3.6은 통과했지만 3 Flash 반례 누락/오판`을 넣는다. `insufficient`는 잡아낸 비율의 분자에 넣지 않는다. 재현율에 임의 통과선을 더하지 않는다. 누락·잘못된 요청 해시·이전 모델/프롬프트는 통과 증명으로 쓰지 않는다.
- [ ] 보고서·산출물을 세트로 식별하기 위해 `snapshotSha256` 외에 cases·연구본·병합 rules/evidence/clauses 파일 해시도 기록한다. 판정은 병합 전에 확정하고 해시만 병합 후 기입한다. 같은 A→B에는 조사 판정을 우선한다. 같은 쌍에 조사 ‘확인 필요’가 있는데 AI가 확정해도 승격하지 않는다. 조사에 명시된 서로 다른 수급 조건·예외는 보존하고 같은 근거의 중복 화면 행은 제거한다. 새 쌍만 T9 결과. `source`는 내부에 유지. `run_id`는 새 실행에 부여하며 재개 때는 같은 입력·실행 ID를 사용한다. 해시가 같은 저장본의 재현과 새 독립 투표를 구분한다.
- [ ] CLI의 로컬 명령은 `tsx --tsconfig tsconfig.json scripts/overlap-agent.ts`, 적재·내보내기·검사는 같은 방식으로 각각 `scripts/db-build.ts`, `scripts/db-export.ts`, `scripts/db-export.ts --check`를 실행한다. CLI 기본은 저장본 전용, `--live`만 T14에서 허용. 완성한 실행의 입력·출력 해시와 점수를 보고서에 묶고 세트가 모두 일치할 때만 인계한다. 불합격 시에도 조사본을 재생성할 수 있어야 한다. **검증** `V tests/overlap/score.test.ts tests/overlap/merge.test.ts`.
- [ ] [제안] `npm run db:build -- --research-only`를 T11에 추가한다. 첫 실행에서 응답·보고서·병합본이 없어도 `A/research.json`의 57쌍과 그 근거로 적재한다. `npm run db:export` → `npm run db:verify`의 기대값은 agent 규칙·안내 0건, 조사 방향쌍 57개, 외부 호출 0회다. 조사본이 없거나 불완전하면 오류로 끝낸다.

### T11. 모든 JSON 적재와 안전한 DB 교체

- **Files**　수정 `lib/db/sources.ts`·`package.json`·`.gitignore`, 생성 `lib/db/build.ts`, `scripts/db-build.ts`, `tests/db/sources.test.ts`, `tests/db/build.test.ts`.
- **Interfaces**　`readSources(root:string,mode?:"merged"|"research-only"):Sources` → `buildDb(src:Sources,outPath:string):BuildReport`. `Sources`는 기존 snapshot(원본 배열·asOf·파일 해시), verified, results, supporting 5종과 `evidence, rules, clauses, report:RunReport|null`. `BuildReport`는 snapshotId·canonicalSha256·각 테이블 건수. [제안] `agent_run(run_id TEXT PRIMARY KEY, report_json TEXT NOT NULL)`에 점수·입력/산출물 해시를 보존해 T12가 재현한다.
- [ ] RED `새 스냅샷 불일치`, `중복 ID·중간 FK 실패 후 이전 DB 보존`, `빈 키/누락 키·순서 그대로 왕복`, `윈도에서 외부 연결이 DB를 점유`. `needs_check`든 조사/agent든 참조 정책이나 API 인용 누락은 적재 오류다. `--research-only`는 기존 AI 실행이 한 건도 없어도 독립적으로 동작해야 한다. 신규 스냅샷 검증에서 이미 정책·인용 불일치로 실패한 배포 후보를 이 옵션으로 덮어써서 성공 처리하지 않는다. 이전 정상본을 유지한다.
- [ ] 구 계획 T2·3의 원본 로더를 유지. 스냅샷과 20자리 verified 파일, verify-results, `regions, route-links, verify-candidates, verify-eval-answers, verify-replay` 적재. `zod` 오류에 파일·인덱스·키 표기. 같은 `asOf`여도 파일 sha를 확인한다. 현재 조사/에이전트 출력 일부만 사라지면 빈 규칙으로 성공시키지 않는다.
- [ ] `npm run db:build`는 `data/db/pathfinder.sqlite`와 같은 디렉터리에 고유 임시 DB를 만들고 한 트랜잭션으로 삽입한다. 중복 번호, `ordinal` 순 파싱 후 해시, `foreign_key_check`·`integrity_check`, 근거의 B, API 필드의 실제 인용, agent 검증 인용·그룹 ID를 검사한다. 회차 값이 있으면 그 verified 회차를 검증하되 null은 허용한다. 공식 근거는 URL·인용을 보존하고 API 출처로 바꾸지 않는다.
- [ ] 실패에 검사 이름과 연관 `rule_id/evidence_id`(조항은 `clause_id`) 출력, 롤백·자기 연결 닫기·이번 임시 파일만 정리. 전부 성공해야 닫고 rename. 잠금 실패는 `[replace]`와 경로를 표시한다. 11/23에 참조 무결성이 깨지면 이전 완전한 배포본 유지, 원천을 고친 뒤 다시 적재. 인용·ID가 온전하지만 판정에 쓰인 원문이 바뀐 agent 규칙은 예전 통과로 확정하지 않는다(T12).
- [ ] **검증** `V tests/db/sources.test.ts tests/db/build.test.ts`, 같은 입력으로 `npm run db:build` 2회 → 같은 counts·canonicalSha256. 11/16 기준 정책 4,020개, 검증 6·저장 결과 6·보조자료 5는 구 계획 T2·3의 수치와 같다. `fs.readdirSync("data/verified")`의 20자리 JSON 파일, `Object.keys`로 센 결과 키, 보조자료 5개 경로의 존재도 이번에 확인했다.

### T12. 실행별 내보내기와 앱 로더

- **Files**　생성 `lib/db/export.ts`, `scripts/db-export.ts`, `lib/data/overlap.ts`, `tests/db/export.test.ts`, `tests/overlap/load.test.ts`. `package.json`에 `db:export,db:verify` 등록.
- **Interfaces**　DB + 동일 실행 보고 → `exportApproved(dbPath:string,root:string):{approved:Approved,manifest:Manifest,texts:Record<string,string>}`. `Approved={snapshotId:string,rules:ApprovedRule[],notices?:{b:string,field:Field,quote:string}[]}`, `ApprovedRule=RuleRow & {evidence:EvidenceRow}`. `Manifest`는 `dataVersion,snapshotAsOf,counts,files`. `loadOverlap():Map<string,ApprovedRule[]>`가 B별 묶음을 반환하고, 같은 로더에서 `loadOverlapNotices(b:string):string[]`로 추적용 행을 제외한 B 안내 인용만 읽는다.
- [ ] RED `회차 null인 needs_check도 배포`, `실패·누락·타 run 보고서는 research만`, `이전 통과 후 새 실행 실패`, `clauses 미배포`, `같은 원천의 바이트·버전 같음`. 실패했던 판정이 지난 성공 보고서로 살아나면 실패다. `passed:true`만 믿지 않고 T10의 공통 통과식과 최신 입력·대상 산출물 해시를 대조한다. `asOf와 run_id가 같고 원문만 다름`도 이전 agent 배포 0건을 단언한다.
- [ ] 쿼리는 `source=research` 또는 **현재 배포 대상 실행과 같은 run_id이며 보고서 통과**인 agent만 허용. 조사 57쌍 및 연결된 `blocked/needs_check`, 근거를 `rule_id` 순 출력. 추적용 `agent_clause`를 B 카드로 내보내지 않는다. 미연결 사업군은 기존 B 원문 표시 경로로만 제공(T13). [결정 5A] 스냅샷 변경 후 새 입력에서 통과한 run이 생길 때까지 조사본만 내보낸다. 예전 agent 규칙과 파생 안내는 함께 제외한다. 참조 정책·인용 불일치는 T11에서 적재 자체가 실패한다.
- [ ] 구 계획 T5의 `writeExport(root,texts)`·`checkExport(root,texts):string[]`, 정렬·해시 앞 12자리·바이트 직렬화를 유지. 검증된 파일 세트를 준비한 뒤 교체, 실패 시 이전 세트 복구. `--check`는 쓰지 않고 다른 경로를 출력·종료 1. `lib/data/verified.ts:108–133`처럼 번들 JSON을 zod 검사·색인, 서버에 SQLite·Gemini 의존성 없음.
- [ ] **검증** `V tests/db/export.test.ts tests/overlap/load.test.ts`, `npm run db:export` 후 `npm run db:verify` → 다른 경로 0, 종료 0.

### T13. 규칙을 개인 상태와 대조하고 API에 연결

- **Files**　생성 `lib/judge/overlap.ts`, `tests/overlap/evaluate.test.ts`. 수정 `lib/judge/{types,index,handler}.ts`, `lib/plan/{handler,summary}.ts`, `tests/judge/handler.test.ts`, `tests/plan/plan.test.ts`.
- **Interfaces**　`Benefit={policyId:string,status?:"applied"|"selected"|"receiving"|"eligible_unpaid"|"ended"|"planned"|"unknown",lastPaymentDate?:string,plannedStart?:string,plannedEnd?:string,noticeStatus?:{ruleId:string,date:string,met:boolean},monthlyPayment?:{month:string,amountWon:number}}`. `evaluateRules(rules:ApprovedRule[],benefits:Benefit[],plannedBenefits:Benefit[],now:Date):{current_restrictions:Restriction[],planned_conflicts:Restriction[]}`. `Restriction`는 `ruleId,sourceId,sourceName,effect,state:"applies"|"not_applies"|"needs_info",reason,evidence:{field,quote,url,checkedAt},question:string|null`와 `restricted_item`. 출처 표시는 양쪽 동일.
- [ ] RED `달력 경계와 날짜 누락`, `선정 대기/선정/첫 지급`, `자격만 있고 미수급`, `불명 한 가지 질문`, `부분 미지급에서 참여 자격 보존`, `기존 요청과 규칙 없는 정책`. 실제 `handleJudge`에서 적용/미적용/자료 부족/규칙 없음 네 응답을 검사한다. [결정 3A] 공고일 신분 참/거짓/미입력, 해당 월 지급액 0원/미입력/다른 달을 각각 검사한다.
- [ ] 규칙의 `judgement`와 개인 상태를 따로 읽는다. 명백히 미적용이면 `not_applies`. 조건·예외·기준일·수급액 중 필요한 사실이 없거나 `unknown`이면 `needs_info` 및 필요한 질문 하나. `needs_check` 규칙은 개인 사실만으로 승격하지 않는다. `receiving`은 실제 수급, `selected`는 선정 또는 지급 중(신청만은 미적용). `within_months_after_end`는 실제 마지막 지급일과 신청 기준일의 달력 개월로 검사한다. 예시 2026-07-15 종료 → 2027-01-14 제한, 01-15 해소. `status_on_notice_date`는 그날 상태 증거, `period_overlap`은 기간 교집합을 요구한다. 미래 계획 충돌은 현재 차단과 구분한다.
- [ ] `POST /api/judge`의 선택 입력 `benefits[]`를 zod로 검사한다. 레거시 `participating[]`만으로 실제 수급을 단정하지 않는다. `eligible_unpaid`는 자격만 있고 실제 수급한 적 없음, `noticeStatus`는 지정 규칙의 공고일(YYYY-MM-DD)에 해당 신분이었는지, `monthlyPayment`는 해당 월(YYYY-MM)의 실제 지급액(원 단위 0 이상 정수)이다. 0원과 `met:false`는 알려진 값이다. 누락·모름·다른 공고일이나 월의 값은 해당 사실 미상으로 두고 필요한 질문 하나만 반환한다. [제안] 영문 키는 이 계약을 구현할 때 사용할 이름이다. 상충하는 동일 식별자의 사실(예: 같은 정책·같은 월의 서로 다른 금액), 존재하지 않는 날짜·음수 금액·뒤집힌 예정 기간은 HTTP 400으로 처리한다. 상이한 달의 지급액은 월별로 대조한다. 명시되지 않은 예외 요건을 코드가 대조할 수 없으면 해당 규칙은 `needs_info`로 둔다.
- [ ] `restrictionAxis`에서 B별 규칙 우선, 규칙 없는 B는 기존 검증 인용·관계·키워드 경로 유지. [제안] `category/law` 등 미연결 안내가 기존 `texts.excluded` 밖에만 있으면 B별로 함께 읽은 `approved.notices`의 원문 대조된 인용을 이용해 `official_quote`로 보여준다. 이를 위해 배포본에 **쌍 없이** `notices:{b:string,field:Field,quote:string}[]`를 선택적으로 둔다. 통과한 실행의 유효 B 인용만 T12에서 파생하고 `agent_clause` 행 자체는 배포하지 않는다. 승인본 없는 B 전체를 임의 제한으로 만들지 않는다.
- [ ] B 전체가 막히고 확정·개인 적용이면 상태에 ‘수혜 불가’를 제공한다. 개인 판정은 `ineligible`에 해당 사유·근거를 남긴다. 연구본에서 확정한 규칙에 `restricted_item`이 있으면 ‘수급기간 중 훈련장려금 미지급’처럼 해당 항목만, `personal` 전체 탈락 금지. 질문이 여러 개면 해당 카드에서 결론을 가르는 첫 질문 하나. 예외 미확정은 확인 필요. API 기존 키를 보존하고 `items[].restrictions`에 현재 판정, `items[].planned_conflicts`에 예정 충돌, 최상위 `dataVersion`을 추가한다. UI 작업은 이 계약의 소비 예시까지다.
- [ ] `lib/plan/handler.ts:135–147`의 내부 `handleJudge`에도 명시 입력을 넘긴다. 캐시 키에 `dataVersion`과 최종 판정 해시를 더한다. `summarizeForAI`에 개인 수혜 사실을 추가하지 않는다. **검증** `V tests/overlap/evaluate.test.ts tests/judge/handler.test.ts tests/plan/plan.test.ts`. 같은 요약이라도 결과·버전이 다르면 캐시 미적중, 판정 경로의 Gemini 호출 0. 실제 `lib/plan/handler.ts:84`의 `RequestSchema.session`과 `PlanSession`에 같은 선택형 `benefits` 스키마를 연결한다. `handlePlan` 진입 테스트로 수혜 입력이 내부 `handleJudge`까지 도달하는지 확인한다. `/api/judge` 내부에서는 검증된 사실을 `Profile`에 붙여 현재·전이·타임라인의 `judgeAll`에 함께 전달한다. 외부 계획 요약과 `routeForAI`의 사유·질문에도 개인의 지급액이나 마지막 지급일이 실리지 않는지 가짜 클라이언트로 검사한다.

### T14. 승인된 전체 실행과 빈 상태 재확인

- **Files**　생성 `tests/overlap/replay.test.ts`. T10~12의 CLI·원천·보고·배포 파일 사용.
- **Interfaces**　고정 스냅샷·`Case[]`·`Research`·정확한 요청의 `SavedResponse` → 같은 `RunReport`의 점수, `BuildReport`, `Approved`, `Manifest.dataVersion`.
- [ ] RED `빈 저장소 재현 누락 응답`은 해시·단계를 알리고 네트워크 0회, `새 스냅샷 불일치`는 이전 배포본 보존. 작은 완전한 가짜 실행을 끝까지 재생해 파이프라인 연결을 먼저 확인한다.
- [ ] **실제 호출은 이 Task에서만 사용자 승인 후** `npm run overlap:agent -- --live`. 사용자가 지정한 `data/snapshot/current.json`의 SHA-256을 검증 보고와 대조하고, 두 모델의 실행 시점 무료 잔여량을 확인한다. 실제 응답과 보고서를 보존한다. 실행 종료 전 중단하면 같은 실행으로 재개한다. 불합격·한도 소진을 통과로 기록하지 않는다.
- [ ] 원본 작업 경로와 분리한 임시 복사본에서 경로 확인 후 재생성물(DB, 병합 출력, 보고서, clauses, approved, manifest)만 비운다. 입력 스냅샷·연구본·cases·`A/runs/<run_id>.json`·저장된 원 응답은 복원 원천으로 남긴다. `npm run overlap:agent -- --replay --run-id <기록한ID>` → `npm run db:build` → `npm run db:export` → `npm run db:verify`. 실행 시각은 원 응답의 기록을 재사용한다. 동일 입력으로 다시 처음부터 실행해 규칙·근거·보고 지표·버전·배포 바이트를 비교한다. 별도 빈 복사본에서는 응답·실행 기록 없이 T11의 `--research-only`부터 복원하는 경로도 검증한다.
- [ ] **검증** `V tests/overlap/replay.test.ts`, `npm test` 연속 2회 및 `npm test -- --sequence.shuffle` 1회, `npm run build` → 각 종료 0. 최종 제출본의 실제 건수·통과 여부·버전·해시, 재현 중 외부 호출 0회를 기록한다. 승인된 라이브 실행과 완전한 저장본이 모두 없으면 해당 실행 검증은 미완료로 기록하고 연구본 제공 가능 여부를 별도 확인한다.

## 기존 SQLite 실행 계획의 교체 범위

| 구 계획 | 유지할 검증 | 폐기하는 검증 → 새 완료 조건 |
|---|---|---|
| T1 스키마 | 내장 SQLite, FK, 중복·ID·자기쌍, 근거 필드 | ‘작성자 자신 승인 금지’, ‘검토자·일자 필수’ → T1·3의 판정·출처·실행·사유·agent_clause 제약 |
| T2 읽기 | JSON 오류 위치, 20자리, 원본 바이트 해시, 보조자료 5종 | 검토자 포함 RuleRow·배포 입력 누락을 묵인 → T2·3·11의 판정 계약, 추적 자료와 보고서 연결 |
| T3 적재 | 순서·빈 값·누락·고유 번호·FK·원문 검사, Windows 잠금·롤백 | `approvedRules`를 승인 상태로 집계 → T11·12의 출처·판정·실제 내보낸 건수 |
| T4 시연 4개 | 실제 B 인용·조건·예외 회귀 검사 | 이름 수집, rules=4/approved=3 고정 → T2·9·10의 연구 57쌍과 조건별 4건. 4번은 확인 필요 |
| T5 export | 정렬·해시·버전·변조·재구축 일치 | ‘승인 + 회차 필수’, ‘검토자 숨김’ → T12의 두 판정·회차 null·출처/실행 게이트·취소된 실행 |
| T6 재현 | 빈 상태 복원·반복·셔플·앱 빌드 | T14에서 응답 재생부터 시작, 연구 전용/통과 실행 각각 확인. 사용자 작업 경로에 대한 일괄 삭제 금지 |

## 일정 (KST)

| 날짜 | 끝낼 일 | 한도가 걸리면 |
|---|---|---|
| 11/19 | 계획 검증·미결정 항목 전달 | 오늘 Gemini 사용 0회 |
| 11/20 | 최종 입력 확정. 지정된 `data/snapshot/current.json`을 사용한다. T1~T13 검증과 별도 승인 후 T14 실제 실행을 시작할 수 있다 | 받은 응답을 즉시 저장한다 |
| 11/21 | 전체 실행 예정일. 11/20에 시작했다면 같은 실행을 재개한다 | 약 50회, 시범 실측 기준 약 2~2.5시간에 한도·재시도 대기가 더해진다. 11/20 표시 잔여량은 3.6 Flash 3회와 3 Flash 20회다. 실제 일정에는 초기화 대기와 전환 중 묶음 재추출을 반영한다 |
| 11/22 | 같은 실행 재개, 채점·조사 병합·연구 전용 내보내기까지 리허설 | 일일 소진은 모델 전환 또는 초기화 대기, 일시 오류는 같은 모델로 재시도 |
| 11/23 오전, 12:00 제출 | 과거 통과 보고 재사용 방지, 새 스냅샷 인용·정책 검사, 빈 상태 재현. 기한까지 통과가 없으면 검증 가능한 연구본만 제출 | 참조 불일치는 적재 실패. 이전 정상 배포본을 쓸 때에는 그 실제 기준일·버전을 유지한다 |

## 사용자 결정 (2026-11-20)

1. **1B** — 에이전트가 추출한 일부 제한은 항상 확인 필요다. 연구본에서 확정한 항목별 효과는 그 범위에서만 표시한다.
2. **2A** — 원문에 기준 사건과 상대기간이 명확하고 구조화 값이 일치하면 다른 검사 통과 시 규칙 확정이 가능하다. 개인의 마지막 지급일이 빠지면 날짜를 묻는다.
3. **3A** — 실제 미수급, 공고일 당시 신분, 해당 월 지급액을 모두 선택 입력으로 받는다. 계약·검증 사례는 T13에 둔다.
4. **4-1 A / 4-2 A** — 사용자가 11/20 제공한 **Gemini 3.6 Flash** 표시값은 분당 요청 2/5, 분당 토큰 6.16K/250K, 일일 요청 17/20이다. **Gemini 3 Flash**는 각각 0/5, 0/250K, 0/20이다. 이 프로젝트의 텍스트 생성 일일 잔여량은 표시 시점 기준 각각 3회와 20회다. 최종 입력은 `D:\pathfinder\data\snapshot\current.json` (기준일 2026-11-16, 4,020건)이다. 별도 전달을 기다릴 필요가 없다.
5. **5A** — 11/23 원문이 바뀌면 새 입력에 대한 재검증 통과까지 조사본만 제공한다. 인용·정책 불일치로 적재가 실패하면 이전 정상 배포본을 유지한다.

## 검증 보고

### 1. 설계 대조표

‘담당’은 구현과 그 단언을 함께 가진 Task다. 각 절 번호는 [기준 설계](./2026-11-19-overlap-agent-design.md)와 같다.

| 절 | 결정 또는 조건 | 담당 |
|---|---|---|
| 2 | 여섯 지역코드, 전국 안내 포함 | T4 |
| 2 | 공개 원문 세 필드 | T4·5 |
| 2 | 확정 전체 제한 / 확인 필요 | T9·13 |
| 2 | 운영자 검증 없음 | T3·8 |
| 2 | 연구와 agent를 같은 화면 표시 | T12·13 |
| 2 | 57쌍을 정답과 최종 자료 양쪽에 사용 | T2·10 |
| 2 | 11/20 변경 결정에 따라 무료 3.6 Flash 우선, 일일 소진 시 3 Flash | T5 |
| 6① | 두 필드 전수, 지원내용 레코드 선별, 전문 단위 묶음 | T4 |
| 6② | 독립 추출 2회·JSON 검증·모든 분류와 예외 | T5·6 |
| 6② | 허용·비제한은 평가, category/law는 B 원문 표시 | T3·7·12·13 |
| 6③ | B의 필드에 공백만 다른 실제 인용, 한 번 수정 요청 후 폐기 | T6·11 |
| 6④ | 정규화는 후보 탐색, 정확 단독 연결과 기관 비교 | T7·9 |
| 6④ | 남은 언급만 상위 5개 또는 none, 같은 이름 그룹 유지 | T7 |
| 6④ | A=B·동일 사업 전국/지역 안내 제외 | T7·10 |
| 6⑤ | 별도 역할, 약 40개, 근거 재대조·반박 폐기·부족 보류 | T8 |
| 6⑥ | 코드로만 7개 조건 최종 판정 | T9 |
| 6⑦ | 57쌍 병합 후 JSON으로 DB 적재 | T10·11 |
| 7① | 원문 인용이 없으면 저장 제외 | T6·11 |
| 7② | 에이전트 확정은 blocks만 허용, partial은 항목을 적고 확인 필요 | T9·13 |
| 7③ | program·정확·단독·기관 일치, AI 연결 확인 필요 | T7·9 |
| 7④ | 신청 연도 일치 또는 한쪽 상시, 미상 보류 | T9 |
| 7⑤ | 다른 응답 2개에서 조건값·예외 유무 대조, partial은 제한 항목 추가 | T5·9 |
| 7⑥ | 구조화한 명시적 상대기간 예외, 미해결 기간·순서와 해당 항목의 참조어 검사 | T6·9 |
| 7⑦ | supported와 그 근거의 원문 일치 | T8·9 |
| 7 개인 | 규칙·효과·필요 사실 분리, 전체/일부/질문 하나 | T3·13 |
| 7 개인 | 미수급·공고일 신분·월 지급액 선택 입력, 참여 목록만으로 수급 추정 금지 | T13 |
| 8 | 로컬 REST, 키 헤더·JSON MIME, 배포 서버에서 분리 | T5·13·14 |
| 8 | 두 모델의 우선순위 고정, 묶음 내 두 추출은 같은 모델로 비교 | T5·6 |
| 8 | 6,000자/헤더 대기 약 5분, 연결·검증 묶음 및 호출 예산 | T4·5·8·14 |
| 8 | 13초 간격, 일일 한도 소진은 전환·초기화 대기, 일시적 429는 재시도 | T5·14 |
| 8 | 응답 없음·500·503 재시도, 400·403·404 즉시 중단, 시각·회차 기록 | T5 |
| 8 | 응답 즉시 저장, 실행일·모델 기록 및 실패 단계 재개 | T5·10·14 |
| 8 | 모델·순번·프롬프트·원문 해시 일치만 재생 | T5·6·14 |
| 8 | 11/20 지정한 최종 파일, 11/23 입력 변경 시 재검증까지 조사본만 배포 | T11·12·14 |
| 9 | 같은 방향쌍은 연구 우선, 보류 승격 금지·신규는 7장 | T2·9·10 |
| 9 | source 기록, 사용자 표시 동일 | T3·12·13 |
| 9 | 병합 전 사례별 조건·효과·항목·예외 평가 | T2·10 |
| 9 | 두 표 변환, 표 2 미연결, 한 줄의 상반된 언급 분리 | T2·7·10 |
| 9 | 재현율·확정 오판·신규 쌍 verdict 분포 | T10 |
| 9 | 반례 3개·정답 supported 비율, 반례 supported 하나면 실패 | T8·10 |
| 9 | 확정 오판 0, 같은 실행 통과만 export, 실패 시 research만 | T10·12·14 |
| 10 | review_status·사람 승인 CHECK 제거, 판정·사유·출처·모델·run_id | T3 |
| 10 | 두 판정 배포·회차 필수 조건 폐기·연도 검사 | T9·12 |
| 10 | agent_clause에 허용·미연결 등 보관, 규칙 배포에서 제외 | T3·9·11·12 |
| 10 | restricted_item·period_text·verify_verdict·verify_quote·a_group_ids·코드값 | T3·6·11 |
| 10 | 교차 검토 4건은 연구본에 포함 | T2·10 |

대조하면서 6③의 **의미상 재질문과 전송 재시도의 분리**, 7⑥의 **다른 제목에 나온 공고문**, 9장의 **같은 run 확인과 이전 성공본 차용 방지**, 서버 2.4의 **판정 캐시 무효화**를 각각 T5·6, T9, T10·12, T13의 단언에 포함했다.

### 2. 데이터 재확인 (읽기 전용)

대상 `data/snapshot/current.json`은 2026-11-16, 4,020행, SHA-256 `f4e8075fdbe7204045f4f9c0821a05a204e3e5b8fa0d0d1ba7a3f87cc26bd39d`. `Get-FileHash data/snapshot/current.json -Algorithm SHA256`와 `node --input-type=module`의 `fs.readFileSync`로 직접 조사했다. 시범 스크립트를 실행하지 않았다.

| 항목 | 실행 결과와 비교 | 재현 기준 |
|---|---|---|
| 지역 범위 | **1,127** 일치 | zipCd 쉼표 분리·trim 후 6코드와 교집합 |
| 전송량 | ptcp **246**, add **447**, sprt **93** 일치. 525개 B, 786필드, 94,196자 | `pilot.mjs:15–17,53–61`. 필드 원문 길이 22,807 + 43,378 + 28,011 |
| 이름 충돌 | **129개 묶음**, 정규화 이름 974개 | 지역 1,127건을 `pilot.mjs:205`로 그룹화 후 크기 >1인 그룹 수 |
| 참조어 | 세 필드 전체 **35**(12+14+9), 전송 대상 **30**(12+14+4) | `/별표|첨부|공고문|지침|상세내용/`로 필드당 1회 집계. 35를 전송 필드 수로 테스트하면 틀린다 |
| 표 1 방향쌍·지역 | 서로 다른 **57쌍**, 지역 밖 A·B **0** | 조사 노트 11~67행, A·B 열의 첫 20자리 ID를 따로 읽어 집합 대조 |
| 근거 필드 | 따옴표 문구가 B에 있는 행 **47/7/1**. 요약만 있는 42·43행까지 실제 원문 확인하면 **49/7/1 = 57** | 필드 표기가 있으면 지정 필드, 없으면 긴 인용부터 B의 세 필드에 공백 정규화 대조. 15행의 짧은 제목은 세 필드에 있지만 본문은 ptcp. 42·43행 실제 ptcp에는 모두 ‘대출접수일 현재 공공임대주택에 입주하고 있는 경우 불가’가 있다 |
| 회차·항목·이름 | 아래 4건 대조. **1~3번은 세 검사 중 이름·연도·항목 참조어를 통과**, 4번은 이름에서 보류 | 교차 검토표 9~12·18~20행, `normalize.ts:36–49`, 시범 보고 v2 11~16행 |
| 환경 | `node --version` = v22.22.2, 내장 SQLite 생성자 있음, 로컬 vitest·tsx 실행 파일은 없음 | `process.getBuiltinModule('node:sqlite').DatabaseSync`와 T1의 두 `Test-Path`. Vitest 안의 import는 T1에서 확인 |

| 시연 조건 | ③ 정확명·기관 | ④ 연도 | ⑥ 제목·인용 줄의 참조어 | 판독 |
|---|---|---|---|---|
| 1 구직급여 수급 중 | 구직급여 단독 | B 상시 | 없음 | 세 검사상 확정 가능 |
| 2 구직급여 종료 후 6개월 | 같은 단독 A | B 상시 | 없음 | 기준 사건과 6개월을 원문대로 구조화하면 ⑥ 통과 가능. 개인의 지급 종료일은 별도로 확인 |
| 3 인천 재직청년 복지포인트 선정 | 기관 ‘인천’이 주관·등록기관과 맞고 이름 단독 | A·B 모두 2026 | ‘○ 동시참여 불가’와 인용 줄에는 없음. 필드 전체에는 있음 | 세 검사상 확정 가능. ‘선정’의 세부 근거는 연구본 FAQ |
| 4 국가근로장학생 | 정확명이 ‘국가근로장학금’이라 불일치, 시범 연결 AI | B 상시 | 인용 줄에 없음 | 확인 필요. 과거 경기도 안내를 2026 회차에 자동 적용하지 않음 |

확인 방법은 시연표의 A·B ID로 지역 원본을 조회해 `plcyNm, sprvsnInstCdNm, rgtrHghrkInstCdNm, aplyYmd, aplyPrdSeCd`를 읽고 B의 인용 줄에서 앞쪽 `/^\s*[○□■]/` 제목까지 역탐색한 것이다. 위 표는 원문의 부분 검사 결과다. `Get-ChildItem -Force docs/백엔드/overlap-pilot`에는 `pilot.mjs`와 보고서 2개만 있었다. 보고서 v2 7~8·43~49행의 25/25·36/36 인용, 반례 3개 반박, 정답 6/6 지지는 **저장된 보고 수치**이며 모든 원 응답을 이번에 재채점했다는 뜻은 아니다. 1~3의 독립 2회·검증까지 포함한 agent 확정은 입증되지 않았다.

**집계 재현 예시.** 저장소 루트에서 아래 JavaScript를 UTF-8 표준입력으로 `node --input-type=module`에 전달한다. 네트워크·파일 쓰기가 없다.

~~~js
import fs from 'node:fs';
const read = p => fs.readFileSync(p, 'utf8');
const {records} = JSON.parse(read('data/snapshot/current.json'));
const codes = new Set(['47111','28185','41111','41113','41115','41117']);
const region = records.filter(r => r.zipCd?.split(',').some(z => codes.has(z.trim())));
const fields = ['ptcpPrpTrgtCn','addAplyQlfcCndCn','plcySprtCn'];
const kw = /중복|유사|동시|병행|수급|참여\s*중|수혜|기참여|생애|택일|제외|불가|차감|제한|타\s*사업|받은\s*경우|받고\s*있|수\s*없/;
const ref = /별표|첨부|공고문|지침|상세내용/;
const space = s => s.replace(/\s+/g,' ').trim();
const norm = s => space(s).replace(/^\d{4}년\s*/,'').replace(/\([^)]*\)|\[[^\]]*\]|「|」|'|"/g,'').replace(/[\s·.,\-]/g,'');
console.log(region.length, [...Map.groupBy(region,r=>norm(r.plcyNm)).values()].filter(g=>g.length>1).length);
for (const f of fields) {
  const all = region.map(r=>r[f]??'').filter(s=>s.trim());
  const sent = all.filter(s=>f!==fields[2] || kw.test(s));
  console.log(f, sent.length, all.filter(s=>ref.test(s)).length, sent.filter(s=>ref.test(s)).length);
}
const byId = new Map(region.map(r=>[r.plcyNo,r]));
const rows = read('docs/백엔드/2026-11-19-demo-overlap.md').split(/\r?\n/).slice(10,67);
for (const [i,line] of rows.entries()) {
  const [, ,ac,bc,memo] = line.split('|').map(s=>s.trim());
  const a = ac.match(/\d{20}/)[0], b = bc.match(/\d{20}/)[0], r = byId.get(b);
  const quotes = [...memo.matchAll(/“([^”]+)”/g)].map(m=>m[1]).sort((x,y)=>y.length-x.length);
  const hit = q => fields.find(f=>space(r[f]??'').includes(space(q)));
  const f = fields.find(k=>memo.startsWith(k)) ?? quotes.map(hit).find(Boolean);
  console.log(i+11,a,b,byId.has(a)&&byId.has(b),f,quotes.some(q=>space(r[f]??'').includes(space(q))));
}
~~~

### 3. 인터페이스·실패 조건·분량 점검

| 앞 Task의 결과 | 뒤에서 같은 이름·단위로 소비 | 확인한 경계 |
|---|---|---|
| T2 `Case[]`·`Research` / T3 `RuleRow, EvidenceRow, ClauseRow` | T10 score/merge → T11 `Sources` | A=source, B=target. 조건별 여러 행, `expect_judgement`와 `expect_kind` 분리 |
| T4 `PublicField` → T5 `SavedResponse` → T6 `Extraction` | T7 `LinkedMention` → T8 `Verification` → T9 `decide` | 1차·2차와 수정 요청을 혼동하지 않음. `none`은 내부 `a=null` |
| T9 `rules,evidence,clauses` → T10 `RunReport` | T11 DB → T12 `Approved,Manifest` | `verify_verdict`는 뒷받침 여부, `judgement`는 규칙, `state`는 개인 적용 |
| T12 `loadOverlap`·`dataVersion` | T13 `evaluateRules`·`handleJudge` → T14 재현 | 서버는 JSON만 읽음. 적용·미적용·정보 부족을 기존 응답에 추가 |

| 설계 3장 실패 조건 | 막는 테스트 |
|---|---|
| 허용을 제한으로, 차액·차감·미지급을 전체 차단으로 처리 | T2 한 줄의 두 급여, T8 오답 3개, T10 확정 오판, T13 부분 미지급 |
| 원문에 없는 인용 저장 | T6 없는 B·다른 필드·빈 인용·재질문, T8 검증 인용, T11 새 스냅샷 |
| A를 지어내거나 엉뚱한 번호 연결 | T7 후보 밖, 동명, 자기쌍, 표 2 none / T9 exact 조건 / T11 FK |
| 사용자 상태 모름인데 탈락 | T13 unknown·선정 대기·기간 누락·질문 하나, T14 실제 핸들러 회귀 |
| 사용자 정보가 Gemini로 감 | T4 공개 필드 투영, T5 가짜 fetch 본문 허용 키 테스트, T13 판정 경로 호출 0 |

분량은 Task별 파일·입출력·RED 단언·고정값·검증 명령에 썼다. 실행 가능한 예시는 집계용 읽기 코드 한 블록이다. 구현·DDL 전문이나 시범 프롬프트 전문은 옮기지 않았다.
