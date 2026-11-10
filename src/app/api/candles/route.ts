import { loadCandles } from "@/lib/server/desk";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  const url = new URL(request.url);
  const instId = (url.searchParams.get("instId") ?? "BTC-USDT").toUpperCase();
  const bar = url.searchParams.get("bar") ?? "15m";
  const limit = Number(url.searchParams.get("limit") ?? 240);
  return handle(() => loadCandles(instId, bar, limit), 502);
}
