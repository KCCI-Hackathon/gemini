// 상태 갈림길 루트: 상태를 마디로 두고(지금 → 수료 후 → 취업/창업), 마디마다 "먼저 확인할 순서"대로 정책을 놓는다.
// 정책 사이의 연결선은 공고 인용이 있는 것만 싣는다. 외부 호출 없음, 입력 프로필은 바꾸지 않는다.
import routeLinks from "@/data/route-links.json";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { judgeAll, type JudgedPolicy, type PersonalValue, type Profile } from "@/lib/judge";
import { baselineOpts, effectiveStatus } from "@/lib/judge/personal";
import { applyTransition, CHANGE_LABEL, classifyChange, type Transition } from "@/lib/sim/transition";
import { deadlineOf, weighPolicy, type WeightReason } from "./weight";

export type RouteStep = {
  order: number;
  policyId: string;
  name: string;
  verified: boolean;
  personal: PersonalValue;
  recruitment: string;
  deadline: string | null;
  score: number;
  reasons: WeightReason[];
  /** 시간 조건 안내(예: 수료일 기준 6개월 경과 후 재검토) */
  note: string | null;
  /** 앞 마디에서는 닫혀 있다가 이 상태에서 열리는 정책 */
  opened: boolean;
};

export type RouteNode = {
  key: "now" | "after_training" | "employed" | "business";
  label: string;
  /** 가정한 상태(오늘 그 일이 일어났다고 가정)인지 */
  assumed: boolean;
  transition: Transition | null;
  steps: RouteStep[];
  /** 마디 전체에 해당하는 안내(예: 수료 예정일이 지났습니다) */
  note: string | null;
  /** 앞 마디에서 본 정책 중 이 상태에서 다시 봐야 하는 것 */
  affected: { policyId: string; name: string; label: string }[];
};

export type RouteLink = {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  kind: "leads_to" | "blocks";
  quote: string;
  /** 인용의 출처: 공식 공고(사람이 확인) 또는 온통청년 API의 텍스트 */
  source: "official" | "api";
  sourceUrl: string | null;
  checkedAt: string | null;
};

export type Route = { trunk: RouteNode[]; branches: RouteNode[]; links: RouteLink[]; notice: string };

const NOTICE =
  "번호는 '먼저 확인할 순서'입니다. 사람이 공식 공고를 확인한 정책을 먼저 놓고, 그 안에서 마감일·자격 판정·관심 분야로 계산한 점수 순으로 놓습니다. 우리 서비스가 정한 규칙이며 공식 기준이 아닙니다. 어느 길이 더 낫다는 뜻이 아니고, 신청 결과를 예측하지 않습니다.";

const NODE_OF: Record<Transition, { key: RouteNode["key"]; label: string }> = {
  complete_training: { key: "after_training", label: "수료한 뒤" },
  get_employed: { key: "employed", label: "취업한다면" },
  register_business: { key: "business", label: "사업자등록을 한다면" },
};

const ORDER: Record<PersonalValue, number> = { eligible: 0, code_met_unreviewed: 1, needs_check: 2, ineligible: 3 };
const ROOT_STEPS = 4;
const NEXT_STEPS = 3;

function normName(name: string): string {
  return name.replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
}

function nameOf(id: string): string {
  return loadVerified().get(id)?.name ?? loadSnapshot().policies.find((p) => p.id === id)?.name ?? id;
}

/** 정책 사이 관계 전체(공고 인용이 있는 것만): 연계(leads_to), 참여 중이면 제한(blocks) */
export function allRelations(): RouteLink[] {
  return links();
}

function links(): RouteLink[] {
  const out: RouteLink[] = routeLinks.map((l) => ({ from: l.from, fromName: nameOf(l.from), to: l.to, toName: nameOf(l.to), kind: "leads_to" as const, quote: l.quote, source: "official" as const, sourceUrl: l.sourceUrl, checkedAt: l.checkedAt }));
  // 참여 중이면 제한된다고 공고가 적은 관계
  for (const v of loadVerified().values()) {
    for (const q of v.restrictionQuotes) {
      for (const other of q.mentions ?? []) {
        out.push({ from: other, fromName: nameOf(other), to: v.id, toName: v.name, kind: "blocks", quote: q.text, source: q.source, sourceUrl: q.source === "official" ? (v.sources[0]?.url ?? null) : null, checkedAt: q.source === "official" ? (v.sources[0]?.checkedAt ?? null) : null });
      }
    }
  }
  return out;
}

const first = (r: JudgedPolicy) => r.verified && r.axes.recruitment !== "closed";

type Built = { node: RouteNode; judged: Map<string, JudgedPolicy>; shown: Set<string>; nextOrder: number };

function buildNode(
  def: { key: RouteNode["key"]; label: string; transition: Transition | null },
  profile: Profile,
  origin: Profile,
  parent: { profile: Profile; built: Built } | null,
  now: Date,
): Built {
  const all = judgeAll(profile, now, parent ? baselineOpts(origin, parent.profile) : {}).filter((r) => r.layer !== "history" || r.verified);
  const judged = new Map(all.map((r) => [r.policy.id, r]));
  const shown = new Set(parent?.built.shown ?? []);

  // 검증 정책과 이름이 같은 미확인 항목(예: 군·구가 따로 등록한 같은 사업)은 접는다
  const verifiedNames = all.filter((r) => r.verified).map((r) => normName(r.policy.name));
  const duplicateOfVerified = (r: JudgedPolicy) => !r.verified && verifiedNames.some((n) => normName(r.policy.name).includes(n));

  const candidates = all
    .filter((r) => r.axes.personal.value !== "ineligible" && !shown.has(r.policy.id) && !duplicateOfVerified(r))
    .map((r) => {
      const before = parent?.built.judged.get(r.policy.id);
      const opened = !!parent && (!before || ORDER[r.axes.personal.value] < ORDER[before.axes.personal.value]);
      return { r, opened, w: weighPolicy(r, { interest: profile.interest, now, opened }) };
    })
    // 첫 마디: 모집이 끝난 정책은 싣지 않는다. 다음 마디: 그 상태에서 새로 열리는 정책만 싣는다
    .filter((c) => (parent ? c.opened && (c.r.axes.recruitment !== "closed" || c.r.verified) : c.r.axes.recruitment !== "closed"))
    // 사람이 확인했고 모집이 열려 있는 정책을 먼저 놓는다. 그 안에서 점수 순,
    // 동점이면 사람이 확인한 정책, 마감이 가까운 정책, 정책 번호 순
    .sort(
      (a, b) =>
        Number(first(b.r)) - Number(first(a.r)) ||
        b.w.score - a.w.score ||
        Number(b.r.verified) - Number(a.r.verified) ||
        (deadlineOf(a.r) ?? "9999").localeCompare(deadlineOf(b.r) ?? "9999") ||
        a.r.policy.id.localeCompare(b.r.policy.id),
    )
    .slice(0, parent ? NEXT_STEPS : ROOT_STEPS);

  let order = parent?.built.nextOrder ?? 1;
  const steps: RouteStep[] = candidates.map((c) => ({
    order: order++,
    policyId: c.r.policy.id,
    name: nameOf(c.r.policy.id),
    verified: c.r.verified,
    personal: c.r.axes.personal.value,
    recruitment: c.r.axes.recruitment,
    deadline: deadlineOf(c.r),
    score: c.w.score,
    reasons: c.w.reasons,
    // 정책 자체의 기간 조건 안내만 싣는다. 마디 전체 안내는 node.note
    note: c.r.axes.time.value !== "na" ? (c.r.axes.time.note ?? null) : null,
    opened: c.opened,
  }));
  for (const s of steps) shown.add(s.policyId);

  const affected: RouteNode["affected"] = [];
  if (parent) {
    for (const id of parent.built.shown) {
      const before = parent.built.judged.get(id);
      const after = judged.get(id);
      if (!before || !after) continue;
      const change = classifyChange(before.axes, after.axes, after.verified);
      if (change !== "unchanged") affected.push({ policyId: id, name: nameOf(id), label: CHANGE_LABEL[change] });
    }
  }

  const nodeNote = all.find((r) => r.axes.time.value === "na" && r.axes.time.note)?.axes.time.note ?? null;
  return { node: { key: def.key, label: def.label, assumed: !!parent, transition: def.transition, steps, note: nodeNote, affected }, judged, shown, nextOrder: order };
}

export function buildRoute(profile: Profile, now: Date): Route {
  const origin = structuredClone(profile);
  const status = effectiveStatus(origin);

  const root = buildNode({ key: "now", label: "지금", transition: null }, origin, origin, null, now);
  const trunk: { profile: Profile; built: Built }[] = [{ profile: origin, built: root }];

  if (status.has("in_training")) {
    const p = applyTransition(origin, "complete_training", now);
    trunk.push({ profile: p, built: buildNode({ ...NODE_OF.complete_training, transition: "complete_training" }, p, origin, trunk[0], now) });
  }

  const tip = trunk[trunk.length - 1];
  const forks: Transition[] = [];
  if (!status.has("employed")) forks.push("get_employed");
  if (!status.has("business_registered")) forks.push("register_business");
  const branches = forks.map((t) => buildNode({ ...NODE_OF[t], transition: t }, applyTransition(tip.profile, t, now), origin, tip, now).node);

  const trunkNodes = trunk.map((t) => t.built.node);
  // 루트에 나오는 정책과 관련된 관계만 보여준다
  const onRoute = new Set([...trunkNodes, ...branches].flatMap((n) => [...n.steps.map((s) => s.policyId), ...n.affected.map((a) => a.policyId)]));
  return { trunk: trunkNodes, branches, links: links().filter((l) => onRoute.has(l.from) || onRoute.has(l.to)), notice: NOTICE };
}
