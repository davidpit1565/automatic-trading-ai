/**
 * Autonomous system change detector.
 *
 * Runs periodically (every 90 minutes) to detect changes in:
 * - Cloud autopilot run status (passed/failed)
 * - Equity and realized P&L (up/down)
 * - Trade closures (count, win/loss, profit)
 * - Audit log errors (new rejections, alerts)
 * - Deployment freshness (pages stale or fresh)
 *
 * Sends Telegram alerts ONLY when something changes, with sentiment
 * (improved, degraded, fixed, broke). Also alerts if no activity for 6h.
 */

import { FileStore } from './fileStore.mts';
import { sendTelegramMessage, SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED } from './telegram.mts';

const STALE_ACTIVITY_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours
const DAY_MS = 24 * 60 * 60 * 1000;

interface SystemState {
  timestamp: number;
  autopilotLastRunAt: number | null;
  autopilotLastRunSuccess: boolean | null;
  equity: number;
  realizedPnlTotal: number;
  closedTradeCount: number;
  openPositionCount: number;
  auditLogEntryCount: number;
  latestAuditLogEntry: string | null;
  pagesLastDeployAt: number | null;
}

interface PreviousState {
  state: SystemState | null;
  lastAlertAt: number;
}

/**
 * Fetch current system state by reading files and computing live metrics.
 */
export async function fetchSystemState(store: FileStore, now: number): Promise<SystemState> {
  let autopilotLastRunAt: number | null = null;
  let autopilotLastRunSuccess: boolean | null = null;

  try {
    const state = store.get<{ at: number }>(AUTOPILOT_LAST_RUN_KEY);
    if (state) {
      autopilotLastRunAt = state.at;
      // Check if the state file is still being updated (last commit is not git-action bot)
      // For now, assume success if the timestamp is recent enough
      // In a real scenario, you'd check the GitHub Actions API
      const timeSinceLastRun = now - state.at;
      autopilotLastRunSuccess = timeSinceLastRun < 4 * 60 * 60 * 1000; // within 4h = likely ok
    }
  } catch (e) {
    // File doesn't exist or is unparseable
  }

  // Load portfolio snapshot to compute equity. TradeJournal (see
  // position/tradeJournal.ts) stores a plain JournalEntry[] directly at this
  // key — not wrapped in an `entries` property, and every entry already has
  // both an entry and an exit (the journal only records completed trades).
  let equity = 10_000; // fallback
  let realizedPnlTotal = 0;
  let closedTradeCount = 0;

  try {
    const journal = store.get<any[]>('trade-journal');
    if (Array.isArray(journal)) {
      closedTradeCount = journal.length;
      realizedPnlTotal = journal.reduce((sum: number, e: any) => sum + (e.realizedPnl ?? 0), 0);
    }
  } catch (e) {
    // Fallback
  }

  // Get positions count — PositionEngine (see position/positionEngine.ts)
  // stores open positions at 'open-positions', not 'positions'.
  let openPositionCount = 0;
  try {
    const positions = store.get<any>('open-positions');
    if (positions && Array.isArray(positions)) {
      openPositionCount = positions.length;
    }
  } catch (e) {
    // Fallback
  }

  // Audit log entry count
  let auditLogEntryCount = 0;
  let latestAuditLogEntry: string | null = null;
  try {
    const auditLog = store.get<any>('audit-log');
    if (auditLog && Array.isArray(auditLog)) {
      auditLogEntryCount = auditLog.length;
      if (auditLog.length > 0) {
        latestAuditLogEntry = auditLog[auditLog.length - 1];
      }
    }
  } catch (e) {
    // Fallback
  }

  // Pages deployment freshness
  let pagesLastDeployAt: number | null = null;
  try {
    // Pages was last deployed on 2026-07-22 based on health check
    // We'd need to call GitHub API to get actual time
    // For now, store the timestamp manually if it's been checked
    const pagesCheck = store.get<{ deployedAt: number }>('pages-last-check');
    if (pagesCheck) {
      pagesLastDeployAt = pagesCheck.deployedAt;
    }
  } catch (e) {
    // Fallback
  }

  // Compute equity: 10k - realized losses + realized gains
  const initialCash = 10_000;
  equity = initialCash + realizedPnlTotal;

  return {
    timestamp: now,
    autopilotLastRunAt,
    autopilotLastRunSuccess,
    equity,
    realizedPnlTotal,
    closedTradeCount,
    openPositionCount,
    auditLogEntryCount,
    latestAuditLogEntry,
    pagesLastDeployAt,
  };
}

/**
 * Detect changes and build alert message.
 * Returns null if no meaningful change detected.
 */
function buildChangeAlert(
  current: SystemState,
  previous: SystemState | null,
  now: number,
  label: string,
  currencySymbol: string,
): string | null {
  if (!previous) return null; // First run, no baseline

  const changes: string[] = [];
  const timeSinceLastAlert = now - (previous.timestamp || 0);

  // 1. Autopilot status change
  if (
    current.autopilotLastRunSuccess !== previous.autopilotLastRunSuccess ||
    (current.autopilotLastRunAt &&
      previous.autopilotLastRunAt &&
      current.autopilotLastRunAt > previous.autopilotLastRunAt)
  ) {
    if (current.autopilotLastRunSuccess) {
      changes.push(`✅ ${label} autopilot: RUN PASSED`);
    } else if (current.autopilotLastRunSuccess === false) {
      changes.push(`❌ ${label} autopilot: RUN FAILED or STALLED`);
    }
  }

  // 2. Equity change
  const equityDiff = current.equity - previous.equity;
  const equityPctChange = ((equityDiff / previous.equity) * 100).toFixed(2);
  if (Math.abs(equityDiff) > 1) {
    // Only alert if change > 1 unit of currency
    const direction = equityDiff > 0 ? '⬆️' : '⬇️';
    const sign = equityDiff > 0 ? '+' : '';
    changes.push(`${direction} Equity: ${currencySymbol}${current.equity.toFixed(2)} (${sign}${equityPctChange}%)`);
  }

  // 3. New closed trade
  if (current.closedTradeCount > previous.closedTradeCount) {
    const newTrades = current.closedTradeCount - previous.closedTradeCount;
    const pnlChange = current.realizedPnlTotal - previous.realizedPnlTotal;
    const sentiment = pnlChange > 0 ? '📈' : '📉';
    changes.push(
      `${sentiment} ${newTrades} trade(s) closed: ${currencySymbol}${pnlChange > 0 ? '+' : ''}${pnlChange.toFixed(2)}`,
    );
  }

  // 4. Audit log growth (new errors/rejections)
  if (current.auditLogEntryCount > previous.auditLogEntryCount) {
    const newEntries = current.auditLogEntryCount - previous.auditLogEntryCount;
    changes.push(`📋 Audit log: +${newEntries} new entries`);
  }

  // 5. Pages deployment status (if we can detect it)
  if (current.pagesLastDeployAt && previous.pagesLastDeployAt) {
    if (current.pagesLastDeployAt > previous.pagesLastDeployAt) {
      changes.push(`🌐 Pages dashboard: REFRESHED`);
    }
  }

  // 6. Long silence warning (no autopilot activity for 6+ hours)
  if (
    current.autopilotLastRunAt &&
    now - current.autopilotLastRunAt > STALE_ACTIVITY_THRESHOLD_MS
  ) {
    const hoursStale = Math.floor((now - current.autopilotLastRunAt) / (60 * 60 * 1000));
    changes.push(`⚠️ WARNING: No ${label} activity for ${hoursStale} hours`);
  }

  if (changes.length === 0) return null;

  const time = new Date(now).toLocaleString('en-US', {
    timeZone: 'UTC',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return `📊 ${label} System Update — ${time} UTC\n\n${changes.join('\n')}\n\nTrades: ${current.closedTradeCount} | Equity: ${currencySymbol}${current.equity.toFixed(2)} | P&L: ${currencySymbol}${current.realizedPnlTotal.toFixed(2)}`;
}

/**
 * Main monitoring function. Call every 90 minutes.
 */
export async function monitorSystemChanges(
  store: FileStore,
  telegram: { token: string; chatId: string },
  now: number,
  /** Distinguishes which agent an alert is about, e.g. "Crypto" or "Stocks". */
  label = 'Crypto',
  currencySymbol = '€',
): Promise<void> {
  if (!telegram.token || !telegram.chatId) {
    console.log('Telegram not configured; skipping system monitor.');
    return;
  }
  // This monitor only ever reads the SIMULATED paper stores (crypto/stocks
  // state files — see systemMonitorRunner.mts's two call sites, neither of
  // which is the live-money store) — silenced (David, 2026-09-06). See
  // SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED's doc comment in telegram.mts.
  if (!SIMULATED_TELEGRAM_NOTIFICATIONS_ENABLED) {
    console.log(`${label} system monitor silenced (simulated-only, no live equivalent).`);
    return;
  }

  try {
    // Fetch current state
    const current = await fetchSystemState(store, now);

    // Fetch previous state
    let previous: SystemState | null = null;
    try {
      const stored = store.get<SystemState>('monitor-last-state');
      if (stored) {
        previous = stored;
      }
    } catch (e) {
      // First run
    }

    // Build alert if there are changes
    const message = buildChangeAlert(current, previous, now, label, currencySymbol);

    // Send alert if changes detected
    if (message) {
      const result = await sendTelegramMessage(message, telegram);
      if (result.sent) {
        console.log('System monitor alert sent.');
        // Only advance the comparison baseline once the alert actually went
        // out. Found in review, 2026-09-06: this used to store `current` as
        // the new baseline unconditionally, before knowing whether the send
        // succeeded — a transient Telegram failure silently and permanently
        // dropped that change (the next cycle compared against the state
        // that already reflected it, so the diff vanished with no retry),
        // unlike every other notification in this codebase (see
        // autopilotRunner.mts's maybeSendSummaries/maybeSendAllClear), which
        // only persists "already notified" state after confirming `sent`.
        store.set('monitor-last-state', current);
        store.set('monitor-last-alert', now);
      } else {
        console.log('System monitor alert failed:', result.reason);
      }
    } else {
      // Nothing to report — safe to advance the baseline unconditionally.
      store.set('monitor-last-state', current);
      console.log('System monitor: no changes detected.');
    }
  } catch (error) {
    console.error('System monitor error:', error);
    // Don't crash the autopilot over a monitoring failure
  }
}

const AUTOPILOT_LAST_RUN_KEY = 'autopilot-last-run';
