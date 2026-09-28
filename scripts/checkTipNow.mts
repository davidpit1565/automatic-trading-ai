/**
 * On-demand CLI equivalent of Telegram's `/tip` (David asked 2026-09-28:
 * "I have a lot of idle cash — is there a good trade right now?"). Reuses
 * `buildProductionAutopilot` (extracted from `autopilotRunner.mts`'s own
 * `main()`, byte-identical construction) and `PaperAutoPilot.previewBestOpportunity`
 * — the exact same gated pipeline production runs every cycle, never an
 * approximation, since this decides real money. Read-only: never opens a
 * position, paper or live.
 *
 *   npx tsx scripts/checkTipNow.mts
 */

import { KrakenPublicSource } from '../src/core/data/krakenPublic';
import { FileStore } from '../server/fileStore.mts';
import { buildProductionAutopilot } from '../server/autopilotRunner.mts';
import { formatTipMessage } from '../server/manualTipCommand.mts';
import { sendTelegramMessage } from '../server/telegram.mts';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';

const store = new FileStore(STATE_PATH);
const source = new KrakenPublicSource();
const instruments = await source.getInstruments();
if (!instruments.ok) {
  console.error('Could not load instruments from Kraken — cannot check.');
  process.exit(1);
}

const { autopilot } = await buildProductionAutopilot(store, source, instruments.value);
const result = await autopilot.previewBestOpportunity(Date.now());
const message = formatTipMessage(result);
console.log(message);

// Same as /tip's own Telegram reply — sent only when credentials are
// configured (e.g. via this script's own workflow_dispatch), so a plain
// local run (no secrets) still works as a read-only console check.
const token = process.env['TELEGRAM_BOT_TOKEN'];
const chatId = process.env['TELEGRAM_CHAT_ID'];
if (token && chatId) {
  const sent = await sendTelegramMessage(message, { token, chatId });
  console.log(sent.sent ? 'Sent to Telegram.' : `Telegram send failed: ${sent.reason}`);
}
