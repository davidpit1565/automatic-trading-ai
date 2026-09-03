/**
 * Headless cloud autopilot runner — US STOCKS.
 *
 * Fully isolated from the crypto runner (`autopilotRunner.mts`): its own
 * state file, its own portfolio (USD), its own GitHub Actions workflow.
 * Nothing here can affect the crypto agent that already works.
 *
 * SIMULATED money only, same as crypto: there is no live-order path anywhere
 * in core.
 *
 * **PASSIVE BUY-AND-HOLD, not signal-driven trading (decided 2026-09-02).**
 * Every lever measured across many sessions — parameter tuning, alternative
 * signal families, regime filters, trend-following exits — failed to close
 * an ~8x gap to simply holding the same 10 curated majors (see
 * PROJECT_STATE.md). Rather than keep researching a strategy that
 * structurally can't win, the real account now holds an equal-weighted
 * basket and never sells (`runPassiveHoldCycle`) — it IS the benchmark, by
 * construction, not an attempt to beat it. No signal evaluation, no
 * risk-per-trade sizing, no stop-loss/take-profit. The signal-driven
 * `PaperAutoPilot` engine (still fully asset-agnostic, shared with crypto)
 * is kept ONLY for the isolated, zero-real-risk shadow evaluations below —
 * if a genuinely different edge is found there later, it can be promoted
 * deliberately; nothing here does that automatically.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AlpacaStockSource, CURATED_STOCK_INSTRUMENTS, BROWSABLE_STOCK_INSTRUMENTS } from '../src/core/data/alpacaStocks';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import { CachingSource } from '../src/core/data/cachingSource';
import { isUsMarketOpen } from '../src/core/data/marketHours';
import { PersistedKillSwitch } from '../src/core/autopilot/killSwitch';
import type { CycleResult } from '../src/core/autopilot/paperAutoPilot';
import { runShadowCycle, type ShadowCandidate } from '../src/core/autopilot/shadowEvaluator';
import { PositionEngine } from '../src/core/position/positionEngine';
import { PortfolioEngine } from '../src/core/position/portfolioEngine';
import { TradeJournal } from '../src/core/position/tradeJournal';
import { tradeAnalytics } from '../src/core/position/analytics';
import { maxDrawdownPct } from '../src/core/backtest/metrics';
import { assessRealMoneyReadiness } from '../src/core/feedback/realMoneyReadiness';
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
/** Stored real-money readiness verdict, mirroring the crypto runner (see `autopilotRunner.mts`). */
const READINESS_KEY = 'real-money-readiness';
const DAY_MS = 24 * 60 * 60 * 1000;
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
/**
 * Internal cycle loop, mirroring the crypto runner's fix for the same root
 * cause (`autopilotRunner.mts`'s `LOOP_CYCLES`/`STATE_COMMIT_EVERY`, measured
 * 2026-08-17): GitHub's scheduler is unreliable at high cron frequency, so a
 * single-cycle-per-trigger design silently loses most of its intended runs.
 * Measured 2026-08-21: despite `stocks-autopilot.yml`'s nominal every-15-
 * minute cron, actual gaps between recorded equity-history points during market
 * hours were mostly 60-110 minutes — the stocks side never got crypto's
 * mitigation. 24 cycles * 5 min = 120 min of coverage per trigger, safely
 * past the worst gap measured.
 */
const LOOP_CYCLES = Math.max(1, Number(process.env['STOCKS_LOOP_CYCLES']) || 1);
const LOOP_INTERVAL_MS = Number(process.env['STOCKS_LOOP_INTERVAL_MS']) || 300_000;
/** Persist state to git every N cycles during the run (0 = only at run end). */
const STATE_COMMIT_EVERY = Math.max(0, Number(process.env['STOCKS_STATE_COMMIT_EVERY']) || 0);

/**
 * Commit + push the state file mid-run, same rationale and shape as the
 * crypto runner's `persistStateToGit` — duplicated rather than shared/
 * imported to keep the two sides fully isolated (see this file's header):
 * a bug in one's git-persistence helper must never be able to reach the
 * other's. Best-effort; only runs inside GitHub Actions.
 *
 * On a push race, merges at the JSON KEY level (origin's file as the base,
 * this run's own dirty keys — `FileStore.dirtyKeys()` — overlaid on top)
 * rather than `git rebase -X theirs`, which resolves a whole-file conflict
 * by discarding ALL of this run's changes wholesale. Same real incident and
 * fix as the crypto runner's own helper (2026-09-03, PROJECT_STATE.md) —
 * applied here too since this file duplicates the same vulnerable shape.
 */
function persistStateToGit(store: FileStore, label: string): void {
  if (process.env['GITHUB_ACTIONS'] !== 'true') return;
  const run = (cmd: string): string => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const hasStagedChanges = (): boolean => {
    try {
      run('git diff --staged --quiet');
      return false; // exit 0 = no differences
    } catch {
      return true; // non-zero = staged changes exist
    }
  };
  try {
    run('git config user.name "github-actions[bot]"');
    run('git config user.email "github-actions[bot]@users.noreply.github.com"');
    run(`git add ${STATE_PATH}`);
    if (!hasStagedChanges()) return;
    run(`git commit -m "Stocks autopilot state (mid-run ${label})"`);
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        run('git push origin HEAD:main');
        console.log(`Stocks state persisted mid-run (${label}).`);
        return;
      } catch {
        try {
          run('git fetch origin main');
          const origin = JSON.parse(run(`git show origin/main:${STATE_PATH}`)) as Record<string, unknown>;
          for (const key of store.dirtyKeys()) origin[key] = store.get(key);
          mkdirSync(dirname(STATE_PATH), { recursive: true });
          writeFileSync(STATE_PATH, JSON.stringify(origin, null, 2));
          run('git reset --soft origin/main');
          run(`git add ${STATE_PATH}`);
          if (hasStagedChanges()) run(`git commit -m "Stocks autopilot state (mid-run ${label})"`);
        } catch (mergeFailure) {
          console.error(
            'Stocks state merge-on-conflict failed:',
            mergeFailure instanceof Error ? mergeFailure.message : mergeFailure,
          );
        }
      }
    }
    console.error(`Could not persist stocks state mid-run (${label}) after retries.`);
  } catch (cause) {
    console.error('persistStateToGit failed:', cause instanceof Error ? cause.message : cause);
  }
}
// Since 2026-09-02 this floor gates ONLY the isolated shadow candidate below
// (STOCKS_SHADOW_CANDIDATES) — the real account is passive buy-and-hold and
// no longer evaluates any signal at all. Kept as the measured value
// (2026-08-31 sweepStrategy.mts run against real Alpaca history) so the
// shadow keeps forward-testing under the same conditions it was measured
// under, in case a genuinely different edge is found later.
const INTERIM_MIN_CONFIDENCE = 40;

/**
 * Long-term investing "wallet" (David asked for this 2026-08-31): a separate
 * paper portfolio that holds through weeks/months instead of the main
 * runner's tight-stop trading. Reuses the exact same signal/risk engine as
 * the main system (no new logic, per this project's own house style of
 * forward-testing a genuinely different IDEA rather than guessing new
 * mechanics — see `shadowEvaluator.ts`'s doc comment) but on DAILY bars
 * (naturally weeks/months-wide ATR stops instead of hourly-wide ones) with
 * `trendExit` replacing the fixed take-profit (already measured to help on
 * stocks, see the trend-exit note above) — hold through a trend, exit only
 * when the daily trend actually breaks. Fully isolated: its own namespaced
 * state inside `stocks-state.json`, no real money, cannot affect the main
 * stocks account.
 */
const STOCKS_SHADOW_STANDINGS_KEY = 'shadow-standings';
const STOCKS_SHADOW_LAST_RUN_DAY_KEY = 'shadow-last-run-day';
const STOCKS_SHADOW_CANDIDATES: readonly ShadowCandidate[] = [
  {
    key: 'long-term',
    label: 'Long-term investing (daily bars, EMA50 trend-exit — holds weeks/months)',
    minConfidence: INTERIM_MIN_CONFIDENCE,
    maxRsiForLong: 65,
    trendExit: { emaPeriod: 50 },
  },
];

/**
 * One cycle of the long-term shadow wallet, on the SAME curated symbols as
 * the main stocks account but on daily bars. Purely diagnostic/simulated —
 * a failure here is logged and never allowed to affect the real cycle,
 * which has already completed by this point (same contract as crypto's
 * `runShadows` in `autopilotRunner.mts`).
 */
async function runStocksShadow(store: FileStore, source: MarketDataSource, now: number): Promise<void> {
  // Daily bars only change once a day — the internal 5-minute cycle loop
  // (STOCKS_LOOP_CYCLES times per trigger) would otherwise re-fetch
  // identical daily candles and re-run the same evaluation for no new
  // information (same measured issue and fix as crypto's own
  // runLongTermShadow in autopilotRunner.mts). Not set on failure, so a
  // transient error gets retried on the very next cycle rather than
  // waiting a full day. UTC calendar day, same convention already used by
  // updateMarketSnapshot in this same file.
  const day = new Date(now).toISOString().slice(0, 10);
  if (store.get<string>(STOCKS_SHADOW_LAST_RUN_DAY_KEY) === day) return;
  try {
    const symbols = CURATED_STOCK_INSTRUMENTS.map((i) => i.symbol);
    const caching = new CachingSource(source);
    const prices: Record<string, number> = {};
    for (const symbol of symbols) {
      const candles = await caching.getCandles(symbol, '1d', 2);
      if (candles.ok && candles.value.length > 0) {
        prices[symbol] = candles.value[candles.value.length - 1]!.close;
      }
    }
    const { standings, failures } = await runShadowCycle(STOCKS_SHADOW_CANDIDATES, {
      source: caching,
      symbols,
      timeframe: '1d',
      initialCash: INITIAL_CASH,
      costRate: COST_RATE,
      baseCurrency: 'USD',
      store,
      now,
      prices,
    });
    store.set(STOCKS_SHADOW_STANDINGS_KEY, { at: now, standings });
    store.set(STOCKS_SHADOW_LAST_RUN_DAY_KEY, day);
    for (const failure of failures) {
      console.error(`Stocks shadow candidate '${failure.key}' failed: ${failure.reason}`);
    }
  } catch (cause) {
    console.error('Stocks shadow evaluation skipped:', cause instanceof Error ? cause.message : cause);
  }
}

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
 * stocks agent see right now" without ever calling Alpaca directly — Alpaca
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

const BENCHMARK_ANCHOR_KEY = 'benchmark-anchor';
/** Latest computed benchmark comparison, persisted so the crypto digest
 * (which has no Alpaca credentials — see `readStocksSummary` in
 * `autopilotRunner.mts`) can fold it in by reading the stocks state file
 * rather than fetching live. */
const BENCHMARK_RESULT_KEY = 'benchmark-result';
interface StocksBenchmarkAnchor {
  spy: number;
  equity: number;
  at: number;
}

/**
 * Compare the portfolio against simply holding SPY (S&P 500) over the same
 * window — same pattern as crypto's own BTC benchmark (`computeBenchmark`
 * in `autopilotRunner.mts`). The anchor (SPY price + portfolio equity) is
 * captured the first time this runs, so both returns are measured from the
 * same moment. Fails soft (null) on any fetch issue — the readiness gate
 * already treats a null benchmark as "not measured yet".
 */
async function computeStocksBenchmark(
  store: FileStore,
  source: MarketDataSource,
  equityNow: number,
  now: number,
): Promise<{ label: string; portfolioPct: number; assetPct: number } | null> {
  const candles = await source.getCandles('SPY', ENTRY_TF, 2);
  if (!candles.ok || candles.value.length === 0) return null;
  const spyNow = candles.value[candles.value.length - 1]!.close;
  if (!(spyNow > 0) || !(equityNow > 0)) return null;

  let anchor = store.get<StocksBenchmarkAnchor>(BENCHMARK_ANCHOR_KEY);
  if (!anchor || !(anchor.spy > 0) || !(anchor.equity > 0)) {
    anchor = { spy: spyNow, equity: equityNow, at: now };
    store.set(BENCHMARK_ANCHOR_KEY, anchor);
  }
  return {
    label: 'S&P 500 (SPY)',
    portfolioPct: ((equityNow - anchor.equity) / anchor.equity) * 100,
    assetPct: ((spyNow - anchor.spy) / anchor.spy) * 100,
  };
}

/**
 * Records an equity-history point and refreshes the real-money readiness
 * verdict from the trade journal — same shape as the crypto runner's
 * `recordEquity`, now including the same kind of buy-and-hold benchmark
 * comparison (SPY here, BTC there) instead of permanently reporting "not
 * measured yet".
 */
export async function recordEquity(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  now: number,
  prices: Readonly<Record<string, number>>,
): Promise<void> {
  const equity = portfolio.snapshot(prices, now).equity;
  const history = store.get<Array<{ at: number; equity: number }>>(EQUITY_HISTORY_KEY) ?? [];
  const firstAt = history[0]?.at ?? now;
  history.push({ at: now, equity: Math.round(equity * 100) / 100 });
  store.set(
    EQUITY_HISTORY_KEY,
    history.length > EQUITY_HISTORY_CAP ? history.slice(-EQUITY_HISTORY_CAP) : history,
  );

  const analytics = tradeAnalytics(journal.entries(), { initialCash: INITIAL_CASH });
  const liveDrawdownPct = maxDrawdownPct(history.map((point) => ({ timestamp: point.at, equity: point.equity })));
  const benchmark = await computeStocksBenchmark(store, source, equity, now);
  // Only overwrite the STORED comparison on an actual success — a transient
  // fetch failure returns null here (see computeStocksBenchmark's doc
  // comment) but must not clobber a real, already-anchored comparison the
  // cross-process digest (readStocksSummary in autopilotRunner.mts) reads
  // back later; the live readiness check just below still honestly reflects
  // "not measured THIS cycle" via `benchmark` itself.
  if (benchmark) store.set(BENCHMARK_RESULT_KEY, benchmark);
  const readiness = assessRealMoneyReadiness({
    closedTrades: analytics.tradeCount,
    profitFactor: analytics.profitFactor,
    // Mark-to-market (unrealized-inclusive), not analytics.totalPnl: the real
    // account is passive buy-and-hold (see this file's header) and never
    // closes a position, so realized P&L alone would stay frozen at
    // whatever it was before the pivot rather than reflecting the held
    // basket's actual performance.
    realizedReturnPct: ((equity - INITIAL_CASH) / INITIAL_CASH) * 100,
    maxDrawdownPct: Math.max(analytics.maxDrawdownPct, liveDrawdownPct),
    vsBenchmarkPct: benchmark ? benchmark.portfolioPct - benchmark.assetPct : null,
    daysRunning: (now - firstAt) / DAY_MS,
    benchmarkLabel: benchmark ? benchmark.label : 'a market benchmark',
    // Same rationale: closed-trade count and profit factor structurally
    // never move once the account stops closing positions.
    gateOnTradeStats: false,
  });
  store.set(READINESS_KEY, readiness);
}

/**
 * One passive buy-and-hold pass for the real stocks account (see this file's
 * header): equal-weight whatever cash is on hand across curated symbols not
 * already held, and never sell. A symbol already held (from a prior cycle,
 * or a partial run that bought some but not all symbols) is skipped, so
 * re-running this on a retry/overlap/next cycle only tops up symbols still
 * at zero position — naturally idempotent, no separate lock needed.
 * `stopLoss`/`takeProfit` are required by `OpenInput` but never checked
 * against here (nothing in this file exits a passive position), so they're
 * set to inert sentinels far outside any real price move.
 */
export function runPassiveHoldCycle(
  portfolio: PortfolioEngine,
  killSwitch: PersistedKillSwitch,
  symbols: readonly string[],
  prices: Readonly<Record<string, number>>,
  now: number,
): CycleResult {
  const opened: CycleResult['opened'] = [];
  const skipped: CycleResult['skipped'] = [];
  if (killSwitch.isEngaged()) {
    return { timestamp: now, halted: true, opened, closed: [], skipped };
  }

  const held = new Set(portfolio.openPositions().map((p) => p.symbol));
  const unheld = symbols.filter((s) => !held.has(s));
  if (unheld.length === 0) return { timestamp: now, halted: false, opened, closed: [], skipped };

  // Split evenly across every symbol still unheld (not just the ones priced
  // THIS cycle) — a symbol missing a price today (a transient fetch gap)
  // must not have its share of cash silently redirected to its neighbors;
  // it simply waits for a later cycle with its equal share still intact.
  // Sized to also cover this buy's fee (see COST_RATE) so the resulting
  // cost never exceeds its share of cash.
  const cashPerSymbol = portfolio.cash() / unheld.length;
  for (const symbol of unheld) {
    const price = prices[symbol];
    if (price === undefined || !(price > 0)) {
      skipped.push({ symbol, reason: 'no price available this cycle' });
      continue;
    }
    const quantity = cashPerSymbol / (price * (1 + COST_RATE));
    if (!(quantity > 0)) {
      skipped.push({ symbol, reason: 'insufficient cash for this cycle' });
      continue;
    }
    const result = portfolio.open({
      symbol,
      quantity,
      entryPrice: price,
      stopLoss: price * 0.01,
      takeProfit: price * 100,
      timestamp: now,
      fee: quantity * price * COST_RATE,
      notes: 'passive buy-and-hold',
    });
    if (result.ok) {
      opened.push({ id: result.value.id, symbol, quantity, entry: price });
    } else {
      skipped.push({ symbol, reason: result.error });
    }
  }
  return { timestamp: now, halted: false, opened, closed: [], skipped };
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
  killSwitch: PersistedKillSwitch,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  symbols: readonly string[],
  now: number,
  /** Pause between the browsable list's extra price requests (see
   * `SNAPSHOT_STAGGER_MS`). Defaults to 0 (no pause) so tests stay fast;
   * `main()` passes the real constant for actual cloud runs. */
  snapshotStaggerMs = 0,
): Promise<boolean> {
  const symbolPrices: Record<string, number> = {};
  for (const symbol of symbols) {
    const candles = await source.getCandles(symbol, ENTRY_TF, 2);
    if (candles.ok && candles.value.length > 0) {
      symbolPrices[symbol] = candles.value[candles.value.length - 1]!.close;
    }
  }
  const cycle = runPassiveHoldCycle(portfolio, killSwitch, symbols, symbolPrices, now);
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

  await recordEquity(store, source, portfolio, journal, now, symbolPrices);
  await runStocksShadow(store, source, now);

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
  const killSwitch = new PersistedKillSwitch(store);

  const telegram = {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  };

  for (let i = 0; i < LOOP_CYCLES; i++) {
    if (i > 0) await sleep(LOOP_INTERVAL_MS);
    const now = Date.now();
    if (!isUsMarketOpen(now)) {
      console.log('US market closed — skipping this stocks cycle.');
      continue;
    }
    let traded = false;
    try {
      traded = await runStocksCycle(store, source, killSwitch, portfolio, journal, telegram, symbols, now, SNAPSHOT_STAGGER_MS);
    } catch (cause) {
      // Never let one bad cycle kill the whole run — log and keep looping.
      console.error('Stocks cycle failed:', cause instanceof Error ? cause.message : cause);
    }
    // Persist mid-run: immediately after any trade, and every N cycles. The
    // final cycle is left to the workflow's end-of-run commit step.
    const isLast = i === LOOP_CYCLES - 1;
    const periodic = STATE_COMMIT_EVERY > 0 && (i + 1) % STATE_COMMIT_EVERY === 0;
    if (!isLast && (traded || periodic)) {
      persistStateToGit(store, `cycle ${i + 1}/${LOOP_CYCLES}`);
    }
  }
}

// Only run when invoked directly, never on import — see autopilotRunner.mts
// for why (tests import the exported pieces above without triggering a
// live cycle).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
