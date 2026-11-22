import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";
import { sha } from "@/scripts/overlap/gemini";
import { snapshotPath, type Sources } from "@/lib/db/sources";

const dirs:string[]=[];
afterEach(()=>{for(const p of dirs.splice(0)) rmSync(p,{force:true,recursive:true});});
export function tempRoot() {
  const dir=mkdtempSync(join(tmpdir(),"pathfinder-overlap-test-"));
  dirs.push(dir);
  return dir;
}
export function put(root:string,path:string,data:unknown) {
  const bytes=typeof data==="string"?data:JSON.stringify(data,null,2)+"\n";
  mkdirSync(dirname(join(root,path)),{recursive:true});
  writeFileSync(join(root,path),bytes);
  return sha(bytes);
}
export function fixtureSources(root:string):Sources {
  const a="00000000000000000001",b="00000000000000000002";
  const q="A 선정자는 지원금 제외";
  const snapshot={asOf:"2026-11-16",records:[
    {plcyNo:a,plcyNm:"A",empty:""},{plcyNo:b,plcyNm:"B",ptcpPrpTrgtCn:q},{plcyNo:"00000000000000000003",plcyNm:"C"},
  ]};
  const fileSha256=put(root,snapshotPath,snapshot);
  return {
    snapshot:{...snapshot,fileSha256},verified:[{policyId:b,json:{id:b,rounds:[{id:"2026"}]}}],results:{},
    supporting:{regions:{}, "route-links":[], "verify-candidates":[], "verify-eval-answers":[], "verify-replay":[]},
    evidence:[{evidence_id:"ev",policy_id:b,round_id:null,source_kind:"api",source_field:"ptcpPrpTrgtCn",source_url:null,quote_text:q,checked_at:"2026-11-19"}],
    rules:[{rule_id:"r",source_policy_id:a,target_policy_id:b,target_round_id:null,evidence_id:"ev",kind:"blocks",effect_type:"selection_excluded",
      condition_type:"selected",condition_params:{},reference_event:null,exception:null,judgement:"blocked",needs_check_reason:null,source:"research",model:null,
      run_id:null,restricted_item:null,period_text:null,verify_verdict:null,verify_quote:null,a_group_ids:[],
      research_basis:{source_row:"표 1 · 12행",url:"https://www.incheon.go.kr/faq",conclusion:"선정 시 제외"}}],
    clauses:[],report:null,files:{[snapshotPath]:fileSha256},
  };
}
