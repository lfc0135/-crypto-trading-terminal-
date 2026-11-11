/**
 * Logging-only X mention counts for the graduation paper trader.
 * Counts are never used to filter or block entries. Fail-open: a missing key,
 * timeout, 429, or limit returns a status and no count, and the caller must still trade.
 *
 * Source: X API recent tweet counts (`GET /2/tweets/counts/recent`) when a bearer
 * token is present in X_BEARER_TOKEN or TWITTER_BEARER_TOKEN. No token is ever logged.
 */
import fs from "node:fs";
import path from "node:path";

export const MENTION_WINDOW_MS = 15 * 60_000;
export const MAX_CALLS_PER_MINUTE = 30;
export const MAX_CALLS_PER_DAY = 1_000;
export const CALL_TIMEOUT_MS = 1_500;
export const COUNTS_URL = "https://api.x.com/2/tweets/counts/recent";
export const MENTIONS_SOURCE = "x-tweets-counts-recent";

export type MentionStatus =
  | "ok"
  | "cached"
  | "no_credentials"
  | "timeout"
  | "rate_limited"
  | "daily_limit"
  | "minute_limit"
  | "error";

export interface MentionReading {
  query: string;
  windowStart: string;
  windowEnd: string;
  count: number | null;
  status: MentionStatus;
  source: "x-tweets-counts-recent" | "cache" | "none";
}

export type MentionAround = "graduation" | "entry" | "exit";

export interface MentionClientOptions {
  token?: string | null;
  fetch?: typeof fetch;
  now?: () => number;
  cachePath?: string;
  timeoutMs?: number;
  maxPerMinute?: number;
  maxPerDay?: number;
}

interface CacheEntry {
  count: number;
  windowStart: string;
  windowEnd: string;
  query: string;
  savedAt: number;
}

interface CacheFile {
  day: string;
  dayCalls: number;
  blockedUntil: number;
  entries: Record<string, CacheEntry>;
}

function emptyCache(day: string): CacheFile {
  return { day, dayCalls: 0, blockedUntil: 0, entries: {} };
}

/** Cashtag when the ticker is a simple $TICKER; always include the contract address. */
export function mentionQuery(symbol: string, token: string): string {
  const address = token.trim();
  const ticker = symbol.trim();
  const cashtag = /^[A-Za-z0-9]{1,15}$/.test(ticker) ? `$${ticker}` : null;
  if (cashtag && address) return `${cashtag} OR ${address}`;
  if (address) return address;
  if (cashtag) return cashtag;
  return ticker;
}

export function mentionJournalFields(reading: MentionReading, around: MentionAround): Record<string, unknown> {
  return {
    xMentionCount: reading.count,
    xMentionAround: around,
    xMentionWindowStart: reading.windowStart,
    xMentionWindowEnd: reading.windowEnd,
    xMentionStatus: reading.status,
    xMentionSource: reading.source,
  };
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function cacheKey(token: string, aroundMs: number, around: MentionAround): string {
  return `${token}|${around}|${aroundMs}`;
}

export class MentionClient {
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cachePath: string;
  private readonly timeoutMs: number;
  private readonly maxPerMinute: number;
  private readonly maxPerDay: number;
  private readonly recentCalls: number[] = [];
  private inflight = new Map<string, Promise<MentionReading>>();

  constructor(opts: MentionClientOptions = {}) {
    const envToken = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || "";
    this.token = (opts.token !== undefined ? opts.token : envToken) || null;
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.cachePath = opts.cachePath ?? path.join(process.cwd(), "data", "graduation", "x-mentions-cache.json");
    this.timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
    this.maxPerMinute = opts.maxPerMinute ?? MAX_CALLS_PER_MINUTE;
    this.maxPerDay = opts.maxPerDay ?? MAX_CALLS_PER_DAY;
  }

  /** Never throws. Never waits longer than the short timeout. */
  async countAround(symbol: string, token: string, aroundMs: number, around: MentionAround = "graduation"): Promise<MentionReading> {
    const query = mentionQuery(symbol, token);
    const { start, end } = this.window(aroundMs);
    const base = { query, windowStart: new Date(start).toISOString(), windowEnd: new Date(end).toISOString() };
    const blank = (status: MentionStatus, source: MentionReading["source"] = "none"): MentionReading => ({
      ...base, count: null, status, source,
    });
    try {
      return await Promise.race([
        this.lookup(symbol, token, aroundMs, around, base, blank),
        this.delay(this.timeoutMs).then(() => blank("timeout")),
      ]);
    } catch {
      return blank("error");
    }
  }

  private window(aroundMs: number): { start: number; end: number } {
    const now = this.now();
    // Recent search only covers the last 7 days; the API rejects a future end_time.
    const start = Math.max(aroundMs - MENTION_WINDOW_MS, now - 7 * 24 * 3_600_000 + 60_000);
    const end = Math.min(aroundMs + MENTION_WINDOW_MS, now - 1_000);
    if (end <= start) return { start: Math.max(now - MENTION_WINDOW_MS, now - 7 * 24 * 3_600_000 + 60_000), end: now - 1_000 };
    return { start, end };
  }

  private async lookup(
    symbol: string,
    token: string,
    aroundMs: number,
    around: MentionAround,
    base: { query: string; windowStart: string; windowEnd: string },
    blank: (status: MentionStatus, source?: MentionReading["source"]) => MentionReading,
  ): Promise<MentionReading> {
    if (!this.token) return blank("no_credentials");
    const key = cacheKey(token, aroundMs, around);
    const cached = this.readCache();
    const hit = cached.entries[key];
    if (hit) {
      return {
        query: hit.query,
        windowStart: hit.windowStart,
        windowEnd: hit.windowEnd,
        count: hit.count,
        status: "cached",
        source: "cache",
      };
    }
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const pending = this.fetchCount(key, base, cached, blank);
    this.inflight.set(key, pending);
    try {
      return await pending;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async fetchCount(
    key: string,
    base: { query: string; windowStart: string; windowEnd: string },
    cached: CacheFile,
    blank: (status: MentionStatus, source?: MentionReading["source"]) => MentionReading,
  ): Promise<MentionReading> {
    const now = this.now();
    if (cached.blockedUntil > now) return blank("rate_limited");
    if (cached.dayCalls >= this.maxPerDay) return blank("daily_limit");
    const cutoff = now - 60_000;
    while (this.recentCalls.length && this.recentCalls[0] <= cutoff) this.recentCalls.shift();
    if (this.recentCalls.length >= this.maxPerMinute) return blank("minute_limit");

    const url = new URL(COUNTS_URL);
    url.searchParams.set("query", base.query);
    url.searchParams.set("granularity", "minute");
    url.searchParams.set("start_time", base.windowStart);
    url.searchParams.set("end_time", base.windowEnd);

    this.recentCalls.push(now);
    cached.dayCalls += 1;
    this.writeCache(cached);

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "User-Agent": "graduation-paper-mentions/0.1",
        },
        signal: ac.signal,
      });
      if (res.status === 429) {
        const reset = Number(res.headers.get("x-rate-limit-reset"));
        cached.blockedUntil = Number.isFinite(reset) && reset > 1e9 ? Math.min(reset * 1000, now + 120_000) : now + 30_000;
        this.writeCache(cached);
        return blank("rate_limited");
      }
      if (!res.ok) return blank("error");
      const json = (await res.json()) as { meta?: { total_tweet_count?: number }; data?: { tweet_count?: number }[] };
      const fromMeta = json.meta?.total_tweet_count;
      const fromRows = Array.isArray(json.data) ? json.data.reduce((s, r) => s + (r.tweet_count ?? 0), 0) : null;
      const count = typeof fromMeta === "number" ? fromMeta : fromRows;
      if (count == null || !Number.isFinite(count)) return blank("error");
      cached.entries[key] = { count, windowStart: base.windowStart, windowEnd: base.windowEnd, query: base.query, savedAt: now };
      this.writeCache(cached);
      return { ...base, count, status: "ok", source: MENTIONS_SOURCE };
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return blank(name === "AbortError" || name === "TimeoutError" ? "timeout" : "error");
    } finally {
      clearTimeout(timer);
    }
  }

  private readCache(): CacheFile {
    const day = utcDay(this.now());
    try {
      if (!fs.existsSync(this.cachePath)) return emptyCache(day);
      const parsed = JSON.parse(fs.readFileSync(this.cachePath, "utf8")) as CacheFile;
      if (parsed.day !== day) return { day, dayCalls: 0, blockedUntil: parsed.blockedUntil ?? 0, entries: this.prune(parsed.entries) };
      parsed.entries = this.prune(parsed.entries ?? {});
      parsed.blockedUntil = parsed.blockedUntil ?? 0;
      parsed.dayCalls = parsed.dayCalls ?? 0;
      return parsed;
    } catch {
      return emptyCache(day);
    }
  }

  private prune(entries: Record<string, CacheEntry>): Record<string, CacheEntry> {
    const cutoff = this.now() - 24 * 3_600_000;
    const out: Record<string, CacheEntry> = {};
    for (const [k, v] of Object.entries(entries ?? {})) if (v && v.savedAt >= cutoff) out[k] = v;
    return out;
  }

  private writeCache(cache: CacheFile): void {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      const tmp = `${this.cachePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache));
      fs.renameSync(tmp, this.cachePath);
    } catch {
      // Cache is best-effort; never break the trader.
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

let defaultClient: MentionClient | null = null;

export function mentionClient(): MentionClient {
  if (!defaultClient) defaultClient = new MentionClient();
  return defaultClient;
}

/** Test helper to drop the process-wide client. */
export function resetMentionClient(): void {
  defaultClient = null;
}
