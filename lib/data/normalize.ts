import { isOpenAt } from "@/lib/date";
import type { Policy, RawPolicy } from "./types";

const EMPTY_TEXT = new Set(["", "-", "--", "해당 없음", "해당없음", "해당사항 없음", "없음"]);

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function text(v: unknown): string {
  const s = str(v).trim();
  return EMPTY_TEXT.has(s) ? "" : s;
}

function list(v: unknown): string[] {
  return str(v)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function age(v: unknown): number | null {
  const n = Number(str(v).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ymd(compact: string): string | null {
  return /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
}

function link(v: unknown): string | null {
  const s = str(v).trim();
  return s && s !== "-" ? s : null;
}

const PERIOD_TYPE: Record<string, Policy["applyPeriodType"]> = {
  "0057001": "period",
  "0057002": "always",
  "0057003": "closed",
};

export function normalize(raw: RawPolicy): Policy {
  const period = str(raw.aplyYmd).trim();
  const m = /^(\d{8}) ~ (\d{8})$/.exec(period);
  return {
    id: raw.plcyNo,
    name: str(raw.plcyNm).trim(),
    supervisingOrg: str(raw.sprvsnInstCdNm).trim(),
    registeringOrg: str(raw.rgtrHghrkInstCdNm).trim(),
    zipCodes: list(raw.zipCd),
    minAge: age(raw.sprtTrgtMinAge),
    maxAge: age(raw.sprtTrgtMaxAge),
    jobCodes: list(raw.jobCd),
    schoolCodes: list(raw.schoolCd),
    specialCodes: list(raw.sbizCd),
    marriageCode: str(raw.mrgSttsCd).trim() || null,
    incomeCode: str(raw.earnCndSeCd).trim() || null,
    provisionCode: str(raw.plcyPvsnMthdCd).trim() || null,
    applyPeriodType: PERIOD_TYPE[str(raw.aplyPrdSeCd).trim()] ?? "period",
    applyStart: m ? ymd(m[1]) : null,
    applyEnd: m ? ymd(m[2]) : null,
    bizEnd: ymd(str(raw.bizPrdEndYmd).trim()),
    texts: {
      addQualification: text(raw.addAplyQlfcCndCn),
      excluded: text(raw.ptcpPrpTrgtCn),
      income: text(raw.earnEtcCn),
      support: text(raw.plcySprtCn),
      description: text(raw.plcyExplnCn),
    },
    links: { apply: link(raw.aplyUrlAddr), ref: link(raw.refUrlAddr1), ref2: link(raw.refUrlAddr2) },
    modifiedAt: str(raw.lastMdfcnDt).trim(),
    category: { large: str(raw.lclsfNm).trim(), middle: str(raw.mclsfNm).trim() },
  };
}

export type SnapshotCount = {
  total: number;
  always: number;
  periodOpen: number;
  periodUpcoming: number;
  periodPast: number;
  periodUnknown: number;
  closedCode: number;
};

/** 설계 3장의 집계표를 만드는 함수. 범주 합 = 전체 */
export function countSnapshot(policies: Policy[], now: Date): SnapshotCount {
  const c: SnapshotCount = { total: policies.length, always: 0, periodOpen: 0, periodUpcoming: 0, periodPast: 0, periodUnknown: 0, closedCode: 0 };
  for (const p of policies) {
    if (p.applyPeriodType === "closed") c.closedCode++;
    else if (p.applyPeriodType === "always") c.always++;
    else {
      const s = isOpenAt(now, p.applyStart, p.applyEnd);
      if (s === "open") c.periodOpen++;
      else if (s === "upcoming") c.periodUpcoming++;
      else if (s === "closed") c.periodPast++;
      else c.periodUnknown++;
    }
  }
  return c;
}
