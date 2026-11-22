import { join } from "node:path";
import { buildDb } from "@/lib/db/build";
import { readSources } from "@/lib/db/sources";

try {
  const args=process.argv.slice(2);
  if(args.some(x=>x!=="--research-only")) throw Error("지원 옵션: --research-only");
  const root=process.cwd();
  const sources=readSources(root,args.includes("--research-only")?"research-only":"merged");
  console.log(JSON.stringify(buildDb(sources,join(root,"data/db/pathfinder.sqlite")),null,2));
} catch(error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode=1;
}
