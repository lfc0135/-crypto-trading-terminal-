import crypto from "node:crypto";
import { okxKeysPresent, publicMode, readConfig } from "../config";
import { DEMO_PHRASE, LIVE_PHRASE, resolvedMonthly } from "../defaults";
import { GMGN_USDC, gmgnRank, gmgnSecurity, gmgnSwap, gmgnToken, priceFromTokenInfo } from "../brokers/gmgn";
import { getCandles, getInstrument, getOrderBook, getSpotTickers, okxPlaceSpotOrder } from "../brokers/okx";
import { runBacktest } from "../backtest/engine";
import { normalizeSettings } from "../settings";
import { BAR_MS, defaultParams, getStrategy, normalizeBar, STRATEGIES } from "../strategies";
import { freshLedger, updateLedger } from "../store";
import { bandOutcome, maxDrawdown } from "../targets";
import { dubaiDayKey, dubaiMonthKey, formatDubai } from "../time";
import { leverageReview } from "../trading/review";
import { cancelPaperOrder, markBook, marksEquity, placePaperOrder, previewPaperOrder, reservedCash, type OrderInput, type Quote } from "../trading/book";
import type { GmgnChain, GmgnCandidate, InstrumentSpec, Ledger, ScreenedToken } from "../types";
import { evaluateGmgnCandidate, parseRankItem, parseSecurity } from "../watchlist/gmgn-filter";
import { isEligibleSpot, rankOkxSpot } from "../watchlist/rank";

const instrumentCache = new Map<string, { at: number; spec: InstrumentSpec }>();
const securityCache = new Map<string, { at: number; security: ReturnType<typeof parseSecurity> }>();
let watchCache: { at: number; key: string; payload: unknown } | null = null;

function validChain(value: string): value is GmgnChain {
  return value === "sol" || value === "bsc" || value === "base";
}

function validAddress(chain: GmgnChain, address: string): boolean {
  if (chain === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

async function instrument(instId: string): Promise<InstrumentSpec> {
  const hit = instrumentCache.get(instId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.spec;
  const spec = await getInstrument(instId);
  instrumentCache.set(instId, { at: Date.now(), spec });
  return spec;
}

async function quoteOkx(instId: string): Promise<Quote> {
  const rows = await getSpotTickers();
  const row = rows.find((item) => item.instId === instId);
  if (!row) throw new Error(`No public OKX ticker for ${instId}.`);
  return { bid: row.bid, ask: row.ask, last: row.last };
}

async function quoteGmgn(chain: GmgnChain, address: string): Promise<Quote> {
  const info = await gmgnToken(chain, address);
  const price = priceFromTokenInfo(info);
  if (!(price && price > 0)) throw new Error("GMGN did not return a price for that token.");
  return { bid: price, ask: price, last: price };
}

function positionMarks(ledger: Ledger, tickers: Map<string, number>): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const position of ledger.account.positions) {
    if (position.venue === "okx" && tickers.has(position.symbol)) marks[position.symbol] = tickers.get(position.symbol)!;
  }
  for (const order of ledger.account.openOrders) {
    if (order.venue === "okx" && tickers.has(order.symbol)) marks[order.symbol] = tickers.get(order.symbol)!;
  }
  return marks;
}

async function hydrateGmgnMarks(ledger: Ledger, marks: Record<string, number>) {
  if (!readConfig().gmgn.apiKey) return;
  for (const position of ledger.account.positions) {
    if (position.venue !== "gmgn" || !position.chain || !position.address) continue;
    try {
      const quote = await quoteGmgn(position.chain, position.address);
      marks[position.symbol] = quote.last;
    } catch {
      marks[position.symbol] = position.avgPrice;
    }
  }
}

function snapshot(ledger: Ledger, marks: Record<string, number>) {
  const account = ledger.account;
  const equity = marksEquity(ledger, marks);
  const marketValue = equity - account.cash;
  const today = dubaiDayKey(new Date());
  const month = dubaiMonthKey(new Date());
  const realizedToday = account.fills
    .filter((fill) => dubaiDayKey(new Date(fill.ts)) === today)
    .reduce((sum, fill) => sum + fill.realizedPnl, 0);
  const realizedMonth = account.fills
    .filter((fill) => dubaiMonthKey(new Date(fill.ts)) === month)
    .reduce((sum, fill) => sum + fill.realizedPnl, 0);
  const monthly = resolvedMonthly(ledger.settings.targets);
  const realizedDayReturn = account.principal > 0 ? realizedToday / account.principal : 0;
  const realizedMonthReturn = account.principal > 0 ? realizedMonth / account.principal : 0;
  const mtmDayPnl = equity - account.dayStartEquity;
  const mtmDayReturn = account.principal > 0 ? mtmDayPnl / account.principal : 0;
  const drawdownPct = account.peakEquity > 0 ? (account.peakEquity - equity) / account.peakEquity : 0;
  const dailyLossPct = account.dayStartEquity > 0 ? (account.dayStartEquity - equity) / account.dayStartEquity : 0;
  const limits = ledger.settings.limits;
  const maxPositionUsd = equity * limits.maxPositionPct;
  const review = leverageReview({
    createdAt: account.createdAt,
    now: Date.now(),
    fills: account.fills,
    observedDrawdownPct: maxDrawdown(account.equityCurve.map((point) => point.equity)),
    drawdownLimitPct: limits.maxDrawdownPct,
    drawdownKillEver: account.drawdownKillEver,
    requiredMonths: ledger.settings.leverageReviewMonths,
  });
  return {
    clock: formatDubai(new Date()),
    mode: publicMode(readConfig(), account.liveConfirmedAt),
    principal: account.principal,
    cash: account.cash,
    reserved: reservedCash(ledger),
    equity,
    marketValue,
    peakEquity: account.peakEquity,
    unrealized: account.positions.reduce((sum, position) => {
      const mark = marks[position.symbol] ?? position.avgPrice;
      return sum + (mark - position.avgPrice) * position.qty;
    }, 0),
    realizedToday,
    realizedMonth,
    realizedDayReturn,
    realizedMonthReturn,
    mtmDayPnl,
    mtmDayReturn,
    drawdownPct,
    dailyLossPct,
    dayOutcome: bandOutcome(realizedDayReturn, ledger.settings.targets.dailyLow, ledger.settings.targets.dailyHigh),
    monthOutcome: bandOutcome(realizedMonthReturn, monthly.monthlyLow, monthly.monthlyHigh),
    targets: { ...ledger.settings.targets, ...monthly },
    limits,
    review,
    kills: {
      daily: account.dailyKillLatched || dailyLossPct >= limits.maxDailyLossPct,
      drawdown: account.drawdownKillLatched || drawdownPct >= limits.maxDrawdownPct,
      ever: account.drawdownKillEver,
    },
    illustration: {
      dollarsToDailyLow: account.principal * ledger.settings.targets.dailyLow,
      dollarsToDailyHigh: account.principal * ledger.settings.targets.dailyHigh,
      maxPositionUsd,
      moveOnFullPosition: maxPositionUsd > 0 ? (account.principal * ledger.settings.targets.dailyLow) / maxPositionUsd : null,
      dailyLossUsd: account.dayStartEquity * limits.maxDailyLossPct,
      perTradeUsd: equity * limits.perTradeRiskPct,
      drawdownUsd: account.peakEquity * limits.maxDrawdownPct,
    },
    positions: account.positions.map((position) => {
      const mark = marks[position.symbol] ?? position.avgPrice;
      const value = mark * position.qty;
      return {
        ...position,
        mark,
        marketValue: value,
        unrealized: (mark - position.avgPrice) * position.qty,
        positionPct: equity > 0 ? value / equity : 0,
        stale: marks[position.symbol] == null,
      };
    }),
    openOrders: account.openOrders,
    recentFills: account.fills.slice(0, 12),
    equityCurve: account.equityCurve.slice(-400),
    settings: ledger.settings,
  };
}

async function tick(ledger: Ledger) {
  let tickers: Awaited<ReturnType<typeof getSpotTickers>> = [];
  try {
    tickers = await getSpotTickers();
  } catch {
    tickers = [];
  }
  const map = new Map(tickers.map((row) => [row.instId, row.last]));
  const marks = positionMarks(ledger, map);
  await hydrateGmgnMarks(ledger, marks);
  markBook(ledger, marks);
  return { tickers, marks };
}

export async function loadDashboard() {
  return updateLedger(async (ledger) => {
    const { marks } = await tick(ledger);
    return snapshot(ledger, marks);
  });
}

export async function loadJournal() {
  return updateLedger(async (ledger) => {
    const { marks } = await tick(ledger);
    return { fills: ledger.account.fills.slice(0, 200), audits: ledger.account.audits.slice(0, 200), clock: formatDubai(new Date()), equity: marksEquity(ledger, marks) };
  });
}

export async function saveSettings(input: unknown) {
  return updateLedger(async (ledger) => {
    const next = normalizeSettings(input, ledger.settings);
    if ("error" in next) return { ok: false as const, error: next.error };
    ledger.settings = next;
    ledger.account.audits.unshift({
      id: crypto.randomUUID(),
      ts: Date.now(),
      level: "info",
      kind: "settings",
      message: "Risk, target, or watchlist rules updated.",
    });
    return { ok: true as const, settings: ledger.settings };
  });
}

export async function clearSwitch(which: "daily" | "drawdown") {
  return updateLedger(async (ledger) => {
    const { marks } = await tick(ledger);
    const view = snapshot(ledger, marks);
    if (which === "daily" && view.dailyLossPct >= ledger.settings.limits.maxDailyLossPct) {
      return { ok: false as const, error: "Daily loss is still through the limit. The switch stays on." };
    }
    if (which === "drawdown" && view.drawdownPct >= ledger.settings.limits.maxDrawdownPct) {
      return { ok: false as const, error: "Drawdown is still through the limit. The switch stays on." };
    }
    if (which === "daily") ledger.account.dailyKillLatched = false;
    if (which === "drawdown") ledger.account.drawdownKillLatched = false;
    ledger.account.audits.unshift({
      id: crypto.randomUUID(),
      ts: Date.now(),
      level: "info",
      kind: "kill",
      message: `${which === "daily" ? "Daily loss" : "Drawdown"} switch cleared by hand. The historical trip is kept for the leverage review.`,
    });
    return { ok: true as const };
  });
}

export async function resetBook(principal?: number) {
  return updateLedger(async (ledger) => {
    const nextPrincipal = principal && principal >= 100 ? principal : readConfig().principal;
    const fresh = freshLedger();
    fresh.settings = ledger.settings;
    fresh.account.principal = nextPrincipal;
    fresh.account.cash = nextPrincipal;
    fresh.account.dayStartEquity = nextPrincipal;
    fresh.account.peakEquity = nextPrincipal;
    fresh.account.equityCurve = [{ ts: Date.now(), equity: nextPrincipal }];
    fresh.account.audits[0].message = `Paper book reset to ${nextPrincipal.toLocaleString("en-US")} USDT.`;
    ledger.account = fresh.account;
    ledger.settings = fresh.settings;
    return { ok: true as const, principal: nextPrincipal };
  });
}

export async function confirmLive(phrase: string) {
  return updateLedger(async (ledger) => {
    const cfg = readConfig();
    if (cfg.tradingMode !== "live") {
      return { ok: false as const, error: "TRADING_MODE is paper. A button cannot turn on live trading. Set TRADING_MODE=live and OKX_SIMULATED=false, then restart." };
    }
    if (phrase !== LIVE_PHRASE) return { ok: false as const, error: `Type ${LIVE_PHRASE} exactly.` };
    ledger.account.liveConfirmedAt = new Date().toISOString();
    ledger.account.audits.unshift({
      id: crypto.randomUUID(),
      ts: Date.now(),
      level: "danger",
      kind: "live",
      message: "Live trading confirmed in the UI. Exchange orders still need the phrase on each ticket.",
    });
    return { ok: true as const };
  });
}

export async function revokeLive() {
  return updateLedger(async (ledger) => {
    ledger.account.liveConfirmedAt = null;
    ledger.account.audits.unshift({ id: crypto.randomUUID(), ts: Date.now(), level: "info", kind: "live", message: "Live confirmation revoked." });
    return { ok: true as const };
  });
}

async function screenToken(chain: GmgnChain, address: string, rules: Ledger["settings"]["watch"]["gmgn"]): Promise<ScreenedToken> {
  const info = await gmgnToken(chain, address);
  const candidate = parseRankItem(chain, { ...info, address, chain });
  if (!candidate) throw new Error("GMGN token payload could not be read.");
  const key = `${chain}:${address}`;
  let security = securityCache.get(key);
  if (!security || Date.now() - security.at > 10 * 60_000) {
    const raw = await gmgnSecurity(chain, address);
    security = { at: Date.now(), security: parseSecurity(raw) };
    securityCache.set(key, security);
  }
  return evaluateGmgnCandidate(candidate, security.security, rules);
}

function gateExchange(route: string, phrase: string | undefined, ledger: Ledger): string | null {
  const cfg = readConfig();
  if (route === "paper") return null;
  if (route === "okx-demo") {
    if (!okxKeysPresent(cfg)) return "OKX demo routing needs an API key, secret, and passphrase. The paper book does not need them.";
    if (!cfg.okxSimulated) return "OKX_SIMULATED is false. The demo route is off so a live order is not sent by mistake.";
    if (phrase !== DEMO_PHRASE) return `Type ${DEMO_PHRASE} to send this order to the OKX demo environment.`;
    return null;
  }
  if (route === "okx-live") {
    if (cfg.tradingMode !== "live") return "TRADING_MODE is paper. Live OKX orders are refused.";
    if (cfg.okxSimulated) return "Set OKX_SIMULATED=false before a live OKX order. Demo mode is still on.";
    if (!okxKeysPresent(cfg)) return "OKX API key, secret, and passphrase are missing.";
    if (!ledger.account.liveConfirmedAt) return "Confirm live trading on the Risk page first.";
    if (phrase !== LIVE_PHRASE) return `Type ${LIVE_PHRASE} on this order.`;
    return null;
  }
  if (route === "gmgn-live") {
    if (cfg.tradingMode !== "live" || cfg.gmgnTrading !== "live") return "GMGN live swaps need TRADING_MODE=live and GMGN_TRADING=live.";
    if (!cfg.gmgn.apiKey || !cfg.gmgn.privateKey || !cfg.gmgn.wallet) return "GMGN live swaps need the API key, the request-signing key, and GMGN_WALLET_ADDRESS.";
    if (!ledger.account.liveConfirmedAt) return "Confirm live trading on the Risk page first.";
    if (phrase !== LIVE_PHRASE) return `Type ${LIVE_PHRASE} on this order.`;
    return null;
  }
  return "Unknown order route.";
}

export async function submitOrder(raw: Record<string, unknown>, commit: boolean) {
  const route = typeof raw.route === "string" ? raw.route : "paper";
  const venue = raw.venue === "gmgn" ? "gmgn" : "okx";
  const side = raw.side === "sell" ? "sell" : "buy";
  const type = raw.type === "limit" ? "limit" : "market";
  return updateLedger(async (ledger) => {
    await tick(ledger);
    const blocked = gateExchange(route, typeof raw.confirmPhrase === "string" ? raw.confirmPhrase : undefined, ledger);
    if (blocked) {
      if (commit) ledger.account.audits.unshift({ id: crypto.randomUUID(), ts: Date.now(), level: "warn", kind: "order", message: blocked });
      return { ok: false as const, message: blocked, reasons: [blocked] };
    }
    let symbol = String(raw.symbol ?? "").toUpperCase();
    let chain: GmgnChain | undefined;
    let address: string | undefined;
    if (venue === "gmgn") {
      const chainRaw = String(raw.chain ?? "");
      address = String(raw.address ?? "").trim();
      if (!validChain(chainRaw) || !validAddress(chainRaw, address)) {
        return { ok: false as const, message: "On-chain orders need a Solana, BSC, or Base address in the expected format.", reasons: ["Bad address."] };
      }
      chain = chainRaw;
      symbol = `${chain}:${address}`;
    } else if (!isEligibleSpot(symbol)) {
      return { ok: false as const, message: "Orders are USDT spot only. Perps and leveraged tokens are not routed.", reasons: ["Not a USDT spot pair."] };
    }
    const input: OrderInput = {
      venue,
      symbol,
      side,
      type,
      qty: typeof raw.qty === "number" ? raw.qty : undefined,
      usdSize: typeof raw.usdSize === "number" ? raw.usdSize : undefined,
      limitPrice: typeof raw.limitPrice === "number" ? raw.limitPrice : undefined,
      stopLoss: typeof raw.stopLoss === "number" ? raw.stopLoss : null,
      takeProfit: typeof raw.takeProfit === "number" ? raw.takeProfit : null,
      sizeFromRisk: raw.sizeFromRisk === true,
      leverage: typeof raw.leverage === "number" ? raw.leverage : 1,
      chain,
      address,
    };
    if (route !== "paper") {
      if (!commit) return { ok: true as const, message: "Preview only. The exchange was not called.", reasons: [] };
      try {
        if (route === "okx-demo" || route === "okx-live") {
          const spec = await instrument(symbol);
          const qty = input.qty && input.qty > 0 ? input.qty : 0;
          if (!(qty > 0) || qty < spec.minSz) return { ok: false as const, message: `OKX minimum size for ${symbol} is ${spec.minSz}.`, reasons: ["Below minimum."] };
          const sent = await okxPlaceSpotOrder({
            instId: symbol,
            side,
            type,
            qty,
            limitPrice: input.limitPrice,
            stopLoss: input.stopLoss,
            takeProfit: input.takeProfit,
          });
          const note = sent.protectionError
            ? `OKX accepted the order. The stop/target was rejected: ${sent.protectionError}`
            : `Order sent to OKX ${route === "okx-live" ? "live" : "demo"}. The paper book was not changed.`;
          ledger.account.audits.unshift({ id: crypto.randomUUID(), ts: Date.now(), level: route === "okx-live" ? "danger" : "warn", kind: "exchange", message: note });
          return { ok: true as const, message: note, reasons: [], exchange: sent.order };
        }
        const info = await gmgnToken(chain!, address!);
        const decimals = typeof info.decimals === "number" ? info.decimals : 9;
        const humanAmount = side === "buy" ? (input.usdSize ?? 0) : (input.qty ?? 0);
        const sent = await gmgnSwap({
          chain: chain!,
          side,
          token: address!,
          humanAmount,
          inputDecimals: side === "buy" ? GMGN_USDC[chain!].decimals : decimals,
          slippagePct: 5,
        });
        ledger.account.audits.unshift({ id: crypto.randomUUID(), ts: Date.now(), level: "danger", kind: "exchange", message: "GMGN swap submitted. The paper book was not changed." });
        return { ok: true as const, message: "GMGN swap submitted. Check the order on GMGN before assuming a fill.", reasons: [], exchange: sent };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Exchange order failed.";
        ledger.account.audits.unshift({ id: crypto.randomUUID(), ts: Date.now(), level: "danger", kind: "exchange", message });
        return { ok: false as const, message, reasons: [message] };
      }
    }
    if (venue === "gmgn" && side === "buy" && raw.acknowledgeUnsafe !== true) {
      try {
        const screened = await screenToken(chain!, address!, ledger.settings.watch.gmgn);
        if (!screened.pass) {
          return { ok: false as const, message: screened.failures[0] ?? "Token failed the safety screen.", reasons: screened.failures };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not screen that token.";
        return { ok: false as const, message, reasons: [message] };
      }
    }
    let quote: Quote;
    let spec = { minSz: 0, lotSz: 0 };
    try {
      if (venue === "okx") {
        quote = await quoteOkx(symbol);
        const inst = await instrument(symbol);
        if (inst.state !== "live") return { ok: false as const, message: `${symbol} is not live on OKX.`, reasons: ["Instrument halted."] };
        spec = { minSz: inst.minSz, lotSz: inst.lotSz };
      } else {
        quote = await quoteGmgn(chain!, address!);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not price the order.";
      return { ok: false as const, message, reasons: [message] };
    }
    const outcome = commit
      ? placePaperOrder(ledger, input, quote, spec)
      : previewPaperOrder(ledger, input, quote, spec);
    if (commit && !outcome.ok) {
      ledger.account.audits.unshift({ id: crypto.randomUUID(), ts: Date.now(), level: "warn", kind: "reject", message: outcome.message });
    }
    return outcome;
  });
}

export async function cancelOrder(id: string) {
  return updateLedger(async (ledger) => cancelPaperOrder(ledger, id));
}

export async function loadCandles(instId: string, bar: string, limit: number) {
  if (!isEligibleSpot(instId)) throw new Error("Charts are USDT spot pairs.");
  const normalized = normalizeBar(bar);
  return getCandles(instId, normalized, Math.min(Math.max(limit, 30), 1000), true);
}

export async function loadBook(instId: string) {
  if (!isEligibleSpot(instId)) throw new Error("Order books are USDT spot pairs.");
  return getOrderBook(instId);
}

export async function loadWatchlist() {
  const ledger = await updateLedger(async (current) => current);
  const rules = ledger.settings.watch;
  const key = JSON.stringify(rules);
  if (watchCache && watchCache.key === key && Date.now() - watchCache.at < rules.refreshSeconds * 1000) {
    return watchCache.payload;
  }
  const tickers = await getSpotTickers(rules.refreshSeconds * 1000);
  const ranked = rankOkxSpot(tickers, rules);
  const onchain = await loadOnchain(rules.gmgn);
  const payload = {
    refreshedAt: new Date().toISOString(),
    refreshSeconds: rules.refreshSeconds,
    rules,
    spot: ranked,
    onchain,
  };
  watchCache = { at: Date.now(), key, payload };
  return payload;
}

async function loadOnchain(rules: Ledger["settings"]["watch"]["gmgn"]) {
  if (!readConfig().gmgn.apiKey) {
    return {
      status: "unconfigured" as const,
      message: "On-chain trends need GMGN_API_KEY. OKX spot trends are live from the public market API. No placeholder prices are shown.",
      tokens: [] as ScreenedToken[],
      scanned: 0,
      rejected: 0,
    };
  }
  const tokens: ScreenedToken[] = [];
  let scanned = 0;
  let rejected = 0;
  let securityCalls = 0;
  let warning: string | null = null;
  for (const chain of rules.chains) {
    if (tokens.length >= rules.maxResults) break;
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await gmgnRank(chain, rules.interval, rules.fetchLimit);
    } catch (error) {
      warning = error instanceof Error ? error.message : "GMGN rank request failed.";
      continue;
    }
    for (const row of rows) {
      if (tokens.length >= rules.maxResults) break;
      const candidate = parseRankItem(chain, row);
      if (!candidate || cheapReject(candidate, rules)) {
        if (candidate) {
          scanned += 1;
          rejected += 1;
        }
        continue;
      }
      scanned += 1;
      const cacheKey = `${chain}:${candidate.address}`;
      let cached = securityCache.get(cacheKey);
      if ((!cached || Date.now() - cached.at > 10 * 60_000) && securityCalls < 8 && !warning) {
        try {
          securityCalls += 1;
          const raw = await gmgnSecurity(chain, candidate.address);
          cached = { at: Date.now(), security: parseSecurity(raw) };
          securityCache.set(cacheKey, cached);
        } catch (error) {
          const message = error instanceof Error ? error.message : "security failed";
          if (message.toLowerCase().includes("rate") || message.includes("429")) warning = "GMGN rate limit hit while checking honeypot flags. Unverified tokens were left off the list.";
          cached = undefined;
        }
      }
      const screened = evaluateGmgnCandidate(candidate, cached?.security ?? null, rules);
      if (screened.pass) tokens.push(screened);
      else rejected += 1;
    }
  }
  return {
    status: warning ? "partial" as const : "live" as const,
    message: warning ?? `Safety screen kept ${tokens.length} token${tokens.length === 1 ? "" : "s"} from ${scanned} scanned.`,
    tokens,
    scanned,
    rejected,
  };
}

export async function runDeskBacktest(raw: Record<string, unknown>) {
  const strategy = getStrategy(String(raw.strategyId ?? ""));
  if (!strategy) throw new Error("Unknown strategy.");
  const instId = String(raw.instId ?? "BTC-USDT").toUpperCase();
  if (!isEligibleSpot(instId)) throw new Error("Backtests run on OKX USDT spot pairs.");
  const bar = normalizeBar(String(raw.bar ?? "15m"));
  const limit = Math.min(1000, Math.max(80, Number(raw.limit ?? 400)));
  const candles = await getCandles(instId, bar, limit, false);
  if (candles.length < 40) throw new Error("OKX returned too few closed candles for a backtest.");
  const spec = await instrument(instId);
  const ledger = await updateLedger(async (current) => current);
  const params = { ...defaultParams(strategy), ...(raw.params && typeof raw.params === "object" ? raw.params as Record<string, number> : {}) };
  const result = runBacktest(candles, strategy.create(params), {
    initialEquity: ledger.account.principal,
    principal: ledger.account.principal,
    limits: ledger.settings.limits,
    feeBps: typeof raw.feeBps === "number" ? raw.feeBps : 10,
    slippageBps: typeof raw.slippageBps === "number" ? raw.slippageBps : 2,
    barDurationMs: BAR_MS[bar] ?? 15 * 60_000,
    minSz: spec.minSz,
    lotSz: spec.lotSz,
    targets: { dailyLow: ledger.settings.targets.dailyLow, dailyHigh: ledger.settings.targets.dailyHigh },
  });
  return {
    strategy: { id: strategy.id, name: strategy.name, description: strategy.description },
    instId,
    bar,
    params,
    result: { ...result, equityCurve: result.equityCurve.filter((_, index) => index % Math.ceil(result.equityCurve.length / 400) === 0 || index === result.equityCurve.length - 1), trades: result.trades.slice(-80) },
  };
}

export function listStrategies() {
  return STRATEGIES.map((strategy) => ({
    id: strategy.id,
    name: strategy.name,
    description: strategy.description,
    timeframes: strategy.timeframes,
    params: strategy.params,
  }));
}

function cheapReject(candidate: GmgnCandidate, rules: Ledger["settings"]["watch"]["gmgn"]): boolean {
  if (candidate.liquidity == null || candidate.liquidity < rules.minLiquidityUsd) return true;
  if (candidate.holderCount == null || candidate.holderCount < rules.minHolders) return true;
  if (candidate.top10HolderRate == null || candidate.top10HolderRate > rules.maxTop10HolderRate) return true;
  if (candidate.rugRatio == null || candidate.rugRatio > rules.maxRugRatio) return true;
  if (rules.blockWashTrading && candidate.isWashTrading !== false) return true;
  if (rules.blockAlert && candidate.isShowAlert !== false) return true;
  return false;
}
