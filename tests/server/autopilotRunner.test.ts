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
  buildLiveEntryResultMessage,
  localDayAndHour,
  maybeSendMoveAlerts,
  maybeSendPeriodicReports,
  maybeSendSummaries,
  readLiveSummary,
  readStocksSummary,
  runLiveMirror,
} from '../../server/autopilotRunner.mts';
import type { LiveEntryOutcome } from '../../server/liveEntryMirror.mts';
import { PrefixedStore } from '../../src/core/data/prefixedStore';
import { PortfolioEngine } from '../../src/core/position/portfolioEngine';
import { PositionEngine } from '../../src/core/position/positionEngine';
import { TradeJournal } from '../../src/core/position/tradeJournal';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import type { Candle, Instrument } from '../../src/core/types';

const DAY_MS = 86_400_000;

let dir: string;
let store: FileStore;
const ORIGINAL_SUMMARY_TIMEZONE = process.env['SUMMARY_TIMEZONE'];
const ORIGINAL_REAL_MONEY_ENABLED = process.env['REAL_MONEY_ENABLED'];
const ORIGINAL_REVOLUT_X_API_KEY = process.env['REVOLUT_X_API_KEY'];
const ORIGINAL_REVOLUT_X_PRIVATE_KEY_PEM = process.env['REVOLUT_X_PRIVATE_KEY_PEM'];

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
  if (ORIGINAL_REAL_MONEY_ENABLED === undefined) delete process.env['REAL_MONEY_ENABLED'];
  else process.env['REAL_MONEY_ENABLED'] = ORIGINAL_REAL_MONEY_ENABLED;
  if (ORIGINAL_REVOLUT_X_API_KEY === undefined) delete process.env['REVOLUT_X_API_KEY'];
  else process.env['REVOLUT_X_API_KEY'] = ORIGINAL_REVOLUT_X_API_KEY;
  if (ORIGINAL_REVOLUT_X_PRIVATE_KEY_PEM === undefined) delete process.env['REVOLUT_X_PRIVATE_KEY_PEM'];
  else process.env['REVOLUT_X_PRIVATE_KEY_PEM'] = ORIGINAL_REVOLUT_X_PRIVATE_KEY_PEM;
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

describe('readLiveSummary (the real Revolut X account folded into the daily digest, 2026-09-03)', () => {
  it('returns null when the live ledger has never been initialized (real money never enabled)', () => {
    const liveStore = new PrefixedStore(store, 'live');
    expect(readLiveSummary(liveStore, {})).toBeNull();
  });

  it('reports cash-only equity when there are no tracked positions and no external BTC', () => {
    const liveStore = new PrefixedStore(store, 'live');
    liveStore.set('live-cash-eur', 40.04);
    const summary = readLiveSummary(liveStore, {});
    expect(summary).not.toBeNull();
    expect(summary!.cash).toBe(40.04);
    expect(summary!.equity).toBe(40.04);
    expect(summary!.positions).toEqual([]);
    expect(summary!.externalBtcValue).toBe(0);
    expect(summary!.killSwitchEngaged).toBe(false);
  });

  it('adds the untracked external BTC holding, valued at the current XBTEUR price, to equity — never affecting sizing separately', () => {
    const liveStore = new PrefixedStore(store, 'live');
    liveStore.set('live-cash-eur', 40.04);
    liveStore.set('live-external-btc-qty', 0.00089742);
    const summary = readLiveSummary(liveStore, { XBTEUR: 67_514 });
    // 40.04 + 0.00089742 * 67,514 ≈ 100.6.
    expect(summary!.externalBtcValue).toBeCloseTo(60.58, 1);
    expect(summary!.equity).toBeCloseTo(100.62, 1);
  });

  it('reports a bot-tracked open position, marked to the current price', () => {
    const liveStore = new PrefixedStore(store, 'live');
    liveStore.set('live-cash-eur', 30);
    liveStore.set('live-open-positions', {
      'live-entry:XBTEUR': {
        id: 'live-entry:XBTEUR', symbol: 'BTC/EUR', quantity: 0.001, entryPrice: 90_000,
        stopLoss: 85_000, takeProfit: 100_000, highestPrice: 90_000, openedAt: 0,
        entryAssessment: { asset: 'XBTEUR' },
      },
    });
    const summary = readLiveSummary(liveStore, { XBTEUR: 100_000 });
    expect(summary!.positions).toEqual([{ symbol: 'XBTEUR', marketValue: 100, pctOfEquity: expect.any(Number) }]);
    expect(summary!.equity).toBe(130); // 30 cash + 0.001 * 100,000
  });

  it('reports whether the kill switch is engaged, and why', () => {
    const liveStore = new PrefixedStore(store, 'live');
    liveStore.set('live-cash-eur', 10);
    liveStore.set('kill-switch', { engaged: true, reason: 'manual pause' });
    const summary = readLiveSummary(liveStore, {});
    expect(summary!.killSwitchEngaged).toBe(true);
    expect(summary!.killSwitchReason).toBe('manual pause');
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

  it('retries a new-extreme alert next cycle after a transient send failure, instead of losing it forever (found in review, 2026-09-03: every OTHER alert in this file only persists its sent flag after checking result.sent — this one recorded the new extreme unconditionally)', async () => {
    let shouldFail = true;
    const sent: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      if (shouldFail) return new Response(JSON.stringify({ ok: false }), { status: 500 });
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

    // -5.5% -> a new extreme, but Telegram is down — must not be recorded as
    // already-alerted.
    await maybeSendMoveAlerts(store, priceSource(() => 94.5), portfolio, telegram);
    expect(sent).toHaveLength(0);

    // Telegram recovers; the SAME extreme (price unchanged) must still be
    // retried, not silently treated as already-handled.
    shouldFail = false;
    await maybeSendMoveAlerts(store, priceSource(() => 94.5), portfolio, telegram);
    expect(sent).toHaveLength(1);
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

describe('runLiveMirror (real-money wiring stays off until deliberately turned on)', () => {
  // A stub covering every Telegram call this cycle could make (getUpdates,
  // sendMessage) — always the empty/ok shape so nothing this test cares
  // about (a manual command, a new entry, an exit signal) is ever found.
  const fetchFn = (async () => new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 })) as unknown as typeof fetch;
  const telegram = { token: 'T', chatId: 'C', fetchFn };

  it('does nothing when REAL_MONEY_ENABLED is unset (the default)', async () => {
    delete process.env['REAL_MONEY_ENABLED'];
    process.env['REVOLUT_X_API_KEY'] = 'key';
    process.env['REVOLUT_X_PRIVATE_KEY_PEM'] = 'pem';
    await runLiveMirror(store, fakeSource(), [btcInstrument], telegram, [], {}, 1000);
    expect(store.get('live:live-cash-eur')).toBeUndefined();
  });

  it('does nothing when enabled but Revolut X credentials are not configured', async () => {
    process.env['REAL_MONEY_ENABLED'] = 'true';
    delete process.env['REVOLUT_X_API_KEY'];
    delete process.env['REVOLUT_X_PRIVATE_KEY_PEM'];
    await runLiveMirror(store, fakeSource(), [btcInstrument], telegram, [], {}, 1000);
    expect(store.get('live:live-cash-eur')).toBeUndefined();
  });

  it('does nothing when enabled and credentialed but Telegram is not configured (every live order needs a human tap)', async () => {
    process.env['REAL_MONEY_ENABLED'] = 'true';
    process.env['REVOLUT_X_API_KEY'] = 'key';
    process.env['REVOLUT_X_PRIVATE_KEY_PEM'] = 'pem';
    await runLiveMirror(store, fakeSource(), [btcInstrument], { token: '', chatId: '' }, [], {}, 1000);
    expect(store.get('live:live-cash-eur')).toBeUndefined();
  });

  it('initializes the live cash ledger, namespaced under "live:", once enabled and credentialed', async () => {
    process.env['REAL_MONEY_ENABLED'] = 'true';
    process.env['REVOLUT_X_API_KEY'] = 'key';
    process.env['REVOLUT_X_PRIVATE_KEY_PEM'] = 'pem';
    process.env['LIVE_STARTING_CASH_EUR'] = '100';
    await runLiveMirror(store, fakeSource(), [btcInstrument], telegram, [], {}, 1000);
    expect(store.get('live:live-cash-eur')).toBe(100);
    delete process.env['LIVE_STARTING_CASH_EUR'];
  });

  // David asked for this 2026-09-03: an always-visible kill-switch button
  // instead of remembering to type /pause — sent once, tracked, never
  // resent every cycle (a persistent reply keyboard stays pinned regardless).
  it('sends the persistent kill-switch keyboard exactly once, the first time real money is enabled', async () => {
    process.env['REAL_MONEY_ENABLED'] = 'true';
    process.env['REVOLUT_X_API_KEY'] = 'key';
    process.env['REVOLUT_X_PRIVATE_KEY_PEM'] = 'pem';
    const sendMessageCalls: unknown[] = [];
    const trackingFetch = (async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/sendMessage')) sendMessageCalls.push(JSON.parse(init!.body!));
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const trackingTelegram = { token: 'T', chatId: 'C', fetchFn: trackingFetch };

    await runLiveMirror(store, fakeSource(), [btcInstrument], trackingTelegram, [], {}, 1000);
    expect(store.get('live:kill-switch-keyboard-sent')).toBe(true);
    const keyboardSends = sendMessageCalls.filter((c) => (c as { reply_markup?: { keyboard?: unknown } }).reply_markup?.keyboard);
    expect(keyboardSends).toHaveLength(1);

    await runLiveMirror(store, fakeSource(), [btcInstrument], trackingTelegram, [], {}, 2000);
    const keyboardSendsAfterSecondCycle = sendMessageCalls.filter(
      (c) => (c as { reply_markup?: { keyboard?: unknown } }).reply_markup?.keyboard,
    );
    expect(keyboardSendsAfterSecondCycle).toHaveLength(1); // still just the one
  });

  // Regression, 2026-09-03: the live account's daily-loss circuit breaker
  // (`DailyLossTracker`) was never actually wired into `runLiveMirror` —
  // nothing read today's real realized loss when sizing a new live entry, so
  // `assessTrade`'s own `dailyLossLimitPct` check (3% of equity by default)
  // could never engage for real money no matter how much was lost that day.
  it('blocks a new live entry once today\'s recorded real losses hit the daily-loss limit', async () => {
    process.env['REAL_MONEY_ENABLED'] = 'true';
    process.env['REVOLUT_X_API_KEY'] = 'key';
    process.env['REVOLUT_X_PRIVATE_KEY_PEM'] = 'pem';
    process.env['LIVE_STARTING_CASH_EUR'] = '100';
    // now=1000 → UTC day '1970-01-01'; seed today's live-scoped daily-loss
    // state directly (same key/shape `DailyLossTracker` itself would write),
    // well past the default 3%-of-equity (~3€) allowance for a 100€ account.
    store.set('live:daily-loss', { day: '1970-01-01', loss: 10 });

    const opportunity = {
      symbol: 'BTC-EUR',
      timeframe: '1h' as const,
      direction: 'long' as const,
      levels: { entry: 100, stopLoss: 95, takeProfit: 115, riskReward: 3 },
      confidence: 70,
      confidenceComponents: [],
      explanation: 'test',
      warnings: [],
      basedOn: { score: 70, candleCount: 200 },
    };
    await runLiveMirror(
      store,
      fakeSource(),
      [btcInstrument],
      telegram,
      [{ symbol: 'BTC-EUR', quantity: 0, entry: 100, opportunity }],
      { 'BTC-EUR': 100 },
      1000,
    );

    // Blocked before ever reaching the broker/confirmation gate — no cash
    // moved and no position was ever tracked.
    expect(store.get('live:live-cash-eur')).toBe(100);
    expect(store.get('live:live-open-positions')).toBeUndefined();
    delete process.env['LIVE_STARTING_CASH_EUR'];
  });

  // Feature, 2026-09-03: David can't be on the phone during Shabbat/Yom Tov
  // (religious observance) and doesn't want automatic entries executed
  // unattended, but also doesn't want to silently lose them. A blackout
  // window queues the bot's own automatic proposals instead of pinging a
  // confirmation nobody can answer, then summarizes once it ends.
  describe('Shabbat/Yom Tov blackout queueing', () => {
    function calendarAndTelegramFetch(sent: { text: string }[]): typeof fetch {
      return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('hebcal.com')) {
          return new Response(
            JSON.stringify({
              items: [
                { category: 'candles', date: new Date(0).toISOString(), title: 'Candle lighting' },
                { category: 'havdalah', date: new Date(10_000).toISOString(), title: 'Havdalah' },
              ],
            }),
            { status: 200 },
          );
        }
        if (url.includes('sendMessage') && init?.body) {
          sent.push(JSON.parse(init.body as string));
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }) as unknown as typeof fetch;
    }

    const opportunity = {
      symbol: 'BTC-EUR',
      timeframe: '1h' as const,
      direction: 'long' as const,
      levels: { entry: 100, stopLoss: 95, takeProfit: 115, riskReward: 3 },
      confidence: 70,
      confidenceComponents: [],
      explanation: 'test',
      warnings: [],
      basedOn: { score: 70, candleCount: 200 },
    };

    beforeEach(() => {
      process.env['REAL_MONEY_ENABLED'] = 'true';
      process.env['REVOLUT_X_API_KEY'] = 'key';
      process.env['REVOLUT_X_PRIVATE_KEY_PEM'] = 'pem';
      process.env['LIVE_STARTING_CASH_EUR'] = '100';
    });
    afterEach(() => delete process.env['LIVE_STARTING_CASH_EUR']);

    // mirrorApprovedEntries is called EXACTLY as it always is during an
    // active window (proven by these tests never stubbing/bypassing it
    // away — unlike an earlier version of this feature, nothing here
    // short-circuits the real confirmation attempt; see
    // liveEntryMirror.test.ts for coverage of that path actually sending a
    // confirmation with a fake broker/gate). What's unique to blackout is
    // ONLY that the opportunity is also remembered, in case it never gets
    // answered by the time the window ends.
    it('remembers an automatically-approved entry in the queue while the window (now=1000, inside [0, 10000)) is active', async () => {
      const sent: { text: string }[] = [];
      const telegram = { token: 'T', chatId: 'C', fetchFn: calendarAndTelegramFetch(sent) };

      await runLiveMirror(
        store,
        fakeSource(),
        [btcInstrument],
        telegram,
        [{ symbol: 'BTC-EUR', quantity: 0, entry: 100, opportunity }],
        { 'BTC-EUR': 100 },
        1000,
      );

      expect(store.get('live:live-blackout-queue')).toEqual({
        'BTC-EUR': { symbol: 'BTC-EUR', entry: 100, stopLoss: 95, takeProfit: 115, queuedAt: 1000 },
      });
    });

    it('drains the queue into one Hebrew summary once the window ends, for whatever never got answered', async () => {
      const sent: { text: string }[] = [];
      const telegram = { token: 'T', chatId: 'C', fetchFn: calendarAndTelegramFetch(sent) };

      // Cycle 1: inside the window (now=1000) — confirmation sent, remembered.
      await runLiveMirror(
        store,
        fakeSource(),
        [btcInstrument],
        telegram,
        [{ symbol: 'BTC-EUR', quantity: 0, entry: 100, opportunity }],
        { 'BTC-EUR': 100 },
        1000,
      );
      // Cycle 2: after havdalah (now=20000, past the window's end at 10000),
      // still never answered — drains into a summary; no new opportunity.
      await runLiveMirror(store, fakeSource(), [btcInstrument], telegram, [], { 'BTC-EUR': 105 }, 20_000);

      expect(store.get('live:live-blackout-queue')).toEqual({});
      const summary = sent.find((m) => m.text.includes('🕯️'));
      expect(summary).toBeTruthy();
      expect(summary!.text).toContain('BTC-EUR');
      expect(summary!.text).toContain('/buy');
    });

    it('excludes a symbol from the end-of-window summary once it actually has an open position (David approved it mid-window)', async () => {
      const sent: { text: string }[] = [];
      const telegram = { token: 'T', chatId: 'C', fetchFn: calendarAndTelegramFetch(sent) };

      await runLiveMirror(
        store,
        fakeSource(),
        [btcInstrument],
        telegram,
        [{ symbol: 'BTC-EUR', quantity: 0, entry: 100, opportunity }],
        { 'BTC-EUR': 100 },
        1000,
      );

      // Simulate David tapping אשר mid-Shabbat: a real position now exists.
      store.set('live:live-open-positions', {
        'live-entry:BTC-EUR:1000': {
          id: 'live-entry:BTC-EUR:1000',
          symbol: 'BTC-EUR',
          quantity: 0.5,
          entryPrice: 100,
          stopLoss: 95,
          takeProfit: 115,
          highestPrice: 100,
          openedAt: 1000,
          entryAssessment: {
            approved: true,
            asset: 'BTC-EUR',
            entry: 100,
            stopLoss: 95,
            takeProfit: 115,
            positionSize: 0.5,
            positionValue: 50,
            riskAmount: 2.5,
            riskPercentage: 2.5,
            rewardRiskRatio: 3,
            portfolioExposure: 50,
            reasons: [],
            warnings: [],
          },
        },
      });

      await runLiveMirror(store, fakeSource(), [btcInstrument], telegram, [], { 'BTC-EUR': 105 }, 20_000);

      expect(store.get('live:live-blackout-queue')).toEqual({});
      expect(sent.some((m) => m.text.includes('🕯️'))).toBe(false);
    });
  });
});

// David asked for this 2026-09-03: after tapping אשר/דחה he had no way to
// know what actually happened at the broker without asking me to read the
// audit log for him. buildLiveEntryResultMessage is the (pure, easy to
// test directly) piece that decides whether a follow-up Telegram message
// gets sent at all, and what it says.
describe('buildLiveEntryResultMessage (the post-decision follow-up David asked for)', () => {
  it('reports a real fill with quantity and average price', () => {
    const outcome: LiveEntryOutcome = {
      symbol: 'BTC-EUR',
      outcome: 'submitted',
      report: { intentId: 'x', state: 'filled', filledQuantity: 2, avgFillPrice: 99.5, detail: 'filled' },
    };
    const message = buildLiveEntryResultMessage(outcome);
    expect(message).toContain('בוצעה');
    expect(message).toContain('BTC-EUR');
    expect(message).toContain('2');
    expect(message).toContain('99.5');
  });

  it('reports a resting (not yet filled) order distinctly from a real fill', () => {
    const outcome: LiveEntryOutcome = {
      symbol: 'BTC-EUR',
      outcome: 'submitted',
      report: { intentId: 'x', state: 'submitted', filledQuantity: 0, avgFillPrice: null, detail: 'order venue-1 placed' },
    };
    const message = buildLiveEntryResultMessage(outcome);
    expect(message).toContain('ממתינה למילוי');
    expect(message).not.toContain('בוצעה בבורסה');
  });

  it('reports a broker-side rejection with the real detail (e.g. the HTTP 400 body)', () => {
    const outcome: LiveEntryOutcome = {
      symbol: 'BTC-EUR',
      outcome: 'submitted',
      report: {
        intentId: 'x',
        state: 'rejected',
        filledQuantity: 0,
        avgFillPrice: null,
        detail: 'Revolut X rejected the order: HTTP 400 — {"error":"size_too_small"}',
      },
    };
    const message = buildLiveEntryResultMessage(outcome);
    expect(message).toContain('דחתה');
    expect(message).toContain('size_too_small');
  });

  it('reports a human decline', () => {
    const outcome: LiveEntryOutcome = { symbol: 'BTC-EUR', outcome: 'rejected', decidedBy: 'C' };
    const message = buildLiveEntryResultMessage(outcome);
    expect(message).toContain('דחית');
    expect(message).toContain('BTC-EUR');
  });

  it('stays silent for outcomes that never reached a human decision (unchanged, audit-log-only)', () => {
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'entry-already-outstanding' })).toBeNull();
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'not-approved', reasons: ['x'] })).toBeNull();
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'no-broker-symbol' })).toBeNull();
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'unknown-symbol', detail: 'x' })).toBeNull();
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'missing-symbol-check' })).toBeNull();
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'blocked-by-kill-switch' })).toBeNull();
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'pending' })).toBeNull();
    expect(buildLiveEntryResultMessage({ symbol: 'BTC-EUR', outcome: 'stale-after-approval', reason: 'x' })).toBeNull();
  });
});
