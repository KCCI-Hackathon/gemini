import regionsJson from "@/data/regions.json";

const labels = (regionsJson as { labels: Record<string, string> }).labels;

/** 기관명 표기 → 시도 코드(2자리). 스냅샷의 주관기관명 표기 변형을 포함한다 */
const SIDO_NAMES: [RegExp, string][] = [
  [/서울/, "11"],
  [/부산/, "26"],
  [/대구/, "27"],
  [/인천/, "28"],
  [/전남광주|전라남도|전남|광주광역시/, "12"],
  [/대전/, "30"],
  [/울산/, "31"],
  [/세종/, "36"],
  [/경기/, "41"],
  [/충청북도|충북/, "43"],
  [/충청남도|충남/, "44"],
  [/경상북도|경북/, "47"],
  [/경상남도|경남/, "48"],
  [/제주/, "50"],
  [/강원/, "51"],
  [/전북|전라북도/, "52"],
];

export function sidoOfOrg(orgName: string): string | null {
  for (const [re, code] of SIDO_NAMES) if (re.test(orgName)) return code;
  return null;
}

/** 지자체로 보이는 기관명(시·군·구청, 광역·특별·자치 단체) */
export function looksLocalGov(orgName: string): boolean {
  return /(광역시|특별시|특별자치|도청|시청|군청|구청|[가-힣]+(시|군|구)(\s|$))/.test(orgName) || sidoOfOrg(orgName) !== null;
}

export function regionLabel(code: string): string {
  return labels[code] ?? code;
}

export function sidoName(code: string): string {
  return regionLabel(code).split(" ")[0];
}

export function regionOptions(): { code: string; label: string }[] {
  return Object.entries(labels)
    .filter(([code]) => code !== "30000")
    .map(([code, label]) => ({ code, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}
