// 최종 리뷰에서 나온 판정 오류(C1, I1~I4)를 재현하는 테스트
import { describe, expect, test } from "vitest";
import { loadSnapshot } from "@/lib/data/snapshot";
import { buildVerifiedMap, loadVerified } from "@/lib/data/verified";
import { judgePolicy } from "@/lib/judge";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import { simulateTransition } from "@/lib/sim/transition";
import type { Policy } from "@/lib/data/types";
import type { Profile } from "@/lib/judge/types";
import incheonRaw from "@/data/verified/20260406005400212445.json";

const { policies } = loadSnapshot();
const verified = loadVerified();
const P = (id: string) => policies.find((p) => p.id === id)!;
const NOW = new Date("2026-11-24T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const CHALLENGE = "20250122005400110346";

const unemployedNoHistory: Profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [] };

describe("C1: 이력 정보가 없으면 최근 이력 조건을 충족했다고 보지 않는다", () => {
  test("청년도전: 이벤트가 없는 미취업자는 시간 축 확인 필요, 조건상 해당 아님", () => {
    const a = judgePolicy(P(CHALLENGE), verified.get(CHALLENGE), unemployedNoHistory, NOW);
    expect(a.time.value).toBe("needs_check");
    expect(a.time.note).toContain("이력 확인 필요");
    expect(a.personal.value).not.toBe("eligible");
  });
});

describe("I1: 검증 정책은 전이 전에 충족하던 조건이 어긋날 때만 기준일 확인으로 완화", () => {
  test("재직자가 사업자등록을 가정해도 미취업자 대상 인천 응시료는 그대로 비해당", () => {
    const employed: Profile = { ...PERSONA_A, currentStatus: ["employed"], events: [] };
    const r = simulateTransition(employed, "register_business", NOW).find((x) => x.policyId === INCHEON)!;
    expect(r.after.personal.value).toBe("ineligible");
    expect(r.change).toBe("unchanged");
  });
});

describe("I2: 연속 전이에서도 완화 기준은 원래 프로필", () => {
  test("미취업자: 취업→사업자등록을 이어 눌러도 미취업자 코드 정책이 비해당으로 굳지 않는다", () => {
    const body = (ts: ("get_employed" | "register_business")[]) => {
      const r = handleJudge({ profile: unemployedNoHistory, transitions: ts }, NOW);
      if (!("items" in r.body)) throw new Error("400");
      return r.body.items;
    };
    const onlyUnemployed = new Set(policies.filter((p) => p.jobCodes.length === 1 && p.jobCodes[0] === "0013003").map((p) => p.id));
    const one = body(["get_employed"]).filter((i) => onlyUnemployed.has(i.id));
    const two = new Map(body(["get_employed", "register_business"]).map((i) => [i.id, i.personal]));
    expect(one.length).toBeGreaterThan(0);
    for (const i of one) expect(two.get(i.id), i.name).toBe(i.personal);
  });
});

describe("I3: 프로필이 표현하지 못하는 취업 요건은 비해당이 아니라 확인 필요", () => {
  const base = P(INCHEON);
  const clean: Policy = { ...base, id: "y1", jobCodes: ["0013006"], schoolCodes: ["0049010"], specialCodes: ["0014010"], incomeCode: "0043001", marriageCode: "0055003", texts: { ...base.texts, addQualification: "", excluded: "", income: "" } };
  test("(예비)창업자 코드만 있는 정책: 미취업자에게 확인 필요", () => {
    expect(judgePolicy(clean, undefined, unemployedNoHistory, NOW).personal.value).toBe("needs_check");
  });
  test("취업 상태를 하나도 고르지 않았으면 미취업자 코드 정책도 확인 필요", () => {
    const p: Policy = { ...clean, id: "y2", jobCodes: ["0013003"] };
    expect(judgePolicy(p, undefined, { ...unemployedNoHistory, currentStatus: [] }, NOW).personal.value).toBe("needs_check");
  });
  test("검증 정책도 취업 상태를 고르지 않았으면 확인 필요", () => {
    expect(judgePolicy(P(INCHEON), verified.get(INCHEON), { ...unemployedNoHistory, currentStatus: [] }, NOW).personal.value).toBe("needs_check");
  });
  test("표현 가능한 코드가 분명히 어긋나면 그대로 비해당", () => {
    const p: Policy = { ...clean, id: "y3", jobCodes: ["0013001"] };
    expect(judgePolicy(p, undefined, unemployedNoHistory, NOW).personal.value).toBe("ineligible");
  });
});

describe("I4: 사람 검증 전(draft) 정책은 검증 정책으로 쓰지 않는다", () => {
  test("draft는 목록에서 빠진다", () => {
    const m = buildVerifiedMap([{ ...incheonRaw, verificationStatus: "draft" }]);
    expect(m.has(INCHEON)).toBe(false);
    expect(buildVerifiedMap([incheonRaw]).has(INCHEON)).toBe(true);
  });
});
