import { describe, expect, test } from "vitest";
import { guardResponse } from "@/lib/agent/guard";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import type { Profile } from "@/lib/judge/types";
import { buildTimeline } from "@/lib/route/timeline";

// 시연 인물: 수강 중, 2026-12-19 수료 예정
const NOW = new Date("2026-11-24T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const KNEWDEAL = "20260714005400113258";
const CHALLENGE = "20250122005400110346";
const row = (t: ReturnType<typeof buildTimeline>, id: string) => t.rows.find((r) => r.policyId === id)!;

describe("buildTimeline: 정책의 신청 구간을 기간 순으로 놓는다", () => {
  const t = buildTimeline(PERSONA_A, NOW, {});

  test("가로축은 오늘부터 12개월, 정책마다 달마다 한 칸", () => {
    expect(t.months.length).toBe(13);
    expect(t.months[0]).toBe("2026-11-24");
    for (const r of t.rows) expect(r.cells.length).toBe(13);
  });

  test("수료 예정일이 가정한 사건으로 들어간다", () => {
    expect(t.events.map((e) => `${e.type}:${e.date}`)).toEqual(["training_completion:2026-12-19"]);
  });

  test("인천 응시료는 오늘부터, K-뉴딜은 수료일부터, 청년도전은 수료 6개월 뒤부터", () => {
    expect(row(t, INCHEON).firstAvailable).toBe("2026-11-24");
    expect(row(t, KNEWDEAL).firstAvailable).toBe("2026-12-19");
    expect(row(t, CHALLENGE).firstAvailable).toBe("2027-06-19");
  });

  test("번호는 신청 구간이 시작되는 순서", () => {
    const numbered = t.rows.filter((r) => r.order != null);
    expect(numbered.map((r) => r.order)).toEqual(numbered.map((_, i) => i + 1));
    const starts = numbered.map((r) => r.firstAvailable!);
    expect([...starts].sort()).toEqual(starts);
    expect(row(t, INCHEON).order).toBeLessThan(row(t, KNEWDEAL).order!);
    expect(row(t, KNEWDEAL).order).toBeLessThan(row(t, CHALLENGE).order!);
  });

  test("인천 응시료의 구간은 11/30 모집 마감에서 끝난다고 적는다", () => {
    expect(row(t, INCHEON).lastAvailable).toBe("2026-11-30");
    expect(row(t, INCHEON).summary).toContain("모집 마감");
  });

  test("달 중간에 열렸다 닫히는 구간도 그 달 칸에 보인다(K-뉴딜 12/19~12/31)", () => {
    // 11/24 기준 첫 칸은 11/24~12/23: 12/19 수료 뒤 구간이 이 칸 안에 있다
    expect(row(t, KNEWDEAL).cells[0]).toBe("ok");
  });

  test("사유에 내부 키(영어)가 드러나지 않는다", () => {
    for (const r of buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3 }).rows) expect(r.summary, r.name).not.toMatch(/unemployed|employed|in_training|business_registered/);
  });

  test("상태 변화로 새로 구간이 시작되는 미확인 정책도 줄에 뽑힌다", () => {
    // 수료 1개월 뒤(2027-01-19) 취업: 재직자 대상 '중소기업 계약학과'(~02-17 모집)가 그날부터 열린다
    const rows = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 1 }).rows;
    expect(rows.some((r) => !r.verified && r.firstAvailable === "2027-01-19")).toBe(true);
  });

  test("사람이 확인한 정책은 모두 줄로 나온다", () => {
    expect(t.rows.filter((r) => r.verified).length).toBe(6);
  });
});

describe("개월 수 조절", () => {
  test("수료 3개월 뒤 취업으로 가정하면 청년도전의 신청 구간이 없고, 이유가 적힌다", () => {
    const t = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3 });
    expect(t.events.map((e) => `${e.type}:${e.date}`)).toEqual(["training_completion:2026-12-19", "employment:2027-03-19"]);
    const c = row(t, CHALLENGE);
    expect(c.firstAvailable).toBeNull();
    expect(c.order).toBeNull();
    expect(c.summary.length).toBeGreaterThan(0);
  });

  test("수료 8개월 뒤 취업으로 가정하면 청년도전 구간은 6개월 뒤 시작해 취업일에 끝난다", () => {
    const c = row(buildTimeline(PERSONA_A, NOW, { employAfterMonths: 8 }), CHALLENGE);
    expect(c.firstAvailable).toBe("2027-06-19");
    expect(c.summary).toContain("2027-08-19");
    expect(c.summary).toContain("취업");
  });

  test("K-뉴딜은 취업을 가정한 날부터 구간이 끊긴다", () => {
    const t = buildTimeline(PERSONA_A, new Date("2026-11-24T12:00:00+09:00"), { employAfterMonths: 0 });
    // 수료일에 바로 취업: 미취업 구간이 없다
    expect(row(t, KNEWDEAL).firstAvailable).toBeNull();
  });

  test("수강 중이 아니면 기준은 오늘", () => {
    const p: Profile = { ...PERSONA_A, currentStatus: ["unemployed"], events: [] };
    const t = buildTimeline(p, NOW, { employAfterMonths: 2 });
    expect(t.events.map((e) => `${e.type}:${e.date}`)).toEqual(["employment:2027-01-24"]);
  });

  test("이미 재직 중이면 취업 가정은 무시한다", () => {
    const p: Profile = { ...PERSONA_A, currentStatus: ["employed"], events: [] };
    expect(buildTimeline(p, NOW, { employAfterMonths: 2 }).events).toEqual([]);
  });

  test("입력 프로필을 바꾸지 않고, 안내 문구에 우열·권유 표현이 없다", () => {
    const before = JSON.stringify(PERSONA_A);
    const t = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 3, businessAfterMonths: 6 });
    expect(JSON.stringify(PERSONA_A)).toBe(before);
    const text = [t.notice, ...t.rows.map((r) => r.summary), ...t.events.map((e) => e.label)].join("\n");
    expect(guardResponse(text, new Set())).toEqual({ ok: true });
  });
});

describe("달마다 넘겨 보는 시뮬레이션", () => {
  const t = buildTimeline(PERSONA_A, NOW, { employAfterMonths: 8 });
  const texts = (from: string, to: string) => t.moments.filter((m) => m.date >= from && m.date < to).map((m) => `${m.kind}:${m.text}`);

  test("달마다 그때의 상태 이름이 있다", () => {
    expect(t.stateLabels.length).toBe(13);
    expect(t.stateLabels[0]).toContain("수강 중");
    expect(t.stateLabels[1]).toBe("미취업"); // 12/24: 수료 뒤
    expect(t.stateLabels[12]).toContain("재직"); // 2027-11-24: 취업 뒤
  });

  test("일어나는 일은 날짜순이고, 삶의 사건과 정책의 열림·닫힘이 섞여 나온다", () => {
    expect(t.moments.map((m) => m.date)).toEqual([...t.moments.map((m) => m.date)].sort());
    expect(texts("2026-12-19", "2026-12-20").join(" ")).toContain("life:수료");
    expect(t.moments.some((m) => m.kind === "open" && m.policyId === KNEWDEAL && m.date === "2026-12-19")).toBe(true);
    expect(t.moments.some((m) => m.kind === "close" && m.policyId === KNEWDEAL && m.date === "2026-12-31")).toBe(true);
    expect(t.moments.some((m) => m.kind === "open" && m.policyId === CHALLENGE && m.date === "2027-06-19")).toBe(true);
    expect(t.moments.some((m) => m.kind === "close" && m.policyId === CHALLENGE && m.date === "2027-08-19")).toBe(true);
  });

  test("일어나는 일의 문구에도 우열·권유 표현이 없다", () => {
    expect(guardResponse([...t.moments.map((m) => m.text), ...t.stateLabels].join(" / "), new Set())).toEqual({ ok: true });
  });
});

describe("판정 요청의 plan", () => {
  test("개월 수를 실으면 타임라인에 반영된다", () => {
    const r = handleJudge({ profile: PERSONA_A, plan: { employAfterMonths: 3 } }, NOW);
    if (!("timeline" in r.body)) throw new Error("400");
    expect(r.body.timeline.events.some((e) => e.type === "employment" && e.date === "2027-03-19")).toBe(true);
  });
  test("범위를 벗어난 개월 수는 400", () => {
    expect(handleJudge({ profile: PERSONA_A, plan: { employAfterMonths: 13 } }, NOW).status).toBe(400);
    expect(handleJudge({ profile: PERSONA_A, plan: { employAfterMonths: -1 } }, NOW).status).toBe(400);
  });
});
