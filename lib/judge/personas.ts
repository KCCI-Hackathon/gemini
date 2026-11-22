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

/** 화면에서 고르는 계획과 응시일을 제외한 시연 원본을 찾는다. */
export function findRegisteredPersona(profile: Profile): Profile | undefined {
  return Object.values(PERSONAS).find((base) =>
    profile.source === base.source && profile.birthYm === base.birthYm && profile.birthDate === base.birthDate &&
    profile.sigungu === base.sigungu && profile.school === base.school &&
    profile.recentHistory === base.recentHistory &&
    profile.currentStatus.length === base.currentStatus.length &&
    profile.currentStatus.every((status, index) => status === base.currentStatus[index]) &&
    profile.participating.length === base.participating.length &&
    profile.participating.every((id, index) => id === base.participating[index]) &&
    profile.events.length === base.events.length && profile.events.every((event, index) => {
      const registered = base.events[index];
      return event.type === registered.type && event.status === registered.status && event.date === registered.date;
    }),
  );
}
