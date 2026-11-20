import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export const models = ["gemini-3.6-flash", "gemini-3-flash-preview"] as const;
export type ModelId = typeof models[number];
const Spec = z.object({
  model: z.enum(models), stage: z.enum(["extract","link","verify"]), pass: z.union([z.literal(1),z.literal(2)]),
  repair: z.union([z.literal(0),z.literal(1)]), prompt: z.string().min(1)
});
export type RequestSpec = z.infer<typeof Spec>;
const Saved = Spec.extend({ hash:z.string(),receivedAt:z.iso.datetime(),body:z.unknown(),responseSha256:z.string() });
export type SavedResponse = z.infer<typeof Saved>;
const StageResult = z.object({candidates:z.array(z.object({
  finishReason:z.literal("STOP"),content:z.object({parts:z.array(z.object({text:z.string().optional(),thought:z.boolean().optional()}))})
})).nonempty()});
export const sha = (s:string | Buffer) => createHash("sha256").update(s).digest("hex");
export const jsonBytes = (value:unknown) => JSON.stringify(value,null,2)+"\n";
export function writeAtomic(file:string,data:string) {
  mkdirSync(dirname(file),{recursive:true});
  const tmp=file+"."+randomUUID()+".tmp";
  try { writeFileSync(tmp,data,{flag:"wx"}); renameSync(tmp,file); }
  finally { rmSync(tmp,{force:true}); }
}
function restBody(prompt:string) {
  return {contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json"}};
}
export function requestHash(spec:RequestSpec) {
  return sha(JSON.stringify([spec.model,spec.stage,spec.pass,spec.repair,restBody(spec.prompt)]));
}
export function verifySaved(value:unknown, expected:{hash:string,model:string,stage:string}):SavedResponse {
  const row = Saved.parse(value);
  if (row.model!==expected.model || row.stage!==expected.stage || row.hash!==expected.hash || requestHash(row)!==row.hash ||
      sha(JSON.stringify(row.body))!==row.responseSha256) throw Error("저장 응답 해시 불일치 "+expected.hash);
  return row;
}
const Entry=z.object({model:z.enum(models),stage:Spec.shape.stage,hash:z.string(),logicalKey:z.string(),completed:z.boolean(),responseSha256:z.string().optional()});
const State=z.object({
  run_id:z.string(),startedAt:z.iso.datetime(),snapshotSha256:z.string(),casesSha256:z.string(),researchSha256:z.string(),
  requests:z.array(Entry), exhausted:z.record(z.string(),z.number()),complete:z.boolean(),lastCall:z.number()
});
export type RunState=z.infer<typeof State>;
export function safeId(id:string) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw Error("실행 ID 형식 오류");
  return id;
}
function nextPacificMidnight(ms:number) {
  const fmt=new Intl.DateTimeFormat("en-US",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"});
  const day=fmt.format(ms);
  let lo=Math.floor(ms/1000), hi=lo+26*3600;
  while (hi-lo>1) { const mid=Math.floor((lo+hi)/2); if (fmt.format(mid*1000)===day) lo=mid; else hi=mid; }
  return hi*1000;
}
function dailyExhausted(error:unknown,model:ModelId) {
  const payload=z.object({error:z.object({details:z.array(z.object({violations:z.array(z.object({
    quotaId:z.string().optional(),quotaMetric:z.string().optional(),quotaDimensions:z.object({model:z.string().optional()}).optional()
  })).optional()}))})}).safeParse(error);
  return payload.success && payload.data.error.details.some(d=>d.violations?.some(v=>
    (!v.quotaDimensions?.model || v.quotaDimensions.model===model) && /requests.*per.?day|requests.*daily/i.test([v.quotaId,v.quotaMetric].join(" "))));
}
type Options={dir:string,runId:string,inputs:Pick<RunState,"snapshotSha256"|"casesSha256"|"researchSha256">,
  live:boolean,apiKey?:string,fetchFn?:typeof fetch,now?:()=>number,sleep?:(ms:number)=>Promise<void>};
export function makeSession(o:Options) {
  const now=o.now??Date.now;
  const sleep=o.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
  const path=join(o.dir,"runs",safeId(o.runId)+".json");
  if(!o.live && !existsSync(path)) throw Error("재생할 실행 기록 없음: "+path);
  const state:RunState=existsSync(path)?State.parse(JSON.parse(readFileSync(path,"utf8"))):{
    ...o.inputs,run_id:o.runId,startedAt:new Date(now()).toISOString(),requests:[],exhausted:{},complete:false,lastCall:0
  };
  if(state.run_id!==o.runId || Object.entries(o.inputs).some(([k,v])=>state[k as keyof RunState]!==v)) throw Error("실행 입력 해시 불일치");
  const persist=()=>writeAtomic(path,jsonBytes(state));
  let cursor=0;
  async function ask(input:Omit<RequestSpec,"model">&{model?:ModelId}) {
    const spec=Spec.parse({...input,model:input.model??models[0]});
    const logicalKey=requestHash(spec);
    const recorded=state.requests[cursor];
    if(recorded && recorded.logicalKey!==logicalKey) throw Error("실행 순서 또는 프롬프트 변경 "+spec.stage+" "+logicalKey);
    let model=recorded?.model??spec.model;
    let retries=0;
    for(;;) {
      const hash=requestHash({...spec,model});
      const file=join(o.dir,"responses",hash+".json");
      if(recorded?.completed && recorded.hash!==hash) throw Error("실행 요청 불일치 "+hash);
      if(!o.live && (!recorded || recorded.hash!==hash || !existsSync(file))) throw Error("재생 응답 누락 "+spec.stage+" "+hash);
      if(!existsSync(file) && (state.exhausted[model]??0)>now()) {
        const alternative=models.find(m=>(state.exhausted[m]??0)<=now());
        if(alternative) { model=alternative; continue; }
        const resetAt=Math.min(...models.map(m=>state.exhausted[m]));
        console.error("Gemini 일일 한도 초기화 대기 "+new Date(resetAt).toISOString());
        await sleep(Math.max(0,resetAt-now()));
        model=models[0]; continue;
      }
      const entry={logicalKey,model,stage:spec.stage,hash,completed:false};
      if(o.live && !recorded?.completed) {state.requests[cursor]=entry;persist();}
      let saved:SavedResponse;
      if(existsSync(file)) {
        saved=verifySaved(JSON.parse(readFileSync(file,"utf8")),entry);
        if(recorded?.responseSha256 && saved.responseSha256!==recorded.responseSha256) throw Error("실행 응답 변경 "+hash);
      } else {
        if(recorded?.completed) throw Error("완료된 호출의 저장 응답 누락 "+hash);
        if(!o.apiKey) throw Error("GEMINI_API_KEY 설정 필요");
        const delay=state.lastCall+13000-now();
        if(delay>0) await sleep(delay);
        state.lastCall=now();persist();
        let res:Response|undefined, raw:string|undefined;
        try {
          res=await (o.fetchFn??fetch)("https://generativelanguage.googleapis.com/v1beta/models/"+model+":generateContent",{
            method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":o.apiKey},
            body:JSON.stringify(restBody(spec.prompt)),signal:AbortSignal.timeout(360000)
          });
          raw=await res.text();
        } catch { res=undefined; }
        if(res?.status===429) {
          let error:unknown; try {error=JSON.parse(raw!);} catch {}
          if(dailyExhausted(error,model)) {
            state.exhausted[model]=nextPacificMidnight(now());
            persist();
            console.error("Gemini 일일 한도 도달 "+model+" "+new Date(state.exhausted[model]).toISOString());
            continue;
          }
        }
        if(!res || [429,500,502,503,504].includes(res.status)) {
          const retryMs=60000*Math.min(10,2**Math.min(retries++,4));
          console.error("Gemini "+(res ? "HTTP "+res.status : "응답 없음")+" "+model+" "+spec.stage+
            " · 재시도 "+new Date(now()+retryMs).toISOString());
          await sleep(retryMs);
          continue;
        }
        if(!res.ok) throw Error("Gemini HTTP "+res.status+" "+model+" "+spec.stage+" "+hash);
        const body:unknown=JSON.parse(raw!);
        saved={...spec,model,hash,receivedAt:new Date(now()).toISOString(),body,responseSha256:sha(JSON.stringify(body))};
        writeAtomic(file,jsonBytes(saved));
      }
      const candidate=StageResult.parse(saved.body).candidates[0];
      const text=candidate.content.parts.filter(p=>!p.thought).map(p=>p.text??"").join("");
      if(!text.trim()) throw Error("빈 Gemini 응답 "+hash);
      if(o.live){ state.requests[cursor]={...entry,completed:true,responseSha256:saved.responseSha256};persist(); }
      cursor++;
      return {hash,model,text};
    }
  }
  return {state,ask,finish(complete:boolean) {
    if(cursor!==state.requests.length) throw Error("재생하지 않은 요청 존재");
    if(o.live){state.complete=complete;persist();}
    else if(state.complete!==complete) throw Error("재생 완료 상태 불일치");
  }};
}
