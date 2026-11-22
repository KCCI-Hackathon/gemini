import { it, expect } from "vitest";
import { score, type RunReport } from "@/scripts/overlap/score";
import { merge } from "@/scripts/overlap/merge";
import { type Case,type ClauseRow,ResearchSchema } from "@/lib/data/overlap-schema";
import researchJson from "@/data/overlap-agent/research.json";
import type { RunState } from "@/scripts/overlap/gemini";

const research=ResearchSchema.parse(researchJson);
const r=research.rules[0],b=r.target_policy_id,a=r.source_policy_id;
const run:RunState={run_id:"one",startedAt:"2026-11-20T00:00:00.000Z",complete:true,exhausted:{},lastCall:0,
  snapshotSha256:"1".repeat(64),casesSha256:"2".repeat(64),researchSha256:"3".repeat(64),
  requests:[{stage:"extract",logicalKey:"q",model:"gemini-3.6-flash",hash:"4".repeat(64),completed:true}]};
const hashes={rulesSha256:"a".repeat(64),evidenceSha256:"b".repeat(64),clausesSha256:"c".repeat(64),runSha256:"d".repeat(64)};
const label="생계·의료급여 수급자(주거·교육급여 수급자는 신청 가능)";
const base:ClauseRow={clause_id:"x",run_id:"one",b_policy_id:b,a,field:"ptcpPrpTrgtCn",pass:1,response_hash:"4".repeat(64),valid_quote:true,quote:label,kind:"blocks",judgement:"blocked",mention:"생계급여"};
function grade(cases:Case[],clauses:ClauseRow[]):RunReport {return score(cases,{rules:[],evidence:[],clauses},[],run,[],hashes);}
const example:Case={b,a,mention:"주거급여",phrase:label,expect_kind:["allowed"],source_row:"표"};
it("다른 급여의 차단과 같은 급여의 잘못된 전체 차단을 구별한다",()=>{
  const yes:ClauseRow={...base,clause_id:"good",kind:"allowed",judgement:null,mention:"주거급여"};
  const bad:ClauseRow={...base,clause_id:"bad",mention:"주거급여"};
  expect(grade([example],[base,yes])).toMatchObject({covered:1,falseBlocked:0});
  expect(grade([example],[base,yes,bad])).toMatchObject({covered:1,falseBlocked:1,passed:false});
});
it("동일 추출에서 조건값과 항목이 맞아야 사례를 맞힌다",()=>{
  const ex:Case={...example,expect_kind:["partial"],expect_effect:"amount_deduction",expect_item:"월세",condition:{type:"within_months_after_end",params:{months:6}}};
  const line:ClauseRow={...base,kind:"partial",mention:"주거급여",judgement:"needs_check",condition_type:"within_months_after_end",effect_type:"amount_deduction",restricted_item:"월세"};
  expect(grade([ex],[{...line,condition_params:{months:5}},{...line,condition_params:{months:6},restricted_item:"장학금"}]).covered).toBe(0);
});
it("채점에 연구 규칙을 넣지 않으며 병합은 동일 쌍의 모든 조사 조건을 보존한다",()=>{
  const agent={evidence:[],rules:[{...r,rule_id:"agent-id",source:"agent" as const,run_id:"one"}],clauses:[]};
  expect(grade([example],[]).covered).toBe(0);
  expect(merge(research,agent).rules).toEqual(research.rules);
  expect(()=>score([example],{...agent,rules:research.rules},[],run,[],hashes)).toThrow();
});
