import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { type Case, type ClauseRow, VerdictSchema } from "@/lib/data/overlap-schema";
import type { CandidateSet } from "./merge";
import { models, type RunState } from "./gemini";
import type { Verification } from "./types";

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.int().nonnegative();
const request=z.object({hash,model:z.enum(models),stage:z.enum(["extract","link","verify"])});
const control=z.object({model:z.enum(models),type:z.enum(["deduction","allowed","exception"]),validQuote:z.boolean(),verdict:VerdictSchema,hash});
const proof=z.object({first:z.array(hash).nonempty(),second:z.array(hash).nonempty(),complete:z.boolean()});
const reportSchema=z.object({
  run_id:z.string().min(1), startedAt:z.iso.datetime(),snapshotSha256:hash,casesSha256:hash,researchSha256:hash,
  rulesSha256:hash,evidenceSha256:hash,clausesSha256:hash,runSha256:hash,
  requests:z.array(request).nonempty(),modelsUsed:z.array(z.enum(models)),controls:z.array(control),batches:z.array(proof).nonempty(),
  covered:count,total:count.min(1),falseBlocked:count,wrongTotal:count,wrongSupported:count,complete:z.boolean(),passed:z.boolean()
});
export type BatchProof=z.infer<typeof proof>;
export type RunReport=z.infer<typeof reportSchema> & {
  missed:string[],falseBlockedCases:string[],wrongLinks:string[],newPairs:Record<string,number>,
  correctSupported:{numerator:number,denominator:number},controlsContradicted:{numerator:number,denominator:number}
};
function hasProof(r: Omit<RunReport,"passed">) {
  if(!r.complete || !r.total || r.covered>r.total || r.falseBlocked || r.wrongSupported || r.wrongTotal!==3) return false;
  const refs=new Map(r.requests.map(e=>[e.hash,e]));
  const verified=new Set(r.requests.filter(q=>q.stage==="verify").map(q=>q.model));
  if(!verified.size || !r.batches.length) return false;
  const extractRuns=new Set<string>();
  for(const b of r.batches){
    const hashes=[...b.first,...b.second];
    if(!b.complete || !b.first.length || !b.second.length || hashes.some(h=>extractRuns.has(h)) ||
       new Set(hashes).size!==hashes.length || hashes.some(h=>refs.get(h)?.stage!=="extract") ||
       new Set(hashes.map(h=>refs.get(h)?.model)).size!==1) return false;
    hashes.forEach(h=>extractRuns.add(h));
  }
  if(r.controls.length!==verified.size*3) return false;
  return [...verified].every(model=>{
    const answers=r.controls.filter(c=>c.model===model);
    return answers.length===3 && new Set(answers.map(c=>c.type)).size===3 && answers.every(c=>
      c.validQuote && c.verdict!=="supported" && refs.get(c.hash)?.model===model && refs.get(c.hash)?.stage==="verify");
  });
}
export function reportPasses(value:RunReport):boolean {
  return reportSchema.safeParse(value).success && value.passed && hasProof(value);
}
const clean=(s:string)=>s.replace(/[\s·ㆍ]/g,"");
function mentions(a:string,b:string) {
  const x=clean(a),y=clean(b);
  return x.length>0 && y.length>0 && (x===y || (Math.min(x.length,y.length)>=2 && (x.includes(y)||y.includes(x))));
}
function subject(c:Case,r:ClauseRow,allowWrongLink=false) {
  if(r.b_policy_id!==c.b || !r.valid_quote || !r.quote) return false;
  if(c.a && c.a!==r.a) return false;
  if(c.mention && (!r.mention || !mentions(c.mention,r.mention))) return false;
  if(!allowWrongLink && c.expect_link==="none" && r.a) return false;
  return clean(r.quote).includes(clean(c.phrase)) || clean(c.phrase).includes(clean(r.quote)) ||
    (!!r.exception && clean(r.exception).includes(clean(c.phrase)));
}
function conditionMatches(c:Case,r:ClauseRow) {
  if(!c.condition) return true;
  return c.condition.type===(r.condition_type??null) && isDeepStrictEqual(c.condition.params,r.condition_params??{}) &&
    (c.condition.exception===undefined || c.condition.exception===!!r.exception);
}
function matches(c:Case,r:ClauseRow){
  const exceptionAllows=c.expect_kind.includes("allowed") && !!r.exception && clean(r.exception).includes(clean(c.phrase));
  return subject(c,r) && conditionMatches(c,r) && ((!!r.kind && c.expect_kind.includes(r.kind)) || exceptionAllows) &&
    (!c.expect_effect || r.effect_type===c.expect_effect) && (!c.expect_item || (!!r.restricted_item && mentions(c.expect_item,r.restricted_item))) &&
    (!c.expect_judgement || r.judgement===c.expect_judgement);
}
function dangerous(c:Case,r:ClauseRow){
  if(!subject(c,r,true) || r.judgement!=="blocked" || r.kind!=="blocks" || r.restricted_item) return false;
  if(c.expect_link==="none") return true;
  if(c.condition && r.condition_type && c.condition.type!==r.condition_type) return false;
  if(c.condition?.exception && r.exception && clean(r.exception).includes(clean(c.phrase))) return false;
  return c.expect_judgement==="needs_check" || !c.expect_kind.includes("blocks") || !!c.expect_item;
}
export function score(cases:Case[],agent:CandidateSet,checks:Verification[],run:RunState,batches:BatchProof[],
  hashes:Pick<RunReport,"rulesSha256"|"evidenceSha256"|"clausesSha256"|"runSha256">):RunReport {
  if(!cases.length || agent.rules.some(r=>r.source!=="agent" || r.run_id!==run.run_id) || agent.clauses.some(c=>c.run_id!==run.run_id)) throw Error("같은 실행의 에이전트 결과와 채점 사례가 필요합니다.");
  const refs=new Map(run.requests.filter(q=>q.completed).map(q=>[q.hash,q]));
  const traces=agent.clauses.filter(r=>refs.get(r.response_hash)?.stage==="extract" && r.verdict!=="contradicted");
  const missed:string[]=[], falseBlockedCases:string[]=[], wrongLinks:string[]=[];
  const correct=new Set<string>();
  cases.forEach((c,index)=>{
    const key=c.source_row+" #"+(index+1);
    const matching=traces.filter(r=>matches(c,r));
    matching.forEach(r=>correct.add(r.clause_id));
    if(!matching.length) missed.push(key);
    if(traces.some(r=>dangerous(c,r))) falseBlockedCases.push(key);
    if(c.expect_link==="none" && traces.some(r=>r.a && subject(c,r,true))) wrongLinks.push(key);
  });
  const controls=checks.flatMap(c=>c.counterexample?[{type:c.counterexample,model:c.model,verdict:c.verdict,validQuote:c.validQuote,hash:c.response_hash}]:[]);
  const known=new Set(cases.map(c=>c.a+":"+c.b)), newPairs:Record<string,number>={};
  const verified=checks.filter(c=>!c.counterexample && correct.has(c.claimId));
  for(const r of agent.clauses) if(r.a && !known.has(r.a+":"+r.b_policy_id) && r.verdict)
    newPairs[r.verdict]=(newPairs[r.verdict]??0)+1;
  const valid=checks.every(c=>refs.get(c.response_hash)?.stage==="verify" && refs.get(c.response_hash)?.model===c.model);
  const used=new Set(run.requests.filter(q=>q.stage==="verify").map(q=>q.model));
  const report:RunReport={
    run_id:run.run_id,startedAt:run.startedAt,snapshotSha256:run.snapshotSha256,researchSha256:run.researchSha256,casesSha256:run.casesSha256,
    ...hashes,requests:run.requests.map(({stage,model,hash})=>({stage,model,hash})),modelsUsed:[...new Set(run.requests.map(q=>q.model))],batches,controls,
    complete:run.complete && run.requests.every(q=>q.completed) && batches.length>0 && batches.every(b=>b.complete) &&
      valid && [...used].every(m=>new Set(controls.filter(c=>c.model===m && c.validQuote).map(c=>c.type)).size===3),
    covered:cases.length-missed.length,total:cases.length,falseBlocked:falseBlockedCases.length,wrongTotal:new Set(controls.map(c=>c.type)).size,
    wrongSupported:controls.filter(c=>c.verdict==="supported").length,missed,falseBlockedCases,wrongLinks,newPairs,passed:false,
    correctSupported:{numerator:verified.filter(c=>c.verdict==="supported" && c.validQuote).length,denominator:verified.length},
    controlsContradicted:{numerator:controls.filter(c=>c.verdict==="contradicted" && c.validQuote).length,denominator:controls.length}
  };
  report.passed=hasProof(report);
  return report;
}
