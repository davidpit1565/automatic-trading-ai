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
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { CoinbasePublicSource } from '../src/core/data/coinbasePublic';
import type { MarketDataSource } from '../src/core/data/revolutClient';
import { PersistedAuditLog } from '../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../src/core/autopilot/killSwitch';
import {
  AUTOPILOT_CONFIDENCE_RISK,
  AUTOPILOT_MARKET_REGIME_PERIOD,
  AUTOPILOT_MAX_RSI_FOR_LONG,
  AUTOPILOT_MIN_CONFIDENCE,
  AUTOPILOT_REGIME_PERIOD,
  AUTOPILOT_RISK_LIMITS,
  AUTOPILOT_TRAILING,
  PaperAutoPilot,
  type CycleResult,
} from '../src/core/autopilot/paperAutoPilot';
import { buildDailyRegimeFilter } from '../src/core/signal/regimeFilter';
import { isWhaleFlowBearish } from '../src/core/signal/whaleFlow';
import { buildTopTraderGate } from '../src/core/signal/topTraderGate';
import { getTopTraderPositionRatio, toOkxSwapInstId } from '../src/core/data/okxPositioning';
import { isAiJudgmentBearish, type AiJudgmentInput } from '../src/core/signal/aiJudgment';
import { scanCandles } from '../src/core/scan/marketScanner';
import { MAX_CONFIDENCE } from '../src/core/signal/signalEngine';
import type { Instrument, Timeframe } from '../src/core/types';
import type { RecentTrade } from '../src/core/data/krakenPublic';
import type { Result } from '../src/core/types';
import { PrefixedStore } from '../src/core/data/prefixedStore';
import { PositionEngine } from '../src/core/position/positionEngine';
import { PortfolioEngine } from '../src/core/position/portfolioEngine';
import { TradeJournal } from '../src/core/position/tradeJournal';
import { DailyLossTracker } from '../src/core/risk/dailyLoss';
import { drawdownBreached } from '../src/core/risk/drawdownBreaker';
import { DEFAULT_RISK_LIMITS } from '../src/core/risk/riskEngine';
import { tradeAnalytics } from '../src/core/position/analytics';
import { maxDrawdownPct } from '../src/core/backtest/metrics';
import { CachingSource } from '../src/core/data/cachingSource';
import {
  runShadowCycle,
  SHADOW_CANDIDATES,
  type ShadowCandidate,
  type ShadowStanding,
} from '../src/core/autopilot/shadowEvaluator';
import {
  assessRealMoneyReadiness,
  type RealMoneyReadiness,
} from '../src/core/feedback/realMoneyReadiness';
import { FileStore } from './fileStore.mts';
import { checkManualKillSwitchCommands } from './manualKillSwitchCommand.mts';
import { checkManualSellRequests } from './manualSellCommand.mts';
import { checkManualBuyRequests } from './manualBuyCommand.mts';
import { mirrorApprovedEntries } from './liveEntryMirror.mts';
import { checkAutomaticExits } from './liveExitMirror.mts';
import { initLiveCash } from './liveLedger.mts';
import { RevolutXBrokerAdapter, type RevolutXCredentials } from './revolutXBrokerAdapter.mts';
import { TelegramConfirmationGate } from './telegramConfirmationGate.mts';
import {
  buildAllClearMessage,
  buildCycleMessage,
  buildDailySummary,
  buildDrawdownHaltAlert,
  buildMoveAlert,
  buildPeriodReport,
  buildRiskHaltAlert,
  buildSafetyAlert,
  buildTestMessage,
  sendTelegramMessage,
  type DailySummaryStocks,
} from './telegram.mts';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
// Read fresh on every call (not a frozen module-level const), same rationale
// as getSummaryTimezone() below — so tests can point this at a temp file
// regardless of whatever env was set at module-import time.
function getStocksStatePath(): string {
  return process.env['STOCKS_STATE_PATH'] ?? 'state/stocks-state.json';
}
const STOCKS_INITIAL_CASH = 10_000; // USD — must match server/stocksRunner.mts's own constant.
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
 * Real-money opt-in (2026-09-02). Off by construction: this must stay
 * simulated-only until a human deliberately flips it AND real broker
 * credentials exist — either one missing is silently a no-op (see
 * `runLiveMirror`), never an error, so this repo keeps working exactly as
 * before for anyone who never sets these. Every real order still goes
 * through the full mandatory chain (kill switch, broker symbol
 * verification, human confirmation via Telegram) regardless of this flag —
 * it only controls whether that chain is ever reached at all.
 */
// Read fresh on every call (not a frozen module-level const), same rationale
// as getSummaryTimezone()/getStocksStatePath() below — so a test can flip
// this via process.env regardless of what it was at module-import time.
function realMoneyEnabled(): boolean {
  return process.env['REAL_MONEY_ENABLED'] === 'true';
}
/** David's confirmed starting real capital (2026-09-02): 100€. Only used the
 * FIRST time the live ledger is ever initialized — never resets a real,
 * already-moving balance on a later run (see `initLiveCash`). */
function liveStartingCashEur(): number {
  return Number(process.env['LIVE_STARTING_CASH_EUR']) || 100;
}

/** Real Revolut X API credentials, configured only in GitHub Actions
 * secrets (per this project's non-negotiable secrets rule) — never
 * fabricated or defaulted. `null` until David generates and adds them. */
function liveCredentials(): RevolutXCredentials | null {
  const apiKey = process.env['REVOLUT_X_API_KEY'];
  const privateKeyPem = process.env['REVOLUT_X_PRIVATE_KEY_PEM'];
  if (!apiKey || !privateKeyPem) return null;
  return { apiKey, privateKeyPem };
}

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
/** Scheduled digests: each fires once per local day, at or after its hour. */
const SUMMARY_SLOTS = [
  { hour: 15, key: 'daily-summary', heading: '📊 סיכום יומי — סוכן מסחר (כסף מדומה)' },
];
/** Alert when an open position moves by at least this % (each new step). */
const MOVE_ALERT_PCT = Number(process.env['MOVE_ALERT_PCT']) || 5;
const MOVE_BUCKETS_KEY = 'move-alert-buckets';
/** Pause NEW buying when equity is this % below its all-time peak. */
const DD_BREAKER_PCT = Number(process.env['DD_BREAKER_PCT']) || 8;
const EQUITY_PEAK_KEY = 'equity-peak';

/** Portfolio circuit-breaker state, derived live from the stored peak + last equity. */
export function breakerEngaged(store: FileStore): boolean {
  const peak = store.get<number>(EQUITY_PEAK_KEY);
  const history = store.get<Array<{ at: number; equity: number }>>(EQUITY_HISTORY_KEY);
  const current = history?.[history.length - 1]?.equity;
  if (peak === undefined || current === undefined) return false;
  return drawdownBreached({ peakEquity: peak, currentEquity: current, maxDrawdownPct: DD_BREAKER_PCT });
}
const MAX_OPEN_POSITIONS = DEFAULT_RISK_LIMITS.maxOpenPositions;
const ALLCLEAR_KEY = 'allclear-last-at';
const ALLCLEAR_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * Timezone the digests are scheduled in. Overridable via the SUMMARY_TIMEZONE
 * repo variable without a code change; DST is handled automatically by Intl.
 * Read fresh on every call (not a frozen module-level const) so an override
 * takes effect immediately and tests can pin their own expected timezone
 * regardless of what the hardcoded fallback below currently is.
 *
 * TEMPORARY: fallback set to Europe/Brussels for a trip (2026-08-10) — revert
 * to 'Asia/Jerusalem' once back home, or set SUMMARY_TIMEZONE instead so this
 * fallback never has to move again.
 */
function getSummaryTimezone(): string {
  return process.env['SUMMARY_TIMEZONE'] || 'Europe/Brussels';
}

/** Local date parts (in the given timezone) used to schedule digests. */
export function localDayAndHour(
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

/**
 * Builds the daily regime gate (see `AUTOPILOT_REGIME_PERIOD`'s measurement
 * comment): fetches daily candles once per symbol and returns a check
 * function. Fails OPEN (allows the entry) for a symbol whose daily fetch
 * failed — a transient daily-candle outage must not silently block every
 * entry-timeframe opportunity for that symbol.
 */
async function buildRegimeCheck(
  source: MarketDataSource,
  symbols: readonly string[],
): Promise<(symbol: string, timestamp: number) => Promise<boolean>> {
  const filters = new Map<string, (atTimestamp: number) => boolean>();
  for (const symbol of symbols) {
    const daily = await source.getCandles(symbol, '1d', 400);
    if (daily.ok) {
      filters.set(symbol, buildDailyRegimeFilter(daily.value, { period: AUTOPILOT_REGIME_PERIOD }));
    }
  }
  return async (symbol, timestamp) => filters.get(symbol)?.(timestamp) ?? true;
}

/**
 * Builds the market-wide regime gate (see `AUTOPILOT_MARKET_REGIME_PERIOD`'s
 * measurement comment): fetches BTC's own daily candles once and returns a
 * check applied to every symbol's entry, including BTC's. Fails OPEN (allows
 * entries) when the BTC instrument or its daily candles aren't available —
 * a fetch outage must not silently block the whole universe.
 */
async function buildMarketRegimeCheck(
  source: MarketDataSource,
  instruments: readonly { symbol: string }[],
): Promise<(timestamp: number) => Promise<boolean>> {
  const btc = instruments.find((i) => /XBT|BTC/i.test(i.symbol) && /EUR/i.test(i.symbol));
  if (!btc) return async () => true;
  const daily = await source.getCandles(btc.symbol, '1d', 400);
  if (!daily.ok) return async () => true;
  const filter = buildDailyRegimeFilter(daily.value, { period: AUTOPILOT_MARKET_REGIME_PERIOD });
  return async (timestamp) => filter(timestamp);
}

/**
 * Builds the whale-flow gate for shadow evaluation ONLY (see `whaleFlow.ts`'s
 * doc comment for why this has no historical validation and must not reach
 * production). Feature-detects `getRecentTrades` on the real source — absent
 * on sources without a real trade tape (e.g. a future non-Kraken fallback) —
 * and fetches fresh on every check since recent trades change fast, unlike a
 * daily regime. Fails OPEN (allows the entry) on any fetch failure.
 */
function buildWhaleFlowCheck(
  source: MarketDataSource,
): ((symbol: string, timestamp: number) => Promise<boolean>) | null {
  const withTrades = source as MarketDataSource & {
    getRecentTrades?: (symbol: string, count?: number) => Promise<Result<RecentTrade[]>>;
  };
  if (typeof withTrades.getRecentTrades !== 'function') return null;
  return async (symbol: string) => {
    const trades = await withTrades.getRecentTrades!(symbol, 50);
    if (!trades.ok) return true;
    return !isWhaleFlowBearish(trades.value);
  };
}

/**
 * Builds the top-trader positioning gate for shadow evaluation ONLY (see
 * `topTraderGate.ts`'s doc comment: real history exists, but the available
 * window was too sparse to trust a backtest verdict yet). Fetches OKX's
 * ratio series once per symbol; fails OPEN for a symbol whose fetch failed
 * or has no recognizable OKX instrument.
 */
async function buildTopTraderCheck(
  symbols: readonly string[],
): Promise<(symbol: string, timestamp: number) => Promise<boolean>> {
  const gates = new Map<string, (atTimestamp: number) => boolean>();
  for (const symbol of symbols) {
    const instId = toOkxSwapInstId(symbol);
    if (!instId) continue;
    const ratios = await getTopTraderPositionRatio(instId, '1D', 100);
    if (ratios.ok) gates.set(symbol, buildTopTraderGate(ratios.value));
  }
  return async (symbol, timestamp) => gates.get(symbol)?.(timestamp) ?? true;
}

/**
 * Calls the Gemini API (free tier: Flash/Flash-Lite, ~10 requests/min, hundreds
 * per day as of 2026-08 — plenty for this gate's call volume, which is already
 * filtered down by every earlier gate before it's ever reached) for one
 * AI-second-opinion judgment. The DEFAULT provider (see `buildAiJudgmentCheck`)
 * specifically because it costs nothing at this call volume. Kept as a small,
 * isolated function so `aiJudgment.ts` itself never needs a network
 * dependency (see that file's doc comment).
 */
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!response.ok) throw new Error(`Gemini API HTTP ${response.status}`);
  const payload = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = payload.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  if (!text) throw new Error('no text content in Gemini response');
  return text;
}

/**
 * Calls the Anthropic Messages API for one AI-second-opinion judgment. A paid
 * FALLBACK provider (see `buildAiJudgmentCheck`) for when Gemini's free tier
 * isn't configured or preferred. Kept as a small, isolated function so
 * `aiJudgment.ts` itself never needs a network dependency (see that file's
 * doc comment).
 */
async function callClaude(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API HTTP ${response.status}`);
  const payload = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = payload.content?.find((block) => block.type === 'text')?.text;
  if (!text) throw new Error('no text content in Anthropic response');
  return text;
}

/**
 * Builds the AI second-opinion gate for shadow evaluation ONLY (see
 * `aiJudgment.ts`'s doc comment: this can never be backtested, so it must
 * never reach production). Prefers the free `GEMINI_API_KEY` (Gemini 2.5
 * Flash's free tier easily covers this gate's call volume); falls back to
 * the paid `ANTHROPIC_API_KEY` if that's what's configured instead. A no-op
 * (always allows) when NEITHER secret is set — this stays off until one is
 * deliberately added.
 */
function buildAiJudgmentCheck(
  source: MarketDataSource,
  timeframe: Timeframe,
): ((symbol: string, timestamp: number) => Promise<boolean>) | null {
  const geminiKey = process.env['GEMINI_API_KEY'];
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  const callModel = geminiKey
    ? (prompt: string) => callGemini(prompt, geminiKey)
    : anthropicKey
      ? (prompt: string) => callClaude(prompt, anthropicKey)
      : null;
  if (!callModel) return null;
  return async (symbol: string) => {
    // 150 candles: the same warm-up window the entry-signal scanner itself
    // needs (see paperAutoPilot.ts's SCAN_CANDLES) for its indicators to be
    // meaningful (long EMAs, ADX, etc.).
    const candles = await source.getCandles(symbol, timeframe, 150);
    if (!candles.ok) return true;
    const scan = scanCandles(symbol, timeframe, candles.value);
    if (!scan.ok) return true;
    const input: AiJudgmentInput = {
      symbol,
      snapshot: scan.value.snapshot,
      score: scan.value.score,
      warnings: scan.value.warnings,
    };
    return !(await isAiJudgmentBearish(input, callModel));
  };
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
  // Trade ONLY the validated majors (the first 10 curated instruments). The
  // instrument list was broadened for display/browsing; capping here keeps the
  // capital-risking universe exactly the measured majors — broadening trading
  // is a separate, must-be-measured change (see PROJECT_STATE pending queue).
  const symbols = instruments.value.slice(0, 10).map((i) => i.symbol);

  const journal = new TradeJournal(store);
  const positions = new PositionEngine(store, journal);
  const portfolio = new PortfolioEngine(store, positions, {
    initialCash: INITIAL_CASH,
    baseCurrency: 'EUR',
  });
  const regimeCheck = await buildRegimeCheck(source, symbols);
  const marketRegimeCheck = await buildMarketRegimeCheck(source, instruments.value);
  const autopilot = new PaperAutoPilot({
    source,
    symbols,
    timeframe: ENTRY_TF,
    confirmationTimeframe: CONFIRMATION_TF,
    // Never open a long while the larger daily trend is down, even when the
    // entry-timeframe setup and the 4h confirmation above both pass —
    // measured to help most in exactly that scenario. See AUTOPILOT_REGIME_PERIOD.
    regimeCheck,
    // A coin can look fine on its own chart while the broader crypto market
    // (tracked via BTC) is rolling over — capital protection first even
    // though it costs some good trades in calmer windows. See
    // AUTOPILOT_MARKET_REGIME_PERIOD.
    marketRegimeCheck,
    scheduler: { start() {}, stop() {}, isRunning: () => false, intervalMs: () => null },
    portfolio,
    positions,
    killSwitch: new PersistedKillSwitch(store),
    audit: new PersistedAuditLog(store),
    getDailyLoss: () => new DailyLossTracker(store).lossToday(Date.now()),
    // Feeds the tracker above: without this, realized losses were never
    // actually recorded, so the daily-loss limit could never trip.
    onRealizedPnl: (pnl, ts) => new DailyLossTracker(store).record(pnl, ts),
    costRate: COST_RATE,
    // Only commit capital to setups with real conviction — refuses the weak
    // ~4–12% signals that were producing churn and losses.
    minConfidence: AUTOPILOT_MIN_CONFIDENCE,
    // Don't chase overbought coins (measured to roughly double profit factor).
    maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG,
    // Ratchet the stop up as trades run in profit (higher PF, lower drawdown).
    trailing: AUTOPILOT_TRAILING,
    // Weak (just-above-floor) setups risk less, strong setups risk up to the
    // same ceiling as before — never more. See AUTOPILOT_CONFIDENCE_RISK.
    confidenceRisk: AUTOPILOT_CONFIDENCE_RISK,
    // Raised total-exposure cap (60% → 80%); per-position/open-position caps
    // unchanged. See AUTOPILOT_RISK_LIMITS for the measurement.
    riskLimits: AUTOPILOT_RISK_LIMITS,
    // Portfolio circuit-breaker: pause new buying while equity is more than
    // DD_BREAKER_PCT below its peak. Exits/stops keep protecting open trades.
    haltNewEntries: () => breakerEngaged(store),
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
      traded = await runCycle(store, source, autopilot, portfolio, journal, telegram, symbols, instruments.value);
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
  symbols: readonly string[],
  instruments: readonly Instrument[],
): Promise<boolean> {
  const now = Date.now();
  const cycle = await autopilot.runCycleOnce(now);
  console.log(
    `Cycle done via ${source.name}: opened ${cycle.opened.length}, ` +
      `closed ${cycle.closed.length}, skipped ${cycle.skipped.length}` +
      (cycle.halted ? ' (kill switch engaged)' : ''),
  );

  // Heartbeat: guarantees the state file exists so the workflow always has
  // something to persist, and records when the cloud agent last ran.
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

  // Circuit-breaker alert: tell the user (once per day) that new buying is
  // paused while the portfolio recovers toward its peak.
  if (telegram.token && telegram.chatId && breakerEngaged(store)) {
    const { day } = localDayAndHour(now, getSummaryTimezone());
    if (store.get<string>('dd-halt-alert-day') !== day) {
      const a = await sendTelegramMessage(buildDrawdownHaltAlert(DD_BREAKER_PCT), telegram);
      if (a.sent) store.set('dd-halt-alert-day', day);
    }
  }

  // Tell the user (once per day) when a safety limit pauses new buying.
  if (telegram.token && telegram.chatId && cycle.skipped.some((s) => /daily loss limit/i.test(s.reason))) {
    const { day } = localDayAndHour(now, getSummaryTimezone());
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
      const { day } = localDayAndHour(now, getSummaryTimezone());
      if (store.get<string>('safety-alert-day') !== day) {
        const a = await sendTelegramMessage(buildSafetyAlert(problems.join(', ')), telegram);
        if (a.sent) store.set('safety-alert-day', day);
      }
    }
  }

  await maybeSendMoveAlerts(store, source, portfolio, telegram);
  // One price fetch per cycle, shared by the shadows and the equity record —
  // each fetching its own would double the requests for identical data.
  const cyclePrices = await latestPrices(source, symbols);
  await runLiveMirror(store, source, instruments, telegram, cycle.opened, cyclePrices, now);
  await runShadows(store, source, symbols, now, cyclePrices);
  await runLongTermShadow(store, source, symbols, now);
  await recordEquity(store, source, portfolio, journal, now, cyclePrices);
  await maybeSendSummaries(store, source, portfolio, journal, telegram, now);
  await maybeSendPeriodicReports(store, source, portfolio, journal, telegram, now);
  await maybeSendAllClear(store, telegram, now);

  return cycle.opened.length > 0 || cycle.closed.length > 0;
}

/**
 * The actual real-money connection (2026-09-02) — David asked to build this
 * once the safety layer underneath was independently reviewed twice with
 * nothing left to fix. A no-op unless BOTH `REAL_MONEY_ENABLED=true` AND
 * real Revolut X credentials are configured — missing either is silent, by
 * design (see `REAL_MONEY_ENABLED`'s doc comment), so this stays exactly the
 * simulated-money-only system it has always been until a human deliberately
 * turns it on. Also requires Telegram to be configured, since EVERY live
 * order (entry or exit) requires a human tap — no Telegram, no orders.
 *
 * Everything here reads/writes ONLY through `liveStore`, a `PrefixedStore`
 * namespaced under `'live'` — including the shared Telegram poller's own
 * offset/pending-confirmation state, not just the trading state. This is the
 * ONLY code in this project that ever polls Telegram, so there is no other
 * consumer to keep in sync with; namespacing it too keeps every trace of
 * real-money state (cash, positions, kill switch, audit, pending
 * confirmations) cleanly separated from the paper autopilot's own state on
 * the exact same underlying store, per PROJECT_STATE.md's note on why
 * `DailyLossTracker` needed the same treatment.
 *
 * Order matters: a human's own manual commands (`/pause`, `/resume`,
 * `/sell`) are checked FIRST, so they always take effect before this same
 * cycle's automatic mirroring — a human pausing or manually selling must
 * never be raced by an automatic entry/exit decided in the same tick.
 */
export async function runLiveMirror(
  store: FileStore,
  source: MarketDataSource,
  instruments: readonly Instrument[],
  telegram: { token: string; chatId: string },
  cycleOpened: CycleResult['opened'],
  prices: Readonly<Record<string, number>>,
  now: number,
): Promise<void> {
  if (!realMoneyEnabled() || !telegram.token || !telegram.chatId) return;
  const credentials = liveCredentials();
  if (!credentials) return;

  const liveStore = new PrefixedStore(store, 'live');
  initLiveCash(liveStore, liveStartingCashEur());
  const killSwitch = new PersistedKillSwitch(liveStore);
  const audit = new PersistedAuditLog(liveStore);
  const brokerAdapter = new RevolutXBrokerAdapter(liveStore, audit, killSwitch, credentials);
  const confirmationGate = new TelegramConfirmationGate(liveStore, telegram, audit);
  // Live-scoped daily-loss circuit breaker (PrefixedStore, never the raw
  // store — see PROJECT_STATE.md's note on why this must never conflate
  // with the paper autopilot's own 'daily-loss' key on the same file). Found
  // missing entirely in review (2026-09-03): nothing fed real-money realized
  // P&L into it and nothing read it when sizing a live entry, so the
  // dailyLossLimitPct check inside `assessTrade` never actually applied to
  // real money — a losing streak in one day could never be halted by it.
  const liveLossTracker = new DailyLossTracker(liveStore);
  const dailyLossSoFar = liveLossTracker.lossToday(now);
  const recordLiveRealizedPnl = (pnl: number, ts: number): void => liveLossTracker.record(pnl, ts);
  // Mirrors paper's own confidence-scaled risk (see AUTOPILOT_CONFIDENCE_RISK)
  // so a live entry's position size actually reflects signal strength the
  // same way paper's does, instead of always sizing at the flat ceiling
  // (found in review, 2026-09-03).
  const liveEntryOptions = {
    dailyLossSoFar,
    confidenceRisk: {
      floorPct: AUTOPILOT_CONFIDENCE_RISK.floorPct,
      ceilingPct: AUTOPILOT_CONFIDENCE_RISK.ceilingPct,
      confidenceFloor: AUTOPILOT_MIN_CONFIDENCE,
      maxConfidence: MAX_CONFIDENCE,
    },
  };
  const flowParams = {
    confirmationGate,
    brokerAdapter,
    killSwitch,
    audit,
    verifySymbolExists: async (symbol: string) => {
      const pairs = await brokerAdapter.listTradablePairs();
      const found = pairs.includes(symbol);
      // `listTradablePairs()` itself only audits a genuine fetch failure —
      // a symbol simply not being in an otherwise-successful pairs list
      // looked identical to that in the audit log (both surfaced as the
      // same ambiguous "could not verify" message from `runLiveOrderFlow`).
      // Found in review (2026-09-03) after the diagnostic fix landed but
      // the /buy XBTEUR rejection message stayed unchanged: this records
      // WHICH case it was — an empty/unreachable pairs list vs. a
      // non-empty list that simply has no 'BASE-*' pair at all.
      if (!found) {
        const base = symbol.split('-')[0];
        const sameBase = base ? pairs.filter((p) => p.startsWith(`${base}-`)) : [];
        audit.append({
          timestamp: Date.now(),
          intentId: 'verify-symbol-exists',
          event: 'rejected',
          mode: 'live',
          detail:
            `'${symbol}' not found among ${pairs.length} tradable pairs from revolut-x` +
            (sameBase.length > 0
              ? `; same-base pairs available: ${sameBase.join(', ')}`
              : `; no pair with base '${base}' listed at all`),
        });
      }
      return found;
    },
    // Re-checked AFTER a human approves, BEFORE the broker sees the order
    // (David's "after I approve, check again it's still good" ask) — this
    // hook existed in `runLiveOrderFlow` already but was never actually
    // passed in here, so it did nothing on the real trading path (found in
    // review, 2026-09-03). Catches a human /pause landing while a
    // confirmation was already pending: without this, an approval tap that
    // arrives just after /pause would still submit a real order.
    revalidate: async () => ({
      ok: !killSwitch.isEngaged(),
      reason: killSwitch.isEngaged() ? 'kill switch engaged after approval was requested' : undefined,
    }),
  };

  try {
    await checkManualKillSwitchCommands(liveStore, telegram, killSwitch, audit, 'david', now);
    await checkManualSellRequests(liveStore, telegram, source, ENTRY_TF, flowParams, now, recordLiveRealizedPnl);
    await checkManualBuyRequests(
      liveStore,
      telegram,
      source,
      ENTRY_TF,
      instruments,
      prices,
      flowParams,
      now,
      liveEntryOptions,
    );
    const newlyApproved = cycleOpened
      .map((o) => o.opportunity)
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    await mirrorApprovedEntries(liveStore, newlyApproved, instruments, prices, flowParams, now, liveEntryOptions);
    await checkAutomaticExits(
      liveStore,
      source,
      ENTRY_TF,
      { trailing: AUTOPILOT_TRAILING },
      flowParams,
      now,
      150,
      recordLiveRealizedPnl,
    );
  } catch (cause) {
    // Never let a live-money problem take down the paper cycle that already
    // completed above — log and retry next cycle, same contract as every
    // other best-effort side-channel in this file (shadows, summaries).
    console.error('Live-money mirror failed:', cause instanceof Error ? cause.message : cause);
  }
}

const SHADOW_STANDINGS_KEY = 'shadow-standings';

/**
 * Long-term investing "wallet" (David asked for this 2026-08-31, mirroring
 * the stocks-side one in `stocksRunner.mts`): a separate paper portfolio
 * that holds through weeks/months instead of the main runner's tight-stop
 * trading. Same signal/risk engine, but on DAILY bars (naturally
 * weeks/months-wide ATR stops instead of hourly-wide ones) with `trendExit`
 * replacing the fixed take-profit — hold through a trend, exit only when the
 * daily trend actually breaks.
 *
 * Crypto's own trend-exit measurement (`sweepAutopilot.mts`, 2026-08-31) was
 * inconclusive on the main HOURLY timeframe (too few trades in both windows
 * tested) — this shadow candidate is the honest way to keep testing the
 * idea without adopting it into the real account on unproven evidence, and
 * daily bars are different enough that the earlier hourly measurement
 * doesn't even directly speak to this variant. Isolated by construction
 * (own namespace, own kill switch, own portfolio) — cannot affect the real
 * account.
 */
const LONGTERM_SHADOW_STANDINGS_KEY = 'shadow-longterm-standings';
const LONGTERM_SHADOW_LAST_RUN_DAY_KEY = 'longterm-shadow-last-run-day';
const LONGTERM_SHADOW_CANDIDATES: readonly ShadowCandidate[] = [
  {
    key: 'long-term',
    label: 'Long-term investing (daily bars, EMA50 trend-exit — holds weeks/months)',
    minConfidence: AUTOPILOT_MIN_CONFIDENCE,
    maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG,
    trendExit: { emaPeriod: 50 },
  },
];

/**
 * One cycle of the long-term shadow wallet, on the same traded symbols as
 * the main account but on daily bars. Purely diagnostic/simulated — a
 * failure here is logged and never allowed to affect the real cycle, which
 * has already completed by this point (same contract as `runShadows`).
 */
async function runLongTermShadow(
  store: FileStore,
  source: MarketDataSource,
  symbols: readonly string[],
  now: number,
): Promise<void> {
  // Daily bars only change once a day — a 5-minute internal loop (up to
  // LOOP_CYCLES times per trigger) would otherwise re-fetch identical daily
  // candles and re-run the same evaluation dozens of times for no new
  // information. Not set on failure, so a transient error gets retried on
  // the very next cycle rather than waiting a full day.
  const { day } = localDayAndHour(now, getSummaryTimezone());
  if (store.get<string>(LONGTERM_SHADOW_LAST_RUN_DAY_KEY) === day) return;
  try {
    const caching = new CachingSource(source);
    const prices: Record<string, number> = {};
    for (const symbol of symbols) {
      const candles = await caching.getCandles(symbol, '1d', 2);
      if (candles.ok && candles.value.length > 0) {
        prices[symbol] = candles.value[candles.value.length - 1]!.close;
      }
    }
    const { standings, failures } = await runShadowCycle(LONGTERM_SHADOW_CANDIDATES, {
      source: caching,
      symbols,
      timeframe: '1d',
      initialCash: INITIAL_CASH,
      costRate: COST_RATE,
      baseCurrency: 'EUR',
      store,
      now,
      prices,
    });
    store.set(LONGTERM_SHADOW_STANDINGS_KEY, { at: now, standings });
    store.set(LONGTERM_SHADOW_LAST_RUN_DAY_KEY, day);
    for (const failure of failures) {
      console.error(`Long-term shadow candidate '${failure.key}' failed: ${failure.reason}`);
    }
  } catch (cause) {
    console.error('Long-term shadow evaluation skipped:', cause instanceof Error ? cause.message : cause);
  }
}

/**
 * Forward-test the candidate strategies on this cycle's bars.
 *
 * Why forward and not another sweep: `scripts/sweepAutopilot.mts` showed no
 * parameter setting of the current signal has a positive edge, and hunting one
 * across a 30-day window is how you manufacture an illusion that dies on real
 * money. Candidates here decide on data as it arrives, building a record they
 * could not have been fitted to.
 *
 * Isolated by construction (own namespace, own portfolio, own kill switch) and
 * free in requests (all candidates read through one `CachingSource`). Purely
 * diagnostic: a failure here is logged and never allowed to affect the real
 * cycle, which has already completed by this point.
 */
async function runShadows(
  store: FileStore,
  source: MarketDataSource,
  symbols: readonly string[],
  now: number,
  prices: Readonly<Record<string, number>>,
): Promise<void> {
  try {
    const caching = new CachingSource(source);
    // Built from the REAL source (not the caching wrapper — CachingSource
    // only proxies candles/instruments), so only the 'whale-flow' candidate
    // ever calls it.
    const whaleFlowCheck = buildWhaleFlowCheck(source) ?? undefined;
    const topTraderCheck = await buildTopTraderCheck(symbols);
    // Reads through the shared CachingSource — the AI check's candle fetch
    // costs nothing extra beyond what the other shadow candidates already do.
    const aiJudgmentCheck = buildAiJudgmentCheck(caching, ENTRY_TF) ?? undefined;
    const { standings, failures } = await runShadowCycle(SHADOW_CANDIDATES, {
      source: caching,
      symbols,
      timeframe: ENTRY_TF,
      initialCash: INITIAL_CASH,
      costRate: COST_RATE,
      store,
      now,
      prices,
      whaleFlowCheck,
      topTraderCheck,
      aiJudgmentCheck,
    });
    store.set(SHADOW_STANDINGS_KEY, { at: now, standings });
    for (const failure of failures) {
      console.error(`Shadow candidate '${failure.key}' failed: ${failure.reason}`);
    }
    const best = [...standings].sort((a, b) => b.returnPct - a.returnPct)[0];
    if (best) {
      console.log(
        `Shadows: ${standings.length} candidates, best '${best.key}' ` +
          `${best.returnPct >= 0 ? '+' : ''}${best.returnPct.toFixed(2)}% over ${best.trades} trades.`,
      );
    }
  } catch (cause) {
    console.error('Shadow evaluation skipped:', cause instanceof Error ? cause.message : cause);
  }
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
  prices: Readonly<Record<string, number>>,
): Promise<void> {
  const equity = portfolio.snapshot(prices, now).equity;
  // Track the all-time equity peak for the drawdown circuit-breaker.
  const peak = store.get<number>(EQUITY_PEAK_KEY) ?? equity;
  store.set(EQUITY_PEAK_KEY, Math.max(peak, equity));
  const history = store.get<Array<{ at: number; equity: number }>>(EQUITY_HISTORY_KEY) ?? [];
  const firstAt = history[0]?.at ?? now;
  history.push({ at: now, equity: Math.round(equity * 100) / 100 });
  store.set(
    EQUITY_HISTORY_KEY,
    history.length > EQUITY_HISTORY_CAP ? history.slice(-EQUITY_HISTORY_CAP) : history,
  );

  // Honest real-money readiness: trade quality from the (after-fee) journal
  // record, but DRAWDOWN from the mark-to-market equity series above. The
  // journal curve steps only at exits, so a portfolio sitting through a deep
  // unrealized drawdown recorded none of it and could clear the 10% safety
  // criterion while real equity was far below its peak. Whichever is worse
  // wins, so the gate can only ever get stricter.
  const analytics = tradeAnalytics(journal.entries(), { initialCash: INITIAL_CASH });
  const liveDrawdownPct = maxDrawdownPct(
    history.map((point) => ({ timestamp: point.at, equity: point.equity })),
  );
  const benchmark = await computeBenchmark(store, source, equity, now);
  const readiness = assessRealMoneyReadiness({
    closedTrades: analytics.tradeCount,
    profitFactor: analytics.profitFactor,
    realizedReturnPct: (analytics.totalPnl / INITIAL_CASH) * 100,
    maxDrawdownPct: Math.max(analytics.maxDrawdownPct, liveDrawdownPct),
    vsBenchmarkPct: benchmark ? benchmark.portfolioPct - benchmark.assetPct : null,
    daysRunning: (now - firstAt) / DAY_MS,
    // This arm keeps a stop-loss (unlike the stocks arm's passive pivot), so
    // beating 100% buy-and-hold BTC in an uptrend is structurally impossible
    // by construction (see PROJECT_STATE.md, 2026-09-02) — accepted as a
    // conscious trade-off of capital protection, not a blocking bar.
    gateOnBenchmark: false,
  });
  store.set(READINESS_KEY, readiness);
}

/** Per-position record of the most extreme ±MOVE_ALERT_PCT step already alerted. */
interface MoveBucketExtreme {
  readonly neg: number;
  readonly pos: number;
}

/**
 * Notify when an open position reaches a new, MORE EXTREME ±MOVE_ALERT_PCT
 * step than ever alerted for it before (e.g. +5%, +10%, -5%), so big swings
 * surface without spamming on every tick.
 *
 * Bug fixed 2026-08-23: the previous version compared against only the
 * LAST bucket (`previous[p.id] !== bucket`), not the most extreme one ever
 * seen. A price hovering right across a threshold (e.g. wobbling between
 * -4.9% and -5.1%) truncates to bucket 0 and bucket -1 alternately, so every
 * single wobble back across the line re-fired the same "-5%" alert — one
 * position sent the identical alert 8+ times over several hours. Tracking
 * the most extreme step per direction (neg/pos) instead of the last one
 * makes a returning wobble a no-op: only a NEW record extreme re-alerts.
 */
export async function maybeSendMoveAlerts(
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
  // Older committed state stored a single number per position (the last
  // bucket, not the extreme). Migrate that shape on read so an already-open
  // position from before this fix keeps alerting correctly instead of going
  // silent forever just because its stored value isn't {neg, pos}.
  const previousRaw = store.get<Record<string, MoveBucketExtreme | number>>(MOVE_BUCKETS_KEY) ?? {};
  const previous: Record<string, MoveBucketExtreme> = {};
  for (const [id, value] of Object.entries(previousRaw)) {
    previous[id] = typeof value === 'number' ? { neg: Math.min(0, value), pos: Math.max(0, value) } : value;
  }
  const current: Record<string, MoveBucketExtreme> = {};
  for (const p of open) {
    const price = prices[p.symbol];
    const prevExtreme = previous[p.id] ?? { neg: 0, pos: 0 };
    if (price === undefined || !(p.entryPrice > 0)) {
      current[p.id] = prevExtreme;
      continue;
    }
    const movePct = ((price - p.entryPrice) / p.entryPrice) * 100;
    const bucket = Math.trunc(movePct / MOVE_ALERT_PCT); // signed step index
    let { neg, pos } = prevExtreme;
    let isNewExtreme = false;
    if (bucket < neg) {
      neg = bucket;
      isNewExtreme = true;
    } else if (bucket > pos) {
      pos = bucket;
      isNewExtreme = true;
    }
    current[p.id] = { neg, pos };
    if (isNewExtreme) {
      const result = await sendTelegramMessage(buildMoveAlert(p.symbol, movePct), telegram);
      console.log(result.sent ? `Move alert sent for ${p.symbol}.` : `Move alert failed: ${result.reason}`);
    }
  }
  store.set(MOVE_BUCKETS_KEY, current); // also drops closed positions
}

/**
 * Read-only snapshot of the fully isolated US-stocks Paper Autopilot, folded
 * into the crypto digest so one daily message covers both sides instead of
 * needing to open the app separately for stocks (requested 2026-08-23).
 *
 * Reads `state/stocks-state.json` directly rather than fetching live Alpaca
 * prices — this workflow has no Alpaca credentials (and shouldn't need any,
 * per the two sides' deliberate isolation) — using that file's own last
 * committed price snapshot instead, same data the stocks dashboard itself
 * shows. Genuinely read-only — deliberately avoids `PortfolioEngine.snapshot()`,
 * which persists a new day-anchor on its first call each day; that write
 * would never reach a commit (the crypto workflow only ever `git add`s its
 * own state file) but there's no reason to touch the stocks file at all
 * for what is otherwise a pure read, so this recomputes equity/P&L directly
 * from the two engines' pure accessors instead. A missing/corrupt file
 * (stocks never ran, or ran on a fork without it) returns null rather than
 * fabricating a fake all-zero stocks section or crashing the crypto digest.
 */
export function readStocksSummary(now: number): DailySummaryStocks | null {
  const stocksStatePath = getStocksStatePath();
  if (!existsSync(stocksStatePath)) return null;
  try {
    const stocksStore = new FileStore(stocksStatePath);
    const stocksJournal = new TradeJournal(stocksStore);
    const stocksPositions = new PositionEngine(stocksStore, stocksJournal);
    const portfolioState = stocksStore.get<{ cash: number; initialCash: number; closedRealizedPnl: number }>(
      'portfolio-engine',
    ) ?? { cash: STOCKS_INITIAL_CASH, initialCash: STOCKS_INITIAL_CASH, closedRealizedPnl: 0 };
    const snapshotEntries =
      stocksStore.get<{ symbols: readonly { symbol: string; price: number }[] }>('market-snapshot')
        ?.symbols ?? [];
    const prices: Record<string, number> = {};
    for (const e of snapshotEntries) prices[e.symbol] = e.price;
    const open = stocksPositions.openPositions();
    const investedValue = open.reduce((sum, p) => sum + p.quantity * (prices[p.symbol] ?? p.entryPrice), 0);
    const equity = portfolioState.cash + investedValue;
    const realizedPnl = portfolioState.closedRealizedPnl + stocksPositions.openRealizedPnl();
    const since = now - DAY_MS;
    const shadowSaved = stocksStore.get<{ standings: ShadowStanding[] }>('shadow-standings');
    const longTermShadow = shadowSaved?.standings.find((s) => s.key === 'long-term') ?? null;
    const benchmark = stocksStore.get<{ label: string; portfolioPct: number; assetPct: number }>('benchmark-result') ?? null;
    return {
      equity,
      cash: portfolioState.cash,
      totalReturnPct: ((equity - portfolioState.initialCash) / portfolioState.initialCash) * 100,
      realizedPnl,
      unrealizedPnl: stocksPositions.unrealizedPnl(prices),
      openedLast24h:
        open.filter((p) => p.openedAt >= since).length +
        stocksJournal.entries().filter((e) => e.entryTimestamp >= since).length,
      closedLast24h: stocksJournal.entries().filter((e) => e.exitTimestamp >= since).length,
      longTermShadow,
      benchmark,
    };
  } catch (cause) {
    console.error('Could not read stocks state for the daily summary:', cause instanceof Error ? cause.message : cause);
    return null;
  }
}

/**
 * Send the single daily digest (see SUMMARY_SLOTS), at most once per local
 * day, folding in the stocks side's own numbers (see `readStocksSummary`).
 * No-op without Telegram.
 */
export async function maybeSendSummaries(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;

  const { day: today, hour } = localDayAndHour(now, getSummaryTimezone());
  // No upper bound: a coverage gap (the free GitHub scheduler is unreliable)
  // must never cause a digest to be silently skipped for the whole day — late
  // is far better than missing. Once-per-day is still enforced by slot.key.
  const dueSlots = SUMMARY_SLOTS.filter(
    (slot) => hour >= slot.hour && store.get<string>(slot.key) !== today,
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
    // Counts every position OPENED in the window, including ones already
    // closed again — `openPositions()` alone would hide any trade that opened
    // and hit its stop or target inside the same 24 hours. The two sources
    // cannot overlap: the journal holds only closed trades, `open` only live ones.
    openedLast24h:
      open.filter((p) => p.openedAt >= since).length +
      journal.entries().filter((e) => e.entryTimestamp >= since).length,
    closedLast24h: journal.entries().filter((e) => e.exitTimestamp >= since).length,
    benchmark,
    readiness: store.get<RealMoneyReadiness>(READINESS_KEY) ?? null,
    stocks: readStocksSummary(now),
  };

  // Single digest a day now carries the shadow-strategy line every time.
  const shadowSaved = store.get<{ standings: ShadowStanding[] }>(SHADOW_STANDINGS_KEY);
  const longTermShadowSaved = store.get<{ standings: ShadowStanding[] }>(LONGTERM_SHADOW_STANDINGS_KEY);
  const longTermShadow = longTermShadowSaved?.standings.find((s) => s.key === 'long-term') ?? null;
  for (const slot of dueSlots) {
    const result = await sendTelegramMessage(
      buildDailySummary({
        ...baseSummary,
        heading: slot.heading,
        ...(shadowSaved ? { shadows: shadowSaved.standings } : {}),
        ...(longTermShadow ? { longTermShadow } : {}),
      }),
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
export async function maybeSendPeriodicReports(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;
  const { day, hour } = localDayAndHour(now, getSummaryTimezone());
  if (hour < 22) return; // evening only
  // Elapsed-time-since-last-send (reusing the anchor already stored by
  // sendPeriodReport), not an exact weekday/day-of-month match: a coverage
  // gap spanning that exact moment must only DELAY the report, never lose it
  // for the whole week/month (the same bug class fixed in the daily digest).
  const weeklyAnchor = store.get<{ at: number }>('weekly-anchor');
  const weeklyDue =
    (!weeklyAnchor || now - weeklyAnchor.at >= 7 * DAY_MS) &&
    store.get<string>('weekly-report-last') !== day;
  const monthlyAnchor = store.get<{ at: number }>('monthly-anchor');
  const monthlyDue =
    (!monthlyAnchor || now - monthlyAnchor.at >= 30 * DAY_MS) &&
    store.get<string>('monthly-report-last') !== day;
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
 * whether the agent beats buy-and-hold.
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

// Only run when invoked directly (`npx tsx server/autopilotRunner.mts`, as the
// GitHub Actions workflow does) — never on import, so tests can exercise the
// exported pure/testable pieces above without kicking off a live cycle.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
