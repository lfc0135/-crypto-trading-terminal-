import { loadBook } from "@/lib/server/desk";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const instId = (new URL(request.url).searchParams.get("instId") ?? "BTC-USDT").toUpperCase();
  return handle(() => loadBook(instId), 502);
}
