import { loadSnapshot } from "@/lib/data/snapshot";
import { countSnapshot } from "@/lib/data/normalize";
const s = loadSnapshot();
console.log(s.asOf, JSON.stringify(countSnapshot(s.policies, new Date("2026-11-16T12:00:00+09:00"))));
