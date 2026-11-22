import { readFileSync } from "node:fs";
import { expect,it } from "vitest";
import { z } from "zod";
import { CaseSchema, ResearchSchema } from "@/lib/data/overlap-schema";
import snapshot from "@/data/snapshot/current.json";
const read=(p:string)=>JSON.parse(readFileSync("data/overlap-agent/"+p+".json","utf8"));
it("조사 방향 57쌍과 모든 표의 사례가 스냅샷 원문에 있다",()=>{
  const research=ResearchSchema.parse(read("research")), cases=z.array(CaseSchema).parse(read("cases"));
  const rows=new Map(snapshot.records.map(p=>[p.plcyNo,p]));
  const table=research.rules.filter(r=>r.research_basis?.source_row.startsWith("표 1"));
  expect(new Set(table.map(r=>r.source_policy_id+":"+r.target_policy_id)).size).toBe(57);
  const lines=readFileSync("docs/backend/2026-11-19-demo-overlap.md","utf8").split(/\r?\n/);
  for(let i=11;i<=67;i++){
    const [, ,a,b]=lines[i-1].split("|");
    expect(table.some(r=>r.source_policy_id===a.match(/\d{20}/)?.[0] && r.target_policy_id===b.match(/\d{20}/)?.[0])).toBe(true);
  }
  for(const c of cases){
    expect(Object.values(rows.get(c.b)??{}).some(s=>String(s).includes(c.phrase))).toBe(true);
    if(c.source_row.startsWith("표 2")) {expect(c.a).toBeUndefined();expect(c.expect_link).toBe("none");}
  }
  for(const n of [...Array.from({length:29},(_,i)=>i+91),...Array.from({length:8},(_,i)=>i+129),...Array.from({length:8},(_,i)=>i+142),155,156])
    expect(cases.some(c=>c.source_row.endsWith(n+"행"))).toBe(true);
  expect(cases.filter(c=>c.source_row==="표 1 · 18행").length).toBeGreaterThanOrEqual(3);
  expect(cases.some(c=>c.mention==="주거급여" && c.expect_kind.includes("allowed"))).toBe(true);
});
