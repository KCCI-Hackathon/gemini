import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildDb } from "@/lib/db/build";
import { openDb } from "@/lib/db/sqlite";
import { sha } from "@/scripts/overlap/gemini";
import { fixtureSources, tempRoot } from "./fixtures";

it("rebuilds deterministically and preserves original keys, empty strings and record order",()=>{
  const root=tempRoot(), path=join(root,"store.sqlite"), src=fixtureSources(root);
  const first=buildDb(src,path);
  expect(buildDb(src,path)).toEqual(first);
  expect(first.counts).toMatchObject({policies:3,rules:1,verified:1,supporting:5});
  const db=openDb(path,true);
  try {
    expect(db.prepare("SELECT raw_json FROM policy_raw ORDER BY ordinal").all().map(v=>JSON.parse(String(v.raw_json)))).toEqual(src.snapshot.records);
  } finally {db.close();}
});
it("on duplicate, missing target, bad quote or round preserves the old file",()=>{
  const root=tempRoot(), path=join(root,"store.sqlite"), src=fixtureSources(root);
  buildDb(src,path);
  const original=sha(readFileSync(path));
  const duplicate=structuredClone(src);duplicate.snapshot.records.push(duplicate.snapshot.records[0]);
  const missing=structuredClone(src);missing.rules[0].source_policy_id="00000000000000000110";
  const changed=structuredClone(src);changed.snapshot.records[1].ptcpPrpTrgtCn="새 공고";
  const round=structuredClone(src);round.rules[0].target_round_id="9999";
  for(const candidate of [duplicate,missing,changed,round]) {
    expect(()=>buildDb(candidate,path)).toThrow();
    expect(sha(readFileSync(path))).toBe(original);
    expect(readdirSync(root).some(f=>f.endsWith(".tmp"))).toBe(false);
  }
});
it.runIf(process.platform==="win32")("preserves DB when Windows holds the destination open",()=>{
  const root=tempRoot(), path=join(root,"store.sqlite"), src=fixtureSources(root);
  buildDb(src,path);
  const old=sha(readFileSync(path)), db=openDb(path);
  try {
    db.exec("BEGIN IMMEDIATE");
    expect(()=>buildDb(src,path)).toThrow(/\[replace\]/);
    expect(sha(readFileSync(path))).toBe(old);
  } finally {db.close();}
});
