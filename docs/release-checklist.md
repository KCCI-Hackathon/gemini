# 제출 전 확인 목록과 11/23 절차

설계 9장 "제출 전 확인 목록"을 자동 테스트 또는 수동 확인 방법과 연결한다. `npm test`가 모두 통과해야 제출한다.

| 항목 | 확인 방법 |
|---|---|
| 수료 예정일과 실제 수료일을 구분하는가 | `tests/judge/axes.test.ts` "예정일이 지났는데 완료로 바꾸지 않았으면 안내 문구" |
| 시연 정책 6건의 자격 판단 기준일을 원문에서 확인했는가 | `data/verified/*.json`의 `referenceDate`, `sources` (사람 확인, 2026-11-16) |
| 신청 종료일 당일에도 모집 중으로 처리하는가 | `tests/date.test.ts` "종료일 당일은 24시까지 모집 중", "마감 시각이 있으면 그 시각까지" |
| 한국 시간 자정 전후로 결과가 바뀌지 않는가 | `tests/date.test.ts` "서버가 UTC여도 한국 날짜로 판단" |
| 날짜 없는 상시 모집 정책을 모집 종료로 처리하지 않는가 | `tests/judge/axes.test.ts` "상시인데 사업 종료일이 지났으면 기간 확인 필요", `tests/data/normalize.test.ts` |
| 모집 종료와 자격 미충족을 구분해 보여주는가 | `tests/judge/axes.test.ts` "모집 종료와 자격은 따로 나온다" |
| 원문 중복 제한 문구와 실제 참여 여부를 구분하는가 | `tests/judge/axes.test.ts` "국민취업지원제도 참여 중이라고 답하면 청년도전 제한이 '적용됨'" |
| 취업 상태로 바꿨을 때 모든 정책을 한꺼번에 비해당으로 바꾸지 않는가 | `tests/sim/transition.test.ts` "일괄 비해당 금지" |
| 데이터 기준일과 판정 기준일을 화면에서 구분하는가 | 화면 확인(결과 머리말) |
| 사용자 입력 모드에서 외부 AI 호출 0회, 가상 인물 요청에 인물 정보 없음 | `tests/judge/handler.test.ts` "판정 경로는 외부로 아무것도 보내지 않는다", `tests/agent/run.test.ts`, `tests/agent/cards.test.ts`, `tests/verify/run.test.ts` "요청에는 정책 번호와 공개 텍스트만" |
| 생년월과 정책별 연령 기준일로 나이를 판정하는가 | `tests/judge/axes.test.ts` "드림For 나이" |
| 집계 수치가 스냅샷과 일치하는가 | `scripts/count-snapshot.ts` 출력으로 설계 3장과 소개서 수치 갱신 |
| 시뮬레이션 격리 | `tests/sim/transition.test.ts` "격리" |
| 기준일 누락 처리 | `tests/sim/transition.test.ts` 국민취업지원제도 "기준일 확인 필요" |
| 프로토타입 링크가 로그아웃 상태에서 열리는가 | 시크릿 창과 휴대폰에서 배포 주소 확인(수동) |
| API 키가 저장소·화면·영상에 없는가 | `git grep -n "sk-ant\|apiKeyNm="` 결과 없음, `.env*`가 `.gitignore`에 있음 |

## 11/23 절차 (11/22에 한 번 연습)

1. `scripts/fetch-snapshot.ts`로 최종 수집 → `data/snapshot/current.json` 교체.
2. `scripts/count-snapshot.ts`로 집계 갱신.
3. 검증 정책 중 `lastMdfcnDt`가 11/21 이후인 것만 공식 공고와 다시 대조.
4. `npm test` 전부 통과면 채택, 아니면 11/21 스냅샷으로 되돌림(`git checkout <11/21 커밋> -- data/snapshot/current.json`).
5. 12시까지 배포, 로그아웃 상태로 확인.
6. 제출 시점 커밋에 태그: `git tag submission-2026-11-23`.
7. 이후에는 기능·프롬프트·데이터를 바꾸지 않는다. 접속 복구, 인증정보 교체, 실행 환경 복구만 하고 변경 내용과 사유를 운영사무국에 알린다.
