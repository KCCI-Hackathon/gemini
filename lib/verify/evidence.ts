import { normalizeSpace } from "./web";

const AGE_CONTEXT = /(?:지원\s*(?:대상|연령|자격)|신청\s*(?:대상|연령|자격)|모집\s*(?:대상|연령)|참여\s*(?:대상|자격|연령)|(?:나이|연령)\s*(?:조건|요건|제한|[:：]))/;
const AGE = /(?:\d{1,3}\s*(?:세|살)|연령\s*[:：]?\s*\d|나이\s*[:：]?\s*\d)/;
const PERIOD = /(?:신청|접수|모집)\s*(?:기간|일정|시작|마감|기한|일시|일|은|는)/;
const REGION = /(?:거주|주민등록|주소지|소재|시범사업 수행 지자체|전국|지역\s*(?:제한|요건|대상))/;
const STATUS = /(?:취업|미취업|실업|재직|건강보험|구직|수강|훈련|등록|학력|졸업|재학|휴학|수료)/;
const INCOME = /(?:소득|중위소득|건강보험료|기준중위|가구원|분위)/;
const RESTRICTION = /(?:제외|제한|중복|동시\s*(?:참여|수혜)|불가|불인정|금지)/;
const ELIGIBILITY = /(?:자격|대상|요건|해야|필수|준수|포함|해당|인정)/;
const REFERENCE = /(?:기준|현재|이전|이후|당일|이내|시점)/;
const DURATION = /\d+\s*(?:일|주|개월|년)\s*(?:이상|이내|이하|초과|동안|전|후)/;

const RELEVANCE: Record<string, RegExp> = {
  apply_period: PERIOD,
  application_period: PERIOD,
  biz_period: /(?:사업|운영|지원|교육|수행)\s*(?:기간|일정|개시|종료)/,
  age: AGE,
  region: REGION,
  region_scope: REGION,
  status_school_special: STATUS,
  status_condition: STATUS,
  income: INCOME,
  extra_conditions: /(?:자격|대상|요건|제외|제한|중복|불가|해야|필수)/,
  support: /(?:지원\s*(?:금|액|내용|규모|혜택)|만원|천원|지급|제공|감면)/,
  apply_link: /https?:\/\/[^\s]+/,
  lookback: DURATION,
  tenure: DURATION,
  restriction: RESTRICTION,
  recruitment_status: /(?:접수\s*(?:중|마감|종료|예정)|모집\s*(?:중|종료|마감|예정)|상시\s*(?:접수|모집))/,
  reference_date_wording: REFERENCE,
};

export function supportsEvidence(kind: string, quote: string): boolean {
  const text = normalizeSpace(quote);
  if (/^(?:\p{P}|\s)*(?:문의|연락처|상담\s*전화|담당\s*부서|전화번호)/u.test(text)) return false;
  if (/^(?:\p{P}|\s)*(?:참여\s*후기|사례|인터뷰)/u.test(text)) return false;
  if (kind === "age") return AGE.test(text) && AGE_CONTEXT.test(text);
  if (kind === "notice_only_condition") return [AGE, REGION, STATUS, INCOME, RESTRICTION, ELIGIBILITY, PERIOD].some((pattern) => pattern.test(text));
  if (kind === "status_reference") return STATUS.test(text) && REFERENCE.test(text);
  return Object.hasOwn(RELEVANCE, kind) && RELEVANCE[kind].test(text);
}

export function supportsComparedValue(field: string, quote: string, value: string): boolean {
  if (!supportsEvidence(field, quote) || !value) return false;
  if (field === "age") {
    const [min, max] = value.split("~");
    const text = normalizeSpace(quote);
    if (min && max && /^\d{1,3}~\d{1,3}$/.test(value)) {
      return new RegExp(`(?<!\\d)${min}\\s*(?:세|살)?\\s*(?:(?:이상\\s*)?[~～–—-]|부터|이상\\s*[,·]?)\\s*(?:만\\s*)?${max}\\s*(?:세|살)(?!\\d)`).test(text);
    }
    if (!/^(?:\d{1,3}~|~\d{1,3})$/.test(value)) return false;
    const bound = min || max;
    const direction = min ? "이상|부터" : "이하|까지";
    return new RegExp(`(?<!\\d)${bound}\\s*(?:세|살)\\s*(?:${direction})`).test(text);
  }
  if (field === "apply_period") {
    if (value === "상시") return /상시/.test(quote);
    const dates = value.split("~");
    return dates.length === 2 && dates.every((date) => containsNoticeDate(quote, date));
  }
  if (field === "biz_period") return containsNoticeDate(quote, value);
  return normalizeSpace(quote).replace(/\s+/g, "").includes(value);
}


export function containsNoticeDate(text: string, date: string): boolean {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!parts) return false;
  const [, year, month, day] = parts;
  return new RegExp(`(?<!\\d)${year}\\s*[-./년]\\s*0?${Number(month)}\\s*[-./월]\\s*0?${Number(day)}(?!\\d)`).test(text);
}
