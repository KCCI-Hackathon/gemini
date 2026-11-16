# 갈림길

취업·수료·창업이라는 갈림길에 선 청년에게, 상황 변화에 따라 달라지는 정책 자격을 보여주고, AI 에이전트가 공식 공고를 직접 찾아가 그 변화의 이유와 다음 행동을 안내하는 서비스입니다.
(2026 대한민국 청년 CAREER FAIR AI 해커톤 출품용 프로토타입)

## 구조

- 판정은 서버 코드가 합니다(`lib/judge`). 사용자 정보는 외부 AI로 가지 않습니다.
- 상태 전이(`lib/sim`): "오늘 수료/취업/사업자등록을 했다고 가정"한 전후 비교.
- 정책 검증 에이전트(`lib/verify`): 정책 번호와 공개 데이터만 받아 공식 공고를 찾아가 대조합니다. 접근 범위·한도는 `lib/verify/web.ts`가 강제합니다.
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
