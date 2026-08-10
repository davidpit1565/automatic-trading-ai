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

const CRYPTO_STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
const STOCKS_STATE_PATH = process.env['STOCKS_STATE_PATH'] ?? 'state/stocks-state.json';

async function main(): Promise<void> {
  const telegram = {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  };

  await monitorSystemChanges(new FileStore(CRYPTO_STATE_PATH), telegram, Date.now(), 'Crypto', '€');
  await monitorSystemChanges(new FileStore(STOCKS_STATE_PATH), telegram, Date.now(), 'Stocks', '$');
}

// Guard so importing this module for its pieces never triggers a live run.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
