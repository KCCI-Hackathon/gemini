import { describe, expect, test } from "vitest";
import { handleJudge } from "@/lib/judge/handler";
import { PERSONA_A } from "@/lib/judge/personas";
import { buildRoadmap, categoryOf } from "@/lib/route/roadmap";
import { buildTimeline } from "@/lib/route/timeline";

// 시연 인물: 수강 중, 2026-12-19 수료 예정
const NOW = new Date("2026-11-24T12:00:00+09:00");
const INCHEON = "20260406005400212445";
const KNEWDEAL = "20260714005400113258";
const CHALLENGE = "20250122005400110346";
const roadmap = (plan = {}) => buildRoadmap(buildTimeline(PERSONA_A, NOW, plan));
const row = (r: ReturnType<typeof roadmap>, id: string) => r.rows.find((x) => x.policyId === id)!;

describe("categoryOf: 온통청년 분류를 로드맵 분류 다섯 개로", () => {
  test.each([
    [{ large: "일자리", middle: "창업" }, "startup"],
    [{ large: "일자리,일자리", middle: "창업,취업" }, "startup"],
    [{ large: "일자리", middle: "취업" }, "job"],
    [{ large: "주거", middle: "기숙사" }, "housing"],
    [{ large: "교육･직업훈련", middle: "미래역량강화" }, "edu"],
    [{ large: "복지문화", middle: "건강" }, "life"],
    [{ large: "참여권리", middle: "청년참여" }, "life"],
  ] as const)("%o → %s", (c, want) => {
    expect(categoryOf(c)).toBe(want);
  });
});

describe("buildRoadmap: 타임라인을 대시보드 줄로 바꾼다", () => {
  const r = roadmap();

  test("줄의 순서와 정책은 타임라인과 같다", () => {
    const t = buildTimeline(PERSONA_A, NOW, {});
    expect(r.rows.map((x) => x.policyId)).toEqual(t.rows.map((x) => x.policyId));
    expect(r.months).toEqual(t.months);
  });

  test("사람이 확인한 정책은 공식 신청 기간과 공식 출처 링크를 쓴다", () => {
    const x = row(r, INCHEON);
    expect(x.official.end).toBe("2026-11-30");
    expect(x.verifyLabel).toBe("근거 확인 대기"); // 회차별 규칙, 조건별 사람 재확인 전
    expect(x.link?.kind).toBe("official");
    expect(x.status).toBe("ok");
    expect(x.statusLabel).toBe("조건 충족");
  });

  test("미확인 정책은 '조건상 해당'이라 하지 않고 API 링크로 표시한다", () => {
    const x = r.rows.find((y) => !y.verified && y.status === "ok")!;
    expect(x.statusLabel).toBe("코드 조건 충족(본문 미검토)");
    expect(x.verifyLabel).toBe("미검증(API)");
    if (x.link) expect(x.link.kind).toBe("api");
  });

  test("내 조건 구간은 달 칸의 열린 구간을 이은 것", () => {
    const k = row(r, KNEWDEAL);
    expect(k.windows[0].from).toBe(0);
    // 청년도전은 2027-06-19부터: 2027-05-24 ~ 06-23 칸(6번째)에서 시작
    const c = row(r, CHALLENGE);
    expect(c.windows[0].from).toBe(6);
  });

  test("가정한 수료·취업이 목표 표시로 들어가고 그 달의 칸 번호를 가진다", () => {
    const g = roadmap({ employAfterMonths: 1 }).goals;
    expect(g.map((x) => [x.type, x.date, x.monthIndex])).toEqual([
      ["training_completion", "2026-12-19", 0],
      ["employment", "2027-01-19", 1],
    ]);
  });

  test("지원 내용은 300자 이하로 줄인다", () => {
    for (const x of r.rows) expect(x.support.length).toBeLessThanOrEqual(300);
  });
});

test("handleJudge 응답에 로드맵이 들어간다", () => {
  const res = handleJudge({ profile: PERSONA_A, plan: { employAfterMonths: 2 } }, NOW);
  expect(res.status).toBe(200);
  const body = res.body as { roadmap: ReturnType<typeof roadmap> };
  expect(body.roadmap.goals.some((g) => g.type === "employment")).toBe(true);
});

test("회차별 규칙이 있는 K-뉴딜은 '근거 확인 대기'로 표시하고 조건별 근거를 싣는다", () => {
  const x = buildRoadmap(buildTimeline(PERSONA_A, NOW, {})).rows.find((r) => r.policyId === KNEWDEAL)!;
  expect(x.verifyLabel).toBe("근거 확인 대기");
  expect(x.evidence.length).toBe(3);
});

describe("검증 표시 네 가지(통합 설계 7.3)", () => {
  const fc = { field: "apply_period" as const, status: "match" as const, apiValue: "", noticeValue: "", quote: "q" };
  const saved = (policyId: string, confirmed: boolean) => ({
    policyId, mode: "agent" as const, outcome: "verified_against_notice" as const, noticeUrl: "https://x.go.kr", findings: [], mismatches: [], trail: [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, pagesOpened: 0 }, fieldChecks: [fc], notice: null, checkedAt: "2026-11-16",
    ...(confirmed ? { fieldChecksConfirmed: { by: "human" as const, at: "2026-11-18" } } : {}),
  });

  test("사람이 항목별 대조를 확인했으면 '공고 항목 확인됨', 아니면 'AI 대조(사람 미확인)'", async () => {
    const { withSavedResults } = await import("@/lib/verify/saved");
    const id = roadmap().rows.find((r) => !r.verified)!.policyId;
    let restore = withSavedResults({ [id]: saved(id, true) });
    try {
      expect(row(roadmap(), id).verifyLabel).toBe("공고 항목 확인됨");
    } finally {
      restore();
    }
    restore = withSavedResults({ [id]: saved(id, false) });
    try {
      expect(row(roadmap(), id).verifyLabel).toBe("AI 대조(사람 미확인)");
    } finally {
      restore();
    }
  });
});

describe("가정한 시점마다 새로 열리는 정책과 다시 확인할 정책", () => {
  test("취업(수료 1개월 뒤 = 2027-01-19)으로 새로 열리는 정책이 그 가정 표시에 모인다", () => {
    const r = roadmap({ employAfterMonths: 1 });
    const job = r.goals.find((g) => g.type === "employment")!;
    expect(job.opened.length).toBeGreaterThan(0);
    for (const id of job.opened) expect(row(r, id).firstAvailable).toBe("2027-01-19");
    expect(row(r, job.opened[0]).openedBy).toBe("취업");
  });

  test("수료(2026-12-19)로 판정이 바뀌는 K-뉴딜은 수료 표시의 '다시 확인'에 들어간다", () => {
    const done = roadmap().goals.find((g) => g.type === "training_completion")!;
    expect(done.changed).toContain(KNEWDEAL);
    expect(done.opened).not.toContain(KNEWDEAL);
  });
});
