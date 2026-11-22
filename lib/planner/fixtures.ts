import type { Profile } from "@/lib/judge/types";
import type { Offering, PlanEvent, Category, Rule, Restriction } from "./types";
export const DEMO_PROFILE: Profile = { birthYm: "2000-04", sigungu: "28185", school: "0049007", currentStatus: ["in_training", "unemployed"], interest: "job", events: [], participating: [], source: "demo_persona" };
// 취업 예정일은 시연 원본 수료일 + 정확히 1개월. /api/plan 이 개월 수로만 받으므로 이 격자 위에 있어야 AI 계획이 화면과 같은 날짜를 쓴다.
export const PERSONA_DEMO_EVENTS: PlanEvent[] = [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }, { id: "ev-job", type: "employment", date: "2027-01-19", status: "scheduled" }];
// 에이전트 패널 예시 버튼. 첫 줄은 위 취업 예정일을 +1개월(격자 위) 옮긴다.
export const AGENT_EXAMPLES = ["취업을 2월 19일로 옮겨줘", "왜 제 기한은 더 빠른가요?", "나에게 맞는 경로 추천해줘"] as const;
export const DEMO_EVENTS: PlanEvent[] = [{ id: "ev-course", type: "training_completion", date: "2026-12-19", status: "scheduled" }, { id: "ev-job", type: "employment", date: "2027-01-20", status: "scheduled" }];
const rule = (key: Rule["key"], kind: Rule["kind"] = "requires"): Rule => ({ key, kind, reviewed: true, evidenceId: "fixture-rule-1" });
export function demoCatalog(): Offering[] {
  const rows: [string, string, Category, string, string, string, Rule[]][] = [
    ["demo-search-2027-01", "수료생 구직 지원", "job", "구직 준비에 필요한 활동비를 지원해요", "2027-01-05", "2027-02-26", [rule("trained"), rule("unemployed")]],
    ["demo-job-voucher", "청년 취업 준비 바우처", "job", "면접·자격증 준비비 최대 30만 원", "2026-11-01", "2027-03-20", [rule("unemployed")]],
    ["demo-housing", "청년 월세 지원", "housing", "안정적인 시작을 위한 월세 지원", "2026-11-01", "2027-04-30", []],
    ["demo-edu", "배움 이어가기 장학금", "edu", "수료 뒤에도 이어지는 배움 지원", "2026-12-19", "2027-02-17", [rule("trained")]],
    ["demo-life", "청년 문화 패스", "life", "일상에 여유를 더하는 문화 활동비", "2026-11-01", "2026-12-15", []],
    ["demo-interview", "면접 정장 대여", "job", "첫 면접을 위한 정장 무료 대여", "2026-11-01", "2027-01-10", [rule("unemployed")]],
    ["demo-training", "디지털 역량 교육", "edu", "직무 역량을 키우는 실무 교육", "2026-11-01", "2026-12-18", [rule("in_training")]],
    ["demo-savings", "첫 월급 저축 지원", "life", "꾸준히 모으는 청년을 위한 매칭 지원", "2027-01-01", "2027-05-31", [rule("employed")]],
    ["demo-worker", "청년 근로자 교통비", "job", "매일의 출퇴근 부담을 덜어드려요", "2026-11-01", "2027-06-30", [rule("employed")]],
    ["demo-startup", "예비 창업 실험실", "startup", "아이디어를 검증하는 작은 시작", "2026-11-01", "2027-03-31", [rule("business_registered", "excludes")]],
    ["demo-rolling", "마음 건강 상담", "life", "필요한 때에 만나는 전문 상담", "2026-11-01", "", []],
    ["demo-budget", "자격증 응시료 지원", "edu", "응시료를 지원해 도전을 응원해요", "2026-11-01", "", []],
  ];
  return rows.map(([offeringId, title, category, support, start, end, rules]) => {
    const restrictions: Restriction[] = offeringId === "demo-job-voucher" ? [{ otherId: "demo-search-2027-01", reviewed: true, action: "application", direction: "both", period: null, otherPeriod: null, evidenceId: "fixture-conflict" }] : [];
    return { policyId: offeringId === "demo-search-2027-01" ? "demo-search" : offeringId, offeringId, title, category, roundLabel: "화면 검증용 가상 회차", summary: support, support, org: "Pathfinder 가상 지원센터", official: { kind: offeringId === "demo-rolling" ? "rolling" : offeringId === "demo-budget" ? "budget" : "fixed", start, end: end || null, closeAt: null }, rules, restrictions, reviewed: true, regions: offeringId === "demo-housing" ? ["28185"] : undefined, dataVersion: "fixture-1", evidence: [{ evidenceId: "fixture-rule-1", title: "시연용 자격 조건", quote: "이 데이터는 화면 검증을 위한 가상 정책입니다. 취업 전날까지 미취업 자격을 가정합니다.", url: null, reviewedAt: "2026-11-19", reviewed: true }, ...(restrictions.length ? [{ evidenceId: "fixture-conflict", title: "시연용 중복 신청 제한", quote: "수료생 구직 지원과 청년 취업 준비 바우처는 동일 계획에서 중복 신청할 수 없습니다.", url: null, reviewedAt: "2026-11-19", reviewed: true }] : [])] };
  });
}
