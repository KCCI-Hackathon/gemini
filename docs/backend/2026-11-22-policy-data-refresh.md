# 정책 데이터 갱신 절차

제출본은 2026-11-16 기준 스냅샷(정책 4,020건)으로 고정한다. 자동 갱신(cron, GitHub Actions)은 구현하지 않았다. 설계상 운영 주기는 하루 1회이며 아래 절차를 사람이 실행한다([설계 6장](../2026-11-16-policy-twin-design.md)).

## 현재 구현 범위

| 단계 | 상태 | 실행 |
|---|---|---|
| 온통청년 API 전체 수집 | 구현, 수동 실행 | `scripts/fetch-snapshot.ts` |
| 이전 스냅샷과 변경 비교 | 구현, 수동 실행 | `npm run snapshot:compare` |
| 중복수혜 규칙 재검토 | 사람이 수행 | 비교 결과의 `rulesToReview` |
| DB 재생성·내보내기·검증 | 구현, 수동 실행 | `db:build`, `db:export`, `db:verify` |
| 예약 실행 | 미구현 | `vercel.json`에 cron 없음, `/api/cron` 경로 없음 |
| 서비스 반영 | 재배포 필요 | 스냅샷과 규칙은 빌드 시 앱에 포함된다 |

스냅샷([snapshot.ts](../../lib/data/snapshot.ts))과 배포 규칙([overlap.ts](../../lib/data/overlap.ts))은 정적 import다. 실행 중인 서버에서 파일을 받아도 화면과 `/api/judge`에 반영되지 않는다. 갱신한 파일을 커밋하고 다시 배포해야 한다.

## 갱신 절차

### 1. 기존 스냅샷 보존

수집 스크립트는 `data/snapshot/current.json`을 덮어쓴다. 비교를 위해 먼저 복사한다.

```powershell
Copy-Item data/snapshot/current.json data/snapshot/previous.json
```

### 2. 수집

`.env.local`에 `YOUTH_POLICY_API_KEY`가 있어야 한다. 2026-11-22 기준 로컬 `.env.local`에는 이 키가 없다.

```powershell
npx tsx --env-file=.env.local scripts/fetch-snapshot.ts
```

100건씩 모든 페이지를 받고 각 페이지는 최대 3회 재시도한다. 받은 건수가 API의 전체 건수와 다르거나 한 페이지라도 실패하면 기존 파일을 바꾸지 않는다. 성공하면 기준일(`asOf`)이 수집일(KST)로 바뀐다.

### 3. 변경 비교

```powershell
npm run snapshot:compare -- data/snapshot/previous.json data/snapshot/current.json
```

| 출력 | 의미 |
|---|---|
| `added`, `changed`, `removed` | 추가·변경·삭제된 정책 |
| `revalidatePolicyIds` | 다시 확인할 정책번호. 수정일만 바뀐 정책은 제외 |
| `rulesToReview` | 변경·삭제된 정책에 연결된 배포 규칙 |

### 4. 중복수혜 규칙 재검토

`rulesToReview`가 비어 있으면 5단계로 간다. 비어 있지 않으면 각 규칙의 근거 인용이 새 원문에 그대로 있는지, 조건과 예외가 바뀌지 않았는지 확인하고 `data/overlap-agent/research.json`을 고친다. 삭제된 정책을 가리키는 규칙은 제거한다.

AI 에이전트로 검토 후보를 좁힐 수 있다. 증분 실행 결과는 검토용이며 배포 규칙을 교체하지 않는다.

```powershell
npm run overlap:agent -- --live --previous-snapshot data/snapshot/previous.json
```

### 5. 배포본 재생성과 검증

```powershell
npm run db:build -- --research-only
npm run db:export
npm run db:verify
```

규칙의 정책이 사라졌거나 근거 인용이 원문에 없으면 `db:build`가 `[evidence]` 또는 `[rule references]` 오류로 멈춘다. 잘못된 규칙이 배포되지 않도록 하는 검사이므로 4단계로 돌아가 규칙을 고친다.

### 6. 테스트와 재배포

```powershell
npx vitest run
```

일부 테스트는 현재 스냅샷의 정책번호와 건수를 사용한다. 실패하면 데이터 변경 때문인지 기능 오류인지 구분한다. 통과하면 `data/snapshot/current.json`, `data/overlap/approved.json`, 수정한 `research.json`을 커밋하고 배포 브랜치에 반영해 재배포한다. 화면의 `데이터 <기준일>` 표시로 반영을 확인한다.

## 자동화할 때 고려할 점

- 수집·비교·검증은 예약 작업으로 실행할 수 있다. 규칙 재검토는 사람이 확인해야 하므로 자동 작업은 `rulesToReview`가 비어 있을 때만 커밋하고, 그 외에는 검토 요청을 남기는 방식이 안전하다.
- Vercel cron은 배포된 서버에서 실행되며 저장소 파일을 바꾸지 못한다. 저장소에 커밋하고 재배포를 일으키는 작업은 GitHub Actions 같은 외부 실행기가 맡아야 한다.
- API 키는 실행기의 비밀값으로 둔다.
