// 계정 API 한 곳(lib/account/router.ts). 함수가 나뉘면 저장소가 갈라지므로 계정 기능을 다른 경로로 나누지 않는다.
import { routeAccount } from "@/lib/account/router";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };
const handle = async (req: Request, { params }: Ctx) => routeAccount(req, (await params).path);
export { handle as GET, handle as POST, handle as PUT };
