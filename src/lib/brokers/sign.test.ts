import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { gmgnMessage, okxPrehash, okxSign } from "./sign";

describe("request signatures", () => {
  it("builds the OKX prehash as timestamp + method + path + body", () => {
    expect(okxPrehash("2020-01-01T00:00:00.000Z", "get", "/api/v5/account/balance?ccy=USDT", "")).toBe(
      "2020-01-01T00:00:00.000ZGET/api/v5/account/balance?ccy=USDT",
    );
    expect(okxSign("secret", "t", "POST", "/api/v5/trade/order", "{\"a\":1}")).toBe(
      crypto.createHmac("sha256", "secret").update("tPOST/api/v5/trade/order{\"a\":1}").digest("base64"),
    );
  });

  it("builds the GMGN signed message with sorted query parameters", () => {
    expect(gmgnMessage("/v1/trade/swap", { client_id: "abc", timestamp: 10 }, "{\"chain\":\"sol\"}", 10)).toBe(
      "/v1/trade/swap:client_id=abc&timestamp=10:{\"chain\":\"sol\"}:10",
    );
  });
});
