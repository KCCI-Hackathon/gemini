import { afterEach, describe, expect, test, vi } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { selectDefaultVisible } from "@/lib/ui/select";
import { PERSONA_A } from "@/lib/judge/personas";
import * as overlap from "@/lib/data/overlap";
import type { Benefit } from "@/lib/judge/types";
import { rule, SOURCE, TARGET } from "../overlap/runtime-fixture";

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

  test("국민취업지원제도 참여 답만 있으면 실제 수급을 확인한다", () => {
    const r = handleJudge({ profile: PERSONA_A, answers: { participating_national_employment_support: "예" } }, NOW);
    const b = r.body as Extract<typeof r.body, { items: unknown }>;
    expect(b.items.find((i) => i.id === CHALLENGE)?.restrictions.find(x => x.sourceId === "20260710005400113256")?.state).toBe("needs_info");
  });

  test("판정 경로는 외부로 아무것도 보내지 않는다", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    handleJudge({ profile: PERSONA_A, transitions: ["get_employed"] }, NOW);
    expect(spy).not.toHaveBeenCalled();
  });

  test("저장된 구직급여 규칙은 명시한 종료 사실에서 마지막 지급일 한 가지만 묻는다", () => {
    const out = handleJudge({ profile: PERSONA_A, benefits: [{ policyId: SOURCE, status: "ended" }] }, NOW).body;
    if (!("items" in out)) throw Error(out.error);
    const questions = out.items.find(x => x.id === TARGET)!.restrictions.filter(x => x.question);
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ sourceId: SOURCE, state: "needs_info", question: expect.stringContaining("마지막 지급일") });
  });

  test("중복수혜 적용·미적용·정보 부족 및 규칙 없는 정책을 구분한다", () => {
    vi.spyOn(overlap, "loadOverlap").mockReturnValue(new Map([[TARGET, [rule()]]]));
    const judge = (benefits?: Benefit[]) => {
      const out = handleJudge({ profile: { ...PERSONA_A, participating: [SOURCE] }, benefits }, NOW).body;
      if (!("items" in out)) throw Error(out.error);
      expect(out.dataVersion).toMatch(/^[a-f0-9]{12}$/);
      expect(out.items.find(i => i.id === INCHEON)?.restrictions).toEqual([]);
      return out.items.find(i => i.id === TARGET)!;
    };
    expect(judge().restrictions[0]).toMatchObject({ state: "needs_info", question: expect.any(String) });
    expect(judge([{ policyId: SOURCE, status: "eligible_unpaid" }]).restrictions[0].state).toBe("not_applies");
    expect(judge([{ policyId: SOURCE, status: "receiving" }])).toMatchObject({ personal: "ineligible", restriction: "applies",
      reasons: expect.arrayContaining([expect.stringContaining("수혜 불가")]), restrictions: [{ evidence: { quote: rule().evidence.quote_text } }] });
    expect(handleJudge({ profile: PERSONA_A, benefits: [{ policyId: SOURCE, lastPaymentDate: "2025-02-29" }] }, NOW).status).toBe(400);
  });

  test("조사로 확정된 훈련장려금 미지급은 개인 자격을 탈락시키지 않는다", () => {
    const r = rule({ kind: "partial", effect_type: "personal_payment_block", restricted_item: "훈련장려금" });
    vi.spyOn(overlap, "loadOverlap").mockReturnValue(new Map([[TARGET, [r]]]));
    const profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [], recentHistory: "no" };
    const out = handleJudge({ profile, benefits: [{ policyId: SOURCE, status: "receiving" }] }, NOW).body;
    if (!("items" in out)) throw Error(out.error);
    expect(out.items.find(i => i.id === TARGET)).toMatchObject({
      personal: "eligible",
      restrictions: [{ state: "applies", restricted_item: "훈련장려금" }],
    });
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
