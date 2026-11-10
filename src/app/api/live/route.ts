import { confirmLive, revokeLive } from "@/lib/server/desk";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as { action?: string; phrase?: string };
    if (body.action === "revoke") return revokeLive();
    const result = await confirmLive(body.phrase ?? "");
    if (!result.ok) throw new Error(result.error);
    return result;
  });
}
