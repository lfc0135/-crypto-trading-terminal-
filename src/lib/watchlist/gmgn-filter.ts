import type { GmgnCandidate, GmgnRules, GmgnSecurity, ScreenedToken } from "../types";

/**
 * GMGN security tax fields came back as 0 for BONK. The skills docs do not pin the unit.
 * Values above 1 are treated as percent (5 → 5%). Values from 0 to 1 are treated as a fraction.
 */
export function normalizeTax(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  if (value > 1) return value / 100;
  return value;
}

export function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function flag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

export function parseRankItem(chain: GmgnCandidate["chain"], raw: Record<string, unknown>): GmgnCandidate | null {
  const address = typeof raw.address === "string" ? raw.address : "";
  const symbol = typeof raw.symbol === "string" ? raw.symbol : "";
  if (!address || !symbol) return null;
  return {
    chain,
    address,
    symbol,
    name: typeof raw.name === "string" ? raw.name : symbol,
    price: num(raw.price),
    liquidity: num(raw.liquidity),
    marketCap: num(raw.market_cap),
    volume: num(raw.volume),
    priceChangePercent: num(raw.price_change_percent),
    holderCount: num(raw.holder_count),
    top10HolderRate: num(raw.top_10_holder_rate),
    rugRatio: num(raw.rug_ratio),
    isWashTrading: flag(raw.is_wash_trading),
    isShowAlert: flag(raw.is_show_alert),
    renouncedMint: flag(raw.renounced_mint),
    renouncedFreeze: flag(raw.renounced_freeze_account),
  };
}

export function parseSecurity(raw: Record<string, unknown> | null): GmgnSecurity | null {
  if (!raw) return null;
  const honeypotFlag = flag(raw.honeypot);
  const honeypotAlt = flag(raw.is_honeypot);
  return {
    honeypot: honeypotFlag ?? honeypotAlt,
    buyTax: normalizeTax(num(raw.buy_tax)),
    sellTax: normalizeTax(num(raw.sell_tax)),
    renouncedMint: flag(raw.renounced_mint),
    canNotSell: flag(raw.can_not_sell),
    isBlacklist: flag(raw.is_blacklist) ?? flag(raw.blacklist),
    isShowAlert: flag(raw.is_show_alert),
  };
}

export function evaluateGmgnCandidate(
  token: GmgnCandidate,
  security: GmgnSecurity | null,
  rules: GmgnRules,
): ScreenedToken {
  const failures: string[] = [];
  const notes: string[] = [];
  if (!rules.chains.includes(token.chain)) failures.push("Chain is outside the watchlist.");
  if (token.liquidity == null) failures.push("Liquidity missing.");
  else if (token.liquidity < rules.minLiquidityUsd) {
    failures.push(`Liquidity $${Math.round(token.liquidity).toLocaleString("en-US")} is under $${Math.round(rules.minLiquidityUsd).toLocaleString("en-US")}.`);
  } else notes.push("liquidity");
  if (token.holderCount == null) failures.push("Holder count missing.");
  else if (token.holderCount < rules.minHolders) failures.push(`Holders ${token.holderCount} < ${rules.minHolders}.`);
  else notes.push("holders");
  if (token.top10HolderRate == null) failures.push("Top-10 holder concentration missing.");
  else if (token.top10HolderRate > rules.maxTop10HolderRate) {
    failures.push(`Top 10 hold ${(token.top10HolderRate * 100).toFixed(1)}% (max ${(rules.maxTop10HolderRate * 100).toFixed(0)}%).`);
  } else notes.push("concentration");
  if (token.rugRatio == null) failures.push("Rug ratio missing.");
  else if (token.rugRatio > rules.maxRugRatio) {
    failures.push(`Rug ratio ${(token.rugRatio * 100).toFixed(1)}% is above ${(rules.maxRugRatio * 100).toFixed(0)}%.`);
  } else notes.push("rug");
  if (rules.blockWashTrading && token.isWashTrading !== false) {
    failures.push(token.isWashTrading ? "Wash-trading flag is on." : "Wash-trading flag missing.");
  } else if (rules.blockWashTrading) notes.push("wash clear");
  if (rules.blockAlert && token.isShowAlert !== false) {
    failures.push(token.isShowAlert ? "GMGN risk alert is on." : "Risk-alert flag missing.");
  }
  const mint = security?.renouncedMint ?? token.renouncedMint;
  if (rules.requireRenouncedMint && mint !== true) {
    failures.push(mint === false ? "Mint authority is not renounced." : "Mint-renounce status missing.");
  } else if (rules.requireRenouncedMint) notes.push("mint renounced");
  if (rules.requireHoneypotClearance) {
    if (!security || security.honeypot == null) failures.push("Honeypot check unverified.");
    else if (security.honeypot) failures.push("Honeypot flag is on.");
    else notes.push("honeypot clear");
    if (security?.canNotSell) failures.push("Sell is blocked.");
    if (security?.isBlacklist) failures.push("Blacklist flag is on.");
    if (security?.isShowAlert) failures.push("Security endpoint raised an alert.");
    if (!security || security.buyTax == null) failures.push("Buy tax unverified.");
    else if (security.buyTax > rules.maxBuyTax) failures.push(`Buy tax ${(security.buyTax * 100).toFixed(1)}% is high.`);
    if (!security || security.sellTax == null) failures.push("Sell tax unverified.");
    else if (security.sellTax > rules.maxSellTax) failures.push(`Sell tax ${(security.sellTax * 100).toFixed(1)}% is high.`);
  }
  return { ...token, pass: failures.length === 0, failures, notes };
}
