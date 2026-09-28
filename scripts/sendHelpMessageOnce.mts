/**
 * One-time re-send of the bot's own `/help` text (David asked for it again
 * after pointing out the first re-send was missing the confirm/reject
 * buttons, since fixed). Sends the EXACT same `HELP_MESSAGE` constant
 * `/help` itself replies with — not a new arbitrary message — so it can
 * never drift from what the bot actually supports. Deleted in a follow-up
 * commit right after this dispatches once; no standing "send arbitrary
 * Telegram text" capability is added.
 */

import { HELP_MESSAGE } from '../server/autopilotRunner.mts';
import { sendTelegramMessage } from '../server/telegram.mts';

const result = await sendTelegramMessage(HELP_MESSAGE, {
  token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
  chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
});

if (!result.sent) {
  console.error(`Help message not sent: ${result.reason}`);
  process.exit(1);
}
console.log('Help message sent.');
