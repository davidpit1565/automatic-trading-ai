/**
 * Headless cloud autopilot runner — US STOCKS.
 *
 * Fully isolated from the crypto runner (`autopilotRunner.mts`): its own
 * state file, its own portfolio (USD), its own GitHub Actions workflow.
 * Nothing here can affect the crypto robot that already works.
 *
 * Reuses the exact same core engines as crypto (scanner -> signal -> risk ->
 * paper autopilot) unchanged — they were already asset-agnostic. SIMULATED
 * money only, same as crypto: there is no live-order path anywhere in core.
 *
 * Strategy constants below are the engine's permissive defaults, NOT a
 * measured tuning — unlike the crypto side's `AUTOPILOT_MIN_CONFIDENCE` /
 * `AUTOPILOT_MAX_RSI_FOR_LONG` / `AUTOPILOT_TRAILING` (each backed by a real
 * sweep on Kraken history), there is no real Alpaca data to measure against
 * yet. Do not read these as "production-tuned for stocks" — they are a
 * deliberately conservative starting point pending `scripts/sweepStrategy.mts`
 * run against real stock history, once ALPACA_API_KEY_ID/
 * ALPACA_API_SECRET_KEY are live. This is a "measure, don't guess" gap, not
 * an oversight.
 */

import { fileURLToPath } from 'node:url';
import { AlpacaStockSource, CURATED_STOCK_INSTRUMENTS, BROWSABLE_STOCK_INSTRUMENTS } from '../src/core/data/alpacaStocks';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import { isUsMarketOpen } from '../src/core/data/marketHours';
import { PersistedAuditLog } from '../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../src/core/autopilot/killSwitch';
import { PaperAutoPilot } from '../src/core/autopilot/paperAutoPilot';
import { PositionEngine } from '../src/core/position/positionEngine';
import { PortfolioEngine } from '../src/core/position/portfolioEngine';
import { TradeJournal } from '../src/core/position/tradeJournal';
import { DailyLossTracker } from '../src/core/risk/dailyLoss';
import { DEFAULT_RISK_LIMITS } from '../src/core/risk/riskEngine';
import { FileStore } from './fileStore.mts';
import { buildStockCycleMessage, sendTelegramMessage } from './telegram.mts';

const STATE_PATH = process.env['STOCKS_STATE_PATH'] ?? 'state/stocks-state.json';
const INITIAL_CASH = 10_000; // USD
const ENTRY_TF = '1h' as const;
const COST_RATE = Number(process.env['STOCKS_COST_RATE']) || 0.001; // Alpaca is commission-free; a small slippage allowance
const EQUITY_HISTORY_KEY = 'equity-history';
const EQUITY_HISTORY_CAP = 5000;
const ALERTED_TRADES_KEY = 'alerted-trade-ids';
const ALERTED_TRADES_CAP = 500;
const MARKET_SNAPSHOT_KEY = 'market-snapshot';
const MARKET_DAY_ANCHOR_KEY = 'market-day-anchor';
/**
 * Pause between the browsable list's extra (non-traded) price requests.
 * Alpaca's free/IEX tier allows ~200 requests/min per key; this caps the
 * snapshot sweep at a theoretical maximum of ~170/min, safely under that,
 * without needing a full request-queue class for what is still a small,
 * fixed-size sweep once per cycle.
 */
const SNAPSHOT_STAGGER_MS = Number(process.env['STOCKS_SNAPSHOT_STAGGER_MS']) || 350;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface MarketSnapshotEntry {
  readonly symbol: string;
  readonly price: number;
  /** Change vs. this UTC day's first recorded price (a simplification — the
   * exact previous close is not fetched separately — same trade-off already
   * accepted by PortfolioEngine's own `dayAnchor`). */
  readonly changePct: number;
  readonly updatedAt: number;
}

export function buildAlpacaSourceFromEnv(): AlpacaStockSource | null {
  const apiKeyId = process.env['ALPACA_API_KEY_ID'] ?? '';
  const apiSecretKey = process.env['ALPACA_API_SECRET_KEY'] ?? '';
  if (!apiKeyId || !apiSecretKey) return null;
  return new AlpacaStockSource({ apiKeyId, apiSecretKey });
}

/**
 * Records a per-symbol price snapshot for the curated stock universe (not
 * just symbols with open positions), so the browser can show "what does the
 * stocks robot see right now" without ever calling Alpaca directly — Alpaca
 * requires a secret key per request, unlike Kraken's public API, so the
 * browser can never call it safely. This is the read-only, no-keys
 * equivalent: written here (server-side, where the key already lives) and
 * read from the committed state file, same as every other cloud-state field.
 */
export function updateMarketSnapshot(
  store: FileStore,
  symbolPrices: Readonly<Record<string, number>>,
  now: number,
): void {
  const day = new Date(now).toISOString().slice(0, 10);
  const anchors = { ...(store.get<Record<string, { day: string; price: number }>>(MARKET_DAY_ANCHOR_KEY) ?? {}) };
  const entries: MarketSnapshotEntry[] = [];
  for (const [symbol, price] of Object.entries(symbolPrices)) {
    if (anchors[symbol] === undefined || anchors[symbol].day !== day) {
      anchors[symbol] = { day, price };
    }
    const anchorPrice = anchors[symbol].price;
    const changePct = anchorPrice > 0 ? ((price - anchorPrice) / anchorPrice) * 100 : 0;
    entries.push({ symbol, price, changePct, updatedAt: now });
  }
  store.set(MARKET_DAY_ANCHOR_KEY, anchors);
  store.set(MARKET_SNAPSHOT_KEY, { at: now, symbols: entries });
}

export async function recordEquity(
  store: FileStore,
  portfolio: PortfolioEngine,
  now: number,
  prices: Readonly<Record<string, number>>,
): Promise<void> {
  const equity = portfolio.snapshot(prices, now).equity;
  const history = store.get<Array<{ at: number; equity: number }>>(EQUITY_HISTORY_KEY) ?? [];
  history.push({ at: now, equity: Math.round(equity * 100) / 100 });
  store.set(
    EQUITY_HISTORY_KEY,
    history.length > EQUITY_HISTORY_CAP ? history.slice(-EQUITY_HISTORY_CAP) : history,
  );
}

/**
 * One full cycle: trade, heartbeat, then a Telegram notification for any
 * trades. Returns true if a trade opened or closed (mirrors the crypto
 * runner's return-value contract for the same reason: so a caller can choose
 * to persist state immediately after real activity).
 */
export async function runStocksCycle(
  store: FileStore,
  source: MarketDataSource,
  autopilot: PaperAutoPilot,
  portfolio: PortfolioEngine,
  telegram: { token: string; chatId: string },
  symbols: readonly string[],
  now: number,
  /** Pause between the browsable list's extra price requests (see
   * `SNAPSHOT_STAGGER_MS`). Defaults to 0 (no pause) so tests stay fast;
   * `main()` passes the real constant for actual cloud runs. */
  snapshotStaggerMs = 0,
): Promise<boolean> {
  const cycle = await autopilot.runCycleOnce(now);
  console.log(
    `Stocks cycle done via ${source.name}: opened ${cycle.opened.length}, ` +
      `closed ${cycle.closed.length}, skipped ${cycle.skipped.length}` +
      (cycle.halted ? ' (kill switch engaged)' : ''),
  );

  store.set('autopilot-last-run', {
    at: now,
    source: source.name,
    opened: cycle.opened.length,
    closed: cycle.closed.length,
    halted: cycle.halted,
  });

  const alerted = new Set(store.get<string[]>(ALERTED_TRADES_KEY) ?? []);
  const idKey = (kind: 'o' | 'c', id?: string): string | null => (id ? `${kind}:${id}` : null);
  const freshOpened = cycle.opened.filter((o) => {
    const k = idKey('o', o.id);
    return k === null || !alerted.has(k);
  });
  const freshClosed = cycle.closed.filter((c) => {
    const k = idKey('c', c.id);
    return k === null || !alerted.has(k);
  });
  const message = buildStockCycleMessage({ timestamp: cycle.timestamp, opened: freshOpened, closed: freshClosed });
  if (message !== null) {
    const result = await sendTelegramMessage(message, telegram);
    console.log(result.sent ? 'Stocks Telegram notification sent.' : `No notification: ${result.reason}`);
    if (result.sent) {
      for (const o of freshOpened) {
        const k = idKey('o', o.id);
        if (k) alerted.add(k);
      }
      for (const c of freshClosed) {
        const k = idKey('c', c.id);
        if (k) alerted.add(k);
      }
      store.set(ALERTED_TRADES_KEY, [...alerted].slice(-ALERTED_TRADES_CAP));
    }
  }

  const symbolPrices: Record<string, number> = {};
  for (const symbol of symbols) {
    const candles = await source.getCandles(symbol, ENTRY_TF, 2);
    if (candles.ok && candles.value.length > 0) {
      symbolPrices[symbol] = candles.value[candles.value.length - 1]!.close;
    }
  }
  await recordEquity(store, portfolio, now, symbolPrices);

  // Browsable-only symbols (BROWSABLE minus the traded set already priced
  // above): display prices for the wider list without fetching anything
  // twice. Staggered — this is 40 extra requests per cycle, not the 10 the
  // trading loop above makes, so it needs to respect Alpaca's rate limit
  // explicitly rather than relying on natural request spacing.
  const tradedSet = new Set(symbols);
  const browsableOnly = BROWSABLE_STOCK_INSTRUMENTS.map((i) => i.symbol).filter((s) => !tradedSet.has(s));
  const snapshotPrices: Record<string, number> = { ...symbolPrices };
  for (const symbol of browsableOnly) {
    const candles = await source.getCandles(symbol, ENTRY_TF, 2);
    if (candles.ok && candles.value.length > 0) {
      snapshotPrices[symbol] = candles.value[candles.value.length - 1]!.close;
    }
    if (snapshotStaggerMs > 0) await sleep(snapshotStaggerMs);
  }
  updateMarketSnapshot(store, snapshotPrices, now);

  return cycle.opened.length > 0 || cycle.closed.length > 0;
}

async function main(): Promise<void> {
  const now = Date.now();
  if (!isUsMarketOpen(now)) {
    console.log('US market closed — skipping this stocks cycle.');
    return;
  }
  const source = buildAlpacaSourceFromEnv();
  if (!source) {
    console.log('Alpaca credentials not configured (ALPACA_API_KEY_ID/ALPACA_API_SECRET_KEY) — skipping.');
    return;
  }

  const store = new FileStore(STATE_PATH);
  const symbols = CURATED_STOCK_INSTRUMENTS.map((i) => i.symbol);
  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, { initialCash: INITIAL_CASH, baseCurrency: 'USD' });
  const autopilot = new PaperAutoPilot({
    source,
    symbols,
    timeframe: ENTRY_TF,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio,
    positions,
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    getDailyLoss: () => new DailyLossTracker(store).lossToday(Date.now()),
    onRealizedPnl: (pnl, ts) => new DailyLossTracker(store).record(pnl, ts),
    costRate: COST_RATE,
    riskLimits: DEFAULT_RISK_LIMITS,
  });

  const telegram = {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  };

  try {
    await runStocksCycle(store, source, autopilot, portfolio, telegram, symbols, now, SNAPSHOT_STAGGER_MS);
  } catch (cause) {
    console.error('Stocks cycle failed:', cause instanceof Error ? cause.message : cause);
  }
}

// Only run when invoked directly, never on import — see autopilotRunner.mts
// for why (tests import the exported pieces above without triggering a
// live cycle).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
