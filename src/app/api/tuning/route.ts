import { tuningStatus, runTuningJob } from "@/lib/server/tune-job";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handle(async () => tuningStatus());
}

export function POST() {
  return handle(async () => {
    void runTuningJob().catch(() => undefined);
    return { started: true };
  });
}
