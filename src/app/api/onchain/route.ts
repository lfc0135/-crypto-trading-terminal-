import { normalizeConfig, presetPatch } from "@/lib/onchain/momentum";
import { onchainPublic } from "@/lib/onchain/model";
import { readOnchain, writeOnchain } from "@/lib/onchain/store";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handle(async () => onchainPublic(readOnchain()), 500);
}

export function POST(request: Request) {
  return handle(async () => {
    const body = await request.json() as { preset?: string };
    const patch = presetPatch(String(body.preset ?? ""));
    if (!patch) throw new Error("Unknown paper preset.");
    const state = readOnchain();
    if (!(state.principal > 0)) throw new Error("The sleeve has not reserved cash yet.");
    state.config = normalizeConfig({ ...state.config, ...patch });
    writeOnchain(state);
    return onchainPublic(state);
  });
}
