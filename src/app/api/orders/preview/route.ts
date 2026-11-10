import { submitOrder } from "@/lib/server/desk";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handle(async () => submitOrder((await request.json()) as Record<string, unknown>, false));
}
