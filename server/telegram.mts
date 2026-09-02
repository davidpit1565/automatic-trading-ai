/**
 * Telegram notifications for the cloud autopilot.
 *
 * Sends a plain message via the Telegram Bot API. Credentials come from
 * environment (GitHub Actions secrets) and are never committed. When they
 * are absent the send is a graceful no-op, so the autopilot still runs and
 * accumulates state — it just doesn't notify.
 */

import type { CycleResult } from '../src/core/autopilot/paperAutoPilot';
import { SHADOW_MEANINGFUL_TRADES, type ShadowStanding } from '../src/core/autopilot/shadowEvaluator';
import type { ReadinessKey, RealMoneyReadiness } from '../src/core/feedback/realMoneyReadiness';

export interface TelegramConfig {
  token: string;
  chatId: string;
  fetchFn?: typeof fetch;
}

export interface SendResult {
  sent: boolean;
  reason?: string;
}

function euro(value: number): string {
  return `€${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Money with an explicit +/- sign, e.g. "+€12.34" / "-€5.00". */
function signedEuro(value: number): string {
  return `${value >= 0 ? '+' : '-'}€${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Money with an explicit +/- sign, e.g. "+$12.34" / "-$5.00". */
function signedUsd(value: number): string {
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** Human-readable trade quantity — never the raw 15-decimal float. */
function formatQty(qty: number): string {
  const abs = Math.abs(qty);
  const maximumFractionDigits = abs >= 1000 ? 0 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return qty.toLocaleString('en-US', { maximumFractionDigits });
}

export interface DailySummaryPosition {
  readonly symbol: string;
  readonly marketValue: number;
  readonly pctOfEquity: number;
}

/** Same-window comparison of the portfolio against a buy-and-hold asset. */
export interface DailySummaryBenchmark {
  /** Display name of the asset, e.g. "ביטקוין". */
  readonly label: string;
  /** Portfolio return since the benchmark anchor, %. */
  readonly portfolioPct: number;
  /** Asset buy-and-hold return over the same window, %. */
  readonly assetPct: number;
}

/**
 * Same shape as the crypto summary above, in USD, for the fully isolated
 * US-stocks Paper Autopilot — optional because the digest must still send
 * correctly (crypto-only) if the stocks state can't be read for any reason.
 */
export interface DailySummaryStocks {
  readonly equity: number;
  readonly cash: number;
  readonly totalReturnPct: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly openedLast24h: number;
  readonly closedLast24h: number;
  /**
   * The long-term investing "wallet" — a separate paper portfolio holding
   * through weeks/months instead of the main runner's tight-stop trading
   * (see `stocksRunner.mts`'s `STOCKS_SHADOW_CANDIDATES`). Null/omitted if
   * it hasn't run yet.
   */
  readonly longTermShadow?: ShadowStanding | null;
  /** Portfolio vs. SPY (S&P 500) buy-and-hold — see `computeStocksBenchmark`
   * in `stocksRunner.mts`. Null/omitted if not measured yet. */
  readonly benchmark?: DailySummaryBenchmark | null;
}

export interface DailySummaryInput {
  readonly equity: number;
  readonly cash: number;
  readonly totalReturnPct: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly positions: readonly DailySummaryPosition[];
  readonly openedLast24h: number;
  readonly closedLast24h: number;
  readonly benchmark?: DailySummaryBenchmark | null;
  /** Honest real-money readiness verdict, shown as one line. */
  readonly readiness?: RealMoneyReadiness | null;
  /** Optional first line, e.g. a morning/evening greeting. */
  readonly heading?: string;
  /**
   * Forward-test standings for the candidate strategies (see
   * `shadowEvaluator.ts`). Optional — omit to leave the digest unchanged;
   * the evening send is the only caller that passes it, so this section
   * appears at most once a day rather than in every digest.
   */
  readonly shadows?: readonly ShadowStanding[];
  /** The stocks side's own numbers, appended as a second section. */
  readonly stocks?: DailySummaryStocks | null;
  /**
   * Crypto's own long-term investing "wallet" — a separate paper portfolio
   * holding through weeks/months instead of the main runner's tight-stop
   * trading (see `autopilotRunner.mts`'s `LONGTERM_SHADOW_CANDIDATES`).
   * Null/omitted if it hasn't run yet.
   */
  readonly longTermShadow?: ShadowStanding | null;
}

/** One line for a long-term shadow wallet's standing — shared by crypto and
 * stocks (see `shadowEvaluator.ts`'s `long-term` candidate). */
function longTermShadowLines(standing: ShadowStanding, prefix: string): string[] {
  if (standing.trades < SHADOW_MEANINGFUL_TRADES) {
    return [`${prefix} עדיין צובר נתונים (${standing.trades}/${SHADOW_MEANINGFUL_TRADES} עסקאות) — מוקדם לדרג.`];
  }
  const sign = standing.returnPct >= 0 ? '+' : '';
  return [
    `${prefix} ${sign}${standing.returnPct.toFixed(2)}% ` +
      `(${standing.trades} עסקאות, PF ${standing.profitFactor === null ? 'n/a' : standing.profitFactor.toFixed(2)}). ` +
      `כסף מדומה, חשבון נפרד.`,
  ];
}

/** One line comparing the portfolio to a buy-and-hold benchmark — shared by
 * crypto (BTC) and stocks (SPY). */
function benchmarkLines(b: DailySummaryBenchmark, prefix: string): string[] {
  const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
  const verdict = b.portfolioPct >= b.assetPct ? 'הסוכן מוביל 🎉' : 'החזקה פשוטה מובילה';
  return [`${prefix}מול ${b.label} (מאז תחילת המעקב): הסוכן ${fmt(b.portfolioPct)} · ${b.label} ${fmt(b.assetPct)} → ${verdict}`];
}

/** One-line summary of the shadow strategy standings, or how far they are from meaning anything. */
function shadowSummaryLines(standings: readonly ShadowStanding[]): string[] {
  if (standings.length === 0) return [];
  const ranked = standings.filter((s) => s.trades >= SHADOW_MEANINGFUL_TRADES);
  if (ranked.length === 0) {
    const most = Math.max(...standings.map((s) => s.trades));
    return [
      `🧪 אסטרטגיות בבדיקה: עדיין צוברות נתונים (המובילה: ${most}/` +
        `${SHADOW_MEANINGFUL_TRADES} עסקאות) — מוקדם לדרג.`,
    ];
  }
  const best = [...ranked].sort((a, b) => b.returnPct - a.returnPct)[0]!;
  const sign = best.returnPct >= 0 ? '+' : '';
  return [
    `🧪 אסטרטגיה מובילה בבדיקה: ${best.label} — ${sign}${best.returnPct.toFixed(2)}% ` +
      `(${best.trades} עסקאות, PF ${best.profitFactor === null ? 'n/a' : best.profitFactor.toFixed(2)}). ` +
      `כסף מדומה, לא משפיע על החשבון האמיתי.`,
  ];
}

/** Short Hebrew phrase for an unmet readiness criterion. */
function readinessReasonHe(key: ReadinessKey): string {
  switch (key) {
    case 'trades':
      return 'צריך עוד עסקאות';
    case 'days':
      return 'צריך עוד זמן מעקב';
    case 'profitable':
      return 'עדיין לא רווחי אחרי עמלות';
    case 'benchmark':
      return 'עדיין לא מנצח החזקת ביטקוין';
    case 'drawdown':
      return 'ירידה זמנית גדולה מדי';
    case 'consistency':
      return 'עקביות עדיין לא מספקת';
    default:
      return 'עוד בבדיקה';
  }
}

/** One honest Hebrew line: is the paper record ready for real money yet? */
export function readinessLineHe(readiness: RealMoneyReadiness): string {
  if (readiness.ready) {
    return '💶 מוכנות לכסף אמיתי: ✅ מוכן — עבר את כל בדיקות הבטיחות (לא הבטחה לרווח).';
  }
  const reasons = readiness.unmet.map(readinessReasonHe).join(', ');
  return `💶 מוכנות לכסף אמיתי: ❌ עדיין לא — ${reasons}. (עדיין כסף מדומה — מגן על הכסף)`;
}

/**
 * Once-a-day portfolio digest so the user knows the agent is alive and how
 * it is doing, without a message every cycle. Sent at most once per day.
 */
export function buildDailySummary(input: DailySummaryInput): string {
  const ret = `${input.totalReturnPct >= 0 ? '+' : ''}${input.totalReturnPct.toFixed(2)}%`;
  const lines: string[] = [
    input.heading ?? '📊 סיכום יומי — סוכן מסחר (כסף מדומה)',
    `💰 שווי תיק: ${euro(input.equity)} (${ret} מההתחלה)`,
    `💵 מזומן פנוי: ${euro(input.cash)}`,
    `📈 רווח/הפסד: ${signedEuro(input.realizedPnl)} ממומש · ${signedEuro(input.unrealizedPnl)} על הנייר`,
    `🔄 24 שעות אחרונות: ${input.openedLast24h} קניות, ${input.closedLast24h} מכירות`,
  ];
  if (input.benchmark) {
    lines.push(...benchmarkLines(input.benchmark, '🏁 '));
  }
  if (input.positions.length === 0) {
    lines.push('📌 אין פוזיציות פתוחות כרגע.');
  } else {
    lines.push(`📌 פוזיציות פתוחות (${input.positions.length}):`);
    for (const p of input.positions) {
      lines.push(`   • ${p.symbol}: ${euro(p.marketValue)} (${p.pctOfEquity.toFixed(1)}% מהתיק)`);
    }
  }
  if (input.openedLast24h === 0 && input.closedLast24h === 0) {
    lines.push('🛡️ אין עסקאות כרגע — ממתין להזדמנות טובה ומגן על הכסף. הכול תקין.');
  }
  if (input.readiness) {
    lines.push(readinessLineHe(input.readiness));
  }
  if (input.shadows) {
    lines.push(...shadowSummaryLines(input.shadows));
  }
  if (input.longTermShadow) {
    lines.push(...longTermShadowLines(input.longTermShadow, '🌱 ארנק השקעות לטווח ארוך:'));
  }
  if (input.stocks) {
    const s = input.stocks;
    const sRet = `${s.totalReturnPct >= 0 ? '+' : ''}${s.totalReturnPct.toFixed(2)}%`;
    lines.push(
      '',
      '📈 מניות (ארה"ב, כסף מדומה — חשבון נפרד):',
      `   💰 שווי: ${usd(s.equity)} (${sRet} מההתחלה) · 💵 מזומן: ${usd(s.cash)}`,
      `   📊 רווח/הפסד: ${signedUsd(s.realizedPnl)} ממומש · ${signedUsd(s.unrealizedPnl)} על הנייר`,
      `   🔄 24 שעות אחרונות: ${s.openedLast24h} קניות, ${s.closedLast24h} מכירות`,
    );
    if (s.benchmark) {
      lines.push(...benchmarkLines(s.benchmark, '   🏁 '));
    }
    if (s.longTermShadow) {
      lines.push(...longTermShadowLines(s.longTermShadow, '   🌱 ארנק השקעות לטווח ארוך:'));
    }
  }
  return lines.join('\n');
}

/**
 * Fixed confirmation message used to verify end-to-end Telegram delivery
 * without waiting for a real trade. Sent only when explicitly requested.
 */
export function buildTestMessage(): string {
  return '✅ הסוכן מחובר! מעכשיו תקבל כאן התראה על כל קנייה/מכירה. כסף מדומה בלבד.';
}

/** Alert sent once when a safety limit pauses new buying for the day. */
export function buildRiskHaltAlert(): string {
  return (
    '🛑 עצרתי לקנות היום — הגעתי לגבול ההפסד היומי (הגנה אוטומטית על הכסף).\n' +
    'הפוזיציות הפתוחות ממשיכות להיות מנוהלות עם סטופ/יעד. אתחדש מחר. (כסף מדומה)'
  );
}

/** Periodic (weekly / monthly) performance report. */
export interface PeriodReportInput {
  /** e.g. "שבועי" or "חודשי". */
  readonly title: string;
  readonly equity: number;
  /** Return since the last report of this kind; null on the first one. */
  readonly periodReturnPct: number | null;
  readonly tradesCount: number;
  readonly wins: number;
  readonly losses: number;
  readonly bestPct: number | null;
  readonly worstPct: number | null;
  readonly benchmark?: DailySummaryBenchmark | null;
}

export function buildPeriodReport(i: PeriodReportInput): string {
  const lines: string[] = [
    `🗓️ דו"ח ${i.title} — סוכן מסחר (כסף מדומה)`,
    `💰 שווי תיק: ${euro(i.equity)}`,
  ];
  lines.push(
    i.periodReturnPct === null
      ? '📈 תשואת התקופה: מתחילים למדוד מעכשיו'
      : `📈 תשואת התקופה: ${i.periodReturnPct >= 0 ? '+' : ''}${i.periodReturnPct.toFixed(2)}%`,
  );
  lines.push(
    `🔄 עסקאות שנסגרו: ${i.tradesCount}` +
      (i.tradesCount > 0 ? ` (${i.wins} ברווח, ${i.losses} בהפסד)` : ''),
  );
  if (i.tradesCount > 0 && i.bestPct !== null && i.worstPct !== null) {
    lines.push(
      `🏆 הכי טובה: ${i.bestPct >= 0 ? '+' : ''}${i.bestPct.toFixed(1)}% · ` +
        `הכי גרועה: ${i.worstPct >= 0 ? '+' : ''}${i.worstPct.toFixed(1)}%`,
    );
  }
  if (i.benchmark) {
    const f = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    const verdict = i.benchmark.portfolioPct >= i.benchmark.assetPct ? 'הסוכן מוביל 🎉' : 'ביטקוין מוביל';
    lines.push(
      `🏁 מול ${i.benchmark.label}: הסוכן ${f(i.benchmark.portfolioPct)} · ${i.benchmark.label} ${f(i.benchmark.assetPct)} → ${verdict}`,
    );
  }
  return lines.join('\n');
}

/** Alert when the portfolio drawdown circuit-breaker pauses new buying. */
export function buildDrawdownHaltAlert(limitPct: number): string {
  return (
    `🛑 בלם ביטחון: התיק ירד יותר מ-${limitPct}% מהשיא, אז עצרתי קניות חדשות — הגנה על ההון.\n` +
    'הפוזיציות הפתוחות ממשיכות להיות מנוהלות עם סטופ/יעד. הקניות יתחדשו אוטומטית כשהתיק יתאושש. (כסף מדומה)'
  );
}

/** Periodic all-clear: confirms the safety protections are active. */
export function buildAllClearMessage(): string {
  return (
    '🛡️ בדיקת ביטחון תקופתית — הכל מבוטח ✅\n' +
    'כל ההגנות פעילות: תקרת סיכון לעסקה, תקרת חשיפה, בלם הפסד יומי, ומגבלת פוזיציות. ' +
    'כסף מדומה בלבד — הסוכן לא יכול לגעת בכסף אמיתי.'
  );
}

/** Immediate alert when a safety invariant looks wrong (should never happen). */
export function buildSafetyAlert(problem: string): string {
  return `🚨 בדיקת בטיחות מצאה בעיה: ${problem}. עצרתי להיזהר — כדאי לבדוק. (כסף מדומה)`;
}

/** Alert for a significant price move on an open position. */
export function buildMoveAlert(symbol: string, movePct: number): string {
  const up = movePct >= 0;
  const pct = `${up ? '+' : ''}${movePct.toFixed(1)}%`;
  return `${up ? '📈' : '📉'} ${symbol} ${up ? 'עלה' : 'ירד'} ${pct} מאז הקנייה (כסף מדומה)`;
}

/** Signal-driver labels (from the signal engine) in plain Hebrew. */
function driverHe(label: string): string {
  switch (label) {
    case 'Scanner evidence':
      return 'ראיות טכניות';
    case 'Trend strength':
      return 'מגמה חזקה';
    case 'Volume participation':
      return 'מחזור מסחר גבוה';
    default:
      return label;
  }
}

/** Exit reason in plain Hebrew. */
function reasonHe(reason: string): string {
  switch (reason) {
    case 'take-profit':
      return 'הגיע ליעד הרווח';
    case 'stop-loss':
      return 'הופעל סטופ-לוס';
    case 'signal-exit':
      return 'יציאה לפי סיגנל';
    case 'manual':
      return 'ידני';
    default:
      return 'אחר';
  }
}

/** Human-readable message (Hebrew) for a cycle's trades, or null if none. */
export function buildCycleMessage(
  cycle: Pick<CycleResult, 'opened' | 'closed' | 'timestamp'>,
): string | null {
  if (cycle.opened.length === 0 && cycle.closed.length === 0) return null;
  const lines: string[] = ['🤖 סוכן מסחר (כסף מדומה)'];
  for (const o of cycle.opened) {
    let line = `🟢 קנייה ${o.symbol}: ${formatQty(o.quantity)} יח׳ במחיר ${euro(o.entry)}`;
    if (typeof o.confidence === 'number') line += ` · ביטחון ${o.confidence.toFixed(0)}%`;
    if (o.reasons && o.reasons.length > 0) {
      line += ` · ${o.reasons.map(driverHe).join(', ')}`;
    }
    lines.push(line);
  }
  for (const c of cycle.closed) {
    lines.push(`🔴 מכירה ${c.symbol} במחיר ${euro(c.price)} (${reasonHe(c.reason)})`);
  }
  return lines.join('\n');
}

function dollar(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/**
 * Same shape as `buildCycleMessage`, for the separate stocks paper autopilot
 * — a distinct function (not a parameterised currency) so the crypto
 * message builder above is never touched by stocks-only changes.
 */
export function buildStockCycleMessage(
  cycle: Pick<CycleResult, 'opened' | 'closed' | 'timestamp'>,
): string | null {
  if (cycle.opened.length === 0 && cycle.closed.length === 0) return null;
  const lines: string[] = ['📈 סוכן מניות (כסף מדומה)'];
  for (const o of cycle.opened) {
    let line = `🟢 קנייה ${o.symbol}: ${formatQty(o.quantity)} יח׳ במחיר ${dollar(o.entry)}`;
    if (typeof o.confidence === 'number') line += ` · ביטחון ${o.confidence.toFixed(0)}%`;
    if (o.reasons && o.reasons.length > 0) {
      line += ` · ${o.reasons.map(driverHe).join(', ')}`;
    }
    lines.push(line);
  }
  for (const c of cycle.closed) {
    lines.push(`🔴 מכירה ${c.symbol} במחיר ${dollar(c.price)} (${reasonHe(c.reason)})`);
  }
  return lines.join('\n');
}

/** An inline button row, e.g. one "Approve" / "Reject" pair. `callback_data` is
 * what comes back on `getTelegramUpdates` when the human taps it — max 64
 * bytes per Telegram's own limit, so callers must keep it short (an intent id,
 * not a whole payload). */
export interface InlineKeyboardButton {
  readonly text: string;
  readonly callback_data: string;
}

export async function sendTelegramMessage(
  text: string,
  config: TelegramConfig,
  replyMarkup?: { inline_keyboard: readonly (readonly InlineKeyboardButton[])[] },
): Promise<SendResult & { messageId?: number }> {
  if (!config.token || !config.chatId) {
    return { sent: false, reason: 'Telegram credentials not set' };
  }
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    const response = await doFetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        disable_web_page_preview: true,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!response.ok) return { sent: false, reason: `Telegram HTTP ${response.status}` };
    const payload = (await response.json()) as { result?: { message_id?: number } };
    return { sent: true, messageId: payload.result?.message_id };
  } catch (cause) {
    return { sent: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly data: string;
}

/**
 * Short-poll for pending button taps (callback queries) since the last-seen
 * update id. `timeout: 0` (no Telegram-side long-poll) is deliberate — this
 * runs inside a GitHub Actions job with its own wall-clock budget, so the
 * caller controls polling cadence itself rather than blocking one HTTP call
 * for minutes.
 */
export async function getTelegramUpdates(
  config: TelegramConfig,
  offset: number,
): Promise<{ updates: readonly TelegramCallbackQuery[]; nextOffset: number }> {
  if (!config.token) return { updates: [], nextOffset: offset };
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    const response = await doFetch(
      `https://api.telegram.org/bot${config.token}/getUpdates?offset=${offset}&timeout=0&allowed_updates=%5B%22callback_query%22%5D`,
      { method: 'GET' },
    );
    if (!response.ok) return { updates: [], nextOffset: offset };
    const payload = (await response.json()) as {
      result?: readonly { update_id: number; callback_query?: { id: string; data?: string } }[];
    };
    const results = payload.result ?? [];
    const updates: TelegramCallbackQuery[] = [];
    let nextOffset = offset;
    for (const u of results) {
      nextOffset = Math.max(nextOffset, u.update_id + 1);
      if (u.callback_query?.data) updates.push({ id: u.callback_query.id, data: u.callback_query.data });
    }
    return { updates, nextOffset };
  } catch {
    return { updates: [], nextOffset: offset };
  }
}

export interface TelegramTextMessage {
  readonly updateId: number;
  readonly text: string;
}

/**
 * Short-poll for plain text messages (not button taps) since the last-seen
 * update id — used for manual commands (e.g. `/sell <SYMBOL>`,
 * `server/manualSellCommand.mts`). A SEPARATE offset from
 * `getTelegramUpdates`'s per-intent ones: unrelated concerns, each free to
 * advance independently over the same underlying update stream.
 *
 * Only ever returns messages from the configured `chatId` — a command must
 * never be honored from any other chat the bot could ever receive a message
 * from, even though this bot is only meant to talk to one person.
 */
export async function getTelegramMessages(
  config: TelegramConfig,
  offset: number,
): Promise<{ messages: readonly TelegramTextMessage[]; nextOffset: number }> {
  if (!config.token) return { messages: [], nextOffset: offset };
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    const response = await doFetch(
      `https://api.telegram.org/bot${config.token}/getUpdates?offset=${offset}&timeout=0&allowed_updates=%5B%22message%22%5D`,
      { method: 'GET' },
    );
    if (!response.ok) return { messages: [], nextOffset: offset };
    const payload = (await response.json()) as {
      result?: readonly { update_id: number; message?: { text?: string; chat?: { id?: number | string } } }[];
    };
    const results = payload.result ?? [];
    const messages: TelegramTextMessage[] = [];
    let nextOffset = offset;
    for (const u of results) {
      nextOffset = Math.max(nextOffset, u.update_id + 1);
      if (u.message?.text && String(u.message.chat?.id ?? '') === String(config.chatId)) {
        messages.push({ updateId: u.update_id, text: u.message.text });
      }
    }
    return { messages, nextOffset };
  } catch {
    return { messages: [], nextOffset: offset };
  }
}

/** Clears the button's "loading" spinner in the Telegram client. Best-effort — a
 * failure here never blocks the decision itself from being recorded. */
export async function answerCallbackQuery(callbackQueryId: string, config: TelegramConfig): Promise<void> {
  if (!config.token) return;
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    await doFetch(`https://api.telegram.org/bot${config.token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch {
    // best-effort, see doc comment
  }
}
