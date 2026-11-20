import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeSession, requestHash, verifySaved, type RequestSpec } from "../../scripts/overlap/gemini";

const req: RequestSpec = { model: "gemini-3.6-flash", stage: "extract", pass: 1, repair: 0, prompt: "공개 정책 원문" };
it("변경된 호출이나 투표를 같은 응답으로 재생하지 않는다", () => {
  const hashes = [req, { ...req, pass: 2 }, { ...req, repair: 1 }, { ...req, stage: "link" }, { ...req, prompt: "변경" }, { ...req, model: "gemini-3-flash-preview" }].map(r => requestHash(r as RequestSpec));
  expect(new Set(hashes).size).toBe(6);
});

it("일일 한도만 모델을 전환하고, 저장한 요청은 네트워크 없이 재생한다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gemini-call-"));
  let now = Date.parse("2026-11-20T12:00:00Z");
  const attempted: string[] = [];
  const options = { dir, runId: "t", inputs: { snapshotSha256: "s", researchSha256: "r", casesSha256: "c" }, now: () => now, sleep: async (ms:number) => { now += ms; } };
  try {
    const session = makeSession({ ...options, live: true, apiKey: "test", fetchFn: async url => {
      attempted.push(String(url));
      if (attempted.length === 1) return Response.json({error:{details:[{violations:[{quotaId:"GenerateRequestsPerDayPerProjectPerModel-FreeTier",quotaDimensions:{model:req.model}}]}]}},{status:429});
      if (attempted.length === 2) return Response.json({}, {status:503});
      return Response.json({ candidates:[{finishReason:"STOP",content:{parts:[{text:"[]"}]}}] });
    } });
    const saved = await session.ask(req);
    expect(saved.model).toBe("gemini-3-flash-preview");
    expect(attempted).toHaveLength(3);
    expect(attempted[1]).toBe(attempted[2]);
    const replay = makeSession({ ...options, live: false, fetchFn: async () => { throw Error("network"); } });
    expect(await replay.ask(req)).toEqual(saved);
    const file = JSON.parse(readFileSync(join(dir,"responses",saved.hash+".json"),"utf8"));
    expect(() => verifySaved({...file,body:{}},file)).toThrow();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
