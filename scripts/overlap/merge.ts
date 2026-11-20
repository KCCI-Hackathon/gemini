import type { Research,ClauseRow } from "@/lib/data/overlap-schema";

export type CandidateSet = Research & {clauses:ClauseRow[]};

export function merge(research:Research, agent:CandidateSet):CandidateSet {
  const pair=(r:Research["rules"][number])=>r.source_policy_id+":"+r.target_policy_id;
  const researched=new Set(research.rules.map(pair));
  const additions=agent.rules.filter(r=>!researched.has(pair(r)));
  const required=new Set(additions.map(r=>r.evidence_id));
  const evidence=[...research.evidence,...agent.evidence.filter(e=>required.has(e.evidence_id))];
  const rules=[...research.rules,...additions];
  if(new Set(rules.map(r=>r.rule_id)).size!==rules.length ||
    new Set(evidence.map(e=>e.evidence_id)).size!==evidence.length)
    throw Error("병합 자료에 중복 ID가 있습니다.");
  return {rules,evidence,clauses:agent.clauses};
}
