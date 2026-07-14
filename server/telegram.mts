/**
 * Telegram notifications for the cloud autopilot.
 *
 * Sends a plain message via the Telegram Bot API. Credentials come from
 * environment (GitHub Actions secrets) and are never committed. When they
 * are absent the send is a graceful no-op, so the autopilot still runs and
 * accumulates state — it just doesn't notify.
 */

import type { CycleResult } from '../src/core/autopilot/paperAutoPilot';

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

export interface DailySummaryPosition {
  readonly symbol: string;
  readonly marketValue: number;
  readonly pctOfEquity: number;
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
}

/**
 * Once-a-day portfolio digest so the user knows the robot is alive and how
 * it is doing, without a message every cycle. Sent at most once per day.
 */
export function buildDailySummary(input: DailySummaryInput): string {
  const ret = `${input.totalReturnPct >= 0 ? '+' : ''}${input.totalReturnPct.toFixed(2)}%`;
  const lines: string[] = [
    '📊 סיכום יומי / Daily Summary — Paper Autopilot (כסף מדומה / simulated money)',
    `💰 שווי תיק / Portfolio value: ${euro(input.equity)} (${ret} מההתחלה / since start)`,
    `💵 מזומן פנוי / Free cash: ${euro(input.cash)}`,
    `📈 רווח/הפסד / P&L: ${signedEuro(input.realizedPnl)} ממומש/realized · ${signedEuro(input.unrealizedPnl)} על הנייר/unrealized`,
    `🔄 24 שעות / last 24h: ${input.openedLast24h} קניות/buys, ${input.closedLast24h} מכירות/sells`,
  ];
  if (input.positions.length === 0) {
    lines.push('📌 אין פוזיציות פתוחות / No open positions.');
  } else {
    lines.push(`📌 פוזיציות פתוחות / Open positions (${input.positions.length}):`);
    for (const p of input.positions) {
      lines.push(
        `   • ${p.symbol}: ${euro(p.marketValue)} (${p.pctOfEquity.toFixed(1)}% מהתיק / of portfolio)`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * Fixed confirmation message used to verify end-to-end Telegram delivery
 * without waiting for a real trade. Sent only when explicitly requested.
 */
export function buildTestMessage(): string {
  return (
    '✅ הבוט מחובר! מעכשיו תקבל כאן התראה על כל קנייה/מכירה (כסף מדומה).\n' +
    '🤖 Paper Autopilot connected — you will get a message here on every simulated buy/sell.'
  );
}

/** Human-readable message for a cycle's trades, or null if nothing happened. */
export function buildCycleMessage(
  cycle: Pick<CycleResult, 'opened' | 'closed' | 'timestamp'>,
): string | null {
  if (cycle.opened.length === 0 && cycle.closed.length === 0) return null;
  const lines: string[] = ['🤖 Paper Autopilot (כסף מדומה / simulated money)'];
  for (const o of cycle.opened) {
    lines.push(`🟢 קנייה / Bought ${o.symbol}: ${o.quantity} @ ${euro(o.entry)}`);
  }
  for (const c of cycle.closed) {
    lines.push(`🔴 מכירה / Sold ${c.symbol} @ ${euro(c.price)} (${c.reason})`);
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
