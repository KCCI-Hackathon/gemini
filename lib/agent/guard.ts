// AI가 만든 문장 검사: 금지 표현과 모르는 정책 번호(설계 5장 ⑤ 금지 사항)

const FORBIDDEN = ["유리합니다", "유리해요", "선정됩니다", "선정될", "받을 수 있습니다", "미루세요", "미루는 것이", "서두르세요", "늦추세요", "당기세요"];

export function guardResponse(text: string, knownIds: Set<string>): { ok: true } | { ok: false; reason: string } {
  for (const w of FORBIDDEN) if (text.includes(w)) return { ok: false, reason: `금지 표현: ${w}` };
  for (const m of text.matchAll(/\d{20}/g)) if (!knownIds.has(m[0])) return { ok: false, reason: `모르는 정책 번호: ${m[0]}` };
  return { ok: true };
}
