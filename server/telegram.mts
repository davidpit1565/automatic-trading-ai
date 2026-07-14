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

/** Human-readable message for a cycle's trades, or null if nothing happened. */
export function buildCycleMessage(
  cycle: Pick<CycleResult, 'opened' | 'closed' | 'timestamp'>,
): string | null {
  if (cycle.opened.length === 0 && cycle.closed.length === 0) return null;
  const lines: string[] = ['🤖 Paper Autopilot (simulated money)'];
  for (const o of cycle.opened) {
    lines.push(`🟢 Bought ${o.symbol}: ${o.quantity} @ ${euro(o.entry)}`);
  }
  for (const c of cycle.closed) {
    lines.push(`🔴 Sold ${c.symbol} @ ${euro(c.price)} (${c.reason})`);
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
