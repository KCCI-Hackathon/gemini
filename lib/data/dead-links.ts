import deadLinksJson from "@/data/verified/dead-links.json";

type DeadEntry = { policyId: string; keep?: boolean; movedTo?: string };
type DeadLinks = { policies: DeadEntry[] };

const entries = () => (deadLinksJson as DeadLinks).policies;
let cache: Set<string> | null = null;

/** 공식 공고 링크가 모두 404/410 이고 옮겨진 공고도 못 찾은(keep 아님) 정책 번호 집합. 원본 스냅샷은 그대로 두고 화면에서만 숨긴다 */
export function loadDeadLinks(): Set<string> {
  if (!cache) cache = new Set(entries().filter(p => !p.keep).map(p => p.policyId));
  return cache;
}

/** 옮겨진 공고 주소를 찾아 둔 정책이면 그 주소 */
export function movedLink(policyId: string): string | null {
  return entries().find(p => p.policyId === policyId && p.keep && p.movedTo)?.movedTo ?? null;
}
