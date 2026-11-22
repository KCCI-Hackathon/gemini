import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { buildDb } from "@/lib/db/build";
import { checkExport, exportApproved, writeExport } from "@/lib/db/export";
import { artifactPaths, readSources } from "@/lib/db/sources";
import { models, requestHash, sha, type RequestSpec, type RunState } from "@/scripts/overlap/gemini";
import { score, type RunReport } from "@/scripts/overlap/score";
import type { Counterexample } from "@/scripts/overlap/types";
import { fixtureSources, put, tempRoot } from "./fixtures";

function writeReport(root:string,report:RunReport) {
  put(root,"data/overlap-agent/report-"+report.run_id+".md","실행 보고서\n\n```json\n"+JSON.stringify(report)+"\n```\n");
}
function release() {
  const root=tempRoot(),src=fixtureSources(root), path=join(root,"db.sqlite"), id="run1";
  const create=(stage:RequestSpec["stage"],pass:1|2)=>{
    const spec={model:models[0],stage,pass,repair:0 as const,prompt:"fake "+stage};
    const hash=requestHash(spec),body={candidates:[{content:{parts:[{text:"[]"}]},finishReason:"STOP"}]};
    const responseSha256=sha(JSON.stringify(body));
    put(root,"data/overlap-agent/responses/"+hash+".json",{...spec,receivedAt:"2026-11-20T01:00:00.000Z",hash,body,responseSha256});
    return {hash,logicalKey:hash,model:spec.model,stage,completed:true,responseSha256};
  };
  const requests=[create("extract",1),create("extract",2),create("verify",1)];
  const r=src.rules[0],ev=src.evidence[0],text=ev.quote_text;
  const agentRule={...r,source_policy_id:src.snapshot.records[2].plcyNo,rule_id:"agent-r",run_id:id,source:"agent" as const,model:models[0],research_basis:undefined,
    judgement:"needs_check" as const,needs_check_reason:"확인 필요",verify_verdict:"insufficient" as const,verify_quote:text};
  src.rules.push(agentRule);
  src.clauses.push({clause_id:"good",run_id:id,b_policy_id:ev.policy_id,field:"ptcpPrpTrgtCn",quote:text,valid_quote:true,mention:"사업군",mention_type:"category",
    kind:"org_decides",pass:1,response_hash:requests[0].hash,verify_hash:requests[2].hash,verdict:"insufficient"});
  const cases=[{b:ev.policy_id,a:r.source_policy_id,phrase:text,expect_kind:["blocks" as const],source_row:"fixture"}];
  const casesSha256=put(root,artifactPaths.casesSha256,cases);
  const researchSha256=put(root,artifactPaths.researchSha256,{rules:[r],evidence:[ev]});
  const evidenceSha256=put(root,artifactPaths.evidenceSha256,src.evidence),rulesSha256=put(root,artifactPaths.rulesSha256,src.rules);
  const clausesSha256=put(root,artifactPaths.clausesSha256,src.clauses);
  const run:RunState={run_id:id,startedAt:"2026-11-20T01:00:00.000Z",snapshotSha256:src.snapshot.fileSha256,casesSha256,researchSha256,
    requests,exhausted:{},complete:true,lastCall:0};
  const runSha256=put(root,"data/overlap-agent/runs/"+id+".json",run);
  const checks=(["deduction","allowed","exception"] as Counterexample[]).map(type=>({claimId:type,counterexample:type,
    verdict:"contradicted" as const,validQuote:true,verify_quote:text,reason:"fixture",model:models[0],response_hash:requests[2].hash}));
  const report=score(cases,{rules:[agentRule],evidence:src.evidence,clauses:src.clauses},checks,run,
    [{first:[requests[0].hash],second:[requests[1].hash],complete:true}],{rulesSha256,evidenceSha256,clausesSha256,runSha256});
  for(const [key,p] of Object.entries(artifactPaths)) src.files[p]=report[key as keyof typeof artifactPaths];
  delete src.files[artifactPaths.casesSha256]; // Production builds retain cases as a report input.
  src.report=report;
  writeReport(root,report);
  put(root,"data/overlap-agent/latest.json",{run_id:id});
  buildDb(src,path);
  return {root,path,src,report,requests};
}
it("exports and verifies stable rule, notice and manifest bytes for the same run",()=>{
  const {root,path,src}=release();
  const first=exportApproved(path,root);
  expect(first.approved.rules.map(r=>r.rule_id)).toEqual(["agent-r","r"]);
  expect(first.approved.rules[0]).toMatchObject({target_round_id:null,judgement:"needs_check"});
  expect(first.approved.rules[1].research_basis).toEqual(src.rules[0].research_basis);
  expect(first.approved.notices).toEqual([{b:src.evidence[0].policy_id,field:"ptcpPrpTrgtCn",quote:src.evidence[0].quote_text}]);
  expect(JSON.stringify(first.approved)).not.toContain("response_hash");
  expect(checkExport(root,first.texts)).toHaveLength(2);
  expect(existsSync(join(root,"data/release/manifest.json"))).toBe(false);
  writeExport(root,first.texts);
  buildDb(src,path);
  expect(exportApproved(path,root)).toEqual(first);
  expect(checkExport(root,first.texts)).toEqual([]);
  put(root,"data/overlap/approved.json","changed");
  expect(checkExport(root,first.texts)).toEqual(["data/overlap/approved.json"]);
});
it.each(["failed","missing","latest","response","outputs","snapshot"] as const)("suppresses agent rules and notices when %s no longer matches",mode=>{
  const {root,path,src,report,requests}=release();
  if(mode==="failed"){
    report.falseBlocked=1;
    writeReport(root,report);
    buildDb(src,path);
  }else if(mode==="missing") rmSync(join(root,"data/overlap-agent/report-run1.md"));
  else if(mode==="latest") put(root,"data/overlap-agent/latest.json",{run_id:"run2"});
  else if(mode==="response") {
    const p="data/overlap-agent/responses/"+requests[0].hash+".json";
    const response=JSON.parse(readFileSync(join(root,p),"utf8"));
    response.body={candidates:[]};
    response.responseSha256=sha(JSON.stringify(response.body));
    put(root,p,response);
  }else if(mode==="outputs") put(root,artifactPaths.clausesSha256,[]);
  else {
    src.snapshot.records[0].plcyNm="수정된 원문";
    src.files[artifactPaths.snapshotSha256]=src.snapshot.fileSha256=put(root,artifactPaths.snapshotSha256,{asOf:src.snapshot.asOf,records:src.snapshot.records});
    buildDb(src,path);
  }
  const {approved}=exportApproved(path,root);
  expect(approved.rules.map(r=>r.rule_id)).toEqual(["r"]);
  expect(approved.notices).toEqual([]);
});
it("keeps a previous export if preparation of its replacement fails",()=>{
  const {root,path}=release(), {texts}=exportApproved(path,root);
  writeExport(root,texts);
  expect(()=>writeExport(root,{"data/overlap/approved.json":"replacement"})).toThrow();
  expect(checkExport(root,texts)).toEqual([]);
});

it("restores the research-only release in a clean directory from current source files",()=>{
  const root=tempRoot(),path=join(root,"data/db/pathfinder.sqlite");
  const src=readSources(process.cwd(),"research-only");
  for(const rel of Object.keys(src.files)) {
    mkdirSync(dirname(join(root,rel)),{recursive:true});
    cpSync(rel,join(root,rel));
  }
  const build=()=>buildDb(readSources(root,"research-only"),path);
  const a=build();
  const first=exportApproved(path,root);
  writeExport(root,first.texts);
  expect(build()).toEqual(a);
  expect(checkExport(root,exportApproved(path,root).texts)).toEqual([]);
  expect(first.approved.rules).toHaveLength(src.rules.length);
  expect(first.approved.rules.every(r=>r.source==="research")).toBe(true);
  expect(first.manifest.counts).toMatchObject({policies:4020,verified:6,results:6,supporting:5});
});
