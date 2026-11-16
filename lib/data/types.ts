/** 온통청년 청년정책 API 원본 레코드(쓰는 필드만, 나머지는 그대로 둔다) */
export type RawPolicy = {
  plcyNo: string;
  plcyNm: string;
  [key: string]: unknown;
};

export type Policy = {
  id: string;
  name: string;
  supervisingOrg: string;
  registeringOrg: string;
  zipCodes: string[];
  minAge: number | null;
  maxAge: number | null;
  jobCodes: string[];
  schoolCodes: string[];
  specialCodes: string[];
  marriageCode: string | null;
  incomeCode: string | null;
  provisionCode: string | null;
  applyPeriodType: "period" | "always" | "closed";
  applyStart: string | null;
  applyEnd: string | null;
  bizEnd: string | null;
  texts: {
    addQualification: string;
    excluded: string;
    income: string;
    support: string;
    description: string;
  };
  links: { apply: string | null; ref: string | null; ref2: string | null };
  modifiedAt: string;
  category: { large: string; middle: string };
};

export type Snapshot = { asOf: string; records: RawPolicy[] };
