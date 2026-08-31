/**
 * Headless entry point for the system monitor — invoked on a schedule by
 * `.github/workflows/system-monitor.yml`.
 *
 * A real, type-checked, testable script rather than the inline
 * `--eval` snippet this replaces: that snippet pointed `FileStore` at
 * `'./state'` (the directory, not a file) — `readFileSync`/`writeFileSync`
 * on a directory throw, so every run silently ate the exception and the
 * monitor had been comparing empty defaults to empty defaults since it was
 * added, never actually reading the real autopilot state.
 *
 * Watches BOTH robots — crypto and stocks — each against its own real state
 * file, with its own currency symbol so an alert is unambiguous about which
 * one it's describing.
 */

import { fileURLToPath } from 'node:url';
import { FileStore } from './fileStore.mts';
import { monitorSystemChanges } from './systemMonitor.mts';
import { checkAndNudgeStaleWorkflow } from './workflowWatchdog.mts';
import { sendTelegramMessage } from './telegram.mts';
import { isUsMarketOpen } from '../src/core/data/marketHours';

const CRYPTO_STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
const STOCKS_STATE_PATH = process.env['STOCKS_STATE_PATH'] ?? 'state/stocks-state.json';
/**
 * Generous relative to each workflow's own cron (crypto every 30 min,
 * stocks every 15 min during market hours) — covers a normal missed tick or
 * two before assuming GitHub's scheduler silently dropped it (see
 * `workflowWatchdog.mts`'s doc comment for the measured 3-day stocks outage
 * this exists to catch).
 */
const WATCHDOG_STALE_AFTER_MS = 90 * 60 * 1000;

/**
 * Re-triggers either cloud workflow if GitHub's scheduler has silently
 * stopped firing it. Best-effort in every sense: skipped entirely (not an
 * error) when this isn't running inside GitHub Actions or lacks the token
 * (e.g. a local run), and a thrown network/API failure is caught and logged
 * rather than crashing the rest of this monitor run — the same standard
 * this file's own `monitorSystemChanges` already holds itself to.
 */
async function runWatchdog(telegram: { token: string; chatId: string }): Promise<void> {
  const [owner, repo] = (process.env['GITHUB_REPOSITORY'] ?? '').split('/');
  const token = process.env['GITHUB_TOKEN'] ?? '';
  if (!owner || !repo || !token) {
    console.log('Workflow watchdog skipped: not running in GitHub Actions (or GITHUB_TOKEN unavailable).');
    return;
  }

  try {
    const now = Date.now();
    const [crypto, stocks] = await Promise.all([
      checkAndNudgeStaleWorkflow(
        { owner, repo, workflowFile: 'autopilot.yml', token, staleAfterMs: WATCHDOG_STALE_AFTER_MS },
        now,
      ),
      checkAndNudgeStaleWorkflow(
        { owner, repo, workflowFile: 'stocks-autopilot.yml', token, shouldBeActive: isUsMarketOpen, staleAfterMs: WATCHDOG_STALE_AFTER_MS },
        now,
      ),
    ]);
    console.log('Crypto workflow watchdog:', crypto.reason);
    console.log('Stocks workflow watchdog:', stocks.reason);

    const nudged = [
      ...(crypto.nudged ? [`Crypto (${crypto.reason})`] : []),
      ...(stocks.nudged ? [`Stocks (${stocks.reason})`] : []),
    ];
    if (nudged.length > 0) {
      await sendTelegramMessage(`🔧 Watchdog: re-triggered a stalled workflow — ${nudged.join('; ')}.`, telegram);
    }
  } catch (cause) {
    console.error('Workflow watchdog failed (non-fatal):', cause instanceof Error ? cause.message : cause);
  }
}

async function main(): Promise<void> {
  const telegram = {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  };

  await monitorSystemChanges(new FileStore(CRYPTO_STATE_PATH), telegram, Date.now(), 'Crypto', '€');
  await monitorSystemChanges(new FileStore(STOCKS_STATE_PATH), telegram, Date.now(), 'Stocks', '$');
  await runWatchdog(telegram);
}

// Guard so importing this module for its pieces never triggers a live run.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
