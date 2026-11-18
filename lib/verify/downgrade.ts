// 항목별 대조 결과를 판정에 반영하는 규칙(통합 설계 5.3-4, 5.4).
// - 낮추기만 한다. 공고 값으로 판정을 바꾸거나 올리지 않는다.
// - API 값을 실제로 판정에 쓴 축만 낮춘다. 그 회차에 승인된 규칙이 있는 정책은 공고 문장으로 판정했으므로 낮추지 않고 참고로만 남긴다.
// - 대조한 공고가 승인된 회차와 다르면(새 회차) "다름"이 아니라 "올해 공고 기준 확인 중"으로 표시한다.
import type { Policy } from "@/lib/data/types";
import type { VerifiedPolicy } from "@/lib/data/verified";
import { pickRound } from "@/lib/judge/rules";
import type { FieldCheck, VerifyResult } from "./run";

export type FieldEffect = {
  /** 모집 축을 '기간 확인 필요'로 낮출 사유 */
  recruitment: string | null;
  /** 개인 조건 축에 더할 '확인 필요' 사유 */
  personal: string[];
  /** 판정에 영향 없이 근거 화면에 참고로만 보일 문구 */
  notes: string[];
  /** 새 회차 공고를 찾았을 때 */
  newRound: { text: string; url: string | null } | null;
};

const FIELD_NAME: Record<FieldCheck["field"], string> = {
  apply_period: "신청기간",
  biz_period: "사업기간",
  age: "연령 조건",
  region: "지역 조건",
  status_school_special: "취업상태·학력·특화 조건",
  income: "소득 조건",
  support: "지원 내용",
  extra_conditions: "추가 자격·참여 제한",
  apply_link: "신청 링크",
};

/** 승인 규칙이 없을 때 판정(API 코드 수준)에 쓰는 항목과 축 */
const PERSONAL_FIELDS: FieldCheck["field"][] = ["age", "region", "status_school_special", "income", "extra_conditions"];

export function fieldCheckEffect(result: VerifyResult, _policy: Policy, v: VerifiedPolicy | undefined, applyDate: string): FieldEffect {
  const out: FieldEffect = { recruitment: null, personal: [], notes: [], newRound: null };
  const differs = (result.fieldChecks ?? []).filter((f) => f.status === "differs");
  const pick = v?.rounds?.length ? pickRound(v.rounds, applyDate) : null;
  const approved = pick?.state === "approved" ? pick.round : null;

  if (approved && result.notice && result.notice.year !== approved.notice.year) {
    out.newRound = { text: "올해 공고 기준 확인 중", url: result.noticeUrl };
    return out;
  }
  for (const f of differs) {
    const name = FIELD_NAME[f.field];
    if (approved || v) {
      // 공고 문장(승인 규칙)으로 판정했다: API 값이 달라도 판정은 그대로
      out.notes.push(`API ${name}이 공고와 다름(참고)`);
      continue;
    }
    if (f.field === "apply_period") out.recruitment = "공고와 신청기간이 다릅니다";
    else if (PERSONAL_FIELDS.includes(f.field)) out.personal.push(`공고와 ${name}이 다릅니다`);
    else out.notes.push(`API ${name}이 공고와 다름(참고)`);
  }
  return out;
}
