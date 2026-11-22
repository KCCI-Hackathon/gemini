import { expect, it } from "vitest";
import { openDb } from "@/lib/db/sqlite";
import { SCHEMA_SQL } from "@/lib/db/schema";
import { RuleRowSchema, EvidenceRowSchema } from "@/lib/data/overlap-schema";
import { fixtureSources, tempRoot } from "./fixtures";

it("rejects invalid raw IDs, missing JSON keys, duplicate ordinals and foreign keys in SQL",()=>{
  const db=openDb(":memory:");
  try {
    db.exec(SCHEMA_SQL);
    db.prepare("INSERT INTO snapshot VALUES(?,?,?)").run("s","2026-11-16","hash");
    const add=db.prepare("INSERT INTO policy_raw VALUES('s',?,?,?)");
    const id="00000000000000000001";
    expect(()=>add.run(id,0,"{}")).toThrow();
    expect(()=>add.run(id,0,'{"plcyNo":"other"}')).toThrow();
    add.run(id,0,JSON.stringify({plcyNo:id}));
    expect(()=>add.run(id,1,JSON.stringify({plcyNo:id}))).toThrow();
    const b="00000000000000000002";
    expect(()=>add.run(b,0,JSON.stringify({plcyNo:b}))).toThrow();
    expect(()=>db.prepare("INSERT INTO verified_policy VALUES('s',?,'{}')").run(b)).toThrow();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {db.close();}
});
it("checks provenance, enums and reasons independently of human review",()=>{
  const s=fixtureSources(tempRoot()), r=s.rules[0],e=s.evidence[0];
  expect(RuleRowSchema.parse(r)).toEqual(r);
  for(const row of [{...r,source:"agent"}, {...r,judgement:"needs_check"}, {...r,source_policy_id:r.target_policy_id},
    {...r,kind:"partial"}, {...r,effect_type:"blocked"}, {...r,a_group_ids:[r.source_policy_id]}]) {
    expect(RuleRowSchema.safeParse(row).success).toBe(false);
  }
  expect(EvidenceRowSchema.safeParse({...e,source_kind:"official"}).success).toBe(false);
});
