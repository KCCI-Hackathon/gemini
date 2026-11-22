// 정책 상세에서 여는 공고 · 신청 링크. 출처 수준이 다르므로 종류(kind)와 확인 여부(checked)를 함께 둔다.
import type { Policy } from "@/lib/data/types";
import type { Round, VerifiedPolicy } from "@/lib/data/verified";
import type { PolicyLink } from "./types";

const http = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try { const u = new URL(url.trim()); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; }
};

/**
 * 우선순위: ① 이 회차의 공고(검증 데이터) ② 검증 데이터의 공식 출처 ③ 온통청년 API 신청 링크 ④ API 참고 링크.
 * 회차가 있는 정책은 그 회차 공고만 준다. API 링크는 어느 회차인지 모르므로 다른 회차 공고를 가리킬 수 있어서 붙이지 않는다.
 */
export function policyLinks(p: Policy, v: VerifiedPolicy | undefined, round: Round | null): PolicyLink[] {
  if (round) {
    const url = http(round.notice.url);
    return url ? [{ url, kind: "notice", checked: round.status === "approved", checkedAt: round.notice.checkedAt }] : [];
  }
  const links: PolicyLink[] = [];
  const add = (link: PolicyLink | null) => { if (link && !links.some(l => l.url === link.url)) links.push(link); };
  const source = v?.sources[0];
  const official = http(source?.url);
  add(official ? { url: official, kind: "official", checked: v!.verificationStatus === "human_verified", checkedAt: source!.checkedAt } : null);
  for (const [raw, kind] of [[p.links.apply, "apply"], [p.links.ref, "ref"], [p.links.ref2, "ref"]] as const) {
    const url = http(raw);
    add(url ? { url, kind, checked: false, checkedAt: null } : null);
  }
  return links;
}
