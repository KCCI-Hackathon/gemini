// AI가 만든 문장 검사: 금지 표현과 모르는 정책 번호(설계 5장 ⑤ 금지 사항)
// 어미가 아니라 어간으로 막는다. "선정 기준"처럼 안내에 필요한 표현은 허용한다.

const FORBIDDEN = /유리|선정(?!\s*기준)|받을\s*수\s*있|미루|서두르|서둘러|늦추|당기세요|당기는|꺼진\s*프로필|평가\s*목록|수혜\s*조건을\s*꺼/;

export function guardResponse(text: string, knownIds: Set<string>): { ok: true } | { ok: false; reason: string } {
  const m = FORBIDDEN.exec(text);
  if (m) return { ok: false, reason: `금지 표현: ${m[0]}` };
  for (const id of text.matchAll(/\d{20}/g)) if (!knownIds.has(id[0])) return { ok: false, reason: `모르는 정책 번호: ${id[0]}` };
  return { ok: true };
}
