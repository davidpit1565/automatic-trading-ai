/**
 * Telegram notifications for the cloud autopilot.
 *
 * Sends a plain message via the Telegram Bot API. Credentials come from
 * environment (GitHub Actions secrets) and are never committed. When they
 * are absent the send is a graceful no-op, so the autopilot still runs and
 * accumulates state — it just doesn't notify.
 */

import type { CycleResult } from '../src/core/autopilot/paperAutoPilot';
import type { KeyValueStore } from '../src/core/data/storage';
import { SHADOW_MEANINGFUL_TRADES, type ShadowStanding } from '../src/core/autopilot/shadowEvaluator';
import type { ReadinessKey, RealMoneyReadiness } from '../src/core/feedback/realMoneyReadiness';

/**
 * Timezone every Hebrew-facing clock time in this project shows — the daily
 * digests (autopilotRunner.mts) AND any absolute deadline shown in a
 * Telegram message (telegramConfirmationGate.mts's confirmation expiry).
 * Overridable via the SUMMARY_TIMEZONE repo variable without a code change;
 * DST is handled automatically by Intl. Read fresh on every call (not a
 * frozen module-level const) so an override takes effect immediately and
 * tests can pin their own expected timezone regardless of the fallback.
 *
 * Real bug, found 2026-09-03: this used to be two independent hardcoded
 * values — digests already defaulted to 'Europe/Brussels' for David's trip,
 * but the confirmation-gate's own deadline clock was hardcoded to
 * 'Asia/Jerusalem' and never read this override, so the two clocks
 * disagreed by an hour while he was travelling. One shared source now.
 *
 * TEMPORARY: fallback set to Europe/Brussels for a trip (2026-08-10) —
 * revert to 'Asia/Jerusalem' once back home, or set SUMMARY_TIMEZONE
 * instead so this fallback never has to move again.
 */
export function getSummaryTimezone(): string {
  return process.env['SUMMARY_TIMEZONE'] || 'Europe/Brussels';
}

export interface TelegramConfig {
  token: string;
  chatId: string;
  fetchFn?: typeof fetch;
}

/** Same bound already used for every other outbound HTTP call in this
 * project (krakenPublic.ts, revolutXBrokerAdapter.mts) — this file was the
 * one place missing it. Found 2026-09-03 after the crypto autopilot's
 * internal cycle loop hung for 2+ hours with no error and no progress: every
 * one of this file's 4 fetch calls ran with no AbortController at all, so a
 * single stalled connection to api.telegram.org — and `pollAllTelegramUpdates`
 * alone is called several times per cycle, by every command handler — could
 * block the entire cycle (and therefore the whole run) forever, with nothing
 * to time it out short of the workflow's own multi-hour job timeout. */
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(doFetch: typeof fetch, input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await doFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
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
export function formatQty(qty: number): string {
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

/**
 * The REAL Revolut X account — separate from everything else in this file,
 * which is all SIMULATED money. Null/omitted if real money has never been
 * enabled (`liveLedger.mts`'s `hasLiveAccount`). Added 2026-09-03 after
 * David pointed out the daily digest never mentioned the real wallet at
 * all, only the simulated crypto/stocks accounts.
 */
export interface DailySummaryLive {
  readonly cash: number;
  /** Cash + tracked open positions + the untracked BTC holding below, all
   * marked to the current price — the same total the app's Profit tab
   * shows (see `liveLedger.mts`'s `recordLiveEquity`). */
  readonly equity: number;
  /** Positions the bot itself opened and manages (stop-loss/take-profit). */
  readonly positions: readonly DailySummaryPosition[];
  /** Current EUR value of BTC sitting in the account outside the bot's own
   * tracking (e.g. a manual EUR→BTC conversion) — reporting only. */
  readonly externalBtcValue: number;
  readonly killSwitchEngaged: boolean;
  readonly killSwitchReason: string | null;
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
  /** The REAL Revolut X account's own numbers, appended as its own section. */
  readonly live?: DailySummaryLive | null;
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
    input.heading ?? '📊 סיכום יומי — סוכן מסחר',
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
  if (input.live) {
    const l = input.live;
    lines.push('', '💶 חשבון אמיתי (Revolut X — כסף אמיתי):', `   💰 שווי כולל: ${euro(l.equity)}`);
    const parts = [`מזומן ${euro(l.cash)}`];
    if (l.externalBtcValue > 0) parts.push(`BTC לא-מנוהל ${euro(l.externalBtcValue)}`);
    lines.push(`   (${parts.join(' · ')})`);
    if (l.positions.length === 0) {
      lines.push('   📌 אין פוזיציות פתוחות של הבוט כרגע.');
    } else {
      lines.push(`   📌 פוזיציות פתוחות של הבוט (${l.positions.length}):`);
      for (const p of l.positions) {
        lines.push(`      • ${p.symbol}: ${euro(p.marketValue)} (${p.pctOfEquity.toFixed(1)}% מהחשבון)`);
      }
    }
    lines.push(
      l.killSwitchEngaged
        ? `   ⏸ קיל סוויץ' מופעל${l.killSwitchReason ? ` — ${l.killSwitchReason}` : ''}`
        : "   ▶️ קיל סוויץ' כבוי — המסחר האמיתי פעיל",
    );
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

/** The always-visible kill-switch keyboard (David asked for this 2026-09-03:
 * a permanent button instead of remembering to type /pause). Once sent, it
 * stays pinned at the bottom of the chat regardless of later messages'
 * inline keyboards — a persistent reply keyboard and a message's inline
 * keyboard are separate Telegram UI layers. Sent once (tracked by the
 * caller), not on every message. */
export function killSwitchKeyboard(): TelegramReplyMarkup {
  return {
    keyboard: [[{ text: '/pause' }], [{ text: '/resume' }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Short, beginner-level trading tips (David asked 2026-09-03 to be taught
 * gradually, "one or two tips every day or two" — he has near-zero trading
 * background). Deliberately foundational and specific to how THIS project
 * actually works (confidence score, risk%, kill switch), not generic
 * finance-blog filler. Order matters: builds from "what am I looking at"
 * toward "why the safety rails exist". */
export const EDUCATION_TIPS: readonly string[] = [
  '💡 טיפ 1: "ביטחון" (confidence) בכל עסקה הוא ציון 0-100 שהמערכת נותנת לאיתות, לא הבטחה. ציון גבוה (למשל 70+) אומר שהרבה סימנים מסכימים ביניהם — לא שהעסקה בטוחה לרווח.',
  '💡 טיפ 2: "סטופ-לוס" הוא המחיר שבו העסקה נסגרת אוטומטית אם השוק זז נגדך, כדי לעצור הפסד לפני שהוא גדל. כל עסקה בכסף אמיתי כאן תמיד מגיעה עם סטופ-לוס מוגדר מראש.',
  '💡 טיפ 3: "% סיכון" זה כמה מהתיק שלך אתה מוכן להפסיד בעסקה הזו אם היא נכשלת (לא כמה אתה קונה בכסף). המערכת שומרת את זה קטן בכוונה — כדי שאף עסקה בודדת לא תפגע משמעותית בתיק.',
  '💡 טיפ 4: יחס סיכוי/סיכון (למשל 2:1 או 3:1) אומר כמה אתה יכול להרוויח מול כמה אתה מסכן. גם אם רק חצי מהעסקאות שלך מצליחות, יחס טוב מספיק יכול עדיין להרוויח לאורך זמן.',
  '💡 טיפ 5: "חשיפת תיק" זה כמה אחוז מכל הכסף שלך נמצא כרגע בעסקאות פתוחות. חשיפה גבוהה מדי אומרת שאם השוק יורד בבת אחת, אתה מרגיש את זה חזק יותר.',
  "💡 טיפ 6: כפתור ה\"קיל סוויץ'\" (/pause) עוצר מיידית כל מסחר חדש בכסף אמיתי — פוזיציות פתוחות ממשיכות להיות מנוטרות, אבל שום עסקה חדשה לא תיפתח עד /resume. שימושי כשאתה לא בטוח או רוצה הפסקה.",
  '💡 טיפ 7: מסחר בכסף מדומה (paper trading) לפני כסף אמיתי הוא לא "משחק" — זו הדרך לבדוק אם אסטרטגיה עובדת על נתונים אמיתיים, בלי לשלם על טעויות למידה.',
  '💡 טיפ 8: הדחף הכי מסוכן בטריידינג הוא לרדוף אחרי הפסד — לפתוח עסקה גדולה יותר "כדי להחזיר" מה שהפסדת. מערכות טובות (וזו כלולה) שומרות על גודל עסקה קבוע לפי הכללים, לא לפי הרגש של הרגע.',
  '💡 טיפ 9: תנודתיות (וריאציה חדה במחיר) לא שווה לסיכון גבוה יותר בהכרח — היא כן אומרת שהמחיר יכול לנוע מהר בשני הכיוונים, ולכן סטופ-לוס קרוב מדי עלול "להיתפס" ברעש רגיל של השוק ולא בתנועה אמיתית.',
  '💡 טיפ 10: אין שיטה שמנצחת בכל עסקה — המטרה היא שהעסקאות המנצחות, לאורך הרבה עסקאות, יפצו על ההפסדים ועוד. זו הסיבה שממושמעות בגודל עסקה וסטופ-לוס חשובה יותר מלנחש נכון כל פעם.',
];

const EDUCATION_TIP_INTERVAL_MS = 2 * 24 * 60 * 60 * 1000;
const EDUCATION_TIP_INDEX_KEY = 'education-tip-index';
const EDUCATION_TIP_LAST_SENT_KEY = 'education-tip-last-sent-at';

/** Sends the next educational tip in rotation roughly every 2 days (David
 * asked for "a tip or two every day or two", 2026-09-03) — never gated
 * behind REAL_MONEY_ENABLED, since paper trading benefits just as much.
 * Wraps around the list forever rather than stopping once it runs out. */
export async function maybeSendEducationTip(
  store: KeyValueStore,
  telegram: TelegramConfig,
  now: number,
): Promise<void> {
  if (!telegram.token || !telegram.chatId) return;
  const lastSentAt = store.get<number>(EDUCATION_TIP_LAST_SENT_KEY);
  if (lastSentAt !== undefined && now - lastSentAt < EDUCATION_TIP_INTERVAL_MS) return;

  const index = store.get<number>(EDUCATION_TIP_INDEX_KEY) ?? 0;
  const tip = EDUCATION_TIPS[index % EDUCATION_TIPS.length]!;
  const result = await sendTelegramMessage(tip, telegram);
  if (!result.sent) return; // retry next cycle rather than skipping ahead
  store.set(EDUCATION_TIP_LAST_SENT_KEY, now);
  store.set(EDUCATION_TIP_INDEX_KEY, index + 1);
}

export function buildKillSwitchKeyboardIntro(): string {
  return (
    '🔒 כפתור עצירת החירום זמין עכשיו תמיד למטה.\n\n' +
    '/pause — עוצר את כל המסחר בכסף אמיתי מיידית.\n' +
    '/resume — ממשיך אחרי עצירה.'
  );
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

/** Signal-driver labels (from the signal engine) in plain Hebrew. Found in
 * review, 2026-09-03: `applyHigherTimeframeGate` (multiTimeframe.ts) adds a
 * FOURTH label — `Higher timeframe confirmation (${timeframe})` — whenever
 * the higher timeframe confirms (the common case), which this switch didn't
 * know about and fell through untranslated, leaking raw English mid-Hebrew-
 * sentence into the single most frequent notification (every buy). */
function driverHe(label: string): string {
  switch (label) {
    case 'Scanner evidence':
      return 'ראיות טכניות';
    case 'Trend strength':
      return 'מגמה חזקה';
    case 'Volume participation':
      return 'מחזור מסחר גבוה';
    default: {
      const higherTimeframe = /^Higher timeframe confirmation \((.+)\)$/.exec(label);
      if (higherTimeframe) return `אישור מהטווח הגדול יותר (${higherTimeframe[1]})`;
      return label;
    }
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
 * what comes back via `pollAllTelegramUpdates` when the human taps it — max
 * 64 bytes per Telegram's own limit, so callers must keep it short (an
 * intent id, not a whole payload). */
export interface InlineKeyboardButton {
  readonly text: string;
  readonly callback_data: string;
}

/** A persistent, bottom-of-chat keyboard button (distinct from an inline
 * button under one message) — tapping it just sends its `text` as an
 * ordinary message, exactly as if the human had typed it. Used for the
 * always-visible kill-switch button David asked for (2026-09-03): the
 * button's text is literally `/pause`/`/resume`, so it needs zero new
 * command-parsing — `checkManualKillSwitchCommands` already handles those. */
export interface ReplyKeyboardButton {
  readonly text: string;
}

export type TelegramReplyMarkup =
  | { readonly inline_keyboard: readonly (readonly InlineKeyboardButton[])[] }
  | {
      readonly keyboard: readonly (readonly ReplyKeyboardButton[])[];
      readonly resize_keyboard?: boolean;
      readonly is_persistent?: boolean;
    };

export async function sendTelegramMessage(
  text: string,
  config: TelegramConfig,
  replyMarkup?: TelegramReplyMarkup,
): Promise<SendResult & { messageId?: number }> {
  if (!config.token || !config.chatId) {
    return { sent: false, reason: 'Telegram credentials not set' };
  }
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    const response = await fetchWithTimeout(doFetch, `https://api.telegram.org/bot${config.token}/sendMessage`, {
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

/** Edits a previously-sent message's text and strips its inline keyboard
 * (David asked for this 2026-09-03: after tapping אשר/דחה the original
 * confirmation prompt just sat there with live buttons and no visible
 * change, which read as "the bot isn't registering my tap" even when it
 * was — Telegram's `answerCallbackQuery` alone shows nothing by default).
 * Used to replace the "awaiting confirmation" prompt with either a
 * "processing" line right after the tap, or the final outcome once known. */
export async function editTelegramMessage(
  messageId: number,
  text: string,
  config: TelegramConfig,
): Promise<SendResult> {
  if (!config.token || !config.chatId) {
    return { sent: false, reason: 'Telegram credentials not set' };
  }
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    const response = await fetchWithTimeout(doFetch, `https://api.telegram.org/bot${config.token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [] },
      }),
    });
    if (!response.ok) return { sent: false, reason: `Telegram HTTP ${response.status}` };
    return { sent: true };
  } catch (cause) {
    return { sent: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}

export interface TelegramCallbackQuery {
  readonly id: string;
  readonly data: string;
}

export interface TelegramTextMessage {
  readonly updateId: number;
  readonly text: string;
}

export interface TelegramUpdates {
  readonly messages: readonly TelegramTextMessage[];
  readonly callbacks: readonly TelegramCallbackQuery[];
}

const SHARED_UPDATE_OFFSET_KEY = 'telegram-shared-update-offset';
const UNCLAIMED_MESSAGES_KEY = 'telegram-unclaimed-messages';
const UNCLAIMED_CALLBACKS_KEY = 'telegram-unclaimed-callbacks';
const UNCLAIMED_CAP = 200;

/**
 * The ONE function in this project allowed to call Telegram's real
 * `getUpdates` with an advancing offset. `getUpdates(offset)` is a single
 * GLOBAL cursor per bot token: calling it with a higher offset from ANY
 * caller PERMANENTLY discards every update below that point for every
 * OTHER caller too, regardless of `allowed_updates` filtering — Telegram
 * has no concept of independent per-consumer cursors.
 *
 * Before 2026-09-02, `TelegramConfirmationGate` (one offset PER pending
 * intent), the manual `/sell` command, and the manual `/pause`/`/resume`
 * commands each tracked their OWN independent offset and called
 * `getUpdates` directly — a real bug: whichever one happened to poll
 * first could silently, permanently discard an update none of the others
 * had read yet (a human's `/pause` could vanish with no error at all). See
 * PROJECT_STATE.md for the full writeup.
 *
 * Fixed by centralizing here: every poll requests BOTH `message` and
 * `callback_query` updates, advances the ONE shared offset, and returns
 * everything (fresh + previously unclaimed) to the caller. `timeout: 0`
 * (no Telegram-side long-poll) is deliberate — this runs inside a GitHub
 * Actions job with its own wall-clock budget, so the caller controls
 * polling cadence itself.
 *
 * **Every caller MUST follow this with `stashUnclaimedTelegramUpdates`**,
 * passing back everything it did NOT act on — the raw Telegram update is
 * already gone by the time anyone looks again, so anything not stashed
 * here is lost for every other consumer, not just silently re-fetchable
 * later.
 */
export async function pollAllTelegramUpdates(
  store: KeyValueStore,
  config: TelegramConfig,
): Promise<TelegramUpdates> {
  const unclaimedMessages = store.get<TelegramTextMessage[]>(UNCLAIMED_MESSAGES_KEY) ?? [];
  const unclaimedCallbacks = store.get<TelegramCallbackQuery[]>(UNCLAIMED_CALLBACKS_KEY) ?? [];
  if (!config.token) return { messages: unclaimedMessages, callbacks: unclaimedCallbacks };

  const offset = store.get<number>(SHARED_UPDATE_OFFSET_KEY) ?? 0;
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  const freshMessages: TelegramTextMessage[] = [];
  const freshCallbacks: TelegramCallbackQuery[] = [];
  try {
    const response = await fetchWithTimeout(
      doFetch,
      `https://api.telegram.org/bot${config.token}/getUpdates?offset=${offset}&timeout=0&allowed_updates=%5B%22message%22%2C%22callback_query%22%5D`,
      { method: 'GET' },
    );
    if (response.ok) {
      const payload = (await response.json()) as {
        result?: readonly {
          update_id: number;
          message?: { text?: string; chat?: { id?: number | string } };
          callback_query?: { id: string; data?: string; message?: { chat?: { id?: number | string } } };
        }[];
      };
      let nextOffset = offset;
      for (const u of payload.result ?? []) {
        nextOffset = Math.max(nextOffset, u.update_id + 1);
        if (u.message?.text && String(u.message.chat?.id ?? '') === String(config.chatId)) {
          freshMessages.push({ updateId: u.update_id, text: u.message.text });
        }
        // A button tap's callback_query carries the chat of the message the
        // button is attached to — checked for the same reason text messages
        // are: a real-money confirmation tap must never be honored from any
        // chat but the one configured, even though this bot is only ever
        // meant to talk to one person (found in an independent review,
        // 2026-09-02 — this check was missing here while present for text
        // messages, a real asymmetry in a security-sensitive path).
        if (u.callback_query?.data && String(u.callback_query.message?.chat?.id ?? '') === String(config.chatId)) {
          freshCallbacks.push({ id: u.callback_query.id, data: u.callback_query.data });
        }
      }
      if (nextOffset !== offset) store.set(SHARED_UPDATE_OFFSET_KEY, nextOffset);
    }
  } catch {
    /* leave fresh empty — offset untouched, nothing was confirmed */
  }
  return {
    messages: [...unclaimedMessages, ...freshMessages],
    callbacks: [...unclaimedCallbacks, ...freshCallbacks],
  };
}

/**
 * Persists whatever a caller did NOT act on from a `pollAllTelegramUpdates`
 * result, so a DIFFERENT consumer can still find it on its own next check.
 * Always pass the full remaining set (not just newly-unclaimed items) —
 * this overwrites, it doesn't merge. Capped at `UNCLAIMED_CAP` per kind to
 * bound growth if something is never claimed (e.g. a stray message matching
 * no known command).
 */
export function stashUnclaimedTelegramUpdates(store: KeyValueStore, unclaimed: TelegramUpdates): void {
  store.set(UNCLAIMED_MESSAGES_KEY, unclaimed.messages.slice(-UNCLAIMED_CAP));
  store.set(UNCLAIMED_CALLBACKS_KEY, unclaimed.callbacks.slice(-UNCLAIMED_CAP));
}

/** Clears the button's "loading" spinner in the Telegram client. Best-effort — a
 * failure here never blocks the decision itself from being recorded. */
export async function answerCallbackQuery(callbackQueryId: string, config: TelegramConfig): Promise<void> {
  if (!config.token) return;
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    await fetchWithTimeout(doFetch, `https://api.telegram.org/bot${config.token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId }),
    });
  } catch {
    // best-effort, see doc comment
  }
}
