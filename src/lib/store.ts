import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readConfig } from "./config";
import { blankSettings } from "./settings";
import { dubaiDayKey } from "./time";
import type { Ledger } from "./types";

const file = path.join(process.cwd(), "data", "ledger.json");

export function freshLedger(now = Date.now()): Ledger {
  const principal = readConfig().principal;
  return {
    version: 1,
    settings: blankSettings(),
    account: {
      principal,
      cash: principal,
      createdAt: now,
      dayKey: dubaiDayKey(new Date(now)),
      dayStartEquity: principal,
      peakEquity: principal,
      positions: [],
      openOrders: [],
      fills: [],
      audits: [{
        id: crypto.randomUUID(),
        ts: now,
        level: "info",
        kind: "open",
        message: `Paper book opened at ${principal.toLocaleString("en-US")} USDT. No exchange keys are loaded. Orders stay on this machine.`,
      }],
      equityCurve: [{ ts: now, equity: principal }],
      dailyKillLatched: false,
      drawdownKillLatched: false,
      drawdownKillEver: false,
      liveConfirmedAt: null,
    },
  };
}

function readFile(): Ledger {
  if (!fs.existsSync(file)) {
    const ledger = freshLedger();
    writeFile(ledger);
    return ledger;
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
  if (parsed.version !== 1 || !parsed.account || !parsed.settings) throw new Error("Paper ledger is unreadable.");
  return parsed;
}

function writeFile(ledger: Ledger) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger));
  fs.renameSync(tmp, file);
}

let queue: Promise<unknown> = Promise.resolve();

export function updateLedger<T>(fn: (ledger: Ledger) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const draft = structuredClone(readFile());
    const result = await fn(draft);
    writeFile(draft);
    return result;
  });
  queue = run.then(() => undefined, () => undefined);
  return run;
}
