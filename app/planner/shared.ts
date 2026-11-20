import type { JudgeBody } from "@/lib/judge/handler";
import type { Profile } from "@/lib/judge/types";
import type { RoadmapCat, RoadmapStatus } from "@/lib/route/roadmap";
import type { TimelinePlan } from "@/lib/route/timeline";
import { PERSONA_A } from "@/lib/judge/personas";

export type Ok = Extract<JudgeBody, { items: unknown }>;
export type { Profile, TimelinePlan };

export const CATS: Record<RoadmapCat, { label: string; fill: string; stroke: string; text: string }> = {
  job: { label: "취업·일자리", fill: "#ECE7FD", stroke: "#6846E8", text: "#3B2496" },
  startup: { label: "창업", fill: "#FCEADB", stroke: "#C96A22", text: "#7A3C0D" },
  housing: { label: "주거", fill: "#DCF2EA", stroke: "#2A8F73", text: "#165243" },
  edu: { label: "교육·역량", fill: "#E0EBFB", stroke: "#3A74CC", text: "#1B4581" },
  life: { label: "생활·복지·참여", fill: "#FAF0D2", stroke: "#B38712", text: "#5E4507" },
};
export const CAT_ORDER: RoadmapCat[] = ["job", "startup", "housing", "edu", "life"];

export const STATUS_STYLE: Record<RoadmapStatus, { bg: string; fg: string }> = {
  ok: { bg: "#E3F5EC", fg: "#17643F" },
  check: { bg: "#FDF1DC", fg: "#8A5A00" },
  wait: { bg: "#E6F0FD", fg: "#1C4F9C" },
  none: { bg: "#F1F2F6", fg: "#4A4D63" },
};

export const SCHOOLS: [string, string][] = [
  ["0049004", "고등학교 졸업"],
  ["0049005", "대학 재학"],
  ["0049006", "대학 졸업 예정"],
  ["0049007", "대학 졸업"],
  ["0049008", "석·박사"],
];

/** 가상 인물: 만 27세, 인천 연수구, 대학 졸업, 국비 교육 수강 중(12/19 수료 예정) */
export const DEMO = PERSONA_A;

/** "2026-11-24" → "2026.11.24" */
export const dot = (ymd: string) => ymd.replaceAll("-", ".");

export function periodLabel(o: { type: string; start: string | null; end: string | null }): string {
  if (o.type === "always") return "상시";
  if (!o.start && !o.end) return "기간 미정";
  return `${o.start ? dot(o.start) : "?"} – ${o.end ? dot(o.end) : "?"}`;
}

export function addMonthsYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

const dayNum = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / 86_400_000;

/** 날짜를 로드맵 가로축의 칸 위치(0 ~ months.length)로. 칸 하나는 months[k]부터 months[k+1] 전까지 */
export function columnOf(months: string[], ymd: string): number {
  const edges = [...months, addMonthsYmd(months[months.length - 1], 1)];
  if (ymd <= edges[0]) return 0;
  for (let k = 0; k + 1 < edges.length; k++) {
    if (ymd < edges[k + 1]) return k + (dayNum(ymd) - dayNum(edges[k])) / (dayNum(edges[k + 1]) - dayNum(edges[k]));
  }
  return months.length;
}

/** 채팅 질문 하나. 선택지는 코드가 정한 것만 */
export type ChatOption = { label: string; value: string };
/** date: 선택지 외에 날짜 입력칸을 함께 보인다(자유 글이 아니라 날짜 형식만 받는다) */
export type ChatQuestion = { key: string; text: string; options: ChatOption[]; date?: boolean; move?: boolean };
export type ChatMessage =
  | { id: number; role: "ai"; text: string; question?: ChatQuestion; answered?: string }
  | { id: number; role: "user"; text: string };

/** AI 계획 정리 결과: 정책 번호 → 순번·정거장·이유. 판정은 바꾸지 않고 표시와 순서에만 쓴다 */
export type AiPick = { rank: number; reasons: { station: string; why: string }[] };
export type AiPicks = Record<string, AiPick>;

export function groupPlanPicks(stations: { label: string; items: { policyId: string; why: string }[] }[]): AiPicks {
  const picks: AiPicks = {};
  let rank = 0;
  for (const station of stations) {
    for (const item of station.items) {
      const pick = picks[item.policyId] ??= { rank: ++rank, reasons: [] };
      pick.reasons.push({ station: station.label, why: item.why });
    }
  }
  return picks;
}
export const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮"];
