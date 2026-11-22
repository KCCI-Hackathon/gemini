// 회원가입의 "계획" 단계 답을 판정 입력(일정 · 현재 상태)으로 바꾼다.
import type { Profile } from "@/lib/judge/types";
import { isDate } from "./dates";
import type { PlanEvent } from "./types";

export type PlanAnswers = {
  training: boolean | null; courseEnd: string;
  job: "plan" | "none" | null; jobDate: string;
  move: boolean | null; moveDate: string; moveTo: string;
  startup: boolean | null; startupDate: string;
};
export const EMPTY_PLAN: PlanAnswers = { training: null, courseEnd: "", job: null, jobDate: "", move: null, moveDate: "", moveTo: "", startup: null, startupDate: "" };

type Result = { ok: true; events: PlanEvent[]; currentStatus: Profile["currentStatus"] } | { ok: false; field: keyof PlanAnswers; message: string };

/** 답이 빠졌거나 날짜가 오늘보다 앞서면 그 칸과 문구를 돌려준다. */
export function planFromAnswers(a: PlanAnswers, today: string): Result {
  const date = (field: keyof PlanAnswers, value: string, what: string): Result | null =>
    !isDate(value) ? { ok: false, field, message: `${what} 날짜를 골라 주세요.` }
      : value < today ? { ok: false, field, message: `${what} 날짜는 오늘(${today}) 이후로 골라 주세요.` } : null;
  if (a.training === null) return { ok: false, field: "training", message: "직업 훈련을 듣고 있는지 골라 주세요." };
  if (a.training) { const bad = date("courseEnd", a.courseEnd, "수료 예정"); if (bad) return bad; }
  if (a.job === null) return { ok: false, field: "job", message: "취업 계획이 있는지 골라 주세요." };
  if (a.job === "plan") { const bad = date("jobDate", a.jobDate, "취업 예정"); if (bad) return bad; }
  if (a.move === null) return { ok: false, field: "move", message: "이사 계획이 있는지 골라 주세요." };
  if (a.move) {
    const bad = date("moveDate", a.moveDate, "이사 예정"); if (bad) return bad;
    if (!a.moveTo) return { ok: false, field: "moveTo", message: "이사할 시·도와 시·군·구를 골라 주세요." };
  }
  if (a.startup === null) return { ok: false, field: "startup", message: "창업 계획이 있는지 골라 주세요." };
  if (a.startup) { const bad = date("startupDate", a.startupDate, "사업자 등록"); if (bad) return bad; }
  const events: PlanEvent[] = [
    ...(a.training ? [{ id: "ev-course", type: "training_completion" as const, date: a.courseEnd, status: "scheduled" as const }] : []),
    ...(a.job === "plan" ? [{ id: "ev-job", type: "employment" as const, date: a.jobDate, status: "scheduled" as const }] : []),
    ...(a.move ? [{ id: "ev-move", type: "relocation" as const, date: a.moveDate, status: "scheduled" as const, sigungu: a.moveTo }] : []),
    ...(a.startup ? [{ id: "ev-business", type: "business_registration" as const, date: a.startupDate, status: "scheduled" as const }] : []),
  ];
  // 현재 상태는 따로 묻지 않는다. 훈련 중이면 수강 중 · 미취업, 앞으로 취업할 계획이면 미취업으로 본다. 둘 다 아니면 모름(확인 필요).
  const currentStatus: Profile["currentStatus"] = a.training ? ["in_training", "unemployed"] : a.job === "plan" ? ["unemployed"] : [];
  return { ok: true, events, currentStatus };
}
