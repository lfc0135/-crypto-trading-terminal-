export const DUBAI_TZ = "Asia/Dubai";

export function dubaiParts(date: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: DUBAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

export function dubaiDayKey(date = new Date()): string {
  const p = dubaiParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function dubaiMonthKey(date = new Date()): string {
  return dubaiDayKey(date).slice(0, 7);
}

export function formatDubai(date = new Date()): string {
  const p = dubaiParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** 00:00 Asia/Dubai for YYYY-MM, as a UTC millisecond timestamp. Dubai is UTC+4 year-round. */
export function dubaiMonthStartUtc(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return Date.UTC(y, m - 1, 1, 0, 0, 0) - 4 * 60 * 60 * 1000;
}

export function isLastBarOfDubaiDay(timeMs: number, barDurationMs: number): boolean {
  return dubaiDayKey(new Date(timeMs)) !== dubaiDayKey(new Date(timeMs + barDurationMs));
}

export function addMonths(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

/** Full Dubai months that ended before `now` and started after the account was created. */
export function completedDubaiMonths(createdAt: number, now: number): string[] {
  const createdMonth = dubaiMonthKey(new Date(createdAt));
  const nowMonth = dubaiMonthKey(new Date(now));
  const out: string[] = [];
  let cursor = addMonths(createdMonth, 1);
  while (cursor < nowMonth) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}
