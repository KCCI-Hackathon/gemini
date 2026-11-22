import type { Card } from "./types";
const normalize = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, "");
export function matchesSearch(card: Card, query: string): boolean {
  const needle = normalize(query);
  return !needle || [card.title, card.org, card.support, card.summary].some(value => normalize(value).includes(needle));
}
