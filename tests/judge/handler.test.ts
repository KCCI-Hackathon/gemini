import { afterEach, describe, expect, test, vi } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { selectDefaultVisible } from "@/lib/ui/select";
import { PERSONA_A } from "@/lib/judge/personas";

const NOW = new Date("2026-11-24T12:00:00+09:00");
const CHALLENGE = "20250122005400110346";
const INCHEON = "20260406005400212445";

afterEach(() => vi.restoreAllMocks());

describe("handleJudge", () => {
  test("프로필 형식이 틀리면 400", () => {
    expect(handleJudge({ profile: { birthYm: "1999" } }, NOW).status).toBe(400);
  });

  test("현재 판정: 네 등급 건수와 검증 정책 카드를 돌려준다", () => {
    const r = handleJudge({ profile: PERSONA_A }, NOW);
    expect(r.status).toBe(200);
    const b = r.body as Extract<typeof r.body, { items: unknown }>;
    expect(b.summary.eligible + b.summary.code_met_unreviewed + b.summary.needs_check + b.summary.ineligible).toBe(b.items.length);
    expect(b.cards.length).toBe(6);
    expect(b.asOf).toBe("2026-11-16");
  });

  test("상태 변경을 차례로 적용한다(수료 → 취업)", () => {
    const r = handleJudge({ profile: PERSONA_A, transitions: ["complete_training", "get_employed"] }, NOW);
    const b = r.body as Extract<typeof r.body, { items: unknown }>;
    expect(b.lastTransition).toBe("get_employed");
    expect(b.items.find((i) => i.id === INCHEON)?.change).toBe("자격 판단 기준일 확인 필요");
    expect(b.needsVerification.length).toBeGreaterThan(0);
  });

  test("국민취업지원제도 참여 답을 반영한다", () => {
    const r = handleJudge({ profile: PERSONA_A, answers: { participating_national_employment_support: "예" } }, NOW);
    const b = r.body as Extract<typeof r.body, { items: unknown }>;
    expect(b.items.find((i) => i.id === CHALLENGE)?.restriction).toBe("applies");
  });

  test("판정 경로는 외부로 아무것도 보내지 않는다", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    handleJudge({ profile: PERSONA_A, transitions: ["get_employed"] }, NOW);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("selectDefaultVisible", () => {
  test("검증 정책, 상태 변화로 바뀐 정책, 30일 안에 마감되는 정책만 기본으로 펼친다", () => {
    const items = [
      { id: "a", verified: true, change: null, deadline: null },
      { id: "b", verified: false, change: "자격 재검토", deadline: null },
      { id: "c", verified: false, change: null, deadline: "2026-12-10" },
      { id: "d", verified: false, change: null, deadline: "2027-03-01" },
      { id: "e", verified: false, change: null, deadline: null },
    ];
    expect(selectDefaultVisible(items, NOW)).toEqual(["a", "b", "c"]);
  });
});
