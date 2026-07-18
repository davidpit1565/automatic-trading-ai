/**
 * Headless cloud autopilot runner.
 *
 * Runs ONE autopilot cycle against live public market data and sends a
 * Telegram notification for any trades. Designed to be invoked on a
 * schedule by GitHub Actions (see .github/workflows/autopilot.yml), which
 * commits the updated state file back to the repo so the next run resumes.
 *
 * It reuses the exact same verified core engines as the browser dashboard —
 * scanner → signal → risk → paper autopilot — so behaviour is identical.
 * SIMULATED money only: there is no live-order path anywhere in the core.
 */

import { execSync } from 'node:child_process';
import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { CoinbasePublicSource } from '../src/core/data/coinbasePublic';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import { PersistedAuditLog } from '../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../src/core/autopilot/killSwitch';
import {
  AUTOPILOT_MAX_RSI_FOR_LONG,
  AUTOPILOT_MIN_CONFIDENCE,
  PaperAutoPilot,
} from '../src/core/autopilot/paperAutoPilot';
import { PositionEngine } from '../src/core/position/positionEngine';
import { PortfolioEngine } from '../src/core/position/portfolioEngine';
import { TradeJournal } from '../src/core/position/tradeJournal';
import { DailyLossTracker } from '../src/core/risk/dailyLoss';
import { DEFAULT_RISK_LIMITS } from '../src/core/risk/riskEngine';
import { tradeAnalytics } from '../src/core/position/analytics';
import {
  assessRealMoneyReadiness,
  type RealMoneyReadiness,
} from '../src/core/feedback/realMoneyReadiness';
import { FileStore } from './fileStore.mts';
import {
  buildAllClearMessage,
  buildCycleMessage,
  buildDailySummary,
  buildMoveAlert,
  buildPeriodReport,
  buildRiskHaltAlert,
  buildSafetyAlert,
  buildTestMessage,
  sendTelegramMessage,
} from './telegram.mts';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
const INITIAL_CASH = 10_000;
const CONFIRMATION_TF = '4h' as const;
const ENTRY_TF = '1h' as const;
/**
 * Per-side trading cost (fraction of notional): Kraken taker fee ~0.25%
 * plus ~0.05% typical slippage. Charged on entry and exit so paper results
 * reflect real costs (~0.6% round trip) and predict live performance.
 */
const COST_RATE = Number(process.env['COST_RATE']) || 0.003;
/**
 * GitHub's scheduled runs are unreliable at high frequency (often skipped
 * for hours), so a single triggered run loops through several cycles
 * internally — one trigger then covers a long stretch, not a single moment.
 */
const LOOP_CYCLES = Math.max(1, Number(process.env['LOOP_CYCLES']) || 1);
const LOOP_INTERVAL_MS = Number(process.env['LOOP_INTERVAL_MS']) || 300_000;
/** Persist state to git every N cycles during the run (0 = only at run end). */
const STATE_COMMIT_EVERY = Math.max(0, Number(process.env['STATE_COMMIT_EVERY']) || 0);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Commit + push the state file mid-run so trades persist promptly and survive
 * a cancelled/timed-out run — the workflow's long run would otherwise only
 * save at the very end. Mirrors the workflow's resilient push (rebase onto the
 * latest main, retry) so it lands even when main advanced. Best-effort: any
 * failure is logged and the loop continues (the end-of-run commit is a
 * backstop). Only runs inside GitHub Actions.
 */
function persistStateToGit(label: string): void {
  if (process.env['GITHUB_ACTIONS'] !== 'true') return;
  const run = (cmd: string): string => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    run('git config user.name "github-actions[bot]"');
    run('git config user.email "github-actions[bot]@users.noreply.github.com"');
    run(`git add ${STATE_PATH}`);
    // Nothing staged → nothing to do.
    try {
      run('git diff --staged --quiet');
      return; // exits 0 = no changes
    } catch {
      /* non-zero = there are staged changes; proceed to commit */
    }
    run(`git commit -m "Autopilot state (mid-run ${label})"`);
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        run('git push origin HEAD:main');
        console.log(`State persisted mid-run (${label}).`);
        return;
      } catch {
        try {
          run('git fetch origin main');
          run('git rebase -X theirs origin/main');
        } catch {
          try {
            run('git rebase --abort');
          } catch {
            /* nothing to abort */
          }
        }
      }
    }
    console.error('Mid-run state push failed after retries (end-of-run commit will retry).');
  } catch (cause) {
    console.error('Mid-run persist skipped:', cause instanceof Error ? cause.message : cause);
  }
}
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * How many hours after a digest's target hour it may still fire. With the
 * continuous coverage from the long run + mid-run persistence, a digest lands
 * within minutes of 08:00/22:00; this window just prevents a very-late digest
 * (e.g. an 08:00 summary arriving in the afternoon) if coverage ever gaps —
 * it is skipped for the day instead. Keeps message times tidy.
 */
const SUMMARY_WINDOW_HOURS = Number(process.env['SUMMARY_WINDOW_HOURS']) || 3;
/** Scheduled digests: each fires once per local day within its hour window. */
const SUMMARY_SLOTS = [
  { hour: 8, key: 'daily-summary-morning', heading: '☀️ סיכום בוקר — רובוט מסחר (כסף מדומה)' },
  { hour: 22, key: 'daily-summary-evening', heading: '🌙 סיכום ערב — רובוט מסחר (כסף מדומה)' },
];
/** Alert when an open position moves by at least this % (each new step). */
const MOVE_ALERT_PCT = Number(process.env['MOVE_ALERT_PCT']) || 5;
const MOVE_BUCKETS_KEY = 'move-alert-buckets';
const MAX_OPEN_POSITIONS = DEFAULT_RISK_LIMITS.maxOpenPositions;
const ALLCLEAR_KEY = 'allclear-last-at';
const ALLCLEAR_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * Timezone the evening digest is scheduled in. Follows the user when they
 * travel by setting the SUMMARY_TIMEZONE repo variable (e.g. Europe/Brussels);
 * defaults to Israel. DST is handled automatically by Intl.
 */
const SUMMARY_TIMEZONE = process.env['SUMMARY_TIMEZONE'] || 'Asia/Jerusalem';

/** Local date parts (in the given timezone) used to schedule digests. */
function localDayAndHour(
  now: number,
  timeZone: string,
): { day: string; hour: number; weekday: string; dayOfMonth: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date(now));
  const value = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(value('hour')) % 24; // some engines emit '24' at midnight
  return {
    day: `${value('year')}-${value('month')}-${value('day')}`,
    hour,
    weekday: value('weekday'), // e.g. 'Sun'
    dayOfMonth: Number(value('day')),
  };
}

/** Pick a live public source, preferring Kraken then Coinbase. */
async function pickSource(): Promise<MarketDataSource | null> {
  for (const candidate of [new KrakenPublicSource(), new CoinbasePublicSource()]) {
    const instruments = await candidate.getInstruments();
    if (!instruments.ok) continue;
    const probe = await candidate.getCandles(instruments.value[0]!.symbol, ENTRY_TF, 2);
    if (probe.ok) return candidate;
  }
  return null;
}

/** Latest close per symbol, for an accurate portfolio snapshot. */
async function latestPrices(
  source: MarketDataSource,
  symbols: readonly string[],
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  for (const symbol of symbols) {
    const candles = await source.getCandles(symbol, ENTRY_TF, 2);
    if (candles.ok && candles.value.length > 0) {
      prices[symbol] = candles.value[candles.value.length - 1]!.close;
    }
  }
  return prices;
}

async function main(): Promise<void> {
  const store = new FileStore(STATE_PATH);
  const source = await pickSource();
  if (source === null) {
    console.error('No live market data source reachable — skipping cycle.');
    process.exitCode = 1;
    return;
  }
  const instruments = await source.getInstruments();
  if (!instruments.ok) {
    console.error('Could not load instruments — skipping cycle.');
    process.exitCode = 1;
    return;
  }
  const symbols = instruments.value.slice(0, 12).map((i) => i.symbol);

  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, {
    initialCash: INITIAL_CASH,
    baseCurrency: 'EUR',
  });
  const autopilot = new PaperAutoPilot({
    source,
    symbols,
    timeframe: ENTRY_TF,
    confirmationTimeframe: CONFIRMATION_TF,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio,
    positions,
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    getDailyLoss: () => new DailyLossTracker(store).lossToday(Date.now()),
    costRate: COST_RATE,
    // Only commit capital to setups with real conviction — refuses the weak
    // ~4–12% signals that were producing churn and losses.
    minConfidence: AUTOPILOT_MIN_CONFIDENCE,
    // Don't chase overbought coins (measured to roughly double profit factor).
    maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG,
  });

  const telegram = {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  };

  // One-off delivery check: verifies notifications reach the phone without
  // waiting for a real trade. Enabled only when explicitly requested.
  if (process.env['SEND_TEST_MESSAGE'] === 'true') {
    const test = await sendTelegramMessage(buildTestMessage(), telegram);
    console.log(test.sent ? 'Telegram test message sent.' : `Test message not sent: ${test.reason}`);
  }

  for (let i = 0; i < LOOP_CYCLES; i++) {
    if (i > 0) await sleep(LOOP_INTERVAL_MS);
    let traded = false;
    try {
      traded = await runCycle(store, source, autopilot, portfolio, journal, telegram);
    } catch (cause) {
      // Never let one bad cycle kill the whole run — log and keep looping.
      console.error('Cycle failed:', cause instanceof Error ? cause.message : cause);
    }
    // Persist mid-run: immediately after any trade, and every N cycles. The
    // final cycle is left to the workflow's end-of-run commit step.
    const isLast = i === LOOP_CYCLES - 1;
    const periodic = STATE_COMMIT_EVERY > 0 && (i + 1) % STATE_COMMIT_EVERY === 0;
    if (!isLast && (traded || periodic)) {
      persistStateToGit(`cycle ${i + 1}/${LOOP_CYCLES}`);
    }
  }
}

/**
 * One full cycle: trade, heartbeat, then trade/move/summary notifications.
 * Returns true if a trade opened or closed this cycle (so the caller can
 * persist state immediately).
 */
async function runCycle(
  store: FileStore,
  source: MarketDataSource,
  autopilot: PaperAutoPilot,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
): Promise<boolean> {
  const now = Date.now();
  const cycle = await autopilot.runCycleOnce(now);
  console.log(
    `Cycle done via ${source.name}: opened ${cycle.opened.length}, ` +
      `closed ${cycle.closed.length}, skipped ${cycle.skipped.length}` +
      (cycle.halted ? ' (kill switch engaged)' : ''),
  );

  // Heartbeat: guarantees the state file exists so the workflow always has
  // something to persist, and records when the cloud robot last ran.
  store.set('autopilot-last-run', {
    at: now,
    source: source.name,
    opened: cycle.opened.length,
    closed: cycle.closed.length,
    halted: cycle.halted,
  });

  // De-duplicate trade alerts by stable position id: if a position is
  // re-processed (e.g. a prior run's state failed to persist), it must never
  // be re-announced. Only trades not yet alerted go into the message.
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
  const message = buildCycleMessage({
    timestamp: cycle.timestamp,
    opened: freshOpened,
    closed: freshClosed,
  });
  if (message !== null) {
    const result = await sendTelegramMessage(message, telegram);
    console.log(result.sent ? 'Telegram notification sent.' : `No notification: ${result.reason}`);
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

  // Tell the user (once per day) when a safety limit pauses new buying.
  if (telegram.token && telegram.chatId && cycle.skipped.some((s) => /daily loss limit/i.test(s.reason))) {
    const { day } = localDayAndHour(now, SUMMARY_TIMEZONE);
    if (store.get<string>('risk-halt-alert-day') !== day) {
      const halt = await sendTelegramMessage(buildRiskHaltAlert(), telegram);
      if (halt.sent) {
        store.set('risk-halt-alert-day', day);
        console.log('Risk-halt alert sent.');
      }
    }
  }

  // Safety net: cheap invariant checks every cycle; alert once/day on trouble.
  if (telegram.token && telegram.chatId) {
    const problems: string[] = [];
    if (portfolio.cash() < -1e-6) problems.push('מזומן שלילי');
    if (portfolio.openPositions().length > MAX_OPEN_POSITIONS) {
      problems.push(`יותר מדי פוזיציות פתוחות (${portfolio.openPositions().length})`);
    }
    if (problems.length > 0) {
      const { day } = localDayAndHour(now, SUMMARY_TIMEZONE);
      if (store.get<string>('safety-alert-day') !== day) {
        const a = await sendTelegramMessage(buildSafetyAlert(problems.join(', ')), telegram);
        if (a.sent) store.set('safety-alert-day', day);
      }
    }
  }

  await maybeSendMoveAlerts(store, source, portfolio, telegram);
  await recordEquity(store, source, portfolio, journal, now);
  await maybeSendSummaries(store, source, portfolio, journal, telegram, now);
  await maybeSendPeriodicReports(store, source, portfolio, journal, telegram, now);
  await maybeSendAllClear(store, telegram, now);

  return cycle.opened.length > 0 || cycle.closed.length > 0;
}

const EQUITY_HISTORY_KEY = 'equity-history';
const EQUITY_HISTORY_CAP = 5000;
/** Position ids already announced via Telegram, so alerts never repeat. */
const ALERTED_TRADES_KEY = 'alerted-trade-ids';
const ALERTED_TRADES_CAP = 500;
/** Stored real-money readiness verdict, so the app + digest can show it. */
const READINESS_KEY = 'real-money-readiness';

/**
 * Append a portfolio-value point each cycle (for the app's value chart) and
 * refresh the honest real-money readiness verdict from the trade journal.
 */
async function recordEquity(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  now: number,
): Promise<void> {
  const open = portfolio.openPositions();
  const prices = await latestPrices(
    source,
    open.map((p) => p.symbol),
  );
  const equity = portfolio.snapshot(prices, now).equity;
  const history = store.get<Array<{ at: number; equity: number }>>(EQUITY_HISTORY_KEY) ?? [];
  const firstAt = history[0]?.at ?? now;
  history.push({ at: now, equity: Math.round(equity * 100) / 100 });
  store.set(
    EQUITY_HISTORY_KEY,
    history.length > EQUITY_HISTORY_CAP ? history.slice(-EQUITY_HISTORY_CAP) : history,
  );

  // Honest real-money readiness: purely from the (after-fee) journal record.
  const analytics = tradeAnalytics(journal.entries(), { initialCash: INITIAL_CASH });
  const benchmark = await computeBenchmark(store, source, equity, now);
  const readiness = assessRealMoneyReadiness({
    closedTrades: analytics.tradeCount,
    profitFactor: analytics.profitFactor,
    realizedReturnPct: (analytics.totalPnl / INITIAL_CASH) * 100,
    maxDrawdownPct: analytics.maxDrawdownPct,
    vsBenchmarkPct: benchmark ? benchmark.portfolioPct - benchmark.assetPct : null,
    daysRunning: (now - firstAt) / DAY_MS,
  });
  store.set(READINESS_KEY, readiness);
}

/**
 * Notify when an open position crosses a new ±MOVE_ALERT_PCT step since
 * entry (e.g. +5%, +10%, -5%), so big swings surface without spamming on
 * every tick. The last-alerted step per position is remembered in state.
 */
async function maybeSendMoveAlerts(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  telegram: { token: string; chatId: string },
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;
  const open = portfolio.openPositions();
  if (open.length === 0) {
    store.remove(MOVE_BUCKETS_KEY);
    return;
  }
  const prices = await latestPrices(
    source,
    open.map((p) => p.symbol),
  );
  const previous = store.get<Record<string, number>>(MOVE_BUCKETS_KEY) ?? {};
  const current: Record<string, number> = {};
  for (const p of open) {
    const price = prices[p.symbol];
    if (price === undefined || !(p.entryPrice > 0)) {
      if (previous[p.id] !== undefined) current[p.id] = previous[p.id]!;
      continue;
    }
    const movePct = ((price - p.entryPrice) / p.entryPrice) * 100;
    const bucket = Math.trunc(movePct / MOVE_ALERT_PCT); // signed step index
    current[p.id] = bucket;
    if (bucket !== 0 && previous[p.id] !== bucket) {
      const result = await sendTelegramMessage(buildMoveAlert(p.symbol, movePct), telegram);
      console.log(result.sent ? `Move alert sent for ${p.symbol}.` : `Move alert failed: ${result.reason}`);
    }
  }
  store.set(MOVE_BUCKETS_KEY, current); // also drops closed positions
}

/**
 * Send the morning (08:00) and evening (22:00) digests, each at most once
 * per local day. So the user sees where things stand at the start and end
 * of the day without a message every cycle. No-op without Telegram.
 */
async function maybeSendSummaries(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;

  const { day: today, hour } = localDayAndHour(now, SUMMARY_TIMEZONE);
  const dueSlots = SUMMARY_SLOTS.filter(
    (slot) =>
      hour >= slot.hour &&
      hour < slot.hour + SUMMARY_WINDOW_HOURS &&
      store.get<string>(slot.key) !== today,
  );
  if (dueSlots.length === 0) return;

  const open = portfolio.openPositions();
  const prices = await latestPrices(
    source,
    open.map((p) => p.symbol),
  );
  const snap = portfolio.snapshot(prices, now);
  const since = now - DAY_MS;
  const benchmark = await computeBenchmark(store, source, snap.equity, now);
  const baseSummary = {
    equity: snap.equity,
    cash: snap.cash,
    totalReturnPct: snap.totalReturnPct,
    realizedPnl: snap.realizedPnl,
    unrealizedPnl: snap.unrealizedPnl,
    positions: snap.allocation.map((a) => ({
      symbol: a.symbol,
      marketValue: a.marketValue,
      pctOfEquity: a.pctOfEquity,
    })),
    openedLast24h: open.filter((p) => p.openedAt >= since).length,
    closedLast24h: journal.entries().filter((e) => e.exitTimestamp >= since).length,
    benchmark,
    readiness: store.get<RealMoneyReadiness>(READINESS_KEY) ?? null,
  };

  for (const slot of dueSlots) {
    const result = await sendTelegramMessage(
      buildDailySummary({ ...baseSummary, heading: slot.heading }),
      telegram,
    );
    if (result.sent) {
      store.set(slot.key, today);
      console.log(`Summary sent (${slot.key}).`);
    } else {
      console.log(`Summary not sent (${slot.key}): ${result.reason}`);
    }
  }
}

/** Periodic all-clear: confirms safety systems are active every ~2 weeks. */
async function maybeSendAllClear(
  store: FileStore,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;
  const last = store.get<number>(ALLCLEAR_KEY);
  if (last !== undefined && now - last < ALLCLEAR_INTERVAL_MS) return;
  const result = await sendTelegramMessage(buildAllClearMessage(), telegram);
  if (result.sent) {
    store.set(ALLCLEAR_KEY, now);
    console.log('All-clear message sent.');
  }
}

/** Weekly (Sunday) and monthly (1st) evening performance reports. */
async function maybeSendPeriodicReports(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;
  const { day, hour, weekday, dayOfMonth } = localDayAndHour(now, SUMMARY_TIMEZONE);
  if (hour < 22) return; // evening only
  const weeklyDue = weekday === 'Sun' && store.get<string>('weekly-report-last') !== day;
  const monthlyDue = dayOfMonth === 1 && store.get<string>('monthly-report-last') !== day;
  if (!weeklyDue && !monthlyDue) return;

  const open = portfolio.openPositions();
  const prices = await latestPrices(
    source,
    open.map((p) => p.symbol),
  );
  const equity = portfolio.snapshot(prices, now).equity;
  const benchmark = await computeBenchmark(store, source, equity, now);

  if (weeklyDue) {
    await sendPeriodReport(store, journal, telegram, equity, benchmark, now, {
      title: 'שבועי',
      anchorKey: 'weekly-anchor',
      lastKey: 'weekly-report-last',
      windowMs: 7 * DAY_MS,
      day,
    });
  }
  if (monthlyDue) {
    await sendPeriodReport(store, journal, telegram, equity, benchmark, now, {
      title: 'חודשי',
      anchorKey: 'monthly-anchor',
      lastKey: 'monthly-report-last',
      windowMs: 30 * DAY_MS,
      day,
    });
  }
}

interface PeriodConfig {
  title: string;
  anchorKey: string;
  lastKey: string;
  windowMs: number;
  day: string;
}

async function sendPeriodReport(
  store: FileStore,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  equity: number,
  benchmark: { label: string; portfolioPct: number; assetPct: number } | null,
  now: number,
  cfg: PeriodConfig,
): Promise<void> {
  const anchor = store.get<{ equity: number }>(cfg.anchorKey);
  const periodReturnPct =
    anchor && anchor.equity > 0 ? ((equity - anchor.equity) / anchor.equity) * 100 : null;
  const trades = journal.entries().filter((e) => e.exitTimestamp >= now - cfg.windowMs);
  const pcts = trades.map((t) => t.returnPct);
  const message = buildPeriodReport({
    title: cfg.title,
    equity,
    periodReturnPct,
    tradesCount: trades.length,
    wins: trades.filter((t) => t.returnPct > 0).length,
    losses: trades.filter((t) => t.returnPct <= 0).length,
    bestPct: pcts.length > 0 ? Math.max(...pcts) : null,
    worstPct: pcts.length > 0 ? Math.min(...pcts) : null,
    benchmark,
  });
  const result = await sendTelegramMessage(message, telegram);
  if (result.sent) {
    store.set(cfg.anchorKey, { equity, at: now });
    store.set(cfg.lastKey, cfg.day);
    console.log(`${cfg.title} report sent.`);
  }
}

const BENCHMARK_ANCHOR_KEY = 'benchmark-anchor';
interface BenchmarkAnchor {
  btc: number;
  equity: number;
  at: number;
}

/**
 * Compare the portfolio against simply holding Bitcoin over the same window.
 * The anchor (BTC price + portfolio equity) is captured the first time this
 * runs, so both returns are measured from the same moment — a fair test of
 * whether the robot beats buy-and-hold.
 */
async function computeBenchmark(
  store: FileStore,
  source: MarketDataSource,
  equityNow: number,
  now: number,
): Promise<{ label: string; portfolioPct: number; assetPct: number } | null> {
  const instruments = await source.getInstruments();
  if (!instruments.ok) return null;
  const btc = instruments.value.find(
    (i) => /XBT|BTC/i.test(i.symbol) && /EUR/i.test(i.symbol),
  );
  if (!btc) return null;
  const prices = await latestPrices(source, [btc.symbol]);
  const btcNow = prices[btc.symbol];
  if (btcNow === undefined || !(btcNow > 0) || !(equityNow > 0)) return null;

  let anchor = store.get<BenchmarkAnchor>(BENCHMARK_ANCHOR_KEY);
  if (!anchor || !(anchor.btc > 0) || !(anchor.equity > 0)) {
    anchor = { btc: btcNow, equity: equityNow, at: now };
    store.set(BENCHMARK_ANCHOR_KEY, anchor);
  }
  return {
    label: 'ביטקוין',
    portfolioPct: ((equityNow - anchor.equity) / anchor.equity) * 100,
    assetPct: ((btcNow - anchor.btc) / anchor.btc) * 100,
  };
}

await main();
