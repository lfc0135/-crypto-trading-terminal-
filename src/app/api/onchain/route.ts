import { onchainPublic } from "@/lib/onchain/model";
import { readOnchain } from "@/lib/onchain/store";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handle(async () => onchainPublic(readOnchain()), 500);
}
