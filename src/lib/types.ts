export interface RiskLimits {
  /** Max gross position notional / equity. */
  maxPositionPct: number;
  /** Session loss versus Dubai-day starting equity. */
  maxDailyLossPct: number;
  /** Peak-to-trough loss versus peak equity. */
  maxDrawdownPct: number;
  /** Stop distance × size + round-trip fees, over equity. */
  perTradeRiskPct: number;
  /** Ceiling. This build still routes spot only (1×). */
  maxLeverage: number;
}

export interface TargetSettings {
  dailyLow: number;
  dailyHigh: number;
  /** When true, the monthly band is the 30-day compound of the daily band. */
  monthlyFollowsDaily: boolean;
  monthlyLow: number;
  monthlyHigh: number;
}

export type GmgnChain = "sol" | "bsc" | "base";
export type GmgnInterval = "1m" | "5m" | "1h" | "6h" | "24h";

export interface GmgnRules {
  chains: GmgnChain[];
  interval: GmgnInterval;
  minLiquidityUsd: number;
  maxTop10HolderRate: number;
  maxRugRatio: number;
  maxBuyTax: number;
  maxSellTax: number;
  requireRenouncedMint: boolean;
  blockWashTrading: boolean;
  blockAlert: boolean;
  requireHoneypotClearance: boolean;
  minHolders: number;
  fetchLimit: number;
  maxResults: number;
}

export interface WatchRules {
  coreInstIds: string[];
  topN: number;
  minQuoteVolumeUsd: number;
  momentumWeight: number;
  /** Absolute 24h move is capped here so one spike cannot dominate volume. */
  momentumCap: number;
  refreshSeconds: number;
  gmgn: GmgnRules;
}

export interface Settings {
  limits: RiskLimits;
  targets: TargetSettings;
  watch: WatchRules;
  leverageReviewMonths: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Position {
  id: string;
  venue: "okx" | "gmgn";
  symbol: string;
  qty: number;
  avgPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: number;
  chain?: GmgnChain;
  address?: string;
}

export interface WorkingOrder {
  id: string;
  venue: "okx" | "gmgn";
  symbol: string;
  side: "buy" | "sell";
  type: "limit";
  qty: number;
  limitPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  reservedCash: number;
  createdAt: number;
  chain?: GmgnChain;
  address?: string;
}

export interface Fill {
  id: string;
  ts: number;
  venue: "okx" | "gmgn";
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  fee: number;
  realizedPnl: number;
  orderType: "market" | "limit" | "stop" | "take-profit";
  route: "paper";
  note: string;
}

export interface Audit {
  id: string;
  ts: number;
  level: "info" | "warn" | "danger";
  kind: string;
  message: string;
}

export interface EquityPoint {
  ts: number;
  equity: number;
}

export interface Account {
  principal: number;
  cash: number;
  createdAt: number;
  dayKey: string;
  dayStartEquity: number;
  peakEquity: number;
  positions: Position[];
  openOrders: WorkingOrder[];
  fills: Fill[];
  audits: Audit[];
  equityCurve: EquityPoint[];
  dailyKillLatched: boolean;
  drawdownKillLatched: boolean;
  drawdownKillEver: boolean;
  liveConfirmedAt: string | null;
}

export interface Ledger {
  version: 1;
  account: Account;
  settings: Settings;
}

export interface OkxTicker {
  instId: string;
  last: number;
  open24h: number;
  bid: number;
  ask: number;
  high24h: number;
  low24h: number;
  quoteVolume24h: number;
  baseVolume24h: number;
  ts: number;
}

export interface RankedMarket {
  instId: string;
  role: "core" | "trend";
  last: number | null;
  change24h: number | null;
  quoteVolume24h: number | null;
  score: number | null;
  missing: boolean;
}

export interface GmgnCandidate {
  chain: GmgnChain;
  address: string;
  symbol: string;
  name: string;
  price: number | null;
  liquidity: number | null;
  marketCap: number | null;
  volume: number | null;
  priceChangePercent: number | null;
  holderCount: number | null;
  top10HolderRate: number | null;
  rugRatio: number | null;
  isWashTrading: boolean | null;
  isShowAlert: boolean | null;
  renouncedMint: boolean | null;
  renouncedFreeze: boolean | null;
}

export interface GmgnSecurity {
  honeypot: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  renouncedMint: boolean | null;
  canNotSell: boolean | null;
  isBlacklist: boolean | null;
  isShowAlert: boolean | null;
}

export interface ScreenedToken extends GmgnCandidate {
  pass: boolean;
  failures: string[];
  notes: string[];
}

export interface InstrumentSpec {
  instId: string;
  base: string;
  quote: string;
  minSz: number;
  lotSz: number;
  tickSz: number;
  state: string;
}
