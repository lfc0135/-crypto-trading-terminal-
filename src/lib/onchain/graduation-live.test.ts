import { describe, expect, it } from "vitest";
import { DAILY_LOSS_PAUSE_USD, ENTRY, LIVE_TRADE_USD, RULE_ID, eligible } from "./graduation-live";

const SOL = "So11111111111111111111111111111111111111112";
const g = (over: Partial<Parameters<typeof eligible>[0]> = {}) => ({ token: "Abcpump", pool: "P", symbol: "T", platform: "Pump.fun", exchange: "pump_amm", quote: SOL, gradMs: 1, liquidity: 20_000, ...over });

describe("graduation live paper", () => {
  it("sizes 6% of the $10k principal with a 10% daily loss pause", () => {
    expect(LIVE_TRADE_USD).toBe(600);
    expect(DAILY_LOSS_PAUSE_USD).toBe(1_000);
  });
  it("requires the first post-graduation 5-minute bar to close up on at least $5k volume", () => {
    expect(ENTRY.minGradVolUsd).toBe(5_000);
    expect(ENTRY.gradMinMs).toBe(5 * 60_000);
    expect(ENTRY.gradMaxMs).toBe(30 * 60_000);
    expect(RULE_ID).toBe("g-grad-vol5k-half20-trail12-cap25-theme");
  });
  it("watches pump.fun graduates on PumpSwap quoted in SOL, with no rug filter", () => {
    expect(eligible(g()).ok).toBe(true);
    expect(eligible(g({ platform: "pump_mayhem" })).ok).toBe(true);
    expect(eligible(g({ platform: "meteora_virtual_curve", exchange: "meteora_damm_v2", token: "Xyz" })).ok).toBe(false);
    expect(eligible(g({ quote: "5dReBkDjES5SyRuasNHytYDmCqdupyoWTRUSTRgtpump" })).ok).toBe(false);
  });
});

import { EXIT, LOSS_CAP_PCT, THEME_MIN_GRAD_VOL_USD, THEME_TRADE_USD, dubaiDay, fetchWithDeadline, gmgnBackoffMs, nameKeys, reentryBlock, themeEntriesInWindow, themeOf, type LiveState } from "./graduation-live";

const st = (closed: Partial<LiveState["closed"][number]>[] = [], positions: Partial<LiveState["positions"][number]>[] = []) =>
  ({ closed, positions } as unknown as LiveState);

describe("graduation reliability", () => {
  it("times out a request that never answers", async () => {
    const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
    await expect(fetchWithDeadline("http://x", {}, 50, hang)).rejects.toThrow(/timeout/);
  });
  it("times out a body that never finishes", async () => {
    const slowBody = (async () => ({ status: 200, ok: true, headers: new Headers(), text: () => new Promise(() => {}) })) as unknown as typeof fetch;
    await expect(fetchWithDeadline("http://x", {}, 50, slowBody)).rejects.toThrow(/timeout/);
  });
  it("backs off GMGN exponentially with jitter, capped at 5 minutes", () => {
    expect(gmgnBackoffMs(1, null, () => 0.5)).toBe(30_000);
    expect(gmgnBackoffMs(2, null, () => 0.5)).toBe(60_000);
    expect(gmgnBackoffMs(10, null, () => 1)).toBe(300_000);
    expect(gmgnBackoffMs(1, 200_000, () => 0.5)).toBe(200_000);
    expect(gmgnBackoffMs(1, 3_600_000, () => 0.5)).toBe(300_000);
  });
});

describe("graduation strategy additions", () => {
  it("caps the loss at 25% for the whole position", () => {
    expect(LOSS_CAP_PCT).toBe(0.25);
    expect(EXIT.capStructureStop).toBe(0.25);
  });
  it("tags GTA and Jensen/Nvidia themes", () => {
    expect(themeOf("GTA 6 Coin", "GTA6")).toBe("gta");
    expect(themeOf("Rockstar G", "RSG")).toBe("gta");
    expect(themeOf(undefined, "VICE", "welcome to vice city")).toBe("gta");
    expect(themeOf("Jensen", "JENSEN")).toBe("jensen-nvidia");
    expect(themeOf("x", "NVDA")).toBe("jensen-nvidia");
    expect(themeOf("vegtables", "VEG")).toBeNull();
    expect(THEME_TRADE_USD).toBe(900);
    expect(THEME_MIN_GRAD_VOL_USD).toBe(3_000);
  });
  it("limits copycats to 2 per theme per 30 minutes", () => {
    const now = 10_000_000;
    const s = st([{ theme: "gta", openedAt: now - 10 * 60_000, fillTime: now - 10 * 60_000 } as never], [{ theme: "gta", openedAt: now - 60_000, fillTime: now - 60_000 } as never, { theme: "gta", openedAt: now - 40 * 60_000, fillTime: 0 } as never]);
    expect(themeEntriesInWindow(s, "gta", now)).toBe(2);
    expect(themeEntriesInWindow(s, "jensen-nvidia", now)).toBe(0);
  });
  it("blocks re-entry on the same name or leading word after a stop that Dubai day", () => {
    expect(nameKeys("Rockstar G")).toEqual(["rockstarg", "rockstar"]);
    const exit = Date.UTC(2026, 10, 12, 10);
    const s = st([{ symbol: "Rockstar", reason: "stop", exitTime: exit } as never, { symbol: "WIN", reason: "trail-stop", exitTime: exit } as never]);
    expect(reentryBlock(s, "RSG", "Rockstar G", exit + 3_600_000)).toBe("Rockstar");
    expect(reentryBlock(s, "WIN", "win", exit + 3_600_000)).toBeNull();
    expect(reentryBlock(s, "Rockstar", undefined, Date.UTC(2026, 10, 12, 21))).toBeNull(); // next Dubai day
    expect(dubaiDay(Date.UTC(2026, 10, 12, 20, 30))).toBe("2026-11-13");
  });
});
