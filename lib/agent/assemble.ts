// 실제 사용자 모드의 행동 카드: 검증 정책의 guidance를 코드가 조립한다. 외부 호출 없음.
import { loadVerified } from "@/lib/data/verified";
import type { JudgedPolicy } from "@/lib/judge";
import type { Transition, TransitionResult } from "@/lib/sim/transition";
import { CHANGE_LABEL } from "@/lib/sim/transition";

export type ActionCard = {
  policyId: string;
  name: string;
  confirmed: string[];
  checkNextInOrder: string[];
  rationale: string;
  quotes: string[];
  link: string | null;
};

const RECRUIT: Record<string, string> = {
  open: "모집 중",
  upcoming: "모집 예정",
  closed: "모집 종료",
  always: "상시 모집",
  unknown: "모집 기간 확인 필요",
};

export function assembleCards(results: JudgedPolicy[], transition: Transition | "none", changes?: TransitionResult[]): ActionCard[] {
  const verified = loadVerified();
  const changeById = new Map((changes ?? []).map((c) => [c.policyId, c]));
  return results
    .filter((r) => r.verified)
    .map((r) => {
      const v = verified.get(r.policy.id)!;
      const g = v.guidance.find((x) => x.transition === transition) ?? v.guidance.find((x) => x.transition === "none");
      const change = changeById.get(r.policy.id);
      const confirmed = [
        // 수료 예정일 경과 같은 안내는 펼치지 않아도 보이게 맨 앞에 둔다
        ...(r.axes.time.note ? [r.axes.time.note] : []),
        `모집: ${RECRUIT[r.axes.recruitment]}${v.apply.end ? ` (${v.apply.end}${v.apply.endTime ? ` ${v.apply.endTime}` : ""} 마감)` : ""}`,
        ...(v.referenceDate.status ? [`자격 기준 시점: ${v.referenceDate.status}`] : []),
        ...(change && change.change !== "unchanged" ? [`상태 변화 결과: ${CHANGE_LABEL[change.change]}`] : []),
      ];
      return {
        policyId: r.policy.id,
        name: v.name,
        confirmed,
        checkNextInOrder: g?.checkOrder ?? ["담당 기관 공고에서 자격 조건 확인"],
        rationale: g?.rationale ?? "",
        quotes: [...v.statusConditions.quotes.map((q) => q.text), ...r.axes.restriction.quotes],
        link: v.sources[0]?.url ?? null,
      };
    });
}
