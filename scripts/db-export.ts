import { join } from "node:path";
import { checkExport, exportApproved, writeExport } from "@/lib/db/export";

try {
  const args=process.argv.slice(2);
  if(args.some(x=>x!=="--check")) throw Error("지원 옵션: --check");
  const root=process.cwd();
  const {texts,manifest}=exportApproved(join(root,"data/db/pathfinder.sqlite"),root);
  if(args.includes("--check")) {
    const paths=checkExport(root,texts);
    if(paths.length) throw Error("배포 파일 불일치: "+paths.join(", "));
    console.log(manifest.dataVersion,"배포 파일 일치");
  } else {
    writeExport(root,texts);
    console.log(manifest.dataVersion,manifest.counts.approvedRules,"규칙");
  }
} catch(error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode=1;
}
