/**
 * `server/autopilotRunner.mts` is the headless cloud runner — it makes the
 * real (simulated-money) trading decisions and drives every Telegram alert,
 * yet had zero test coverage before this. Two real bugs (the daily digest and
 * the weekly/monthly reports both silently skipping a whole period after a
 * coverage gap) were only found by manual review, which is exactly the class
 * of regression these tests exist to catch automatically.
 *
 * The module ran `await main()` unconditionally at the top level, executing a
 * live cycle against real exchanges on import. It's now guarded to only run
 * when invoked directly (`npx tsx server/autopilotRunner.mts`), so importing
 * it here for its exported helpers is side-effect-free.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStore } from '../../server/fileStore.mts';
import {
  breakerEngaged,
  localDayAndHour,
  maybeSendPeriodicReports,
  maybeSendSummaries,
} from '../../server/autopilotRunner.mts';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle, Instrument } from '../../src/core/types';

const DAY_MS = 86_400_000;

let dir: string;
let store: FileStore;
const ORIGINAL_SUMMARY_TIMEZONE = process.env['SUMMARY_TIMEZONE'];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'autopilot-runner-'));
  store = new FileStore(join(dir, 'state.json'));
  // getSummaryTimezone() is read fresh on every call (not a frozen
  // module-level default), specifically so this can pin these tests to a
  // fixed timezone regardless of whatever the hardcoded fallback in
  // autopilotRunner.mts currently is (it moves around as the user travels).
  process.env['SUMMARY_TIMEZONE'] = 'Asia/Jerusalem';
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (ORIGINAL_SUMMARY_TIMEZONE === undefined) delete process.env['SUMMARY_TIMEZONE'];
  else process.env['SUMMARY_TIMEZONE'] = ORIGINAL_SUMMARY_TIMEZONE;
});

describe('localDayAndHour', () => {
  it('reads the local day, hour and weekday in the given timezone', () => {
    // 2026-07-28T21:30:00Z = 2026-07-29 00:30 in Asia/Jerusalem (UTC+3 in summer).
    const parts = localDayAndHour(Date.parse('2026-07-28T21:30:00Z'), 'Asia/Jerusalem');
    expect(parts.day).toBe('2026-07-29');
    expect(parts.hour).toBe(0);
    expect(parts.dayOfMonth).toBe(29);
  });

  it('never returns hour 24 at local midnight (some Intl engines emit it)', () => {
    const parts = localDayAndHour(Date.parse('2026-01-01T22:00:00Z'), 'Asia/Jerusalem');
    expect(parts.hour).toBeGreaterThanOrEqual(0);
    expect(parts.hour).toBeLessThan(24);
  });
});

describe('breakerEngaged', () => {
  it('is false with no recorded peak or equity history', () => {
    expect(breakerEngaged(store)).toBe(false);
  });

  it('engages once current equity is far enough below the recorded peak', () => {
    store.set('equity-peak', 10_000);
    store.set('equity-history', [{ at: 0, equity: 10_000 }, { at: 1, equity: 9_000 }]); // -10%
    expect(breakerEngaged(store)).toBe(true);
  });

  it('stays disengaged for a shallow dip', () => {
    store.set('equity-peak', 10_000);
    store.set('equity-history', [{ at: 0, equity: 10_000 }, { at: 1, equity: 9_800 }]); // -2%
    expect(breakerEngaged(store)).toBe(false);
  });
});

const btcCandle = (close: number): Candle => ({ timestamp: 0, open: close, high: close, low: close, close, volume: 1 });
const btcInstrument: Instrument = { symbol: 'BTC-EUR', base: 'BTC', quote: 'EUR' };

function fakeSource(): MarketDataSource {
  return {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [btcInstrument] }),
    getCandles: async () => ({ ok: true, value: [btcCandle(50_000), btcCandle(50_000)] }),
  };
}

function buildPortfolio(): { portfolio: PortfolioEngine; journal: TradeJournal } {
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'EUR' });
  return { portfolio, journal };
}

describe('maybeSendSummaries (the exact bug class already found once)', () => {
  it('sends the digest once due, and never a second time the same day', async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };
    const { portfolio, journal } = buildPortfolio();

    // 08:30 local time in Asia/Jerusalem -> morning slot is due.
    const morning = Date.parse('2026-07-28T05:30:00Z');
    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, morning);
    expect(sent).toHaveLength(1);

    // A second cycle the same morning must NOT resend.
    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, morning + 60_000);
    expect(sent).toHaveLength(1);
  });

  it('does nothing without Telegram credentials configured', async () => {
    const fetchFn = vi.fn();
    const telegram = { token: '', chatId: '', fetchFn: fetchFn as unknown as typeof fetch };
    const { portfolio, journal } = buildPortfolio();
    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, Date.parse('2026-07-28T05:30:00Z'));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('maybeSendPeriodicReports — elapsed-time gating survives a coverage gap', () => {
  it('a gap spanning the exact weekly moment only delays the report, never loses it', async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };
    const { portfolio, journal } = buildPortfolio();

    // Anchor the weekly window far enough in the past that it's already due,
    // simulating "the runner was offline through the exact Sunday-evening
    // window" — the old exact-calendar-match code would have skipped this
    // report for the entire week; elapsed-time gating must still send it.
    const anchoredAt = Date.parse('2026-07-01T18:00:00Z');
    store.set('weekly-anchor', { at: anchoredAt, equity: 10_000 });
    // Evening, well past 7 days after the anchor, and NOT the exact anchor day.
    const now = Date.parse('2026-07-20T19:00:00Z'); // 22:00 Asia/Jerusalem
    await maybeSendPeriodicReports(store, fakeSource(), portfolio, journal, telegram, now);
    expect(sent.length).toBeGreaterThan(0);
  });

  it('does not resend the same report twice on the same local day', async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };
    const { portfolio, journal } = buildPortfolio();

    const now = Date.parse('2026-07-20T19:00:00Z');
    await maybeSendPeriodicReports(store, fakeSource(), portfolio, journal, telegram, now);
    const firstCount = sent.length;
    expect(firstCount).toBeGreaterThan(0);

    await maybeSendPeriodicReports(store, fakeSource(), portfolio, journal, telegram, now + 60_000);
    expect(sent.length).toBe(firstCount);
  });

  it('before hour 22 local, nothing is sent even if otherwise due', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const telegram = { token: 'T', chatId: 'C', fetchFn: fetchFn as unknown as typeof fetch };
    const { portfolio, journal } = buildPortfolio();
    // 10:00 Asia/Jerusalem — before the evening-only gate.
    await maybeSendPeriodicReports(store, fakeSource(), portfolio, journal, telegram, Date.parse('2026-07-20T07:00:00Z'));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
