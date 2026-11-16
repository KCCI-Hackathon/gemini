import type { Profile } from "./types";

/** 시연 인물 가: 만 27세, 인천 연수구, 대학 졸업, 국비 교육과정 수강 중(12/19 수료 예정), 미취업 */
export const PERSONA_A: Profile = {
  birthYm: "1999-03",
  sigungu: "28185",
  school: "0049007",
  currentStatus: ["in_training", "unemployed"],
  interest: "job",
  events: [{ type: "training_completion", date: "2026-12-19", status: "scheduled" }],
  participating: [],
  source: "demo_persona",
};

export const PERSONAS = { "demo-1": PERSONA_A } as const;
export type PersonaId = keyof typeof PERSONAS;
