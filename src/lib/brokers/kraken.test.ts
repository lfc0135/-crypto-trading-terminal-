import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { divergenceBps, isKrakenMajor, krakenSymbol } from "./kraken";

describe("Kraken paper adapter", () => {
  it("maps the three majors and nothing else", () => {
    expect(krakenSymbol("BTC-USDT")).toBe("PF_XBTUSD");
    expect(krakenSymbol("eth-usdt")).toBe("PF_ETHUSD");
    expect(isKrakenMajor("SOL-USDT")).toBe(true);
    expect(krakenSymbol("DOGE-USDT")).toBeNull();
  });

  it("measures the mark gap in basis points", () => {
    expect(divergenceBps(100, 100.1)).toBeCloseTo(10, 6);
    expect(divergenceBps(0, 100)).toBeNull();
  });

  it("does not call a private Kraken route or read a key", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "src/lib/brokers/kraken.ts"), "utf8");
    expect(text.includes("/private/")).toBe(false);
    expect(text.includes("API-Key")).toBe(false);
    expect(text.includes("KRAKEN_API")).toBe(false);
    expect(text.includes("sendorder")).toBe(false);
  });
});
