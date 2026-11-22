import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readSources } from "@/lib/db/sources";
import { tempRoot } from "./fixtures";

it("reads 4,020 unique snapshot policies, supporting files and 57 researched table-one pairs",()=>{
  const s=readSources(process.cwd(),"research-only");
  expect(new Set(s.snapshot.records.map(r=>r.plcyNo)).size).toBe(4020);
  expect(s.snapshot.records).toHaveLength(4020);
  expect(s.verified).toHaveLength(6);
  expect(Object.keys(s.results)).toHaveLength(6);
  expect(Object.keys(s.supporting)).toHaveLength(5);
  expect(s.report).toBeNull();
  expect(s.rules.every(r=>r.source==="research")).toBe(true);
});
it("reports the offending rule path and rejects an incomplete merged candidate, including research-only mode",()=>{
  const root=tempRoot();
  for(const p of ["snapshot","verified","verify-results","verify-eval","verify-replay"]) {
    cpSync(join("data",p),join(root,"data",p),{recursive:true});
  }
  for(const p of ["regions.json","route-links.json","overlap-agent/research.json"]) {
    mkdirSync(join(root,"data","overlap-agent"),{recursive:true});
    cpSync(join("data",p),join(root,"data",p));
  }
  mkdirSync(join(root,"data/overlap"));
  writeFileSync(join(root,"data/overlap/rules.json"),'[{"effect_type":"invalid"}]');
  expect(()=>readSources(root,"research-only")).toThrow(/data\/overlap\/rules.json.*|effect_type/);
  writeFileSync(join(root,"data/overlap/rules.json"),"[]");
  expect(()=>readSources(root)).toThrow(/evidence.json/);
  const file=join(root,"data/overlap-agent/research.json");
  const research=JSON.parse(readFileSync(file,"utf8"));
  research.rules=[];
  writeFileSync(file,JSON.stringify(research));
  expect(()=>readSources(root,"research-only")).toThrow(/57/);
});
