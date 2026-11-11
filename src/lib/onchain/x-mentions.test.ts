import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MentionClient, mentionJournalFields, mentionQuery } from "./x-mentions";

function tmpCache(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "x-mentions-")), "cache.json");
}

afterEach(() => {
  // nothing process-global to clear besides temp dirs left for the OS
});

describe("mentionQuery", () => {
  it("uses a cashtag plus the contract address for a simple ticker", () => {
    expect(mentionQuery("BERNIE", "GnQqJffn6mg5qSkdf6rHTmjxfaMhYcqxgMDYTCVfpump")).toBe(
      "$BERNIE OR GnQqJffn6mg5qSkdf6rHTmjxfaMhYcqxgMDYTCVfpump",
    );
  });
  it("falls back to the contract address when the symbol is not a cashtag", () => {
    expect(mentionQuery("月薪喵", "4qperWiuSvkn1r3T6ZZkWThzadoxttAeNbPdbDJTpump")).toBe(
      "4qperWiuSvkn1r3T6ZZkWThzadoxttAeNbPdbDJTpump",
    );
  });
});

describe("MentionClient", () => {
  const around = Date.UTC(2026, 10, 11, 19, 0, 0);

  it("returns no_credentials immediately when no bearer token is set, and does not call fetch", async () => {
    let calls = 0;
    const client = new MentionClient({
      token: null,
      cachePath: tmpCache(),
      now: () => around,
      fetch: (async () => { calls += 1; throw new Error("should not fetch"); }) as typeof fetch,
    });
    const reading = await client.countAround("BERNIE", "Token111", around, "graduation");
    expect(reading.status).toBe("no_credentials");
    expect(reading.count).toBeNull();
    expect(reading.source).toBe("none");
    expect(calls).toBe(0);
    expect(mentionJournalFields(reading, "graduation").xMentionStatus).toBe("no_credentials");
  });

  it("records the total from the recent counts API and reuses the cache", async () => {
    let calls = 0;
    const client = new MentionClient({
      token: "test-token",
      cachePath: tmpCache(),
      now: () => around + 60_000,
      fetch: (async (_url, init) => {
        calls += 1;
        const headers = new Headers(init?.headers);
        if (!headers.get("authorization")?.startsWith("Bearer ")) throw new Error("missing bearer");
        return new Response(JSON.stringify({ meta: { total_tweet_count: 7 }, data: [{ tweet_count: 3 }, { tweet_count: 4 }] }), { status: 200 });
      }) as typeof fetch,
    });
    const first = await client.countAround("BERNIE", "Token111", around, "graduation");
    const second = await client.countAround("BERNIE", "Token111", around, "graduation");
    expect(first).toMatchObject({ count: 7, status: "ok", source: "x-tweets-counts-recent" });
    expect(second).toMatchObject({ count: 7, status: "cached", source: "cache" });
    expect(calls).toBe(1);
  });

  it("backs off on 429 without waiting for the reset, and does not retry", async () => {
    let calls = 0;
    const client = new MentionClient({
      token: "test-token",
      cachePath: tmpCache(),
      now: () => around + 60_000,
      timeoutMs: 200,
      fetch: (async () => {
        calls += 1;
        return new Response("rate", { status: 429, headers: { "x-rate-limit-reset": String(Math.floor((around + 60_000) / 1000) + 30) } });
      }) as typeof fetch,
    });
    const first = await client.countAround("AAA", "TokenA", around, "entry");
    const second = await client.countAround("BBB", "TokenB", around + 1, "entry");
    expect(first.status).toBe("rate_limited");
    expect(first.count).toBeNull();
    expect(second.status).toBe("rate_limited");
    expect(calls).toBe(1);
  });

  it("honours the per-minute cap without calling the API", async () => {
    let calls = 0;
    const client = new MentionClient({
      token: "test-token",
      cachePath: tmpCache(),
      now: () => around + 60_000,
      maxPerMinute: 1,
      fetch: (async () => {
        calls += 1;
        return new Response(JSON.stringify({ meta: { total_tweet_count: 1 } }), { status: 200 });
      }) as typeof fetch,
    });
    const first = await client.countAround("AAA", "TokenA", around, "exit");
    const second = await client.countAround("BBB", "TokenB", around, "exit");
    expect(first.status).toBe("ok");
    expect(second.status).toBe("minute_limit");
    expect(second.count).toBeNull();
    expect(calls).toBe(1);
  });

  it("returns timeout when the API hangs past the short deadline", async () => {
    const client = new MentionClient({
      token: "test-token",
      cachePath: tmpCache(),
      now: () => around + 60_000,
      timeoutMs: 40,
      fetch: (async (_url, init) => {
        await new Promise((r) => setTimeout(r, 500));
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        return new Response(JSON.stringify({ meta: { total_tweet_count: 9 } }), { status: 200 });
      }) as typeof fetch,
    });
    const started = Date.now();
    const reading = await client.countAround("AAA", "TokenA", around, "graduation");
    expect(reading.status).toBe("timeout");
    expect(reading.count).toBeNull();
    expect(Date.now() - started).toBeLessThan(400);
  });
});
