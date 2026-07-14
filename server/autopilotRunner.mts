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

import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { CoinbasePublicSource } from '../src/core/data/coinbasePublic';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import { PersistedAuditLog } from '../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../src/core/autopilot/killSwitch';
import { PaperAutoPilot } from '../src/core/autopilot/paperAutoPilot';
import { PositionEngine } from '../src/core/position/positionEngine';
import { PortfolioEngine } from '../src/core/position/portfolioEngine';
import { TradeJournal } from '../src/core/position/tradeJournal';
import { DailyLossTracker } from '../src/core/risk/dailyLoss';
import { FileStore } from './fileStore.mts';
import {
  buildCycleMessage,
  buildDailySummary,
  buildTestMessage,
  sendTelegramMessage,
} from './telegram.mts';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
const INITIAL_CASH = 10_000;
const CONFIRMATION_TF = '4h' as const;
const ENTRY_TF = '1h' as const;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The daily digest is sent on the first cycle at/after this local hour. */
const DAILY_SUMMARY_HOUR_LOCAL = 22;
const DAILY_SUMMARY_KEY = 'daily-summary-last-day';
/**
 * Timezone the evening digest is scheduled in. Follows the user when they
 * travel by setting the SUMMARY_TIMEZONE repo variable (e.g. Europe/Brussels);
 * defaults to Israel. DST is handled automatically by Intl.
 */
const SUMMARY_TIMEZONE = process.env['SUMMARY_TIMEZONE'] || 'Asia/Jerusalem';

/** Local calendar day (YYYY-MM-DD) and hour (0–23) in the given timezone. */
function localDayAndHour(now: number, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  const value = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(value('hour')) % 24; // some engines emit '24' at midnight
  return { day: `${value('year')}-${value('month')}-${value('day')}`, hour };
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
  });

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

  const telegram = {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  };

  const message = buildCycleMessage(cycle);
  if (message !== null) {
    const result = await sendTelegramMessage(message, telegram);
    console.log(result.sent ? 'Telegram notification sent.' : `No notification: ${result.reason}`);
  }

  // One-off delivery check: verifies notifications reach the phone without
  // waiting for a real trade. Enabled only when explicitly requested.
  if (process.env['SEND_TEST_MESSAGE'] === 'true') {
    const test = await sendTelegramMessage(buildTestMessage(), telegram);
    console.log(test.sent ? 'Telegram test message sent.' : `Test message not sent: ${test.reason}`);
  }

  await maybeSendDailySummary(store, source, portfolio, journal, telegram, now);
}

/**
 * Send a portfolio digest at most once per day (first cycle at/after
 * DAILY_SUMMARY_HOUR_UTC), so the user sees the robot is alive and how it's
 * doing without a message every cycle. No-op when Telegram is unconfigured.
 */
async function maybeSendDailySummary(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;

  const { day: today, hour } = localDayAndHour(now, SUMMARY_TIMEZONE);
  const lastDay = store.get<string>(DAILY_SUMMARY_KEY);
  const dueToday =
    lastDay !== today && (lastDay === undefined || hour >= DAILY_SUMMARY_HOUR_LOCAL);
  if (!dueToday) return;

  const open = portfolio.openPositions();
  const prices = await latestPrices(
    source,
    open.map((p) => p.symbol),
  );
  const snap = portfolio.snapshot(prices, now);
  const since = now - DAY_MS;
  const summary = buildDailySummary({
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
  });

  const result = await sendTelegramMessage(summary, telegram);
  if (result.sent) {
    store.set(DAILY_SUMMARY_KEY, today);
    console.log('Daily summary sent.');
  } else {
    console.log(`Daily summary not sent: ${result.reason}`);
  }
}

await main();
