export function usd(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function compactUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${n < 0 ? "-" : ""}$${(abs / 1_000).toFixed(1)}k`;
  return usd(n);
}

/** `fraction` is 0.02 for 2%. */
export function pct(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return "—";
  const sign = fraction > 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(digits)}%`;
}

export function pctPlain(fraction: number, digits = 2): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function price(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 6 : 8;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: Math.min(2, digits) });
}

export function qty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const digits = n >= 100 ? 4 : 8;
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function clsxJoin(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
