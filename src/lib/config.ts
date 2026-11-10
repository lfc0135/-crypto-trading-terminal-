import { DEFAULT_PRINCIPAL } from "./defaults";

export type TradingMode = "paper" | "live";

export interface AppConfig {
  tradingMode: TradingMode;
  okxSimulated: boolean;
  gmgnTrading: "paper" | "live";
  principal: number;
  okx: { apiKey: string; secret: string; passphrase: string; baseUrl: string };
  gmgn: { apiKey: string; privateKey: string; host: string; wallet: string };
  /** Which paper book the majors use. Live routing is unchanged. */
  paperExchange: "okx" | "kraken" | "both";
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

export function readConfig(): AppConfig {
  const principal = Number(process.env.PAPER_PRINCIPAL ?? DEFAULT_PRINCIPAL);
  return {
    tradingMode: process.env.TRADING_MODE === "live" ? "live" : "paper",
    okxSimulated: process.env.OKX_SIMULATED !== "false",
    gmgnTrading: process.env.GMGN_TRADING === "live" ? "live" : "paper",
    principal: Number.isFinite(principal) && principal >= 100 ? principal : DEFAULT_PRINCIPAL,
    okx: {
      apiKey: clean(process.env.OKX_API_KEY),
      secret: clean(process.env.OKX_API_SECRET),
      passphrase: clean(process.env.OKX_API_PASSPHRASE),
      baseUrl: clean(process.env.OKX_BASE_URL) || "https://www.okx.com",
    },
    gmgn: {
      apiKey: clean(process.env.GMGN_API_KEY),
      privateKey: clean(process.env.GMGN_PRIVATE_KEY).replace(/\\n/g, "\n"),
      host: clean(process.env.GMGN_HOST) || "https://openapi.gmgn.ai",
      wallet: clean(process.env.GMGN_WALLET_ADDRESS),
    },
    paperExchange: process.env.PAPER_EXCHANGE === "kraken" || process.env.PAPER_EXCHANGE === "both" ? process.env.PAPER_EXCHANGE : "okx",
  };
}

export function okxKeysPresent(cfg = readConfig()): boolean {
  return Boolean(cfg.okx.apiKey && cfg.okx.secret && cfg.okx.passphrase);
}

export function publicMode(cfg = readConfig(), liveConfirmedAt: string | null = null) {
  return {
    tradingMode: cfg.tradingMode,
    okxSimulated: cfg.okxSimulated,
    gmgnTrading: cfg.gmgnTrading,
    okxKeys: okxKeysPresent(cfg),
    gmgnKey: Boolean(cfg.gmgn.apiKey),
    gmgnSigningKey: Boolean(cfg.gmgn.privateKey),
    gmgnWallet: Boolean(cfg.gmgn.wallet),
    liveConfirmed: Boolean(liveConfirmedAt),
    spotOnly: true as const,
    principal: cfg.principal,
    paperExchange: cfg.paperExchange,
  };
}
