/**
 * On-demand health summary to Telegram — workflow_dispatch only (see
 * `.github/workflows/health-ping.yml`). Reads the committed state, builds the
 * fixed-template message (`server/healthReport.mts`) and sends it. Read-only.
 *
 *   npx tsx scripts/healthPing.mts
 */

import { FileStore } from '../server/fileStore.mts';
import { buildHealthMessage } from '../server/healthReport.mts';
import { sendTelegramMessage } from '../server/telegram.mts';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
const store = new FileStore(STATE_PATH);
const message = buildHealthMessage((key) => store.get(key), Date.now(), process.env['GITHUB_SHA'] ?? '');
console.log(message);

const token = process.env['TELEGRAM_BOT_TOKEN'];
const chatId = process.env['TELEGRAM_CHAT_ID'];
if (token && chatId) {
  const sent = await sendTelegramMessage(message, { token, chatId });
  console.log(sent.sent ? 'Sent to Telegram.' : `Telegram send failed: ${sent.reason}`);
}
