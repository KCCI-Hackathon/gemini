// 상담 에이전트에 보내는 내용. 프로필 객체를 인자로 받지 않으므로 사용자 정보가 들어갈 길이 없다(설계 7장).
import { judgeAll } from "@/lib/judge";
import { PERSONAS, type PersonaId } from "@/lib/judge/personas";
import { effectiveStatus } from "@/lib/judge/personal";
import { rankOpenQuestions, type Question } from "./questions";

const STATUS_LABEL: Record<string, string> = {
  in_training: "교육 수강 중",
  unemployed: "구직 중",
  employed: "재직 중",
  business_registered: "사업자등록",
};

export type AgentPayload = {
  personaId: PersonaId;
  stateLabel: string;
  policies: { id: string; name: string; personal: string; reasons: string[]; recruitment: string; quotes: string[] }[];
  questions: Question[];
};

export function buildAgentPayload(personaId: PersonaId, now: Date): AgentPayload {
  const profile = PERSONAS[personaId];
  if (!profile) throw new Error("가상 인물 번호만 쓸 수 있습니다.");
  const status = [...effectiveStatus(profile)];
  const stateLabel = ["in_training", "unemployed", "employed", "business_registered"].filter((k) => status.includes(k as never)).map((k) => STATUS_LABEL[k]).join(" · ");
  const results = judgeAll(profile, now).filter((r) => r.verified || r.axes.personal.value === "needs_check");
  return {
    personaId,
    stateLabel,
    policies: results
      .filter((r) => r.verified)
      .map((r) => ({ id: r.policy.id, name: r.policy.name, personal: r.axes.personal.value, reasons: r.axes.personal.reasons.filter((x) => !/지역|거주/.test(x)), recruitment: r.axes.recruitment, quotes: r.axes.restriction.quotes })),
    questions: rankOpenQuestions(results),
  };
}
