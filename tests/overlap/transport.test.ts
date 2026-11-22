import { expect,it } from "vitest";
import { mkdtempSync,rmSync,readFileSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSession, reviewModels } from "@/scripts/overlap/gemini";

const req={stage:"extract",pass:1,repair:0,prompt:"공개 원문"} as const;
const success=()=>Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:"[]"}]}}]});
function runFixture(replies:(Response|null)[]){
  const dir=mkdtempSync(join(tmpdir(),"retry-"));
  let t=Date.parse("2026-11-20T18:00:00Z");
  const sends:{time:number,model:string}[]=[];
  const input={dir,inputs:{snapshotSha256:"s",casesSha256:"c",researchSha256:"r"},runId:"run",live:true,apiKey:"test",now:()=>t,
    sleep:async(ms:number)=>{t+=ms;},fetchFn:async(url:RequestInfo|URL,init?:RequestInit)=>{
      sends.push({time:t,model:String(url).split("/models/")[1].split(":")[0]});
      expect(init?.headers).toHaveProperty("x-goog-api-key","test");
      expect(JSON.parse(String(init?.body))).toEqual({contents:[{role:"user",parts:[{text:req.prompt}]}],generationConfig:{responseMimeType:"application/json"}});
      if(!replies.length) return new Response("",{status:400});
      const r=replies.shift(); if(!r)throw Error("network"); return r;
    }};
  return {dir,input,sends,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
it("종류 불명 429, 500 및 응답 없음은 같은 모델에서 간격을 늘린다",async()=>{
  const f=runFixture([Response.json({error:{}},{status:429}),new Response("",{status:500}),null,success(),success()]);
  try {
    const s=makeSession(f.input);
    await s.ask(req);await s.ask({...req,pass:2});
    expect(f.sends.map(s=>s.model)).toEqual(Array(5).fill("gemini-3.6-flash"));
    expect(f.sends.slice(1).map((s,i)=>s.time-f.sends[i].time)).toEqual([60000,120000,240000,13000]);
  }finally{f.cleanup();}
});
it.each([400,403,404])("HTTP %i는 즉시 종료한다",async status=>{
  const f=runFixture([new Response("",{status})]);
  try {await expect(makeSession(f.input).ask(req)).rejects.toThrow(String(status));expect(f.sends).toHaveLength(1);}finally{f.cleanup();}
});
it("두 모델의 일일 한도가 끝나면 태평양 자정에 첫 모델로 재개한다",async()=>{
  const daily=()=>Response.json({error:{details:[{violations:[{quotaId:"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}},{status:429});
  const f=runFixture([daily(),daily(),success()]);
  try {const result=await makeSession(f.input).ask(req);expect(result.model).toBe("gemini-3.6-flash");
    expect(f.sends.map(s=>s.model)).toEqual(["gemini-3.6-flash","gemini-3-flash-preview","gemini-3.6-flash"]);
    expect(new Date(f.sends[2].time).toISOString()).toBe("2026-11-21T08:00:00.000Z");
    const path=join(f.dir,"runs/run.json"), saved=JSON.parse(readFileSync(path,"utf8"));
    saved.requests[0].completed=false;delete saved.requests[0].responseSha256;writeFileSync(path,JSON.stringify(saved));
    expect(await makeSession(f.input).ask(req)).toEqual(result);expect(f.sends).toHaveLength(3);
  }finally{f.cleanup();}
});

it("재검증은 세 모델을 지정 순서로 사용하고 성공 요청 시간만 기록한다", async () => {
  const daily = () => Response.json({ error: { details: [{ violations: [{ quotaId: "GenerateRequestsPerDay" }] }] } }, { status: 429 });
  const f = runFixture([daily(), daily(), success()]);
  try {
    const s = makeSession({ ...f.input, fetchFn: async (...args) => {
      const response = await f.input.fetchFn(...args);
      await f.input.sleep(250);
      return response;
    } });
    expect((await s.ask({ ...req, stage: "verify" }, reviewModels)).model).toBe("gemini-3.8-flash");
    expect(f.sends.map(s => s.model)).toEqual([...reviewModels]);
    expect(s.state.requests[0].durationMs).toBe(250);
  } finally { f.cleanup(); }
});

it("분류되지 않은 429가 세 번 이어지면 일일 한도로 기록하지 않고 다음 검증 모델로 넘긴다", async () => {
  const limited = () => Response.json({}, { status: 429 });
  const f = runFixture([limited(), limited(), limited(), success()]);
  try {
    const s = makeSession({ ...f.input, compact: true });
    expect((await s.ask({ ...req, stage: "verify" }, reviewModels)).model).toBe(reviewModels[1]);
    expect(f.sends.map(s => s.model)).toEqual([reviewModels[0], reviewModels[0], reviewModels[0], reviewModels[1]]);
    expect(s.state.exhausted).toEqual({});
    expect(s.state.cooldown?.[reviewModels[0]]).toBeGreaterThan(f.sends[3].time);
    expect(s.state.attempts?.["verify:" + reviewModels[0]]).toEqual({ success: 0, failed: 3, retries: 2 });
    expect(s.state.attempts?.["verify:" + reviewModels[1]]).toEqual({ success: 1, failed: 0, retries: 0 });
  } finally { f.cleanup(); }
});
