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
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStore } from '../../server/fileStore.mts';
import {
  breakerEngaged,
  localDayAndHour,
  maybeSendMoveAlerts,
  maybeSendPeriodicReports,
  maybeSendSummaries,
  readStocksSummary,
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

function priceSource(getPrice: () => number): MarketDataSource {
  return {
    name: 'fake-price',
    getInstruments: async () => ({ ok: true, value: [btcInstrument] }),
    getCandles: async () => ({ ok: true, value: [btcCandle(getPrice()), btcCandle(getPrice())] }),
  };
}

describe('readStocksSummary (folds the isolated stocks side into the crypto digest)', () => {
  const ORIGINAL_STOCKS_STATE_PATH = process.env['STOCKS_STATE_PATH'];
  let stocksPath: string;

  beforeEach(() => {
    stocksPath = join(dir, 'stocks-state.json');
    process.env['STOCKS_STATE_PATH'] = stocksPath;
  });
  afterEach(() => {
    if (ORIGINAL_STOCKS_STATE_PATH === undefined) delete process.env['STOCKS_STATE_PATH'];
    else process.env['STOCKS_STATE_PATH'] = ORIGINAL_STOCKS_STATE_PATH;
  });

  it('returns null (not a fake empty account) when the stocks state file does not exist', () => {
    expect(readStocksSummary(Date.now())).toBeNull();
  });

  it('reads real equity/cash/P&L from the stocks state file using its own last-known prices', () => {
    const stocksStore = new FileStore(stocksPath);
    const stocksJournal = new TradeJournal(stocksStore);
    const stocksPositions = new PositionEngine(stocksStore, stocksJournal);
    const opened = stocksPositions.open({
      symbol: 'AAPL', quantity: 10, entryPrice: 200, stopLoss: 180, takeProfit: 240, timestamp: 0,
    });
    if (!opened.ok) throw new Error('open failed');
    // readStocksSummary reads cash/initialCash/closedRealizedPnl straight
    // off the store (deliberately not via PortfolioEngine — see its doc
    // comment), so this writes that same shape directly: 10,000 initial
    // minus the 2,000 spent opening the AAPL position above.
    stocksStore.set('portfolio-engine', { cash: 8_000, initialCash: 10_000, baseCurrency: 'USD', closedRealizedPnl: 0, dayAnchor: null });
    // No live Alpaca fetch available here — the last-known price snapshot
    // the stocks runner itself committed is what this must read instead.
    stocksStore.set('market-snapshot', { at: 0, symbols: [{ symbol: 'AAPL', price: 220, changePct: 10, updatedAt: 0 }] });

    const summary = readStocksSummary(1000);
    expect(summary).not.toBeNull();
    // cash 8,000 (10,000 - 10*200) + market value 10*220 = 10,200.
    expect(summary!.equity).toBeCloseTo(10_200, 5);
    expect(summary!.unrealizedPnl).toBeCloseTo(200, 5); // 10 * (220 - 200)
    expect(summary!.openedLast24h).toBe(1);
  });

  it('never writes back to the stocks state file (read-only)', () => {
    const stocksStore = new FileStore(stocksPath);
    new TradeJournal(stocksStore);
    stocksStore.set('portfolio-engine', { cash: 5_000, initialCash: 10_000, baseCurrency: 'USD', closedRealizedPnl: 0, dayAnchor: null });
    const contentBefore = readFileSync(stocksPath, 'utf8');
    readStocksSummary(Date.now());
    const contentAfter = readFileSync(stocksPath, 'utf8');
    expect(contentAfter).toBe(contentBefore);
  });

  it('folds in the long-term investing shadow standing when present', () => {
    const stocksStore = new FileStore(stocksPath);
    new TradeJournal(stocksStore);
    stocksStore.set('portfolio-engine', { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD', closedRealizedPnl: 0, dayAnchor: null });
    stocksStore.set('shadow-standings', {
      at: 0,
      standings: [
        {
          key: 'long-term',
          label: 'Long-term investing',
          equity: 10_500,
          returnPct: 5,
          trades: 25,
          winRatePct: 60,
          profitFactor: 1.8,
          openPositions: 1,
          startedAt: 0,
        },
      ],
    });

    const summary = readStocksSummary(Date.now());
    expect(summary?.longTermShadow?.key).toBe('long-term');
    expect(summary?.longTermShadow?.returnPct).toBe(5);
  });

  it('reports longTermShadow as null when no shadow standing has been recorded yet', () => {
    const stocksStore = new FileStore(stocksPath);
    new TradeJournal(stocksStore);
    stocksStore.set('portfolio-engine', { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD', closedRealizedPnl: 0, dayAnchor: null });

    const summary = readStocksSummary(Date.now());
    expect(summary?.longTermShadow ?? null).toBeNull();
  });

  it('folds in the stocks-side SPY benchmark when one has been recorded', () => {
    const stocksStore = new FileStore(stocksPath);
    new TradeJournal(stocksStore);
    stocksStore.set('portfolio-engine', { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD', closedRealizedPnl: 0, dayAnchor: null });
    stocksStore.set('benchmark-result', { label: 'S&P 500 (SPY)', portfolioPct: 4, assetPct: 6 });

    const summary = readStocksSummary(Date.now());
    expect(summary?.benchmark).toEqual({ label: 'S&P 500 (SPY)', portfolioPct: 4, assetPct: 6 });
  });

  it('reports benchmark as null when not measured yet', () => {
    const stocksStore = new FileStore(stocksPath);
    new TradeJournal(stocksStore);
    stocksStore.set('portfolio-engine', { cash: 10_000, initialCash: 10_000, baseCurrency: 'USD', closedRealizedPnl: 0, dayAnchor: null });

    const summary = readStocksSummary(Date.now());
    expect(summary?.benchmark ?? null).toBeNull();
  });
});

describe('maybeSendMoveAlerts (a real spam bug: wobbling near a threshold re-alerted every time)', () => {
  it('alerts once on a new extreme, and never again for the same or a shallower move', async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'EUR' });
    const opened = positions.open({
      symbol: 'XRP-EUR', quantity: 100, entryPrice: 100, stopLoss: 80, takeProfit: 130, timestamp: 0,
    });
    if (!opened.ok) throw new Error('open failed');

    let price = 100;
    // -5.5% -> a genuinely new extreme (crosses the -5% step for the first time).
    price = 94.5;
    await maybeSendMoveAlerts(store, priceSource(() => price), portfolio, telegram);
    expect(sent).toHaveLength(1);

    // Recovers to -4.8% -> back inside the band, no alert.
    price = 95.2;
    await maybeSendMoveAlerts(store, priceSource(() => price), portfolio, telegram);
    expect(sent).toHaveLength(1);

    // Wobbles back to -5.4% -> the SAME step already alerted, not a new extreme.
    // The pre-fix version compared only against the immediately-previous bucket
    // (which had reset to 0 on the recovery above) and would have re-sent here.
    price = 94.6;
    await maybeSendMoveAlerts(store, priceSource(() => price), portfolio, telegram);
    expect(sent).toHaveLength(1);

    // A genuinely deeper move (-11%) is a new extreme and does alert again.
    price = 89;
    await maybeSendMoveAlerts(store, priceSource(() => price), portfolio, telegram);
    expect(sent).toHaveLength(2);
  });

  it('migrates the old single-number bucket shape instead of going silent forever', async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };
    const journal = new TradeJournal(store);
    const positions = new PositionEngine(store, journal);
    const portfolio = new PortfolioEngine(store, positions, { initialCash: 10_000, baseCurrency: 'EUR' });
    const opened = positions.open({
      symbol: 'XRP-EUR', quantity: 100, entryPrice: 100, stopLoss: 80, takeProfit: 130, timestamp: 0,
    });
    if (!opened.ok) throw new Error('open failed');
    // Legacy shape: a plain number (the old "last bucket"), already at -1.
    store.set('move-alert-buckets', { [opened.value.id]: -1 });

    // A deeper move than the legacy value should still alert.
    const price = 89; // -11% -> bucket -2, deeper than the migrated neg extreme of -1.
    await maybeSendMoveAlerts(store, priceSource(() => price), portfolio, telegram);
    expect(sent).toHaveLength(1);
  });

  it('does nothing without Telegram credentials configured', async () => {
    const fetchFn = vi.fn();
    const telegram = { token: '', chatId: '', fetchFn: fetchFn as unknown as typeof fetch };
    const { portfolio } = buildPortfolio();
    await maybeSendMoveAlerts(store, priceSource(() => 90), portfolio, telegram);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('maybeSendSummaries (the exact bug class already found once)', () => {
  it('sends the digest once due, and never a second time the same day', async () => {
    const sent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      sent.push(String(url));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };
    const { portfolio, journal } = buildPortfolio();

    // 15:30 local time in Asia/Jerusalem -> the daily slot (hour 15) is due.
    const afternoon = Date.parse('2026-07-28T12:30:00Z');
    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, afternoon);
    expect(sent).toHaveLength(1);

    // A second cycle the same afternoon must NOT resend.
    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, afternoon + 60_000);
    expect(sent).toHaveLength(1);
  });

  it('does nothing without Telegram credentials configured', async () => {
    const fetchFn = vi.fn();
    const telegram = { token: '', chatId: '', fetchFn: fetchFn as unknown as typeof fetch };
    const { portfolio, journal } = buildPortfolio();
    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, Date.parse('2026-07-28T12:30:00Z'));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('before hour 15 local, nothing is sent even if otherwise due', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const telegram = { token: 'T', chatId: 'C', fetchFn: fetchFn as unknown as typeof fetch };
    const { portfolio, journal } = buildPortfolio();
    // 10:30 Asia/Jerusalem — before the single daily slot.
    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, Date.parse('2026-07-28T07:30:00Z'));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('folds crypto\'s own long-term shadow wallet standing into the digest text', async () => {
    let capturedText = '';
    const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
      capturedText = JSON.parse(String(init?.body)).text;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const telegram = { token: 'T', chatId: 'C', fetchFn };
    const { portfolio, journal } = buildPortfolio();
    store.set('shadow-longterm-standings', {
      at: 0,
      standings: [
        { key: 'long-term', label: 'Long-term investing', equity: 10_800, returnPct: 8, trades: 25, winRatePct: 60, profitFactor: 1.5, openPositions: 1, startedAt: 0 },
      ],
    });

    await maybeSendSummaries(store, fakeSource(), portfolio, journal, telegram, Date.parse('2026-07-28T12:30:00Z'));
    expect(capturedText).toContain('🌱 ארנק השקעות לטווח ארוך:');
    expect(capturedText).toContain('+8.00%');
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
