import { looksLocalGov, sidoName, sidoOfOrg } from "@/lib/data/regions";
import type { Policy } from "@/lib/data/types";

export type RegionResult = { ok: true } | { ok: false; reason: string } | { ok: "unknown"; reason: string };

/**
 * 지역 판정. 지역 코드가 15개 이상 시도에 걸쳤는데 주관기관이 지자체면
 * 주관기관 이름의 시도로 다시 좁힌다(설계 5장 ③). 등록기관이 아니라 주관기관을 본다.
 */
export function judgeRegion(p: Policy, myCode: string): RegionResult {
  if (!p.zipCodes.includes(myCode)) {
    return { ok: false, reason: "거주 지역이 지원 대상 지역이 아님" };
  }
  const sidoCount = new Set(p.zipCodes.map((c) => c.slice(0, 2))).size;
  if (sidoCount < 15) return { ok: true };

  const org = p.supervisingOrg;
  const orgSido = sidoOfOrg(org);
  if (orgSido) {
    if (orgSido === myCode.slice(0, 2)) return { ok: true };
    return { ok: false, reason: `${org} 주관 사업(지역 코드는 전국이지만 ${sidoNameOf(orgSido)} 사업으로 판단)` };
  }
  if (looksLocalGov(org)) {
    return { ok: "unknown", reason: `지역 코드는 전국인데 주관기관(${org})이 지자체로 보여 지역 확인 필요` };
  }
  return { ok: true };
}

function sidoNameOf(sido: string): string {
  const names: Record<string, string> = { "11": "서울", "26": "부산", "27": "대구", "28": "인천", "12": "전남광주", "30": "대전", "31": "울산", "36": "세종", "41": "경기", "43": "충북", "44": "충남", "47": "경북", "48": "경남", "50": "제주", "51": "강원", "52": "전북" };
  return names[sido] ?? sidoName(`${sido}000`);
}
