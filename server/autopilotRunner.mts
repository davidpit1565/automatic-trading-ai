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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATE_INSTRUMENTS, CURATED_INSTRUMENTS, KrakenPublicSource } from '../src/core/data/krakenPublic';
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
import type { KeyValueStore } from '../src/core/data/storage';
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
import { checkManualKillSwitchCommands, type ManualKillSwitchOutcome } from './manualKillSwitchCommand.mts';
import { checkManualSellRequests } from './manualSellCommand.mts';
import { checkManualBuyRequests } from './manualBuyCommand.mts';
import { checkTipRequests } from './manualTipCommand.mts';
import { checkDiscoverRequests } from './manualDiscoverCommand.mts';
import { mirrorApprovedEntries, type LiveEntryOutcome } from './liveEntryMirror.mts';
import { checkAutomaticExits } from './liveExitMirror.mts';
import {
  hasLiveAccount,
  initLiveCash,
  liveCash,
  liveExternalBtcQuantity,
  recordLiveEquity,
  syncLiveCashFromBroker,
  syncLiveExternalBtc,
} from './liveLedger.mts';
import { openLivePositions } from './liveExitFlow.mts';
import { syncManualTradesFromBroker } from './liveManualTradeSync.mts';
import { ensureBlackoutWindows, isBlackout } from './blackoutCalendar.mts';
import { buildBlackoutSummaryMessage, drainBlackoutQueue, queueBlackoutEntries } from './liveBlackoutQueue.mts';
import { RevolutXBrokerAdapter, type RevolutXCredentials } from './revolutXBrokerAdapter.mts';
import { TelegramConfirmationGate } from './telegramConfirmationGate.mts';
import {
  buildAllClearMessage,
  buildCycleMessage,
  buildDailySummary,
  buildDrawdownHaltAlert,
  buildKillSwitchKeyboardIntro,
  buildMoveAlert,
  buildPeriodReport,
  buildRiskHaltAlert,
  buildSafetyAlert,
  buildTestMessage,
  getSummaryTimezone,
  killSwitchKeyboard,
  maybeSendEducationTip,
  pollAllTelegramUpdates,
  sendTelegramMessage,
  stashUnclaimedTelegramUpdates,
  SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED,
  type DailySummaryLive,
  type DailySummaryStocks,
  type TelegramTextMessage,
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
 * save at the very end. Best-effort: any failure is logged and the loop
 * continues (the end-of-run commit is a backstop). Only runs inside GitHub
 * Actions.
 *
 * On a push race (another run — e.g. a cancelled run that hadn't actually
 * exited yet, racing its own freshly-dispatched replacement, see
 * PROJECT_STATE.md 2026-09-03 — pushed first), this used to `git rebase -X
 * theirs origin/main`: a WHOLE-FILE conflict resolution that, for the single
 * monolithic state JSON every cycle rewrites, silently discarded this run's
 * own changes to every key it touched in favor of the other run's version —
 * even a just-closed trade or a live fill, producing a duplicate Telegram
 * alert next cycle once the discarded close got redetected against stale
 * state (the real incident: a paper ADAEUR take-profit alerted twice, 60s
 * apart, from two overlapping runs). Merges at the JSON KEY level instead:
 * origin's file as the base (keeps whatever the other run wrote), this run's
 * own DIRTY keys (`FileStore.dirtyKeys()` — only what THIS instance actually
 * set/removed) overlaid on top. Real data loss now only if both runs wrote
 * the exact same key in the same race window, not the whole file.
 */
/**
 * True only if at least one outcome represents a REAL order that just
 * reached the broker (`'submitted'` — see LiveOrderFlowResult) — every
 * other outcome ('pending', 'rejected', 'no-price-data', a routine Telegram
 * poll that found nothing, etc.) is either a no-op or safely retried next
 * cycle, so losing it to an untimely process kill costs nothing. Used to
 * gate the mid-cycle persist calls below to the moments that actually
 * matter, not literally every call (see persistStateToGit's own doc
 * comment for the real incident, 2026-09-04, this distinction fixes).
 */
function hasSubmittedOrder(outcomes: readonly { readonly outcome: string }[]): boolean {
  return outcomes.some((o) => o.outcome === 'submitted');
}

/** Blocking sleep with no subprocess spawn (Atomics.wait on a throwaway
 * SharedArrayBuffer) — see persistStateToGit's retry loop for why. */
function sleepSyncMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function persistStateToGit(store: FileStore, label: string): void {
  if (process.env['GITHUB_ACTIONS'] !== 'true') return;
  // Never captures stdout (2026-09-04, THIRD ENOBUFS recurrence same night,
  // after both an earlier stdio-piping fix and a retry backoff still didn't
  // stop it — see the retry-loop comment for the real cause found this
  // time): nothing here reads a returned value anymore, `git show` (the one
  // call that used to) now redirects straight to a file via the shell
  // instead. stderr stays piped — small, never the problem, and keeps
  // failure messages below readable instead of a bare exit code.
  const run = (cmd: string): void => {
    execSync(cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
  };
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
    run(`git commit -m "Autopilot state (mid-run ${label})"`);
    // 3, not 5 — a real incident, 2026-09-04: each attempt spawns a handful
    // of subprocesses (fetch/show/reset/add/commit), and calling this
    // function from 4 separate points every cycle over a multi-hour run,
    // with near-constant external pushes racing it, exhausted the
    // runner's process/pipe resources (every retry started failing with
    // `spawnSync ENOBUFS`) after roughly 90 minutes — silently breaking
    // EVERY subsequent persist for the rest of that run. Fewer attempts
    // per call, combined with only calling this at points that actually
    // submitted a real order (see hasSubmittedOrder), cuts the total
    // subprocess volume by roughly an order of magnitude.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        run('git push origin HEAD:main');
        console.log(`State persisted mid-run (${label}).`);
        return;
      } catch {
        try {
          // A real incident, 2026-09-04: neither the stdio-piping fix above
          // NOR a backoff between attempts (tried next, tested under a real
          // conflict — the delays measurably happened, ~3s/~6s between
          // attempts) stopped ENOBUFS; it kept failing on EVERY attempt
          // regardless. The one thing every failure had in common: `git
          // show origin/main:${STATE_PATH}` piping this file's full content
          // (over 1MB now) through execSync's own captured stdout pipe —
          // the only call in this whole function that ever moved a
          // meaningful amount of data through a Node-managed pipe, rather
          // than a git subprocess talking directly to the filesystem or
          // network. Redirecting it to a file via the shell instead (git
          // writes straight to disk; Node just reads the file back) means
          // NOTHING here pipes real data through Node anymore. Kept the
          // backoff too — harmless, and still matches the YAML step's own
          // never-failed retry loop.
          sleepSyncMs(attempt * 3000);
          run('git fetch origin main');
          const originTmpPath = `${STATE_PATH}.origin-tmp`;
          run(`git show origin/main:${STATE_PATH} > ${originTmpPath}`);
          const origin = JSON.parse(readFileSync(originTmpPath, 'utf8')) as Record<string, unknown>;
          rmSync(originTmpPath, { force: true });
          for (const key of store.dirtyKeys()) origin[key] = store.get(key);
          // Fully sync EVERYTHING to origin/main FIRST — a real incident,
          // 2026-09-03: `git reset --soft origin/main` alone moves HEAD but
          // leaves the index/working tree exactly as they were, so every
          // OTHER tracked file (source code included) stayed frozen at
          // whatever this process's OWN stale checkout had. The next commit
          // then silently REVERTED any file origin/main had gained since —
          // a long-running stocks workflow's stale checkout reverted a
          // critical live-money safety fix (PR #152) straight back out of
          // main this way. `--hard` snaps every file to origin/main's real
          // current content; only the state file is then deliberately
          // overwritten again with the key-merged version.
          run('git reset --hard origin/main');
          mkdirSync(dirname(STATE_PATH), { recursive: true });
          writeFileSync(STATE_PATH, JSON.stringify(origin, null, 2));
          run(`git add ${STATE_PATH}`);
          if (hasStagedChanges()) run(`git commit -m "Autopilot state (mid-run ${label})"`);
          // else: the merged file is byte-identical to origin's — nothing of
          // ours to add; the next attempt just fast-forwards.
        } catch (mergeFailure) {
          console.error(
            'State merge-on-conflict failed:',
            mergeFailure instanceof Error ? mergeFailure.message : mergeFailure,
          );
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
  // Dropped the "(כסף מדומה)" qualifier from the heading (2026-09-03) — the
  // digest now also carries the REAL Revolut X account's own section below,
  // so a blanket "simulated money" label at the top would be misleading.
  { hour: 15, key: 'daily-summary', heading: '📊 סיכום יומי — סוכן מסחר' },
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
/** Same bound every data source in this project uses — this AI-judgment gate
 * and the Telegram helpers were the only fetch calls in the whole codebase
 * missing it (found 2026-09-03 after the crypto autopilot's cycle loop hung
 * for 2+ hours with nothing to time it out). This gate runs on every
 * candidate that reaches it, every cycle. */
const AI_JUDGMENT_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_JUDGMENT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(url, {
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
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
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
  // Trade ONLY the validated majors — see the CURATED_INSTRUMENTS doc
  // comment in krakenPublic.ts for the real-history measurements behind
  // each addition. The instrument list is broadened beyond this for
  // display/browsing (see getInstruments there: CURATED_INSTRUMENTS always
  // comes first, in order, so this slice always lines up with it exactly).
  // Derived from CURATED_INSTRUMENTS.length rather than a hardcoded count —
  // found in review, 2026-09-04: a hardcoded 20 here required remembering
  // to bump it in the SAME change as every future addition to
  // CURATED_INSTRUMENTS, or a newly-curated symbol would be silently
  // excluded from real trading while the UI's "TRADED" badge (CURATED_BASES,
  // the same source array) kept claiming it traded.
  const symbols = instruments.value.slice(0, CURATED_INSTRUMENTS.length).map((i) => i.symbol);

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
    // Persist mid-run: immediately after any trade, and every N cycles —
    // including the FINAL cycle (found 2026-09-03, full-system audit): this
    // used to be left to the workflow's own end-of-run commit step, whose
    // conflict fallback (`git rebase -X theirs`, a whole-file strategy) can
    // silently discard an entire cycle's state on a genuine push race — the
    // exact bug class `persistStateToGit`'s key-level dirty-merge exists to
    // prevent, just left unprotected in this one remaining spot. The
    // workflow's own commit step still runs afterward as a harmless
    // redundant safety net (it finds nothing staged and no-ops in the normal
    // case).
    const periodic = STATE_COMMIT_EVERY > 0 && (i + 1) % STATE_COMMIT_EVERY === 0;
    if (traded || periodic) {
      persistStateToGit(store, `cycle ${i + 1}/${LOOP_CYCLES}`);
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
  await checkHelpRequests(store, telegram);
  await checkTipRequests(store, telegram, autopilot, now);
  await checkStatusRequests(store, source, portfolio, journal, telegram, now);
  await checkDiscoverRequests(store, telegram, source);
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
  // Simulated buy/sell fills — silenced (David, 2026-09-06). See
  // SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED's doc comment.
  if (message !== null && SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED) {
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
  // Simulated-only (breakerEngaged reads the paper equity history) — silenced,
  // see SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED.
  if (SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED && telegram.token && telegram.chatId && breakerEngaged(store)) {
    const { day } = localDayAndHour(now, getSummaryTimezone());
    if (store.get<string>('dd-halt-alert-day') !== day) {
      const a = await sendTelegramMessage(buildDrawdownHaltAlert(DD_BREAKER_PCT), telegram);
      if (a.sent) store.set('dd-halt-alert-day', day);
    }
  }

  // Tell the user (once per day) when a safety limit pauses new buying.
  // Simulated-only (the paper autopilot's own daily-loss limit) — silenced.
  if (
    SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED &&
    telegram.token &&
    telegram.chatId &&
    cycle.skipped.some((s) => /daily loss limit/i.test(s.reason))
  ) {
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
  // Checks the simulated `portfolio` — silenced (real-money invariants have
  // their own separate audit-log-based safety net, untouched here).
  if (SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED && telegram.token && telegram.chatId) {
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
  await runCandidateWatch(store, source, now);
  await recordEquity(store, source, portfolio, journal, now, cyclePrices);
  await maybeSendSummaries(store, source, portfolio, journal, telegram, now);
  await maybeSendPeriodicReports(store, source, portfolio, journal, telegram, now);
  // See maybeSendEducationTip's own doc comment — persists immediately only
  // on the rare cycle a tip actually sent, closing the same duplicate-digest
  // gap fixed above for the daily/periodic reports.
  if (await maybeSendEducationTip(store, telegram, now)) persistStateToGit(store, 'after education tip');
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
/**
 * David asked for this 2026-09-03: after tapping אשר/דחה he had no way to
 * know what actually happened at the broker without asking me to read the
 * audit log for him — `TelegramConfirmationGate` only knows the human's
 * decision, not the broker's response, so this is a SEPARATE message sent
 * once that's known. Only covers outcomes that reached an actual human
 * decision (`'submitted'` after approval, `'rejected'` with a real
 * `decidedBy`) — the earlier algorithmic refusals (`'not-approved'`,
 * `'no-broker-symbol'`, `'unknown-symbol'`, etc.) never reached a tap and
 * stay audit-log-only, same as before.
 */
export function buildLiveEntryResultMessage(o: LiveEntryOutcome): string | null {
  if (o.outcome === 'rejected') {
    return `❌ דחית את העסקה ${o.symbol} — ההזמנה לא בוצעה.`;
  }
  if (o.outcome !== 'submitted') return null;
  const r = o.report;
  if (r.state === 'filled') {
    return (
      `✅ העסקה בוצעה בבורסה\n\n` +
      `${o.symbol}\n` +
      `כמות: ${r.filledQuantity}` +
      (r.avgFillPrice != null ? ` · מחיר ממוצע: ${r.avgFillPrice}` : '')
    );
  }
  if (r.state === 'rejected' || r.state === 'cancelled') {
    return `❌ הבורסה דחתה את ההזמנה\n\n${o.symbol}\n${r.detail}`;
  }
  // Still resting/open at the broker, not yet filled.
  return `🟡 ההזמנה נשלחה לבורסה ועדיין ממתינה למילוי\n\n${o.symbol}\n${r.detail}`;
}

async function notifyLiveEntryOutcomes(
  telegram: { token: string; chatId: string },
  outcomes: readonly LiveEntryOutcome[],
): Promise<void> {
  for (const outcome of outcomes) {
    const message = buildLiveEntryResultMessage(outcome);
    if (message) await sendTelegramMessage(message, telegram);
  }
}

/**
 * Found in a full-system safety re-audit, 2026-09-04: `/pause` and `/resume`
 * (both the typed command and the persistent keyboard button, which sends
 * the same text — `killSwitchKeyboard()`) DID engage/disengage the kill
 * switch correctly and DID audit it, but `runLiveMirror` discarded
 * `checkManualKillSwitchCommands`'s return value, so a human tapping the
 * one-and-only emergency stop got zero Telegram confirmation it actually
 * took effect — the exact same "silently did nothing" shape as the bare
 * /buy and /sell bug fixed earlier tonight, but on the safety control
 * itself. `applied: false` (already in the requested state) still gets a
 * reply — an unconfirmed no-op reads identically to an unconfirmed success
 * from the human's side of the chat.
 */
function buildKillSwitchOutcomeMessage(o: ManualKillSwitchOutcome): string {
  if (o.command === 'pause') {
    return o.applied
      ? "⏸ קיל סוויץ' הופעל — נעצר כל מסחר חדש בכסף אמיתי. פוזיציות פתוחות ממשיכות להיות מנוטרות."
      : "⏸ קיל סוויץ' כבר היה מופעל — אין שינוי.";
  }
  return o.applied
    ? "▶️ קיל סוויץ' כובה — המסחר האמיתי חזר לפעול."
    : "▶️ קיל סוויץ' כבר היה כבוי — אין שינוי.";
}

async function notifyKillSwitchOutcomes(
  telegram: { token: string; chatId: string },
  outcomes: readonly ManualKillSwitchOutcome[],
): Promise<void> {
  for (const outcome of outcomes) {
    await sendTelegramMessage(buildKillSwitchOutcomeMessage(outcome), telegram);
  }
}

export async function runLiveMirror(
  store: FileStore,
  source: MarketDataSource,
  instruments: readonly Instrument[],
  telegram: { token: string; chatId: string; fetchFn?: typeof fetch },
  cycleOpened: CycleResult['opened'],
  prices: Readonly<Record<string, number>>,
  now: number,
): Promise<void> {
  if (!realMoneyEnabled() || !telegram.token || !telegram.chatId) return;
  const credentials = liveCredentials();
  if (!credentials) return;

  const liveStore = new PrefixedStore(store, 'live');
  initLiveCash(liveStore, liveStartingCashEur());
  // Send the always-visible kill-switch keyboard once (David asked for
  // this 2026-09-03) — a persistent reply keyboard stays pinned at the
  // bottom of the chat regardless of later inline-keyboard messages, so
  // one send is enough; tracked so it's never re-sent every cycle.
  if (!liveStore.get<boolean>('kill-switch-keyboard-sent')) {
    const result = await sendTelegramMessage(buildKillSwitchKeyboardIntro(), telegram, killSwitchKeyboard());
    if (result.sent) liveStore.set('kill-switch-keyboard-sent', true);
  }
  const killSwitch = new PersistedKillSwitch(liveStore);
  const audit = new PersistedAuditLog(liveStore);
  const brokerAdapter = new RevolutXBrokerAdapter(liveStore, audit, killSwitch, credentials);
  // Reconcile the tracked cash figure against Revolut X's own real balance
  // before anything sizes a trade off of it — see liveLedger.mts's own doc
  // comment for the real incident (2026-09-03) that made this necessary.
  await syncLiveCashFromBroker(liveStore, brokerAdapter);
  // Same reconciliation, for the BTC balance David keeps as a personal
  // holding outside the bot's own tracked positions (2026-09-03) — reporting
  // only, so the app's Real-money chart reflects it without changing how
  // trades are sized (see liveLedger.mts's own doc comment).
  await syncLiveExternalBtc(liveStore, brokerAdapter);
  recordLiveEquity(liveStore, prices, now);
  const confirmationGate = new TelegramConfirmationGate(liveStore, telegram, audit, store);
  // Live-scoped daily-loss circuit breaker (PrefixedStore, never the raw
  // store — see PROJECT_STATE.md's note on why this must never conflate
  // with the paper autopilot's own 'daily-loss' key on the same file). Found
  // missing entirely in review (2026-09-03): nothing fed real-money realized
  // P&L into it and nothing read it when sizing a live entry, so the
  // dailyLossLimitPct check inside `assessTrade` never actually applied to
  // real money — a losing streak in one day could never be halted by it.
  const liveLossTracker = new DailyLossTracker(liveStore);
  const recordLiveRealizedPnl = (pnl: number, ts: number): void => liveLossTracker.record(pnl, ts);
  // Catches a trade David makes directly in the Revolut X app instead of
  // through this bot (2026-09-04, David asked for this explicitly) — before
  // this cycle's own entry/exit checks below, so a manual fill from between
  // cycles is reconciled first (see liveManualTradeSync.mts's own doc
  // comment for why this ordering is race-free).
  const reconciledManualTrade = await syncManualTradesFromBroker(
    liveStore, brokerAdapter, source, telegram, now, recordLiveRealizedPnl,
  );
  // A real, already-detected position/loss must never be lost to a killed
  // job — every OTHER real-money action in this cycle gets an immediate
  // persist on a genuine outcome (manual sell/buy, mirrored entries,
  // automatic exits below); this one had none, so a crash between here and
  // the next such persist would silently revert an already Telegram-announced
  // stop-loss/take-profit (or realized P&L) back to untracked. Found in
  // review, 2026-09-05 — same incident class as persistStateToGit's own
  // doc comment describes for manual /buy.
  if (reconciledManualTrade) persistStateToGit(store, 'live-mirror: after manual trade reconciliation');
  // Read AFTER syncManualTradesFromBroker, not before — an external sell it
  // just detected can itself add to today's realized loss (recordLiveRealizedPnl
  // above), and every entry sized below (manual /buy, mirrored) must see that
  // same-cycle loss, not a snapshot taken before it ran. Found in review,
  // 2026-09-05: the exact stale-snapshot bug class already fixed once for
  // equity/openPositions in `mirrorApprovedEntries` (PRs #107-#110,
  // 2026-09-03), reintroduced here for `dailyLossSoFar` specifically by this
  // call's insertion point.
  const dailyLossSoFar = liveLossTracker.lossToday(now);
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
    // `store` (raw, unprefixed) is passed for Telegram polling specifically —
    // never `liveStore` — there is only ONE Telegram bot and ONE update
    // offset, and every OTHER command handler (/help, /tip, /status,
    // /discover) polls through `store` too. Real bug, found 2026-09-03: this
    // used to implicitly poll through `liveStore` (a separate key namespace),
    // so a /sell (or /buy, /pause, /resume, or an approve/reject button tap)
    // picked up by the outer pollers first — they run earlier in the cycle —
    // got stashed where these handlers, reading the live-prefixed unclaimed
    // key, could never find it. Silently broken despite the bot clearly
    // being alive (other commands answered fine).
    const killSwitchOutcomes = await checkManualKillSwitchCommands(store, telegram, killSwitch, audit, 'david', now);
    await notifyKillSwitchOutcomes(telegram, killSwitchOutcomes);
    const manualSellOutcomes = await checkManualSellRequests(
      liveStore, telegram, source, ENTRY_TF, flowParams, now, recordLiveRealizedPnl, store,
    );
    // Persisted immediately once a real order actually reaches the broker,
    // not only once at the very end of this whole function (which itself
    // only runs once per OUTER cycle) — a real incident, 2026-09-03: a
    // manual /buy genuinely reached Revolut X (a real order placed,
    // Telegram already notified) but the surrounding cycle was killed (a
    // stuck job cancelled and redispatched) before ever reaching runCycle's
    // own end-of-loop persist, silently losing every bit of bookkeeping for
    // an order that had already, irreversibly, happened.
    //
    // Gated on hasSubmittedOrder (not called unconditionally after every
    // step) — a SECOND real incident, 2026-09-04: calling this after every
    // single manual-command check regardless of outcome meant it ran its
    // full conflict-retry path on nearly every cycle (routine Telegram
    // polling alone dirties the shared offset key even when nothing
    // matched), and over a multi-hour run with constant external pushes
    // racing it, exhausted the runner's process/pipe resources
    // (`spawnSync ENOBUFS`) after ~90 minutes — silently breaking EVERY
    // subsequent persist, mid-cycle AND end-of-cycle, for the rest of that
    // run. Only a genuine broker submission is worth the cost; everything
    // else is either a no-op or safely retried next cycle regardless.
    if (hasSubmittedOrder(manualSellOutcomes)) persistStateToGit(store, 'live-mirror: after manual sell');
    const manualBuyOutcomes = await checkManualBuyRequests(
      liveStore,
      telegram,
      source,
      ENTRY_TF,
      instruments,
      prices,
      flowParams,
      now,
      liveEntryOptions,
      store,
    );
    await notifyLiveEntryOutcomes(telegram, manualBuyOutcomes);
    if (hasSubmittedOrder(manualBuyOutcomes)) persistStateToGit(store, 'live-mirror: after manual buy');
    const newlyApproved = cycleOpened
      .map((o) => o.opportunity)
      .filter((o): o is NonNullable<typeof o> => o !== undefined);
    const mirroredOutcomes = await mirrorApprovedEntries(
      liveStore,
      newlyApproved,
      instruments,
      prices,
      flowParams,
      now,
      liveEntryOptions,
    );
    await notifyLiveEntryOutcomes(telegram, mirroredOutcomes);
    if (hasSubmittedOrder(mirroredOutcomes)) persistStateToGit(store, 'live-mirror: after auto-approved entries');
    // Shabbat/Yom Tov: the confirmation above is still sent as always —
    // David asked (2026-09-03) to keep the option to approve any time he's
    // actually available. This only remembers what was proposed so
    // anything that never got answered by the time the window ends can be
    // summarized in one message, instead of silently vanishing.
    const blackoutWindows = await ensureBlackoutWindows(liveStore, now, telegram.fetchFn ?? fetch);
    const activeBlackout = isBlackout(blackoutWindows, now);
    const wasInBlackout = liveStore.get<boolean>('live-blackout-active') ?? false;
    if (activeBlackout) {
      queueBlackoutEntries(liveStore, newlyApproved, now);
    } else if (wasInBlackout) {
      const stillOpen = new Set(openLivePositions(liveStore).map((p) => p.entryAssessment.asset));
      const summary = drainBlackoutQueue(liveStore, prices, stillOpen);
      const message = buildBlackoutSummaryMessage(summary, 'השבת/החג');
      if (message) await sendTelegramMessage(message, telegram);
    }
    liveStore.set('live-blackout-active', activeBlackout !== null);
    const exitOutcomes = await checkAutomaticExits(
      liveStore,
      source,
      ENTRY_TF,
      { trailing: AUTOPILOT_TRAILING },
      flowParams,
      now,
      150,
      recordLiveRealizedPnl,
    );
    if (hasSubmittedOrder(exitOutcomes)) persistStateToGit(store, 'live-mirror: after automatic exits');
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

/**
 * Live forward test of the 13 new-candidate symbols (see `CANDIDATE_INSTRUMENTS`
 * in `krakenPublic.ts` for why: measured net-positive on real Kraken backtest
 * history, but backtest alone was already caught being wrong once tonight —
 * the BREAKOUT lead — so these earn a real live forward record before any
 * decision to add them to `CURATED_INSTRUMENTS`. David: "תריץ קודם ואז תוסיף
 * אחרי ההרצה" (run it first, then add after the run) — nothing here decides
 * that; it only builds the honest record to decide from later.
 *
 * Deliberately its OWN `runShadowCycle` call with its OWN symbols array, not
 * folded into `SHADOW_CANDIDATES`/`symbols` above: those test alternate
 * STRATEGIES on the curated universe, this tests the PRODUCTION-DEFAULT
 * strategy on a DIFFERENT universe. One candidate, no `evaluate` override —
 * production's own minConfidence/maxRsiForLong/trailing/confirmation, so the
 * record answers exactly the question "would these have done well trading
 * like the real bot does." Isolated by construction (own namespace, own
 * portfolio, own kill switch, real account and SHADOW_CANDIDATES scoreboard
 * both untouched) and 100% simulated — `runShadowCycle` never has a live-order
 * path. Bounded extra cost: 13 symbols' worth of candle fetches through the
 * same throttled `KrakenPublicSource` queue as everything else, not a new
 * fetch pattern.
 */
const CANDIDATE_WATCH_STANDINGS_KEY = 'candidate-watch-standings';
const CANDIDATE_WATCH_SYMBOLS = CANDIDATE_INSTRUMENTS.map((i) => i.symbol);
const CANDIDATE_WATCH_CANDIDATES: readonly ShadowCandidate[] = [
  {
    key: 'candidate-watch',
    label: '13 new candidates, production defaults (forward test only — not real trading)',
    minConfidence: AUTOPILOT_MIN_CONFIDENCE,
    maxRsiForLong: AUTOPILOT_MAX_RSI_FOR_LONG,
    trailing: AUTOPILOT_TRAILING,
    confirmationTimeframe: CONFIRMATION_TF,
  },
];

/**
 * One cycle of the new-candidate forward test, on their own symbol universe.
 * Purely diagnostic/simulated — a failure here is logged and never allowed
 * to affect the real cycle, which has already completed by this point (same
 * contract as `runShadows`/`runLongTermShadow`).
 */
async function runCandidateWatch(
  store: FileStore,
  source: MarketDataSource,
  now: number,
): Promise<void> {
  try {
    const caching = new CachingSource(source);
    const prices = await latestPrices(caching, CANDIDATE_WATCH_SYMBOLS);
    const { standings, failures } = await runShadowCycle(CANDIDATE_WATCH_CANDIDATES, {
      source: caching,
      symbols: CANDIDATE_WATCH_SYMBOLS,
      timeframe: ENTRY_TF,
      initialCash: INITIAL_CASH,
      costRate: COST_RATE,
      store,
      now,
      prices,
    });
    store.set(CANDIDATE_WATCH_STANDINGS_KEY, { at: now, standings });
    for (const failure of failures) {
      console.error(`Candidate watch '${failure.key}' failed: ${failure.reason}`);
    }
  } catch (cause) {
    console.error('Candidate watch evaluation skipped:', cause instanceof Error ? cause.message : cause);
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
    // Default to the OLD extreme, not the new one — only actually advance it
    // once the alert is confirmed sent (below). Found in review, 2026-09-03:
    // this used to record the new extreme unconditionally, so a transient
    // Telegram failure right when a position crossed a new extreme silently,
    // permanently lost that alert — the next cycle would no longer see it as
    // "new" (already recorded) and never retry, unlike every other alert in
    // this file, which only persists its "sent" flag after checking
    // `result.sent`.
    current[p.id] = prevExtreme;
    // `portfolio.openPositions()` above is the SIMULATED paper portfolio —
    // silenced (David, 2026-09-06). See SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED.
    if (isNewExtreme && SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED) {
      const result = await sendTelegramMessage(buildMoveAlert(p.symbol, movePct), telegram);
      console.log(result.sent ? `Move alert sent for ${p.symbol}.` : `Move alert failed: ${result.reason}`);
      if (result.sent) current[p.id] = { neg, pos };
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
 * Builds the REAL Revolut X account's own numbers for the daily digest —
 * null if real money has never been enabled (`liveLedger.mts`'s
 * `hasLiveAccount`). Added 2026-09-03: David pointed out the digest never
 * mentioned the real wallet at all, only the simulated crypto/stocks ones.
 * Reporting only — mirrors the same total the app's Profit tab shows.
 */
export function readLiveSummary(
  liveStore: KeyValueStore,
  prices: Readonly<Record<string, number>>,
): DailySummaryLive | null {
  if (!hasLiveAccount(liveStore)) return null;
  const cash = liveCash(liveStore);
  const positionsRaw = openLivePositions(liveStore).map((p) => {
    const symbol = p.entryAssessment.asset;
    const price = prices[symbol] ?? p.entryPrice;
    return { symbol, marketValue: p.quantity * price };
  });
  const trackedValue = positionsRaw.reduce((sum, p) => sum + p.marketValue, 0);
  const externalBtcValue = liveExternalBtcQuantity(liveStore) * (prices['XBTEUR'] ?? 0);
  const equity = cash + trackedValue + externalBtcValue;
  const killSwitch = new PersistedKillSwitch(liveStore);
  return {
    cash,
    equity,
    externalBtcValue,
    positions: positionsRaw.map((p) => ({
      ...p,
      pctOfEquity: equity > 0 ? (p.marketValue / equity) * 100 : 0,
    })),
    killSwitchEngaged: killSwitch.isEngaged(),
    killSwitchReason: killSwitch.reason(),
  };
}

/**
 * Send the single daily digest (see SUMMARY_SLOTS), at most once per local
 * day, folding in the stocks side's own numbers (see `readStocksSummary`)
 * and the real Revolut X account's own numbers (see `readLiveSummary`).
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
  const liveStore = new PrefixedStore(store, 'live');
  // 'XBTEUR' is always fetched too, even with no open position in it — it's
  // needed to value the untracked external BTC holding in readLiveSummary.
  const priceSymbols = Array.from(
    new Set([...open.map((p) => p.symbol), ...openLivePositions(liveStore).map((p) => p.entryAssessment.asset), 'XBTEUR']),
  );
  const prices = await latestPrices(source, priceSymbols);
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
    live: readLiveSummary(liveStore, prices),
  };

  // Single digest a day now carries the shadow-strategy line every time.
  const shadowSaved = store.get<{ standings: ShadowStanding[] }>(SHADOW_STANDINGS_KEY);
  const longTermShadowSaved = store.get<{ standings: ShadowStanding[] }>(LONGTERM_SHADOW_STANDINGS_KEY);
  const longTermShadow = longTermShadowSaved?.standings.find((s) => s.key === 'long-term') ?? null;
  const candidateWatchSaved = store.get<{ standings: ShadowStanding[] }>(CANDIDATE_WATCH_STANDINGS_KEY);
  const candidateWatch = candidateWatchSaved?.standings.find((s) => s.key === 'candidate-watch') ?? null;
  for (const slot of dueSlots) {
    // Simulated crypto/stocks sections silenced (David, 2026-09-06) — only
    // the REAL Revolut X section (`baseSummary.live`) still renders. See
    // SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED and buildDailySummary's
    // `hideSimulated` doc comment.
    const built = buildDailySummary({
      ...baseSummary,
      heading: slot.heading,
      hideSimulated: !SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED,
      ...(shadowSaved ? { shadows: shadowSaved.standings } : {}),
      ...(longTermShadow ? { longTermShadow } : {}),
      ...(candidateWatch ? { candidateWatch } : {}),
    });
    if (built === null) {
      // Nothing left to report (no live account) — mark the slot done for
      // today without sending anything, so the rest of today's cycles don't
      // keep recomputing this for nothing.
      store.set(slot.key, today);
      persistStateToGit(store, `daily summary silenced (${slot.key})`);
      console.log(`Summary silenced (${slot.key}): simulated-only, no live account.`);
      continue;
    }
    const result = await sendTelegramMessage(built, telegram);
    if (result.sent) {
      store.set(slot.key, today);
      // Real incident, 2026-09-04: this "already sent today" fact only used
      // to persist via the routine per-cycle commit — if the process got
      // killed or cancelled before that commit landed (a cancelled/stuck
      // run being cancelled+redispatched, exactly what happened repeatedly
      // tonight fighting the ENOBUFS incidents above), the fact was lost;
      // the next fresh run re-checked against the last COMMITTED state,
      // still saw the digest as unsent, and sent it again — a real
      // duplicate digest David actually received. A digest send is rare
      // (at most once a day per slot) so persisting it immediately, like
      // the hasSubmittedOrder-gated live-order persists above, costs
      // nothing and closes this specific gap.
      persistStateToGit(store, `after daily summary (${slot.key})`);
      console.log(`Summary sent (${slot.key}).`);
    } else {
      console.log(`Summary not sent (${slot.key}): ${result.reason}`);
    }
  }
}

/**
 * `/status` — on-demand snapshot of both accounts, right now (David asked
 * 2026-09-03, alongside `/tip`: "what's bought and sold, what's the
 * situation now"). Reuses the exact same data-gathering and message format
 * as the scheduled daily digest (`maybeSendSummaries`, just above) —
 * consistent with every other notification rather than inventing a new
 * shape — just triggered on demand instead of by the clock, and never
 * marks a summary slot as sent (a `/status` check must never suppress the
 * real scheduled digest later that day).
 */
export async function checkStatusRequests(
  store: FileStore,
  source: MarketDataSource,
  portfolio: PortfolioEngine,
  journal: TradeJournal,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<boolean> {
  const polled = await pollAllTelegramUpdates(store, telegram);
  const unclaimed: TelegramTextMessage[] = [];
  let requested = false;
  for (const message of polled.messages) {
    if (/^\/status\s*$/i.test(message.text.trim())) requested = true;
    else unclaimed.push(message);
  }
  stashUnclaimedTelegramUpdates(store, { messages: unclaimed, callbacks: polled.callbacks });
  if (!requested) return false;

  const open = portfolio.openPositions();
  const liveStore = new PrefixedStore(store, 'live');
  const priceSymbols = Array.from(
    new Set([...open.map((p) => p.symbol), ...openLivePositions(liveStore).map((p) => p.entryAssessment.asset), 'XBTEUR']),
  );
  const prices = await latestPrices(source, priceSymbols);
  const snap = portfolio.snapshot(prices, now);
  const since = now - DAY_MS;
  const benchmark = await computeBenchmark(store, source, snap.equity, now);
  // Simulated section silenced (David, 2026-09-06) — /status now reports
  // only the REAL Revolut X account. See SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED.
  const message = buildDailySummary({
    heading: '📋 מצב נוכחי — לפי בקשה',
    equity: snap.equity,
    cash: snap.cash,
    totalReturnPct: snap.totalReturnPct,
    realizedPnl: snap.realizedPnl,
    unrealizedPnl: snap.unrealizedPnl,
    positions: snap.allocation.map((a) => ({ symbol: a.symbol, marketValue: a.marketValue, pctOfEquity: a.pctOfEquity })),
    openedLast24h:
      open.filter((p) => p.openedAt >= since).length + journal.entries().filter((e) => e.entryTimestamp >= since).length,
    closedLast24h: journal.entries().filter((e) => e.exitTimestamp >= since).length,
    benchmark,
    readiness: store.get<RealMoneyReadiness>(READINESS_KEY) ?? null,
    stocks: readStocksSummary(now),
    live: readLiveSummary(liveStore, prices),
    hideSimulated: !SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED,
  });
  if (message === null) {
    console.log('Status not sent: simulated-only, no live account.');
    return true;
  }
  const result = await sendTelegramMessage(message, telegram);
  console.log(result.sent ? 'Status sent (on demand).' : `Status not sent: ${result.reason}`);
  return true;
}

const HELP_MESSAGE = [
  '📋 פקודות זמינות:',
  '',
  '/status — מצב נוכחי של החשבון האמיתי: הון, מזומן, פוזיציות פתוחות, קניות/מכירות ב-24 השעות האחרונות.',
  '/tip — הזדמנות המסחר הכי טובה כרגע (אותם קריטריונים בדיוק כמו הסוכן האוטומטי) — לא מבצע כלום, רק מדווח.',
  '/discover — סקר שוק על-פי דרישה: בודק מטבעות שעדיין לא ברשימת המסחר על נתונים אמיתיים ומדווח אם משהו שווה הוספה. לא מוסיף כלום אוטומטית.',
  '/buy SYMBOL — פתיחת פוזיציה אמיתית ידנית (למשל /buy XBTEUR). עובר את אותה שרשרת בטיחות (אישור בטלגרם, מתג חירום).',
  '/sell SYMBOL — סגירת פוזיציה אמיתית פתוחה ידנית (למשל /sell XBTEUR).',
  '/pause — עצירת חירום מיידית: אין הזמנות אמיתיות חדשות עד /resume.',
  '/resume — ביטול /pause, חזרה לפעילות רגילה.',
  '/help — ההודעה הזו.',
].join('\n');

/**
 * `/help` — a pinnable list of every command (David asked 2026-09-03).
 * Static text, no data gathering — genuinely read-only, no side effects
 * beyond consuming its own Telegram message.
 */
export async function checkHelpRequests(
  store: FileStore,
  telegram: { token: string; chatId: string },
): Promise<boolean> {
  const polled = await pollAllTelegramUpdates(store, telegram);
  const unclaimed: TelegramTextMessage[] = [];
  let requested = false;
  for (const message of polled.messages) {
    if (/^\/help\s*$/i.test(message.text.trim())) requested = true;
    else unclaimed.push(message);
  }
  stashUnclaimedTelegramUpdates(store, { messages: unclaimed, callbacks: polled.callbacks });
  if (!requested) return false;

  const result = await sendTelegramMessage(HELP_MESSAGE, telegram);
  console.log(result.sent ? 'Help sent.' : `Help not sent: ${result.reason}`);
  return true;
}

/** Periodic all-clear: confirms safety systems are active every ~2 weeks. */
async function maybeSendAllClear(
  store: FileStore,
  telegram: { token: string; chatId: string },
  now: number,
): Promise<void> {
  // Describes the simulated engine's own protections — silenced (David,
  // 2026-09-06). See SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED.
  if (!SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED) return;
  if (!telegram.token || !telegram.chatId) return;
  const last = store.get<number>(ALLCLEAR_KEY);
  if (last !== undefined && now - last < ALLCLEAR_INTERVAL_MS) return;
  const result = await sendTelegramMessage(buildAllClearMessage(), telegram);
  if (result.sent) {
    store.set(ALLCLEAR_KEY, now);
    // Same real duplicate-notification gap as the daily digest (see
    // maybeSendSummaries) — a cancelled run right after this send loses the
    // "already sent" fact if it never made it into a committed persist,
    // and the next fresh run sends it again. Rare enough (interval-gated)
    // that persisting immediately costs nothing.
    persistStateToGit(store, 'after all-clear message');
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
  // Weekly/monthly report of the simulated `portfolio` — silenced (David,
  // 2026-09-06). See SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED.
  if (!SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED) return;
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
    // Same real duplicate-notification gap as the daily digest (see
    // maybeSendSummaries) — weekly/monthly, rare enough that an immediate
    // persist costs nothing and closes it for good.
    persistStateToGit(store, `after ${cfg.title} report`);
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
