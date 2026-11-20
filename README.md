# PathFinder

## 2026-11-21 프론트엔드

```bash
npm ci
npm run dev
```

`http://localhost:3000`에서 새 플래너를 엽니다. 기존 화면은 `/legacy`에 보존했습니다.

- **예시로 둘러보기**: 명세서의 고정 기준일 2026-11-19와 12개 가상 정책으로 시연합니다. 수료생 구직 지원을 담고 취업일을 2027-02-13, 2027-01-03으로 바꿔 D−61 → D−85 → 신청 불가 → 되돌리기를 확인할 수 있습니다.
- **내 정보로 시작**: 기존 정책 스냅샷·규칙 엔진을 이용합니다. 미검토 조건과 수혜 기간은 확인 필요로 남깁니다.
- 정책 선택, 일정 편집, 추천 미리보기, 비교·교체, 여러 계획 저장과 일 단위 로드맵을 지원합니다. 저장은 현재 브라우저에만 적용되며 실제 로그인·기기 간 동기화는 포함하지 않습니다.
- 외부 AI 없이 일정 문답과 조건 기준 추천을 사용할 수 있습니다. 기존 AI·검증 엔드포인트와 설정은 유지했습니다.
- `/api/judge`의 선택적 `plannerV2` 입력·응답은 기존 필드와 공존합니다. 날짜·적격성·중복·추천은 서버가 계산합니다.
- 구현 기준: `docs/superpowers/specs/2026-11-21-pathfinder.md`.

검증: `npm test -- --maxWorkers=2 --testTimeout=60000`, `npm run lint`, `npm run build`.
전체 테스트의 워커 수는 로컬 환경의 동시 실행 시간 초과를 피하기 위해 제한합니다.

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
