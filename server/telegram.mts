/**
 * Telegram notifications for the cloud autopilot.
 *
 * Sends a plain message via the Telegram Bot API. Credentials come from
 * environment (GitHub Actions secrets) and are never committed. When they
 * are absent the send is a graceful no-op, so the autopilot still runs and
 * accumulates state — it just doesn't notify.
 */

import type { CycleResult } from '../src/core/autopilot/paperAutoPilot';
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
 * Once-a-day portfolio digest so the user knows the robot is alive and how
 * it is doing, without a message every cycle. Sent at most once per day.
 */
export function buildDailySummary(input: DailySummaryInput): string {
  const ret = `${input.totalReturnPct >= 0 ? '+' : ''}${input.totalReturnPct.toFixed(2)}%`;
  const lines: string[] = [
    input.heading ?? '📊 סיכום יומי — רובוט מסחר (כסף מדומה)',
    `💰 שווי תיק: ${euro(input.equity)} (${ret} מההתחלה)`,
    `💵 מזומן פנוי: ${euro(input.cash)}`,
    `📈 רווח/הפסד: ${signedEuro(input.realizedPnl)} ממומש · ${signedEuro(input.unrealizedPnl)} על הנייר`,
    `🔄 24 שעות אחרונות: ${input.openedLast24h} קניות, ${input.closedLast24h} מכירות`,
  ];
  if (input.benchmark) {
    const b = input.benchmark;
    const fmt = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    const verdict = b.portfolioPct >= b.assetPct ? 'הרובוט מוביל 🎉' : 'החזקה פשוטה מובילה';
    lines.push(
      `🏁 מול ${b.label} (מאז תחילת המעקב): הרובוט ${fmt(b.portfolioPct)} · ${b.label} ${fmt(b.assetPct)} → ${verdict}`,
    );
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
  return lines.join('\n');
}

/**
 * Fixed confirmation message used to verify end-to-end Telegram delivery
 * without waiting for a real trade. Sent only when explicitly requested.
 */
export function buildTestMessage(): string {
  return '✅ הבוט מחובר! מעכשיו תקבל כאן התראה על כל קנייה/מכירה. כסף מדומה בלבד.';
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
    `🗓️ דו"ח ${i.title} — רובוט מסחר (כסף מדומה)`,
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
    const verdict = i.benchmark.portfolioPct >= i.benchmark.assetPct ? 'הרובוט מוביל 🎉' : 'ביטקוין מוביל';
    lines.push(
      `🏁 מול ${i.benchmark.label}: הרובוט ${f(i.benchmark.portfolioPct)} · ${i.benchmark.label} ${f(i.benchmark.assetPct)} → ${verdict}`,
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
    'כסף מדומה בלבד — הרובוט לא יכול לגעת בכסף אמיתי.'
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
  const lines: string[] = ['🤖 רובוט מסחר (כסף מדומה)'];
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

export async function sendTelegramMessage(
  text: string,
  config: TelegramConfig,
): Promise<SendResult> {
  if (!config.token || !config.chatId) {
    return { sent: false, reason: 'Telegram credentials not set' };
  }
  const doFetch = config.fetchFn ?? ((input, init) => fetch(input, init));
  try {
    const response = await doFetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) return { sent: false, reason: `Telegram HTTP ${response.status}` };
    return { sent: true };
  } catch (cause) {
    return { sent: false, reason: cause instanceof Error ? cause.message : String(cause) };
  }
}
