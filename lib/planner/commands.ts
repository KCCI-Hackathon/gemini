import { isDate } from "./dates";
import type { PlanEvent, Card, Evaluation, Choice } from "./types";
import { regionOptions } from "@/lib/data/regions";
export type AgentCommand = { type: "update_event"; eventId: string; date: string } | { type: "add_event"; eventType: PlanEvent["type"]; date: string; sigungu?: string } | { type: "clarify"; message: string } | { type: "locate_card" } | { type: "recommend" } | { type: "undo" } | { type: "explain" };
export function parseScheduleCommand(text: string, events: PlanEvent[]): AgentCommand {
  if (/되돌|취소해/.test(text)) return { type: "undo" };
  if (/담아|담기|추가해/.test(text) && !/일정|시점/.test(text)) return { type: "locate_card" };
  if (/추천/.test(text)) return { type: "recommend" };
  const eventType = /이사/.test(text) ? "relocation" : /취업/.test(text) ? "employment" : /수료/.test(text) ? "training_completion" : /창업|사업자/.test(text) ? "business_registration" : null;
  if (/왜|기한|같이|중복|근거/.test(text) && !/옮겨|바꿔|예정/.test(text)) return { type: "explain" };
  if (!eventType) return { type: "clarify", message: "수료·취업·창업·이사 중 어떤 일정을 바꿀까요?" };
  const existing = events.filter(e => e.type === eventType);
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  const korean = /(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일/.exec(text);
  const year = iso?.[1] ?? korean?.[1] ?? (existing.length === 1 ? existing[0].date.slice(0, 4) : null);
  const month = iso?.[2] ?? korean?.[2]; const day = iso?.[3] ?? korean?.[3];
  if (!month || !day) return { type: "clarify", message: "정확한 날짜를 알려 주세요. 일정의 날짜 칩을 눌러 달력에서도 고를 수 있어요." };
  if (!year) return { type: "clarify", message: "몇 년의 일정인가요? 연도와 월·일을 함께 알려 주세요." };
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  if (!isDate(date)) return { type: "clarify", message: "달력에 없는 날짜예요. 날짜를 다시 알려 주세요." };
  if (eventType === "relocation") {
    const compact = text.replace(/\s/g, "");
    const matching = regionOptions().filter(r => compact.includes(r.label.replace(/\s/g, "")));
    if (matching.length === 1) {
      const repeat = existing.find(e => e.date === date && e.sigungu === matching[0].code);
      if (repeat) return { type: "update_event", eventId: repeat.id, date };
      return { type: "add_event", eventType: "relocation", date, sigungu: matching[0].code };
    }
    return { type: "clarify", message: `이사할 시·군·구를 알려 주세요. ${date} 날짜는 기억해 둘게요. 예: 서울 강남구` };
  }
  if (existing.length === 1) return { type: "update_event", eventId: existing[0].id, date };
  if (existing.length > 1) return { type: "clarify", message: "어느 일정을 바꿀까요? 위의 일정 칩에서 선택해 주세요." };
  return { type: "add_event", eventType, date };
}

export function parseScheduleTurn(text: string, events: PlanEvent[], pending: string | null = null): { command: AgentCommand; pending: string | null } {
  const continuing = pending && !/이사|취업|수료|창업|사업자|추천|되돌|담아/.test(text);
  const combined = continuing ? `${pending} ${text}` : text;
  const year = /\b(20\d{2})년/.exec(text)?.[1];
  const source = continuing && year && !/20\d{2}[년-]/.test(pending!) ? `${year}년 ${combined}` : combined;
  const command = parseScheduleCommand(source, events);
  return { command, pending: command.type === "clarify" ? source : null };
}
export function findNamedCards(text: string, evaluation: Evaluation, choices: Choice[]): Card[] {
  const compact = text.replace(/\s/g, "");
  const matches = evaluation.cards.filter(c => compact.includes(c.title.replace(/\s/g, "")) || c.title.split(/\s+/).some(token => token.length >= 2 && !["지원", "청년", "정책"].includes(token) && compact.includes(token)));
  const ids = [...new Set(matches.map(c => c.offeringId))];
  return ids.map(id => matches.find(c => c.offeringId === id && choices.some(p => p.offeringId === id && p.stageId === c.stageId)) ?? matches.find(c => c.offeringId === id && c.availability !== "blocked") ?? matches.find(c => c.offeringId === id)!);
}
