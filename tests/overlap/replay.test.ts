import { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect,it,vi } from "vitest";
import { runOverlap } from "@/scripts/overlap-agent";
import { buildDb } from "@/lib/db/build";
import { artifactPaths,readSources } from "@/lib/db/sources";
import { exportApproved } from "@/lib/db/export";
import { reportPasses } from "@/scripts/overlap/score";

it("재생은 저장 응답만 사용하고 빈 폴더에서 같은 점수·배포본을 만든다",async()=>{
  const temp=mkdtempSync(join(tmpdir(),"overlap-replay-"));
  const root=join(temp,"first"), copy=join(temp,"copy");
  function inputs(to:string){
    for(const p of ["snapshot","verified","verify-results","verify-eval","verify-replay","regions.json","route-links.json","overlap-agent/cases.json","overlap-agent/research.json"]){
      const dest=join(to,"data",p);
      mkdirSync(join(dest,".."),{recursive:true});cpSync(join("data",p),dest,{recursive:true});
    }
  }
  function release(to:string){
    const db=join(to,"data/db/test.sqlite");
    buildDb(readSources(to),db);
    return exportApproved(db,to);
  }
  try{
    inputs(root);inputs(copy);
    let now=Date.parse("2026-11-20T00:00:00Z");
    const fake=vi.fn<typeof fetch>(async (_url,options)=>{
      const prompt=JSON.parse(String(options?.body)).contents[0].parts[0].text as string;
      const data=JSON.parse(prompt.split("\n").at(-1)!);
      const b="20250122005400110346", field="ptcpPrpTrgtCn";
      const item=Array.isArray(data) && data.find(v=>v.b_policy_id===b && v.field===field);
      const quote="국민취업지원제도에 참여하여 수혜 중인 자";
      const rows=data.assertions
        ? data.assertions.map((a:{index:number,quote:string})=>({index:a.index,evidence_quote:a.quote,
          verdict:a.quote===quote?"supported":"contradicted",reason:"항목 확인"}))
        : item?[{b_policy_id:b,field,quote,mentions:[{text:"국민취업지원제도",org:null,type:"program"}],
          kind:"blocks",effect_type:"participation_block",condition_type:"receiving",condition_params:{},
          restricted_item:null,period_text:null,exception:null}]:[];
      return Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(rows)}]}}]});
    });
    const options={runId:"test-run",live:true,root,apiKey:"fixture",now:()=>now,sleep:async(ms:number)=>{now+=ms;},fetchFn:fake};
    const first=await runOverlap(options);
    expect(first.passed).toBe(true);expect(first.covered).toBeGreaterThan(0);
    expect(reportPasses(first)).toBe(true);
    expect(reportPasses({...first,controls:Array(3).fill(first.controls[0])})).toBe(false);
    expect(reportPasses({...first,requests:[...first.requests,{...first.requests.at(-1)!,model:"gemini-3-flash-preview"}]})).toBe(false);
    expect(reportPasses({...first,controls:first.controls.map((v,i)=>i?v:{...v,verdict:"supported"})})).toBe(false);
    expect(reportPasses({...first,batches:[]})).toBe(false);
    const original=release(root);
    for(const name of ["runs","responses"]) cpSync(join(root,"data/overlap-agent",name),join(copy,"data/overlap-agent",name),{recursive:true});
    const offline=vi.fn<typeof fetch>();
    const replay={root:copy,live:false,runId:options.runId,fetchFn:offline};
    expect(await runOverlap(replay)).toEqual(first);
    expect(release(copy).texts).toEqual(original.texts);
    for(const p of Object.values(artifactPaths)) expect(readFileSync(join(copy,p))).toEqual(readFileSync(join(root,p)));
    const response=join(copy,"data/overlap-agent/responses",first.requests[0].hash+".json");
    rmSync(response);
    await expect(runOverlap(replay)).rejects.toThrow(first.requests[0].hash);
    writeFileSync(join(copy,"data/overlap-agent/latest.json"),JSON.stringify({run_id:"later-failed"}));
    await expect(runOverlap(replay)).rejects.toThrow("최신 실행");
    expect(offline).not.toHaveBeenCalled();
  }finally{rmSync(temp,{recursive:true,force:true});}
},60000);
