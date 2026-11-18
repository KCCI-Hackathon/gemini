// 대시보드용 로드맵: 타임라인 계산 결과를 분류별 줄, 공식 신청 기간, 내 조건 구간, 목표 표시로 바꾼다.
// 판정은 하지 않는다(타임라인의 칸을 그대로 쓴다). 외부 호출 없음.
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified, type VerifiedPolicy } from "@/lib/data/verified";
import { fieldCheckEffect, type FieldEffect } from "@/lib/verify/downgrade";
import type { VerifyResult } from "@/lib/verify/run";
import { savedResult } from "@/lib/verify/saved";
import type { Policy } from "@/lib/data/types";
import type { EventType } from "@/lib/judge";
import type { Evidence } from "@/lib/judge/rules";
import type { CellState, Timeline } from "./timeline";

/** 근거 확인됨 / 근거 확인 대기(회차별 규칙, 조건별 사람 확인 전) / 공고 항목 확인됨 / AI 대조(사람 미확인) / 미검증 */
export type VerifyLabel = "근거 확인됨" | "근거 확인 대기" | "공고 항목 확인됨" | "AI 대조(사람 미확인)" | "미검증(API)";

export type RoadmapCat = "job" | "startup" | "housing" | "edu" | "life";
export type RoadmapStatus = "ok" | "check" | "wait" | "none";

export type RoadmapRow = {
  order: number | null;
  policyId: string;
  name: string;
  org: string;
  cat: RoadmapCat;
  verified: boolean;
  /** 근거 확인됨: 회차별 조건 근거를 사람이 모두 확인 · 근거 확인 대기: 회차별 규칙은 있으나 조건별 확인 전 */
  verifyLabel: VerifyLabel;
  /** 저장된 항목별 대조에서 온 문구(낮춘 이유·참고) */
  fieldNotes: string[];
  evidence: Evidence[];
  /** 공고(또는 API)의 신청 기간. 판정과 상관없이 정책이 정한 기간 */
  official: { type: "period" | "always" | "closed"; start: string | null; end: string | null };
  /** 내 조건으로 신청할 수 있는 칸의 구간(달 칸 번호, 양 끝 포함) */
  windows: { from: number; to: number; state: "ok" | "check"; note?: string }[];
  /** 가정한 사건이 있는 달 중 판정이 바뀌는 칸: 그 달은 선후 확인 필요(통합 설계 5.2) */
  boundaries: { col: number; date: string; text: string }[];
  status: RoadmapStatus;
  statusLabel: string;
  summary: string;
  reasons: string[];
  support: string;
  link: { url: string; kind: "official" | "api" } | null;
};

export type RoadmapGoal = { type: EventType; date: string; monthIndex: number; label: string };

export type Roadmap = {
  months: string[];
  stateLabels: string[];
  baseLabel: string;
  goals: RoadmapGoal[];
  rows: RoadmapRow[];
  notice: string;
};

const GOAL_LABEL: Record<EventType, string> = { training_completion: "수료", employment: "취업", business_registration: "창업", relocation: "이사" };
const SUPPORT_MAX = 300;
const DATE_NAME: Record<EventType, string> = { training_completion: "수료일", employment: "취업일", business_registration: "사업자등록일", relocation: "이사일" };

/** 온통청년 대·중분류 → 로드맵 분류. 여러 개가 붙은 값은 첫 번째로 보되, 창업이 있으면 창업 */
export function categoryOf(c: { large: string; middle: string }): RoadmapCat {
  if (c.middle.split(",").some((m) => m.trim() === "창업")) return "startup";
  const large = c.large.split(",")[0].trim();
  if (large.startsWith("일자리")) return "job";
  if (large.startsWith("주거")) return "housing";
  if (large.startsWith("교육")) return "edu";
  return "life";
}

/** 열린 칸을 잇는다. 가정한 사건으로 판정 사유가 바뀐 달(breakCols)에서는 새 구간을 시작한다 */
function windowsOf(cells: CellState[], breakCols: Map<number, string>): RoadmapRow["windows"] {
  const out: RoadmapRow["windows"] = [];
  cells.forEach((c, i) => {
    if (c !== "ok" && c !== "check") return;
    const last = out.at(-1);
    const note = breakCols.get(i);
    if (last && last.to === i - 1 && last.state === c && note === undefined) last.to = i;
    else out.push(note === undefined ? { from: i, to: i, state: c } : { from: i, to: i, state: c, note });
  });
  return out;
}

function statusOf(cells: CellState[], verified: boolean): { status: RoadmapStatus; label: string } {
  if (cells.includes("ok")) return { status: "ok", label: verified ? "조건 충족" : "코드 조건 충족(본문 미검토)" };
  if (cells.includes("check")) return { status: "check", label: "확인 필요" };
  if (cells.includes("wait")) return { status: "wait", label: "기간 조건 남음" };
  return { status: "none", label: "이 기간 신청 구간 없음" };
}

function labelOf(v: VerifiedPolicy | undefined, saved: VerifyResult | undefined): VerifyLabel {
  if (v?.rounds?.length) return v.rounds.every((x) => x.status !== "approved" || x.conditions.every((c) => c.supportsConfirmed)) ? "근거 확인됨" : "근거 확인 대기";
  if (v) return "근거 확인 대기";
  if (saved?.fieldChecks?.length) return saved.fieldChecksConfirmed ? "공고 항목 확인됨" : "AI 대조(사람 미확인)";
  return "미검증(API)";
}

function notesOf(e: FieldEffect): string[] {
  return [...(e.newRound ? [e.newRound.text] : []), ...(e.recruitment ? [e.recruitment] : []), ...e.personal, ...e.notes];
}

function monthIndexOf(months: string[], date: string): number {
  let k = 0;
  while (k + 1 < months.length && months[k + 1] <= date) k++;
  return k;
}

function shorten(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > SUPPORT_MAX ? `${t.slice(0, SUPPORT_MAX - 1)}…` : t;
}

export function buildRoadmap(timeline: Timeline): Roadmap {
  const policies = new Map<string, Policy>(loadSnapshot().policies.map((p) => [p.id, p]));
  const verified = loadVerified();

  const rows: RoadmapRow[] = timeline.rows.map((r) => {
    const p = policies.get(r.policyId);
    const v = verified.get(r.policyId);
    const { status, label } = statusOf(r.cells, r.verified);
    const apiLink = p?.links.apply ?? p?.links.ref ?? null;
    return {
      order: r.order,
      policyId: r.policyId,
      name: r.name,
      org: p?.supervisingOrg ?? "",
      cat: p ? categoryOf(p.category) : "life",
      verified: r.verified,
      verifyLabel: labelOf(v, savedResult(r.policyId)),
      fieldNotes: p && savedResult(r.policyId)?.outcome === "verified_against_notice" ? notesOf(fieldCheckEffect(savedResult(r.policyId)!, p, v, timeline.months[0])) : [],
      evidence: r.evidence,
      official: v
        ? { type: v.apply.type, start: v.apply.start, end: v.apply.end }
        : { type: p?.applyPeriodType ?? "closed", start: p?.applyStart ?? null, end: p?.applyEnd ?? null },
      windows: windowsOf(r.cells, new Map(r.breaks.map((d) => [monthIndexOf(timeline.months, d), `${GOAL_LABEL[timeline.events.find((e) => e.date === d)?.type ?? "employment"]} 후 다시 확인`]))),
      boundaries: r.boundaries.map((d) => {
        const type = timeline.events.find((e) => e.date === d)?.type ?? "employment";
        return { col: monthIndexOf(timeline.months, d), date: d, text: `신청일과 ${DATE_NAME[type]}의 선후 확인 필요` };
      }),
      status,
      statusLabel: label,
      summary: r.summary,
      reasons: r.reasons,
      support: shorten(p?.texts.support ?? ""),
      link: v ? { url: v.sources[0].url, kind: "official" } : apiLink ? { url: apiLink, kind: "api" } : null,
    };
  });

  const goals = timeline.events.map((e) => ({
    type: e.type,
    date: e.date,
    monthIndex: monthIndexOf(timeline.months, e.date),
    label: `${GOAL_LABEL[e.type]} 가정 · ${e.date.slice(0, 7).replace("-", ".")}`,
  }));

  return { months: timeline.months, stateLabels: timeline.stateLabels, baseLabel: timeline.baseLabel, goals, rows, notice: timeline.notice };
}
