/**
 * Shabbat/Yom Tov blackout windows for the manual-confirmation live-trading
 * trial (David asked 2026-09-03: don't silently lose crypto entries while
 * he's off the phone for religious observance, but never execute
 * unattended — the caller queues candidates instead of proposing them, see
 * `liveBlackoutQueue.mts`).
 *
 * Times come from Hebcal's public calendar API for David's location
 * (Antwerp, Belgium — geonameid 2803138, confirmed directly against
 * Hebcal's own `/shabbat` response for that id, not guessed), fetched and
 * cached in the store so a normal cycle never makes a network call. A
 * blackout window is [first candle-lighting, next havdalah) — this
 * naturally spans a multi-day Yom Tov too, since Hebcal pairs the FIRST
 * candle-lighting of a run with the LAST havdalah after it (a 2-day Yom
 * Tov's own internal candle-lighting, lit from day 1's flame into day 2,
 * is skipped below since a window is already open).
 *
 * A calendar-fetch failure fails OPEN (no blackout assumed) — this feature
 * exists to respect Shabbat, not to protect capital, so an unreachable
 * calendar must never be able to silently pause live trading indefinitely.
 */

import type { KeyValueStore } from '../src/core/data/storage';

export interface BlackoutWindow {
  readonly start: number;
  readonly end: number;
  readonly label: string;
}

const CACHE_KEY = 'blackout-windows-cache';
const GEONAME_ID = 2803138; // Antwerp, Belgium
const FETCH_HORIZON_DAYS = 120;
const REFRESH_WHEN_UNCOVERED_DAYS = 30;
/** Same bound every other external call in this codebase uses (telegram.mts,
 * okxPositioning.ts, etc.) — found 2026-09-03 in a full-system audit after
 * the earlier missing-timeout incident: this fetch runs inside the SAME
 * live-trading cycle loop, unconditionally whenever the cache needs
 * refreshing, with nothing to time it out if Hebcal ever stalls. */
const FETCH_TIMEOUT_MS = 15_000;

interface HebcalItem {
  readonly category: string;
  readonly date: string;
  readonly title: string;
  readonly yomtov?: boolean;
}

interface CacheEntry {
  readonly fetchedAt: number;
  readonly windows: readonly BlackoutWindow[];
}

export function parseBlackoutWindows(items: readonly HebcalItem[]): BlackoutWindow[] {
  const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
  const windows: BlackoutWindow[] = [];
  let openStart: number | null = null;
  for (const item of sorted) {
    if (item.category === 'candles' && openStart === null) {
      openStart = new Date(item.date).getTime();
    } else if (item.category === 'havdalah' && openStart !== null) {
      const end = new Date(item.date).getTime();
      const start = openStart;
      const holiday = sorted.find((i) => {
        if (i.category !== 'holiday' || i.yomtov !== true) return false;
        const t = new Date(i.date).getTime();
        return t >= start && t < end;
      });
      windows.push({ start, end, label: holiday?.title ?? 'שבת' });
      openStart = null;
    }
  }
  return windows;
}

async function fetchBlackoutWindows(now: number, fetchFn: typeof fetch): Promise<readonly BlackoutWindow[] | null> {
  const start = new Date(now).toISOString().slice(0, 10);
  const end = new Date(now + FETCH_HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url =
    `https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&mod=off&nx=off&mf=off&ss=off` +
    `&c=on&geonameid=${GEONAME_ID}&start=${start}&end=${end}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { items?: HebcalItem[] };
    return parseBlackoutWindows(data.items ?? []);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the cached windows, refreshing from Hebcal only when the cache
 * doesn't reach far enough into the future — never on every cycle. */
export async function ensureBlackoutWindows(
  store: KeyValueStore,
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<readonly BlackoutWindow[]> {
  const cached = store.get<CacheEntry>(CACHE_KEY);
  const horizon = now + REFRESH_WHEN_UNCOVERED_DAYS * 24 * 60 * 60 * 1000;
  if (cached && cached.windows.some((w) => w.end > horizon)) return cached.windows;
  const fetched = await fetchBlackoutWindows(now, fetchFn);
  if (fetched === null) return cached?.windows ?? [];
  store.set(CACHE_KEY, { fetchedAt: now, windows: fetched });
  return fetched;
}

export function isBlackout(windows: readonly BlackoutWindow[], now: number): BlackoutWindow | null {
  return windows.find((w) => now >= w.start && now < w.end) ?? null;
}
