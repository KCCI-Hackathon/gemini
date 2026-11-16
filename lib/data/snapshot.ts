import snapshotJson from "@/data/snapshot/current.json";
import { normalize } from "./normalize";
import type { Policy, Snapshot } from "./types";

let cache: { asOf: string; policies: Policy[] } | null = null;

export function loadSnapshot(): { asOf: string; policies: Policy[] } {
  if (!cache) {
    const s = snapshotJson as unknown as Snapshot;
    cache = { asOf: s.asOf, policies: s.records.map(normalize) };
  }
  return cache;
}
