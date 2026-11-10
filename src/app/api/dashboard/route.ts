import { loadDashboard } from "@/lib/server/desk";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handle(() => loadDashboard(), 500);
}
