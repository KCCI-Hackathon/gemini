import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { EvidenceRowSchema, ClauseRowSchema, RuleRowSchema } from "@/lib/data/overlap-schema";
import { sha } from "@/scripts/overlap/gemini";
import { openDb } from "./sqlite";
import { SCHEMA_SQL } from "./schema";
import { validateReferences, type Sources } from "./sources";

export const tableNames = {
  policies:"policy_raw", verified:"verified_policy", results:"verification_result", supporting:"supporting_data",
  rules:"policy_overlap_rule", evidence:"evidence", clauses:"agent_clause",
} as const;
export function readCounts(db:DatabaseSync) {
  return Object.fromEntries(Object.entries(tableNames).map(([key,table])=>[key,Number(db.prepare("SELECT COUNT(*) AS n FROM "+table).get()!.n)]));
}
type BuildReport={snapshotId:string; canonicalSha256:string; counts:Record<string,number>};
function insert(db:DatabaseSync,table:string,columns:string[]) {
  const stmt=db.prepare("INSERT INTO "+table+" ("+columns.join(",")+") VALUES ("+columns.map(()=>"?").join(",")+")");
  return (row:Record<string,SQLInputValue>)=>stmt.run(...columns.map(c=>row[c]));
}

export function buildDb(src:Sources,outPath:string):BuildReport {
  mkdirSync(dirname(outPath),{recursive:true});
  const tmp=outPath+"."+randomUUID()+".tmp";
  let db:DatabaseSync|undefined;
  try {
    db=openDb(tmp);
    db.exec(SCHEMA_SQL);
    db.exec("BEGIN");
    const id=src.snapshot.asOf;
    db.prepare("INSERT INTO snapshot VALUES(?,?,?)").run(id,id,src.snapshot.fileSha256);
    const raw=db.prepare("INSERT INTO policy_raw VALUES(?,?,?,?)");
    src.snapshot.records.forEach((p,i)=>raw.run(id,p.plcyNo,i,JSON.stringify(p)));
    const verified=db.prepare("INSERT INTO verified_policy VALUES(?,?,?)");
    for(const v of src.verified) verified.run(id,v.policyId,JSON.stringify(v.json));
    const result=db.prepare("INSERT INTO verification_result VALUES(?,?,?)");
    for(const [k,v] of Object.entries(src.results)) result.run(id,k,JSON.stringify(v));
    const support=db.prepare("INSERT INTO supporting_data VALUES(?,?,?)");
    for(const [k,v] of Object.entries(src.supporting)) support.run(id,k,JSON.stringify(v));
    for(const e of src.evidence) EvidenceRowSchema.parse(e);
    for(const r of src.rules) RuleRowSchema.parse(r);
    for(const c of src.clauses) ClauseRowSchema.parse(c);
    validateReferences(src);
    const addEvidence=insert(db,"evidence",["evidence_id","snapshot_id","policy_id","round_id","source_kind","source_field","source_url","quote_text","checked_at"]);
    for(const e of src.evidence) addEvidence({...e,snapshot_id:id});
    const addRule=insert(db,"policy_overlap_rule",["rule_id","snapshot_id","source_policy_id","target_policy_id","target_round_id","evidence_id","kind","effect_type","condition_type","condition_params_json","reference_event","exception_json","judgement","needs_check_reason","source","model","run_id","restricted_item","period_text","verify_verdict","verify_quote","a_group_ids","research_basis_json"]);
    for(const r of src.rules) {
      const {condition_params,exception,research_basis,a_group_ids,...rest}=r;
      addRule({...rest, snapshot_id:id, condition_params_json:JSON.stringify(condition_params),
        exception_json:exception===null?null:JSON.stringify(exception), research_basis_json:research_basis?JSON.stringify(research_basis):null,
        a_group_ids:JSON.stringify([...a_group_ids].sort())});
    }
    const clause=db.prepare("INSERT INTO agent_clause VALUES(?,?,?,?,?,?,?,?)");
    for(const c of src.clauses) clause.run(c.clause_id,c.run_id,id,c.b_policy_id,c.field,c.pass,c.response_hash,JSON.stringify(c));
    if(src.report) db.prepare("INSERT INTO agent_run VALUES(?,?)").run(src.report.run_id,JSON.stringify(src.report));
    const file=db.prepare("INSERT INTO source_file VALUES(?,?)");
    for(const [path,hash] of Object.entries(src.files)) file.run(path,hash);
    const restored=db.prepare("SELECT raw_json FROM policy_raw ORDER BY ordinal").all().map(row=>JSON.parse(String(row.raw_json)));
    const canonicalSha256=sha(JSON.stringify({asOf:id,records:src.snapshot.records}));
    if(sha(JSON.stringify({asOf:id,records:restored}))!==canonicalSha256) throw Error("[snapshot roundtrip] "+id);
    if(db.prepare("PRAGMA foreign_key_check").all().length || db.prepare("PRAGMA integrity_check").get()?.integrity_check!=="ok") throw Error("[integrity] "+tmp);
    const counts=readCounts(db);
    db.exec("COMMIT");
    db.close(); db=undefined;
    try { renameSync(tmp,outPath); } catch(error) {throw Error("[replace] "+outPath+": "+error);}
    return {snapshotId:id,canonicalSha256,counts};
  } finally {
    // Closing a live transaction rolls it back; the published DB has not been touched.
    try { db?.close(); } finally { rmSync(tmp,{force:true}); }
  }
}
