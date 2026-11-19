// 파이프라인: 신청 마감월로 열을 자르고(11월 마감 → 12월 마감 → … → 상시), 열마다 먼저 볼 정책 몇 장.
// 카드 색은 출처(지금 열려 있음 / 수료·취업·창업 가정 뒤에 열림)로 나누고, 가정한 사건은 열 사이 표시로 놓는다.
// 정책 사이의 중복 수혜 제한(공고 인용)·연계를 카드에 함께 싣는다. 판정은 로드맵 그대로 쓴다.
import type { EventType } from "@/lib/judge";
import type { RouteLink } from "./build";
import type { Roadmap, RoadmapRow } from "./roadmap";

const PER_COLUMN = 6;

export type Relation = { id: string; name: string; quote: string };
/** now: 오늘 열려 있음 · 사건: 그 가정 뒤에 열림 · later: 오늘 이후 첫 가정 전에 열림 */
export type CardSource = "now" | "later" | EventType;
export type PipelineCard = {
  policyId: string;
  name: string;
  cat: RoadmapRow["cat"];
  status: RoadmapRow["status"];
  statusLabel: string;
  verified: boolean;
  verifyLabel: RoadmapRow["verifyLabel"];
  source: CardSource;
  /** 열리는 날(오늘이면 null) · 마감일(상시면 null) */
  opensAt: string | null;
  closesAt: string | null;
  blocks: Relation[];
  blockedBy: Relation[];
  leadsTo: Relation[];
  dupNote: string | null;
};
export type PipelineColumn = {
  /** "2026-11" 같은 마감월, 12개월 뒤보다 늦으면 "beyond", 기한이 없으면 "always" */
  key: string;
  title: string;
  cards: PipelineCard[];
  /** 이 열에 속한 정책 전체(번호) */
  allIds: string[];
  total: number;
  hidden: number;
  /** 같은 열 안에서 서로 제한되어 하나만 고를 수 있는 카드 묶음 */
  exclusiveGroups: string[][];
  /** 출처별 개수 */
  bySource: Partial<Record<CardSource, number>>;
};
/** 가정한 사건: beforeKey 열 앞에 놓는다 */
export type PipelineMarker = { type: EventType; date: string; label: string; beforeKey: string };
export type Pipeline = { columns: PipelineColumn[]; markers: PipelineMarker[] };

const EVENT_NAME: Record<string, string> = { training_completion: "수료", employment: "취업", business_registration: "창업", relocation: "이사" };

export function buildPipeline(roadmap: Roadmap, relations: RouteLink[]): Pipeline {
  const today = roadmap.months[0];
  const thisYear = today.slice(0, 4);
  const blocks = relations.filter((l) => l.kind === "blocks");
  const leads = relations.filter((l) => l.kind === "leads_to");
  const related = new Set(relations.flatMap((l) => [l.from, l.to]));
  const sourceOf = new Map<string, CardSource>();
  for (const g of roadmap.goals) for (const id of g.openedAfter) sourceOf.set(id, g.type);

  /** 마감일: 공고 마감과, 상태가 바뀌어 구간이 끝나는 날 중 이른 날. 둘 다 없으면 상시 */
  const closeOf = (r: RoadmapRow): string | null => {
    const official = r.official.type === "always" ? null : r.official.end;
    const ends = [official, r.lastAvailable].filter((d): d is string => !!d && d >= (r.firstAvailable ?? today));
    return ends.length ? ends.sort()[0] : null;
  };

  const rows = roadmap.rows.filter((r) => r.firstAvailable && r.status !== "none");
  const card = (r: RoadmapRow): PipelineCard => ({
    policyId: r.policyId,
    name: r.name,
    cat: r.cat,
    status: r.status,
    statusLabel: r.statusLabel,
    verified: r.verified,
    verifyLabel: r.verifyLabel,
    source: r.firstAvailable === today ? "now" : (sourceOf.get(r.policyId) ?? "later"),
    opensAt: r.firstAvailable === today ? null : r.firstAvailable,
    closesAt: closeOf(r),
    blocks: blocks.filter((l) => l.from === r.policyId).map((l) => ({ id: l.to, name: l.toName, quote: l.quote })),
    blockedBy: blocks.filter((l) => l.to === r.policyId).map((l) => ({ id: l.from, name: l.fromName, quote: l.quote })),
    leadsTo: leads.filter((l) => l.from === r.policyId).map((l) => ({ id: l.to, name: l.toName, quote: l.quote })),
    dupNote: r.restrictionQuote,
  });

  const horizon = roadmap.months[roadmap.months.length - 1].slice(0, 7);
  const groups = new Map<string, RoadmapRow[]>();
  for (const r of rows) {
    const close = closeOf(r);
    const key = !close ? "always" : close.slice(0, 7) > horizon ? "beyond" : close.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const order = (k: string) => (k === "always" ? "9999-99" : k === "beyond" ? "9999-98" : k);
  const keys = [...groups.keys()].sort((a, b) => order(a).localeCompare(order(b)));

  const columns: PipelineColumn[] = keys.map((key) => {
    const all = groups.get(key)!;
    // 관계가 있는 사람 확인 정책 → 가정 뒤에 열리는 정책(상태 변화) → 나머지(로드맵 순서: 사람 확인 · 점수)
    const rank = (r: RoadmapRow) => (related.has(r.policyId) && r.verified ? 0 : r.firstAvailable !== today ? 1 : 2);
    const sorted = [...all].sort((a, b) => rank(a) - rank(b));
    const cards = sorted.slice(0, PER_COLUMN).map(card);
    const ids = new Set(cards.map((c) => c.policyId));
    const exclusiveGroups: string[][] = [];
    const seen = new Set<string>();
    for (const l of blocks) {
      if (ids.has(l.from) && ids.has(l.to)) {
        const k = [l.from, l.to].sort().join(":");
        if (!seen.has(k)) {
          seen.add(k);
          exclusiveGroups.push([l.from, l.to]);
        }
      }
    }
    const bySource: Partial<Record<CardSource, number>> = {};
    for (const r of all) {
      const s = card(r).source;
      bySource[s] = (bySource[s] ?? 0) + 1;
    }
    const [y, m] = key.split("-");
    return {
      key,
      title: key === "always" ? "상시 · 기한 없음" : key === "beyond" ? `${horizon.slice(0, 4)}년 ${Number(horizon.slice(5))}월 이후 마감` : `${y === thisYear ? "" : `${y}년 `}${Number(m)}월 마감`,
      cards,
      allIds: all.map((r) => r.policyId),
      total: all.length,
      hidden: all.length - cards.length,
      exclusiveGroups,
      bySource,
    };
  });

  const markers: PipelineMarker[] = roadmap.goals.map((g) => {
    const month = g.date.slice(0, 7);
    const before = keys.find((k) => order(k) >= month) ?? "always";
    return { type: g.type, date: g.date, label: `${EVENT_NAME[g.type]} 가정 ${g.date.slice(5).replace("-", ".")}`, beforeKey: before };
  });

  return { columns, markers };
}
