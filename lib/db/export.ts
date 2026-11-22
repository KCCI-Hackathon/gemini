import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ApprovedSchema, ClauseRowSchema, type Approved } from "@/lib/data/overlap-schema";
import { safeId, sha, verifySaved } from "@/scripts/overlap/gemini";
import { reportPasses, type RunReport } from "@/scripts/overlap/score";
import { artifactPaths, readJson, readReport, snapshotPath } from "./sources";
import { readCounts } from "./build";
import { openDb } from "./sqlite";

const bundlePath="data/overlap/approved.json";
const manifestPath="data/release/manifest.json";
type Manifest={dataVersion:string;snapshotAsOf:string;counts:Record<string,number>;files:Record<string,string>};
const outputText=(value:unknown)=>JSON.stringify(value,null,1)+"\n";

function passingRun(db:DatabaseSync,root:string,inputs:Record<string,string>):string|null {
  const stored=db.prepare("SELECT report_json FROM agent_run").get();
  if(!stored) return null;
  try {
    const report:RunReport=JSON.parse(String(stored.report_json));
    const current=readReport(root);
    if(JSON.stringify(current)!==JSON.stringify(report) || !reportPasses(report)) return null;
    for(const [key,path] of Object.entries(artifactPaths)) {
      const digest=report[key as keyof typeof artifactPaths];
      if((inputs[path] && inputs[path]!==digest) || sha(readFileSync(join(root,path)))!==digest) return null;
    }
    const runPath="data/overlap-agent/runs/"+safeId(report.run_id)+".json";
    const runBytes=readFileSync(join(root,runPath));
    if(sha(runBytes)!==report.runSha256) return null;
    const run=z.object({run_id:z.string(),complete:z.literal(true),incremental:z.literal(false).optional(),snapshotSha256:z.string(),researchSha256:z.string(),casesSha256:z.string(),
      requests:z.array(z.object({hash:z.string().regex(/^[0-9a-f]{64}$/),model:z.string(),stage:z.string(),completed:z.literal(true),responseSha256:z.string()})).min(1)
    }).parse(JSON.parse(runBytes.toString("utf8")));
    if(run.run_id!==report.run_id || run.snapshotSha256!==report.snapshotSha256 || run.casesSha256!==report.casesSha256 ||
       run.researchSha256!==report.researchSha256 || run.requests.length!==report.requests.length) return null;
    const stages=new Map<string,{stage:string;pass:1|2;repair:0|1}>();
    for(const [index,req] of run.requests.entries()) {
      const expected=report.requests[index];
      if(req.hash!==expected.hash || req.stage!==expected.stage || req.model!==expected.model) return null;
      const saved=verifySaved(readJson(root,"data/overlap-agent/responses/"+req.hash+".json",z.unknown()),req);
      if(req.responseSha256!==saved.responseSha256) return null;
      stages.set(req.hash,{stage:req.stage,pass:saved.pass,repair:saved.repair});
    }
    for(const b of report.batches) {
      for(const [pass,hashes] of [[1,b.first],[2,b.second]] as const) {
        if(hashes.length>2 || hashes.some((h,index)=>{
          const row=stages.get(h);
          return row?.stage!=="extract" || row.pass!==pass || row.repair!==index;
        })) return null;
      }
    }
    for(const {payload_json} of db.prepare("SELECT payload_json FROM agent_clause WHERE run_id=?").all(run.run_id)) {
      const c=ClauseRowSchema.parse(JSON.parse(String(payload_json)));
      const extraction=stages.get(c.response_hash);
      if(extraction?.stage!=="extract" || extraction.pass!==c.pass || (c.link_hash && stages.get(c.link_hash)?.stage!=="link") ||
         (c.verify_hash && stages.get(c.verify_hash)?.stage!=="verify")) return null;
    }
    return run.run_id;
  } catch { return null; }
}

export function exportApproved(dbPath:string,root:string):{approved:Approved;manifest:Manifest;texts:Record<string,string>} {
  const db=openDb(dbPath,true);
  try {
    const snap=db.prepare("SELECT snapshot_id,source_sha256 FROM snapshot").get();
    if(!snap) throw Error("[snapshot] DB 기준일 누락");
    const inputs=Object.fromEntries(db.prepare("SELECT path,sha256 FROM source_file ORDER BY path").all().map(row=>[String(row.path),String(row.sha256)]));
    if(inputs[snapshotPath]!==snap.source_sha256) throw Error("[snapshot] 원천 파일 해시 누락");
    const files:Record<string,string>={};
    for(const [path,digest] of Object.entries(inputs)) {
      // A changed agent artifact disables that run; a changed runtime source requires a new DB.
      if([artifactPaths.rulesSha256, artifactPaths.evidenceSha256, artifactPaths.clausesSha256].some(p=>p===path)) continue;
      if(sha(readFileSync(join(root,path)))!==digest) throw Error("[source changed] "+path+" · db:build 필요");
      if(path!==artifactPaths.researchSha256) files[path]=digest;
    }
    const runId=passingRun(db,root,inputs);
    const evidence=new Map(db.prepare("SELECT evidence_id, policy_id,round_id,source_kind,source_field,source_url,quote_text,checked_at FROM evidence").all().map(e=>[e.evidence_id,e]));
    const rows=db.prepare("SELECT * FROM policy_overlap_rule WHERE source='research' OR (source='agent' AND run_id=?) ORDER BY rule_id").all(runId);
    const rules=rows.map(row=>{
      const {snapshot_id,condition_params_json,exception_json,research_basis_json,a_group_ids,...r}=row;
      if(snapshot_id!==snap.snapshot_id) throw Error("[snapshot] "+r.rule_id);
      return {...r,condition_params:JSON.parse(String(condition_params_json)),exception:JSON.parse(String(exception_json)),
        ...(research_basis_json?{research_basis:JSON.parse(String(research_basis_json))}:{}),a_group_ids:JSON.parse(String(a_group_ids)),evidence:evidence.get(r.evidence_id)};
    });
    const notices=new Map<string,{b:string;field:import("@/lib/data/overlap-schema").Field;quote:string}>();
    for(const row of db.prepare("SELECT payload_json FROM agent_clause WHERE run_id=? ORDER BY b_policy_id,field,clause_id").all(runId)) {
      const c=ClauseRowSchema.parse(JSON.parse(String(row.payload_json)));
      if(!c.a && c.valid_quote && c.quote && c.kind && !["allowed","not_restriction"].includes(c.kind) && c.verdict!=="contradicted" &&
          (c.mention_type==="category" || c.mention_type==="law")) {
        const notice={b:c.b_policy_id,field:c.field,quote:c.quote};
        notices.set(JSON.stringify(notice),notice);
      }
    }
    const approved=ApprovedSchema.parse({snapshotId:snap.snapshot_id,rules,notices:[...notices.values()]});
    const bundled=outputText(approved);
    files[bundlePath]=sha(bundled);
    const sorted=Object.fromEntries(Object.keys(files).sort().map(p=>[p,files[p]]));
    const dataVersion=sha(Object.entries(sorted).map(([p,h])=>p+":"+h).join("\n")).slice(0,12);
    const manifest={dataVersion,snapshotAsOf:approved.snapshotId,counts:{...readCounts(db),approvedRules:rules.length},files:sorted};
    return {approved,manifest,texts:{[bundlePath]:bundled,[manifestPath]:outputText(manifest)}};
  } finally { db.close(); }
}

export function checkExport(root:string,texts:Record<string,string>):string[] {
  return Object.entries(texts).filter(([p,s])=>!existsSync(join(root,p)) || readFileSync(join(root,p),"utf8")!==s).map(([p])=>p);
}
export function writeExport(root:string,texts:Record<string,string>):void {
  mkdirSync(join(root,"data/db"),{recursive:true});
  const lock=openDb(join(root,"data/db/publish-lock.sqlite"));
  const files:{path:string;temp:string;previous:Buffer|null}[]=[];
  const written:typeof files=[];
  try {
    lock.exec("PRAGMA busy_timeout=10000; BEGIN EXCLUSIVE");
    for(const rel of [bundlePath,manifestPath]) {
      const path=join(root,rel);
      mkdirSync(dirname(path),{recursive:true});
      const temp=path+"."+randomUUID()+".tmp";
      const previous=existsSync(path)?readFileSync(path):null;
      files.push({path,temp,previous});
      writeFileSync(temp,texts[rel],{flag:"wx"});
    }
    for(const file of files) {
      renameSync(file.temp,file.path);
      written.push(file);
    }
  } catch(error) {
    for(const file of written.reverse()) {
      if(file.previous===null) rmSync(file.path);
      else { writeFileSync(file.temp,file.previous); renameSync(file.temp,file.path); }
    }
    throw error;
  } finally {
    try {for(const file of files) rmSync(file.temp,{force:true});} finally {lock.close();}
  }
}
