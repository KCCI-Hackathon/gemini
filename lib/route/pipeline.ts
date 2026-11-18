// 파이프라인: 기간(지금 → 수료 후 → 취업 후 → 창업 후)마다 먼저 볼 정책 몇 장과,
// 정책 사이의 중복 수혜 제한(공고 인용이 있는 것)·연계를 함께 놓는다. 판정은 로드맵 그대로 쓴다.
import type { RouteLink } from "./build";
import type { Roadmap, RoadmapRow } from "./roadmap";

const PER_STAGE = 5;
const EVENT_NAME: Record<string, string> = { training_completion: "수료", employment: "취업", business_registration: "창업", relocation: "이사" };

export type Relation = { id: string; name: string; quote: string };
export type PipelineCard = {
  policyId: string;
  name: string;
  cat: RoadmapRow["cat"];
  status: RoadmapRow["status"];
  statusLabel: string;
  verified: boolean;
  verifyLabel: RoadmapRow["verifyLabel"];
  /** 이 단계에서 열리는 때(지금이면 null) */
  opensAt: string | null;
  /** 이 정책에 참여 중이면 제한되는 정책 */
  blocks: Relation[];
  /** 이 정책을 제한하는 정책(그 정책에 참여 중이면 신청 불가) */
  blockedBy: Relation[];
  /** 이수하면 연계되는 정책 */
  leadsTo: Relation[];
  /** 상대를 특정할 수 없는 중복·유사사업 제한 문구 */
  dupNote: string | null;
};
export type PipelineStage = {
  key: string;
  title: string;
  when: string;
  cards: PipelineCard[];
  total: number;
  hidden: number;
  /** 이 단계 안에서 서로 제한되어 하나만 고를 수 있는 카드 묶음(정책 번호) */
  exclusiveGroups: string[][];
};
export type Pipeline = { stages: PipelineStage[] };

export function buildPipeline(roadmap: Roadmap, relations: RouteLink[]): Pipeline {
  const today = roadmap.months[0];
  const ym = (d: string) => d.slice(0, 7).replace("-", ".");
  const byId = new Map(roadmap.rows.map((r) => [r.policyId, r]));
  const blocks = relations.filter((l) => l.kind === "blocks");
  const leads = relations.filter((l) => l.kind === "leads_to");

  const card = (r: RoadmapRow, opensAt: string | null): PipelineCard => ({
    policyId: r.policyId,
    name: r.name,
    cat: r.cat,
    status: r.status,
    statusLabel: r.statusLabel,
    verified: r.verified,
    verifyLabel: r.verifyLabel,
    opensAt,
    blocks: blocks.filter((l) => l.from === r.policyId).map((l) => ({ id: l.to, name: l.toName, quote: l.quote })),
    blockedBy: blocks.filter((l) => l.to === r.policyId).map((l) => ({ id: l.from, name: l.fromName, quote: l.quote })),
    leadsTo: leads.filter((l) => l.from === r.policyId).map((l) => ({ id: l.to, name: l.toName, quote: l.quote })),
    dupNote: r.restrictionQuote,
  });

  // 지금: 오늘 열려 있는 정책. 로드맵 순서가 이미 "사람 확인 → 먼저 볼 순서 점수"다
  const nowRows = roadmap.rows.filter((r) => r.firstAvailable === today && r.status !== "none");
  // 관계가 있는 정책은 상위 카드에 꼭 넣는다(파이프라인에서 제한·연계가 보이도록)
  const related = new Set(relations.flatMap((l) => [l.from, l.to]));
  const pick = (rows: RoadmapRow[]) => {
    const must = rows.filter((r) => related.has(r.policyId) && r.verified);
    const rest = rows.filter((r) => !must.includes(r));
    return [...must, ...rest].slice(0, Math.max(PER_STAGE, must.length));
  };

  const stages: PipelineStage[] = [
    { key: "now", title: "지금", when: `오늘 ${today.slice(5).replace("-", ".")}`, cards: pick(nowRows).map((r) => card(r, null)), total: nowRows.length, hidden: 0, exclusiveGroups: [] },
    ...roadmap.goals.map((g) => {
      const rows = g.openedAfter.map((id) => byId.get(id)!).filter(Boolean);
      const ev = EVENT_NAME[g.type];
      return {
        key: g.type,
        title: `${ev} 후`,
        when: `${ev} 가정 ${ym(g.date)}`,
        cards: pick(rows).map((r) => card(r, r.firstAvailable === g.date ? null : r.firstAvailable)),
        total: rows.length,
        hidden: 0,
        exclusiveGroups: [] as string[][],
      };
    }),
  ];

  for (const st of stages) {
    st.hidden = st.total - st.cards.length;
    const ids = new Set(st.cards.map((c) => c.policyId));
    const seen = new Set<string>();
    for (const l of blocks) {
      if (ids.has(l.from) && ids.has(l.to)) {
        const key = [l.from, l.to].sort().join(":");
        if (!seen.has(key)) {
          seen.add(key);
          st.exclusiveGroups.push([l.from, l.to]);
        }
      }
    }
  }
  return { stages };
}
