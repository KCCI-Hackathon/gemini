import { describe, expect, test } from "vitest";
import { guardResponse } from "@/lib/agent/guard";
import { rankOpenQuestions } from "@/lib/agent/questions";
import { judgeAll, judgePolicy } from "@/lib/judge";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import { loadSnapshot } from "@/lib/data/snapshot";
import { loadVerified } from "@/lib/data/verified";
import { buildRoute, type RouteNode } from "@/lib/route/build";
import { weighPolicy } from "@/lib/route/weight";

const NOW = new Date("2026-11-24T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const NATIONAL = "20260710005400113256";
const CHALLENGE = "20250122005400110346";
const unemployedNoHistory: Profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [] };
const unpaid = [NATIONAL, "20250122005400110369"].map(policyId => ({ policyId, status: "eligible_unpaid" as const }));

describe("weighPolicy: 먼저 확인할 순서 점수", () => {
  const results = judgeAll(PERSONA_A, NOW);
  const of = (id: string) => results.find((r) => r.policy.id === id)!;

  test("점수는 이유들의 합이고, 이유마다 이름과 점수가 있다", () => {
    const w = weighPolicy(of(INCHEON), { interest: "job", now: NOW });
    expect(w.reasons.length).toBeGreaterThan(0);
    expect(w.score).toBe(w.reasons.reduce((s, r) => s + r.points, 0));
    expect(w.reasons.map((r) => r.label)).toContain("마감 6일 전");
    expect(w.reasons.map((r) => r.label)).toContain("공식 공고를 사람이 확인");
  });

  test("마감이 임박하고 조건을 충족한 검증 정책이 상시·본문 미확인 정책보다 앞선다", () => {
    const unreviewedAlways = results.find((r) => !r.verified && r.axes.recruitment === "always" && r.axes.personal.value === "code_met_unreviewed")!;
    expect(weighPolicy(of(INCHEON), { interest: "job", now: NOW }).score).toBeGreaterThan(weighPolicy(unreviewedAlways, { interest: "job", now: NOW }).score);
  });

  test("관심이 창업이면 창업 분야 정책의 점수가 오른다", () => {
    const startup = results.find((r) => r.policy.category.middle.includes("창업") && r.axes.personal.value === "code_met_unreviewed")!;
    const asJob = weighPolicy(startup, { interest: "job", now: NOW }).score;
    const asStartup = weighPolicy(startup, { interest: "startup", now: NOW }).score;
    expect(asStartup).toBeGreaterThan(asJob);
  });
});

describe("buildRoute: 상태 갈림길", () => {
  const route = buildRoute(PERSONA_A, NOW);
  const path = (branch: RouteNode) => [...route.trunk, branch];

  test("수강 중인 사람: 지금 → 수료 후가 한 줄기, 취업과 창업이 갈림길", () => {
    expect(route.trunk.map((n) => n.key)).toEqual(["now", "after_training"]);
    expect(route.branches.map((n) => n.key)).toEqual(["employed", "business"]);
    expect(route.trunk[0].assumed).toBe(false);
    expect(route.branches.every((n) => n.assumed)).toBe(true);
  });

  test("지금 마디는 최대 4개, 1번은 마감이 임박한 인천 응시료", () => {
    const now = route.trunk[0];
    expect(now.steps.length).toBeGreaterThan(0);
    expect(now.steps.length).toBeLessThanOrEqual(4);
    expect(now.steps[0].policyId).toBe(INCHEON);
    expect(now.steps.map((s) => s.order)).toEqual(now.steps.map((_, i) => i + 1));
  });

  test("사람이 확인한 국민취업지원제도가 지금 마디에 들어 있다(본문 미확인 정책에 밀리지 않는다)", () => {
    expect(route.trunk[0].steps.map((s) => s.policyId)).toContain(NATIONAL);
  });

  test("수료 직후의 청년도전은 기간 조건이 남아 있다는 안내와 감점이 붙는다", () => {
    const s = route.trunk[1].steps.find((x) => x.policyId === CHALLENGE)!;
    expect(s.note).toContain("6개월");
    expect(s.reasons.some((r) => r.points < 0 && r.label.includes("기간"))).toBe(true);
  });

  test("번호는 줄기를 따라 이어지고, 두 갈림길은 같은 번호에서 시작한다", () => {
    const trunkCount = route.trunk.reduce((n, node) => n + node.steps.length, 0);
    for (const b of route.branches) if (b.steps.length) expect(b.steps[0].order).toBe(trunkCount + 1);
  });

  test("한 길 위에서 같은 정책이 두 번 나오지 않고, 비해당 정책은 없다", () => {
    for (const b of route.branches) {
      const ids = path(b).flatMap((n) => n.steps.map((s) => s.policyId));
      expect(new Set(ids).size).toBe(ids.length);
      for (const n of path(b)) for (const s of n.steps) expect(s.personal).not.toBe("ineligible");
    }
  });

  test("다음 마디의 정책은 그 상태에서 새로 열리는 것만 싣는다", () => {
    for (const n of [...route.trunk.slice(1), ...route.branches]) for (const s of n.steps) expect(s.opened, `${n.key} ${s.name}`).toBe(true);
  });

  test("취업 갈림길에는 앞에서 본 인천 응시료가 '기준일 확인 필요'로 표시된다", () => {
    const employed = route.branches.find((n) => n.key === "employed")!;
    const hit = employed.affected.find((a) => a.policyId === INCHEON);
    expect(hit?.label).toBe("자격 판단 기준일 확인 필요");
  });

  test("정책 사이 연결은 공고 인용이 있는 것만: 청년도전 → 국민취업지원제도 연계, 국취 참여 중이면 청년도전 제한", () => {
    const leads = route.links.find((l) => l.kind === "leads_to" && l.from === CHALLENGE && l.to === NATIONAL);
    expect(leads?.quote).toContain("국민취업지원제도");
    const blocks = route.links.find((l) => l.kind === "blocks" && l.from === NATIONAL && l.to === CHALLENGE);
    expect(blocks?.quote.length).toBeGreaterThan(0);
    for (const l of route.links) expect(l.quote.length).toBeGreaterThan(0);
  });

  test("이미 재직 중이면 줄기는 지금 하나, 갈림길은 창업만", () => {
    const r = buildRoute({ ...PERSONA_A, currentStatus: ["employed"], events: [] }, NOW);
    expect(r.trunk.map((n) => n.key)).toEqual(["now"]);
    expect(r.branches.map((n) => n.key)).toEqual(["business"]);
  });

  test("입력 프로필을 바꾸지 않는다", () => {
    const before = JSON.stringify(PERSONA_A);
    buildRoute(PERSONA_A, NOW);
    expect(JSON.stringify(PERSONA_A)).toBe(before);
  });

  test("순서 이유와 안내 문구에 우열·선정 표현이 없다", () => {
    const text = [route.notice, ...[...route.trunk, ...route.branches].flatMap((n) => [n.label, ...n.steps.flatMap((s) => s.reasons.map((r) => r.label)), ...n.affected.map((a) => a.label)])].join("\n");
    expect(guardResponse(text, new Set())).toEqual({ ok: true });
  });
});

describe("상담 질문: 최근 이력", () => {
  const P = (id: string) => loadSnapshot().policies.find((p) => p.id === id)!;
  const V = (id: string) => loadVerified().get(id);

  test("이력 정보가 없으면 '최근 6개월 이력' 질문이 후보에 오른다", () => {
    const qs = rankOpenQuestions(judgeAll(unemployedNoHistory, NOW));
    const q = qs.find((x) => x.key === "recent_history");
    expect(q?.relatedCount).toBeGreaterThan(0);
  });

  test("'아니오'라고 답하면 청년도전의 시간 조건이 충족으로 바뀐다", () => {
    const a = judgePolicy(P(CHALLENGE), V(CHALLENGE), { ...unemployedNoHistory, recentHistory: "no", benefits: unpaid }, NOW);
    expect(a.time.value).toBe("met");
    expect(a.personal.value).toBe("eligible");
  });

  test("'예'라고 답하면 기간 경과 후 재검토", () => {
    const a = judgePolicy(P(CHALLENGE), V(CHALLENGE), { ...unemployedNoHistory, recentHistory: "yes" }, NOW);
    expect(a.time.value).toBe("unmet");
    expect(a.time.note).toContain("경과");
  });

  test("판정 요청에 답을 실으면 반영되고, 응답에 루트가 들어 있다", () => {
    const r = handleJudge({ profile: unemployedNoHistory, benefits: unpaid, answers: { recent_history: "아니오" } }, NOW);
    if (!("route" in r.body)) throw new Error("400");
    expect(r.body.items.find((i) => i.id === CHALLENGE)?.personal).toBe("eligible");
    expect(r.body.route.trunk[0].key).toBe("now");
    expect(r.body.questions.some((q) => q.key === "recent_history")).toBe(false);
  });
});
