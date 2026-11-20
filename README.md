# PathFinder

취업·수료·창업이라는 갈림길에 선 청년에게, 상황 변화에 따라 달라지는 정책 자격을 보여주고, AI 에이전트가 공식 공고를 직접 찾아가 그 변화의 이유와 다음 행동을 안내하는 서비스입니다.
(2026 대한민국 청년 CAREER FAIR AI 해커톤 출품용 프로토타입)

## 구조

- 판정은 서버 코드가 합니다(`lib/judge`). 사용자 정보는 외부 AI로 가지 않습니다.
- 상태 전이(`lib/sim`): "오늘 수료/취업/사업자등록을 했다고 가정"한 전후 비교.
- 정책 검증 에이전트(`lib/verify`): 정책 번호와 공개 데이터만 받아 공식 공고를 찾아가 대조합니다. 접근 범위·한도는 `lib/verify/web.ts`가 강제합니다.
- 시간 흐름 시뮬레이션(`lib/route/timeline.ts`): 앞으로 12개월 동안 정책마다 신청 구간이 언제 열리고 닫히는지 계산합니다. 취업·사업자등록 시점을 개월 수로 바꿔 가며 볼 수 있습니다. 현재 공고 기준이며 언제 취업하는 것이 낫다는 판단은 하지 않습니다.
- 상태 갈림길 루트(`lib/route`): 지금 → 수료한 뒤 → 취업/창업 갈림길. 마디 안의 번호는 `lib/route/weight.ts`의 "먼저 확인할 순서" 점수(우리가 정한 규칙, 이유와 점수를 화면에 표시)이고, 정책 사이 연결선은 공고 인용이 있는 것만 그립니다.
- 상담 질문(`lib/agent/questions.ts`): 답하면 판정이 바뀌는 질문을 코드가 고릅니다. 답은 외부 AI로 가지 않습니다.
- 상담 에이전트(`lib/agent/run.ts`): 가상 인물 시연 전용.
- 설계 문서: `docs/2026-11-16-policy-twin-design.md`, 구현 계획: `docs/superpowers/plans/2026-11-16-galimgil.md`

## 실행

```bash
npm install
npm test
npm run build && npm run start
```

환경변수(`.env.local`, 저장소에 올리지 않음): `.env.example` 참고.

- `EXTERNAL_AI_ENABLED=true`일 때만 외부 AI를 부릅니다. 꺼져 있으면 저장된 검증 결과와 코드가 조립한 카드로 동작합니다.
- `ANTHROPIC_API_KEY`: Claude API 키.
- `YOUTH_POLICY_API_KEY`: 온통청년 API 키(데이터 수집 스크립트에만 필요, 배포 환경에는 넣지 않음).

데이터 수집(제출본은 기준일 고정, 예약 실행은 비활성):

```bash
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/fetch-snapshot.ts
```

검증 에이전트 실행과 비교 실험:

```bash
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-batch.ts 20260406005400212445
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-eval.ts --mode=agent
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/verify-eval.ts --mode=fixed
```

API 키 없이 저장 결과 만들기(개발 도구가 정한 도구 호출을 실제 검증 루프에 넣어 실행, 결과에 `producedBy: "claude_code_session"` 표시):

```bash
npx tsx --tsconfig tsconfig.json scripts/verify-replay.ts run 20260406005400212445 data/verify-replay/turns.json --save
```

`data/verify-results/index.json`의 현재 6건은 이 방식으로 만든 것입니다(2026-11-17). 페이지 열기·허용 도메인·robots.txt·인용 대조는 서비스 코드가 수행했고, 어떤 페이지를 열고 무엇을 인용할지는 Claude Code가 정했습니다. Claude API로 실행한 결과가 아닙니다.

## 중복수혜 규칙 실행

중복수혜 에이전트는 로컬에서 공개 정책 원문을 분석합니다. 기존 `/api/verify`는 정책 한 건의 공식 공고를 대조합니다. 중복수혜 결과는 SQLite에서 검증하고 JSON으로 내보냅니다. 배포된 `/api/judge`는 이 JSON을 읽어 신청자의 수혜 사실과 대조합니다. [구현 계획](docs/backend/2026-11-19-overlap-agent-implementation-plan.md)

Node 22.22에서 연구 조사본으로 배포 파일을 재생성하는 명령입니다.

```bash
npm ci
npm run db:build -- --research-only
npm run db:export
npm run db:verify
```

새 Gemini 실행에는 프로젝트의 무료 할당량과 로컬 `.env.local`의 `GEMINI_API_KEY`가 필요합니다. 실호출은 `npm run overlap:agent -- --live`로 시작합니다. 실행 ID는 `data/overlap-agent/latest.json`에 기록됩니다. 중단 후에는 같은 입력으로 `--live --run-id <ID>`를 사용합니다. 최신 실행의 저장 응답을 다시 채점하고 배포본을 만드는 명령은 다음과 같습니다.

```bash
npm run overlap:agent -- --replay --run-id <ID>
npm run db:build
npm run db:export
npm run db:verify
```

점수와 요청 해시는 `data/overlap-agent/report-<ID>.md`에서 확인합니다. 점수 기준을 통과하지 못한 실행은 종료 코드 2를 반환합니다. 적재·내보내기는 같은 실행과 원문의 검증을 통과한 에이전트 규칙만 조사본에 추가합니다. 이전 실행을 재현하려면 별도 작업 폴더에서 그 실행 기록과 저장 응답을 사용합니다.

`POST /api/judge`에 기존 프로필과 함께 선택 입력인 `benefits`를 보낼 수 있습니다. 예를 들어 구직급여 지급이 종료됐다면 `{"policyId":"20250122005400110369","status":"ended","lastPaymentDate":"2026-07-15"}`를 배열에 담습니다. 정책별 `restrictions`에는 적용 여부·이유·인용 근거가, `planned_conflicts`에는 예정된 충돌이 들어갑니다. 응답의 `dataVersion`으로 사용한 규칙 버전을 식별합니다.

## Vercel Preview 배포

팀 Vercel 프로젝트에 GitHub 저장소를 연결하고 Node.js 22.x를 선택합니다. `backend/vercel-preview` 브랜치를 Preview로 배포합니다. 함수 리전은 `vercel.json`에서 서울(`icn1`)로 설정합니다. 현재 배포용 규칙과 버전은 `data/overlap/approved.json`과 `data/release/manifest.json`에서 가져옵니다.

초기 Preview에서는 브랜치별 환경변수에 `EXTERNAL_AI_ENABLED=false`와 `PLAN_AI_FOR_USERS=false`를 설정합니다. 이 상태에서 자격 판정과 저장된 정책 검증 근거를 확인할 수 있습니다. 외부 AI를 확인하는 Preview에는 승인된 제공자의 키와 `EXTERNAL_AI_ENABLED=true`를 별도로 설정합니다.

```bash
npm ci
npm run db:build -- --research-only
npm run db:verify
npm test
npm run build
npm run smoke:preview -- <Preview URL>
```

스모크 명령은 첫 화면과 세 시연 지역의 `/api/judge` 요청 8건을 확인합니다. 응답에서 배포 데이터 버전, 적용 상태, 근거 인용을 검사합니다.

## Credits / Licenses

| 구분 | 이름 | 출처·라이선스 | 사용 위치 |
|---|---|---|---|
| 데이터 | 온통청년 청년정책 API | 한국고용정보원, 공공데이터포털 등록(이용허락범위 제한 없음) | `data/snapshot` |
| 데이터 | 시군구 코드 이름 | 행정표준 시군구 코드 이름을 내부 작성(공식 대응표 대조 전) | `data/regions.json` |
| 데이터 | 시연 정책 6건의 조건 | 각 기관 공식 안내 페이지(인천청년포털, 고용24, 정부24, aT 등), 2026-11-16 확인 | `data/verified` |
| AI 모델 | Claude API (claude-opus-5-5) | Anthropic | 정책 검증 에이전트, 상담 에이전트 |
| 오픈소스 | Next.js | MIT | 웹 앱 |
| 오픈소스 | React | MIT | 화면 |
| 오픈소스 | zod | MIT | 입력 검증 |
| 오픈소스 | @anthropic-ai/sdk | MIT | Claude API 호출 |
| 오픈소스 | Vitest, tsx | MIT | 테스트, 스크립트 실행 |
| 개발 도구 | Claude Code | Anthropic | 조사, 설계, 코드 작성, 설계 평가 |
