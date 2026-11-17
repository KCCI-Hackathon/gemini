// 루트 기능 리뷰(2026-11-17)에서 나온 지적을 재현하는 테스트
import { describe, expect, test } from "vitest";
import { rankOpenQuestions } from "@/lib/agent/questions";
import { loadSnapshot } from "@/lib/data/snapshot";
import { judgeAll } from "@/lib/judge";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import { buildRoute } from "@/lib/route/build";
import { weighPolicy } from "@/lib/route/weight";

const NOW = new Date("2026-11-24T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const NATIONAL = "20260710005400113256";
const CHALLENGE = "20250122005400110346";
const unemployedNoHistory: Profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [] };
const employed: Profile = { ...PERSONA_A, currentStatus: ["employed"], events: [] };
const ids = new Set(loadSnapshot().policies.map((p) => p.id));

describe("C1: 기간 조건이 남아 있으면 '조건상 해당'이 아니다", () => {
  test("최근 이력이 있다고 답하면 청년도전은 확인 필요", () => {
    const r = handleJudge({ profile: unemployedNoHistory, answers: { recent_history: "예" } }, NOW);
    if (!("items" in r.body)) throw new Error("400");
    const item = r.body.items.find((i) => i.id === CHALLENGE)!;
    expect(item.personal).toBe("needs_check");
    expect(item.reasons.join(" ")).toContain("기간");
  });

  test("수료 직후의 청년도전은 확인 필요이고 '새로 검토 대상' 가점이 붙지 않는다", () => {
    const s = buildRoute(PERSONA_A, NOW).trunk[1].steps.find((x) => x.policyId === CHALLENGE)!;
    expect(s.personal).toBe("needs_check");
    expect(s.reasons.some((r) => r.label.includes("새로"))).toBe(false);
  });

  test("모집이 끝난 정책에는 '새로 검토 대상' 가점이 붙지 않는다", () => {
    const route = buildRoute(PERSONA_A, NOW);
    for (const n of route.branches) for (const s of n.steps) if (s.recruitment === "closed") expect(s.reasons.some((r) => r.label.includes("새로")), s.name).toBe(false);
  });
});

describe("C2: 본문을 아무도 확인하지 않은 '확인 필요' 정책이 앞자리를 차지하지 않는다", () => {
  test("시연 인물의 지금 마디에 무관한 미확인 정책과 검증 정책의 중복 항목이 없다", () => {
    const names = buildRoute(PERSONA_A, NOW).trunk[0].steps.map((s) => s.name);
    expect(names.some((n) => n.includes("매장유산"))).toBe(false);
    expect(names.filter((n) => n.includes("자격증 응시료")).length).toBe(1);
  });

  test("어떤 관심 분야에서도 미확인 '확인 필요' 정책이 검증 정책보다 앞서지 않는다", () => {
    for (const interest of ["job", "keep_searching", "startup"] as const) {
      for (const base of [PERSONA_A, unemployedNoHistory, employed]) {
        const steps = buildRoute({ ...base, interest }, NOW).trunk[0].steps;
        const lastVerified = steps.map((s) => s.verified).lastIndexOf(true);
        const firstWeak = steps.findIndex((s) => !s.verified && s.personal === "needs_check");
        if (firstWeak !== -1) expect(firstWeak, `${interest} ${steps.map((s) => s.name).join(" / ")}`).toBeGreaterThan(lastVerified);
      }
    }
  });

  test("관심이 창업인 미취업자의 지금 마디에도 국민취업지원제도가 남는다", () => {
    const steps = buildRoute({ ...unemployedNoHistory, interest: "startup" }, NOW).trunk[0].steps;
    expect(steps.map((s) => s.policyId)).toContain(NATIONAL);
  });
});

describe("C3: 날짜가 바뀌어도 첫 마디가 무너지지 않는다", () => {
  test("마감 당일은 '오늘 마감'이라고 쓴다", () => {
    const at = new Date("2026-11-30T10:00:00+09:00");
    const r = judgeAll(PERSONA_A, at).find((x) => x.policy.id === INCHEON)!;
    const labels = weighPolicy(r, { interest: "job", now: at }).reasons.map((x) => x.label);
    expect(labels).toContain("오늘 마감");
    expect(labels.some((l) => l.includes("0일"))).toBe(false);
  });

  test("11/30 18시가 지나면 인천 응시료는 지금 마디에서 빠진다", () => {
    const steps = buildRoute(PERSONA_A, new Date("2026-11-30T23:30:00+09:00")).trunk[0].steps;
    expect(steps.map((s) => s.policyId)).not.toContain(INCHEON);
  });

  test("12월에도 지금 마디의 1번은 사람이 확인한 정책이다", () => {
    const steps = buildRoute(PERSONA_A, new Date("2026-12-05T12:00:00+09:00")).trunk[0].steps;
    expect(steps[0].verified).toBe(true);
  });

  test("수료 예정일이 지났다는 안내는 마디에 한 번만, 정책마다 반복하지 않는다", () => {
    const route = buildRoute(PERSONA_A, new Date("2026-12-20T12:00:00+09:00"));
    expect(route.trunk[0].note).toContain("수료 예정일이 지났습니다");
    for (const s of route.trunk[0].steps) expect(s.note ?? "").not.toContain("수료 예정일이 지났습니다");
  });
});

describe("I2: 다시 볼 정책의 라벨", () => {
  test("취업으로 비해당이 된 청년도전에 '수료일 기준' 라벨을 붙이지 않는다", () => {
    const route = buildRoute(unemployedNoHistory, NOW);
    const a = route.branches.find((n) => n.key === "employed")!.affected.find((x) => x.policyId === CHALLENGE);
    expect(a).toBeDefined();
    expect(a!.label).not.toContain("수료일");
  });
});

describe("I3: 정책 사이 관계의 출처", () => {
  const route = buildRoute(PERSONA_A, NOW);
  test("모든 관계는 실제 정책 번호를 가리키고 출처 종류가 적혀 있다", () => {
    expect(route.links.length).toBeGreaterThan(0);
    for (const l of route.links) {
      expect(ids.has(l.from) && ids.has(l.to), `${l.from} → ${l.to}`).toBe(true);
      expect(["official", "api"]).toContain(l.source);
      if (l.source === "api") expect(l.sourceUrl).toBeNull();
      if (l.source === "official") expect(l.sourceUrl).toMatch(/^https?:\/\//);
    }
  });
  test("루트에 나오지 않는 정책의 관계는 보여주지 않는다", () => {
    const r = buildRoute(employed, NOW);
    const onRoute = new Set([...r.trunk, ...r.branches].flatMap((n) => [...n.steps.map((s) => s.policyId), ...n.affected.map((a) => a.policyId)]));
    for (const l of r.links) expect(onRoute.has(l.from) || onRoute.has(l.to)).toBe(true);
  });
});

describe("I4: 답해도 바뀌지 않는 질문은 묻지 않는다", () => {
  test("재직자에게 최근 이력을 묻지 않는다", () => {
    const qs = rankOpenQuestions(judgeAll(employed, NOW));
    expect(qs.some((q) => q.key === "recent_history")).toBe(false);
    for (const q of qs) expect(q.mayChangeCount).toBeGreaterThan(0);
  });
});
