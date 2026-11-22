import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ApprovedSchema, CaseSchema, ClauseRowSchema, ResearchSchema } from "@/lib/data/overlap-schema";
import { openDb } from "@/lib/db/sqlite";
import { artifactPaths, snapshotPath } from "@/lib/db/sources";
import { compareSnapshots, parseSnapshot } from "./compare-snapshots";
import { batchFields, screenPolicyIds, selectFields, selectRegion } from "./overlap/select";
import { extract, extractPair } from "./overlap/extract";
import { linkMentions } from "./overlap/link";
import { verifyClaims } from "./overlap/verify";
import { decide, needsReview } from "./overlap/decide";
import { merge } from "./overlap/merge";
import { score, type BatchProof } from "./overlap/score";
import { isScanModel, jsonBytes, makeSession, reviewModels, safeId, scanModel, sha, writeAtomic, type ScanModel } from "./overlap/gemini";
import type { Ask, Clause } from "./overlap/types";
import type { ClauseRow } from "@/lib/data/overlap-schema";

type AgentOptions = {root:string,live:boolean,runId?:string,scanWith?:ScanModel,previousSnapshot?:string} & Pick<Parameters<typeof makeSession>[0],"apiKey"|"fetchFn"|"now"|"sleep">;
export async function runOverlap(o:AgentOptions) {
  const dir=join(o.root,"data/overlap-agent");
  const read=(file:string)=>readFileSync(join(o.root,file));
  const snapshot=read(snapshotPath), casesFile=read(artifactPaths.casesSha256), researchFile=read(artifactPaths.researchSha256);
  const cases=z.array(CaseSchema).nonempty().parse(JSON.parse(casesFile.toString("utf8")));
  const research=ResearchSchema.parse(JSON.parse(researchFile.toString("utf8")));
  const records=z.array(z.looseObject({plcyNo:z.string().regex(/^\d{20}$/),plcyNm:z.string().min(1)})).nonempty().parse(JSON.parse(snapshot.toString("utf8")).records);
  const dbDir=join(o.root,"data/db");
  mkdirSync(dbDir,{recursive:true});
  const lock=openDb(join(dbDir,"overlap-run-lock.sqlite"));
  try {
    lock.exec("BEGIN EXCLUSIVE");
    const pointer=join(dir,"latest.json");
    const runId=safeId(o.runId??(o.live?randomUUID():existsSync(pointer)?JSON.parse(readFileSync(pointer,"utf8")).run_id:""));
    if(existsSync(pointer) && (!o.live || existsSync(join(dir,"runs",runId+".json"))) &&
      JSON.parse(readFileSync(pointer,"utf8")).run_id!==runId)
      throw Error("이전 실행은 별도 작업 폴더에서 재생하세요. 최신 실행을 보존합니다.");
    const inputs={snapshotSha256:sha(snapshot),casesSha256:sha(casesFile),researchSha256:sha(researchFile)};
    const path=join(dir,"runs",runId+".json");
    let candidateIds: string[] | undefined;
    if (o.live && !existsSync(path)) {
      const approved = ApprovedSchema.parse(JSON.parse(read("data/overlap/approved.json").toString("utf8")));
      const known = new Set(approved.rules.flatMap(rule => [rule.source_policy_id, rule.target_policy_id, ...rule.a_group_ids]));
      let changed: Set<string> | undefined;
      if (o.previousSnapshot) {
        const before = parseSnapshot(JSON.parse(readFileSync(o.previousSnapshot, "utf8")));
        const after = parseSnapshot(JSON.parse(snapshot.toString("utf8")));
        if (before.asOf !== approved.snapshotId || after.asOf < before.asOf)
          throw Error("이전 스냅샷과 배포 근거의 기준일이 맞지 않습니다.");
        changed = new Set(compareSnapshots(before, after, approved.rules).revalidatePolicyIds);
      }
      candidateIds = screenPolicyIds(records, known, changed);
    }
    const session=makeSession({...o,dir,inputs,runId,compact:true,candidateIds,incremental:!!o.previousSnapshot});
    const initialModel = session.state.requests[0]?.model;
    const legacy = !!initialModel && !isScanModel(initialModel);
    const scanner = isScanModel(initialModel) ? initialModel : o.scanWith ?? scanModel;
    const fields = selectFields(records, !legacy);
    const selected = session.state.candidateIds ? new Set(session.state.candidateIds) : undefined;
    const scanned = selected ? fields.filter(field => selected.has(field.b_policy_id)) : fields;
    const batches = batchFields(scanned, session.state.compact ? 12000 : 6000), region = legacy ? selectRegion(records) : records;
    if(!batches.length) throw Error("중복수혜 검증 대상 정책이 없습니다.");
    const ask: Ask = legacy ? session.ask : req => req.stage === "verify"
      ? session.ask(req, reviewModels)
      : session.ask({ ...req, model: scanner }, [scanner]);
    const votes:[Clause[],Clause[]]=[[],[]],proofs:BatchProof[]=[],failures:ClauseRow[]=[];
    if(o.live) writeAtomic(pointer,jsonBytes({run_id:runId}));
    for(const batch of batches){
      const pair=legacy ? await extractPair(batch,ask) : [await extract(batch,1,ask,undefined,session.state.compact)];
      proofs.push({first:pair[0].hashes,second:pair[1]?.hashes ?? [],complete:pair.every(x=>x.complete)});
      pair.forEach((result,i)=>{
        votes[i].push(...result.clauses);
        for(const f of result.failures) {
          if(!f.b_policy_id || !f.field) continue;
          const location=f.response_hash+":"+f.index;
          failures.push({clause_id:"error-"+location,run_id:runId,b_policy_id:f.b_policy_id,field:f.field,
            pass:f.pass,response_hash:f.response_hash,valid_quote:false,error_location:location,reason:f.reason});
        }
      });
    }
    const first=await linkMentions(votes[0],region,ask);
    const second=legacy ? await linkMentions(votes[1],region,ask) : [];
    const sourceByPolicy = new Map(region.map(policy => [policy.plcyNo, policy]));
    const review = legacy ? [...first, ...second] : first.filter(vote =>
      needsReview(vote, String(sourceByPolicy.get(vote.clause.b_policy_id)?.[vote.clause.field] ?? "")));
    const checks=await verifyClaims(review,fields,ask);
    const agent=decide(first,second,checks,region,session.state,!legacy);
    agent.clauses.push(...failures);
    const merged=merge(research,agent);
    ResearchSchema.parse({rules:merged.rules,evidence:merged.evidence});
    z.array(ClauseRowSchema).parse(merged.clauses);
    session.finish(proofs.every(p=>p.complete));
    const rules=jsonBytes(merged.rules),evidence=jsonBytes(merged.evidence),clauses=jsonBytes(merged.clauses);
    const report=score(cases,agent,checks,session.state,proofs,{rulesSha256:sha(rules),evidenceSha256:sha(evidence),clausesSha256:sha(clauses),runSha256:sha(readFileSync(path))});
    const fence=String.fromCharCode(96).repeat(3);
    const markdown=["# 중복수혜 에이전트 실행 보고","",report.passed?"평가 통과":"평가 미통과",
      "", "에이전트 단독 채점 "+report.covered+"/"+report.total+"건, 확정 오판 "+report.falseBlocked+"건, 반례 지지 "+report.wrongSupported+"건.",
      "",fence+"json",jsonBytes(report).trimEnd(),fence,""].join("\n");
    for(const [file,bytes] of [[artifactPaths.rulesSha256,rules],[artifactPaths.evidenceSha256,evidence],[artifactPaths.clausesSha256,clauses]])
      writeAtomic(join(o.root,file),bytes);
    writeAtomic(join(dir,"report-"+runId+".md"),markdown);
    writeAtomic(pointer,jsonBytes({run_id:runId}));
    return report;
  } finally {lock.close();}
}

async function main(){
  const {values}=parseArgs({options:{live:{type:"boolean"},replay:{type:"boolean"},"run-id":{type:"string"},"previous-snapshot":{type:"string"}}});
  if(values.live && values.replay) throw Error("--live와 --replay 중 하나를 선택하세요.");
  if(!values.live && !values["run-id"] && !existsSync("data/overlap-agent/latest.json"))
    throw Error("재생할 중복수혜 실행이 없습니다. 연구본은 npm run db:build -- --research-only 로 적재할 수 있습니다.");
  if(values.live && existsSync(".env.local")) process.loadEnvFile(".env.local");
  if(values.live && !process.env.GEMINI_API_KEY) throw Error("라이브 실행에 GEMINI_API_KEY가 필요합니다.");
  const scanner = process.env.OVERLAP_SCAN_MODEL;
  if (scanner && !isScanModel(scanner)) throw Error("OVERLAP_SCAN_MODEL은 2.5 또는 3.5 Flash-Lite여야 합니다.");
  const r=await runOverlap({root:process.cwd(),live:!!values.live,runId:values["run-id"],apiKey:values.live?process.env.GEMINI_API_KEY:undefined,
    scanWith: isScanModel(scanner) ? scanner : undefined, previousSnapshot:values["previous-snapshot"]});
  console.log(JSON.stringify({run_id:r.run_id,complete:r.complete,passed:r.passed,covered:r.covered,total:r.total,falseBlocked:r.falseBlocked,wrongSupported:r.wrongSupported}));
  if(!r.passed) process.exitCode=2;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
