import { saveSettings } from "@/lib/server/desk";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function PUT(request: Request) {
  return handle(async () => {
    const body = await request.json();
    const result = await saveSettings(body);
    if (!result.ok) throw new Error(result.error);
    return result;
  });
}
