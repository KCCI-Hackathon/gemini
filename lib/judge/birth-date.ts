import { toKstDate } from "@/lib/date";
import { isDate } from "@/lib/planner/dates";

/** A birth date is a date-only value, never a timestamp. */
export function isValidBirthDate(value: string, today = toKstDate(new Date())): boolean {
  return isDate(value) && value <= today;
}

export function birthYmForDate(value: string): string {
  return value.slice(0, 7);
}

export function isBirthPairConsistent(birthYm: string, birthDate?: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(birthYm) && (!birthDate || birthYmForDate(birthDate) === birthYm);
}
