import { clearSwitch } from "@/lib/server/desk";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handle(async () => {
    const body = (await request.json()) as { which?: string };
    if (body.which !== "daily" && body.which !== "drawdown") throw new Error("Unknown switch.");
    const result = await clearSwitch(body.which);
    if (!result.ok) throw new Error(result.error);
    return result;
  });
}
