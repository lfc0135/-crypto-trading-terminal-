import crypto from "node:crypto";

export function okxPrehash(timestamp: string, method: string, pathWithQuery: string, body: string): string {
  return timestamp + method.toUpperCase() + pathWithQuery + body;
}

export function okxSign(secret: string, timestamp: string, method: string, pathWithQuery: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(okxPrehash(timestamp, method, pathWithQuery, body)).digest("base64");
}

/** `{path}:{sorted query}:{body}:{timestamp}` — GMGN signed-auth message. */
export function gmgnMessage(
  subPath: string,
  query: Record<string, string | number>,
  body: string,
  timestamp: number,
): string {
  const sorted = Object.keys(query)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`)
    .join("&");
  return `${subPath}:${sorted}:${body}:${timestamp}`;
}

export function gmgnSign(message: string, pem: string): string {
  const key = crypto.createPrivateKey(pem);
  const data = Buffer.from(message, "utf8");
  if (key.asymmetricKeyType === "ed25519") {
    return crypto.sign(null, data, key).toString("base64");
  }
  if (key.asymmetricKeyType === "rsa") {
    return crypto.sign("sha256", data, {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    }).toString("base64");
  }
  throw new Error("GMGN_PRIVATE_KEY must be an Ed25519 or RSA PEM. It signs API requests. It is not a wallet key.");
}
