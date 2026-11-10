import crypto from "node:crypto";
import { readConfig } from "../config";
import { gmgnMessage, gmgnSign } from "./sign";
import { num } from "../watchlist/gmgn-filter";
import type { GmgnChain } from "../types";

export const GMGN_USDC: Record<GmgnChain, { address: string; decimals: number }> = {
  sol: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  bsc: { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18 },
  base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
};

export function unwrapGmgn(payload: unknown): unknown {
  let current = payload;
  for (let i = 0; i < 4; i += 1) {
    if (!current || typeof current !== "object" || !("code" in current) || !("data" in current)) break;
    const record = current as { code?: unknown; data?: unknown; message?: unknown; msg?: unknown; error?: unknown };
    if (record.code !== 0 && record.code !== "0") {
      const message = [record.message, record.msg, record.error].find((item) => typeof item === "string") as string | undefined;
      throw new Error(message || `GMGN error ${String(record.code)}`);
    }
    current = record.data;
  }
  return current;
}

async function gmgnPublic(path: string, query: Record<string, string | number>): Promise<unknown> {
  const cfg = readConfig();
  if (!cfg.gmgn.apiKey) throw new Error("GMGN_API_KEY is not set.");
  const timestamp = Math.floor(Date.now() / 1000);
  const clientId = crypto.randomUUID();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, timestamp, client_id: clientId })) {
    params.set(key, String(value));
  }
  const res = await fetch(`${cfg.gmgn.host}${path}?${params}`, {
    headers: { "X-APIKEY": cfg.gmgn.apiKey, "User-Agent": "aayush-desk/0.1" },
    cache: "no-store",
  });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    try {
      unwrapGmgn(json);
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : `GMGN HTTP ${res.status}`);
    }
    throw new Error(`GMGN HTTP ${res.status}`);
  }
  return unwrapGmgn(json);
}

export async function gmgnRank(chain: GmgnChain, interval: string, limit: number): Promise<Record<string, unknown>[]> {
  const data = await gmgnPublic("/v1/market/rank", { chain, interval, limit, order_by: "volume" });
  const rank = data && typeof data === "object" && "rank" in data ? (data as { rank?: unknown }).rank : null;
  if (!Array.isArray(rank)) return [];
  return rank.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

export async function gmgnToken(chain: GmgnChain, address: string): Promise<Record<string, unknown>> {
  const data = await gmgnPublic("/v1/token/info", { chain, address });
  if (!data || typeof data !== "object") throw new Error("GMGN token info was empty.");
  return data as Record<string, unknown>;
}

export function priceFromTokenInfo(data: Record<string, unknown>): number | null {
  const price = data.price;
  if (price && typeof price === "object") return num((price as { price?: unknown }).price);
  return num(price);
}

export async function gmgnSecurity(chain: GmgnChain, address: string): Promise<Record<string, unknown> | null> {
  const data = await gmgnPublic("/v1/token/security", { chain, address });
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

export async function gmgnSwap(input: {
  chain: GmgnChain;
  side: "buy" | "sell";
  token: string;
  /** USDC amount when buying, token amount when selling. Human units, not base units. */
  humanAmount: number;
  inputDecimals: number;
  slippagePct: number;
}): Promise<unknown> {
  const cfg = readConfig();
  if (!cfg.gmgn.apiKey || !cfg.gmgn.privateKey || !cfg.gmgn.wallet) {
    throw new Error("Live GMGN swaps need GMGN_API_KEY, GMGN_PRIVATE_KEY, and GMGN_WALLET_ADDRESS.");
  }
  const usdc = GMGN_USDC[input.chain];
  const slippage = Math.min(50, Math.max(1, Math.round(input.slippagePct)));
  const inputToken = input.side === "buy" ? usdc.address : input.token;
  const outputToken = input.side === "buy" ? input.token : usdc.address;
  const amount = input.humanAmount * 10 ** input.inputDecimals;
  const body = {
    chain: input.chain,
    from_address: cfg.gmgn.wallet,
    input_token: inputToken,
    output_token: outputToken,
    input_amount: String(Math.round(amount)),
    slippage,
    is_anti_mev: input.chain !== "base",
  };
  const timestamp = Math.floor(Date.now() / 1000);
  const clientId = crypto.randomUUID();
  const query = { timestamp, client_id: clientId };
  const payload = JSON.stringify(body);
  const signature = gmgnSign(gmgnMessage("/v1/trade/swap", query, payload, timestamp), cfg.gmgn.privateKey);
  const params = new URLSearchParams({ timestamp: String(timestamp), client_id: clientId });
  const res = await fetch(`${cfg.gmgn.host}/v1/trade/swap?${params}`, {
    method: "POST",
    headers: {
      "X-APIKEY": cfg.gmgn.apiKey,
      "X-Signature": signature,
      "Content-Type": "application/json",
      "User-Agent": "aayush-desk/0.1",
    },
    body: payload,
    cache: "no-store",
  });
  const json = (await res.json()) as unknown;
  return unwrapGmgn(json);
}
