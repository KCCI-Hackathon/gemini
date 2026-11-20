import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ClauseRowSchema, EvidenceRowSchema, PolicyIdSchema, ResearchSchema, RuleRowSchema, type Research, type ClauseRow } from "@/lib/data/overlap-schema";
import type { RawPolicy } from "@/lib/data/types";
import { sha, safeId } from "@/scripts/overlap/gemini";
import type { RunReport } from "@/scripts/overlap/score";

export const supportPaths = {
  regions: "data/regions.json", "route-links": "data/route-links.json",
  "verify-candidates": "data/verified/candidates.json", "verify-eval-answers": "data/verify-eval/answers.json",
  "verify-replay": "data/verify-replay/turns.json",
} as const;
export const snapshotPath = "data/snapshot/current.json";
export const artifactPaths = {
  snapshotSha256: snapshotPath, casesSha256: "data/overlap-agent/cases.json", researchSha256: "data/overlap-agent/research.json",
  rulesSha256: "data/overlap/rules.json", evidenceSha256: "data/overlap/evidence.json", clausesSha256: "data/overlap-agent/clauses.json",
} as const;
export type Sources = Research & {
  snapshot: {asOf: string; records: RawPolicy[]; fileSha256: string};
  verified: {policyId: string; json: Record<string, unknown>}[];
  results: Record<string, Record<string, unknown>>;
  supporting: Record<keyof typeof supportPaths, unknown>;
  clauses: ClauseRow[]; report: RunReport | null;
  files: Record<string,string>;
};
export function readJson<T>(root: string, path: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(readFileSync(join(root, path), "utf8")));
  } catch (error) { throw new Error(path + ": " + (error instanceof Error ? error.message : String(error))); }
}
const rawSchema = z.looseObject({plcyNo: PolicyIdSchema, plcyNm: z.string()});
const snapshotSchema = z.object({asOf:z.iso.date(), records:z.array(rawSchema).min(1)});
const verifiedSchema = z.looseObject({id:PolicyIdSchema, rounds:z.array(z.looseObject({id:z.string()})).optional()});
const resultsSchema = z.record(PolicyIdSchema,z.looseObject({policyId:PolicyIdSchema}));
export function readReport(root: string): RunReport | null {
  const pointer = "data/overlap-agent/latest.json";
  if (!existsSync(join(root,pointer))) return null;
  const id = safeId(readJson(root,pointer,z.object({run_id:z.string()})).run_id);
  const file = join(root,"data/overlap-agent","report-"+id+".md");
  if (!existsSync(file)) return null;
  const blocks = [...readFileSync(file,"utf8").matchAll(/^`{3}json\s*\r?\n([\s\S]*?)\r?\n`{3}\s*$/gm)];
  if (blocks.length !== 1) return null;
  try {
    const report: RunReport = JSON.parse(blocks[0][1]);
    return report && report.run_id === id ? report : null;
  } catch { return null; }
}

export function validateReferences(src: Pick<Sources,"snapshot"|"verified"|"evidence"|"rules"|"clauses">) {
  const policies = new Map(src.snapshot.records.map(p=>[p.plcyNo,p]));
  const rounds = new Map(src.verified.map(v=>[v.policyId,new Set(verifiedSchema.parse(v.json).rounds?.map(r=>r.id))]));
  const evidenceById = new Map(src.evidence.map(e=>[e.evidence_id,e]));
  const ruleIds = new Map<string, string[]>();
  for(const rule of src.rules) {
    const ids=ruleIds.get(rule.evidence_id)??[];
    ids.push(rule.rule_id); ruleIds.set(rule.evidence_id,ids);
  }
  for(const evidence of src.evidence) {
    const policy=policies.get(evidence.policy_id);
    const field=policy?.[evidence.source_field ?? ""];
    if(!policy || (evidence.round_id && !rounds.get(evidence.policy_id)?.has(evidence.round_id)) ||
        (evidence.source_kind==="api" && (typeof field!=="string" || !field.includes(evidence.quote_text)))) {
      throw Error("[evidence] "+evidence.evidence_id+" "+(ruleIds.get(evidence.evidence_id)??[]).join(","));
    }
  }
  for(const r of src.rules) {
    const ev=evidenceById.get(r.evidence_id), target=policies.get(r.target_policy_id);
    if (!ev || !target || ev.policy_id!==r.target_policy_id || !policies.has(r.source_policy_id) ||
        (r.target_round_id && !rounds.get(r.target_policy_id)?.has(r.target_round_id)) ||
        r.a_group_ids.some(id=>!policies.has(id))) throw Error("[rule references] "+r.rule_id+" "+r.evidence_id);
    const field=target[ev.source_field??""];
    if (r.source==="agent" && (ev.source_kind!=="api" || (r.verify_quote && (typeof field!=="string" || !field.includes(r.verify_quote))))) {
      throw Error("[verification quote] "+r.rule_id+" "+r.evidence_id);
    }
  }
  for(const c of src.clauses) {
    const field=policies.get(c.b_policy_id)?.[c.field];
    if(typeof field!=="string" || (c.a && !policies.has(c.a)) || (c.quote && !field.includes(c.quote)) ||
       (c.valid_quote === false && !!c.quote) || (c.verify_quote && !field.includes(c.verify_quote))) throw Error("[clause references] "+c.clause_id);
  }
}

export function readSources(root:string, mode:"merged"|"research-only"="merged"):Sources {
  const files: Record<string,string>={};
  const read = <T>(path:string,schema:z.ZodType<T>):T => {
    const bytes=readFileSync(join(root,path));
    files[path]=sha(bytes);
    try { return schema.parse(JSON.parse(bytes.toString("utf8"))); }
    catch(error) { throw Error(path+": "+(error instanceof Error?error.message:String(error))); }
  };
  const snapshot={...read(snapshotPath,snapshotSchema),fileSha256:files[snapshotPath]};
  const verified=readdirSync(join(root,"data/verified")).filter(p=>/^\d{20}\.json$/.test(p)).sort().map(file=>{
    const json=read("data/verified/"+file,verifiedSchema);
    if(file!==json.id+".json") throw Error("[verified ID] "+file);
    return {policyId:json.id,json};
  });
  const results=read("data/verify-results/index.json",resultsSchema);
  for(const [id,v] of Object.entries(results)) if(id!==v.policyId) throw Error("[result ID] "+id);
  const supporting=Object.fromEntries(Object.entries(supportPaths).map(([key,path])=>[key,read(path,z.unknown())])) as Sources["supporting"];
  const research=read(artifactPaths.researchSha256,ResearchSchema);
  const tableOne=research.rules.filter(r=>r.research_basis?.source_row.startsWith("표 1"));
  if(research.rules.some(r=>r.source!=="research") || new Set(tableOne.map(r=>r.source_policy_id+":"+r.target_policy_id)).size!==57) {
    throw Error("[research] 57개 조사 방향쌍 필요");
  }
  validateReferences({snapshot,verified,...research,clauses:[]});
  const haveMerged=Object.values(artifactPaths).slice(3).some(p=>existsSync(join(root,p)));
  const base={snapshot,verified,results,supporting,files};
  if(mode==="research-only" && !haveMerged) return {...base,...research,clauses:[],report:null};
  // Even research-only releases must detect broken references in a previous candidate.
  const rules=read(artifactPaths.rulesSha256,z.array(RuleRowSchema));
  const evidence=read(artifactPaths.evidenceSha256,z.array(EvidenceRowSchema));
  const clauses=read(artifactPaths.clausesSha256,z.array(ClauseRowSchema));
  validateReferences({snapshot,verified,rules,evidence,clauses});
  if(mode==="research-only") return {...base,...research,clauses:[],report:null};
  const researchPairs=new Set(research.rules.map(r=>r.source_policy_id+":"+r.target_policy_id));
  const mergedResearch=rules.filter(r=>r.source==="research");
  const byId=new Map(mergedResearch.map(r=>[r.rule_id,JSON.stringify(r)]));
  const evidenceById=new Map(evidence.map(e=>[e.evidence_id,JSON.stringify(e)]));
  if(mergedResearch.length!==research.rules.length || research.rules.some(r=>byId.get(r.rule_id)!==JSON.stringify(r)) ||
       research.evidence.some(e=>evidenceById.get(e.evidence_id)!==JSON.stringify(e)) ||
       rules.some(r=>r.source==="agent" && researchPairs.has(r.source_policy_id+":"+r.target_policy_id))) throw Error("[research] 병합본과 조사 원천 불일치");
  return {...base,rules,evidence,clauses,report:readReport(root)};
}
