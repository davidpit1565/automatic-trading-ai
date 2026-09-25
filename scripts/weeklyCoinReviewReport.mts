/**
 * Sends the weekly coin-review Telegram report.
 *
 * Triggered by the weekly coin-review Routine (a fresh Claude Code session
 * that runs the actual discovery/readiness/promotion decision, edits
 * CANDIDATE_INSTRUMENTS/CURATED_INSTRUMENTS as warranted, and merges its own
 * PR to main) via this workflow's `workflow_dispatch` inputs — never a raw
 * free-text message. Inputs are structured symbol lists plus one short
 * context line; this script renders them into ONE fixed template, the same
 * shape `discoverCryptoCandidates.mts` already uses for its own weekly
 * Telegram report. No standing "send arbitrary text" capability is added by
 * this — the message content is always this file's own template.
 */

import { sendTelegramMessage } from '../server/telegram.mts';

function parseList(raw: string | undefined): readonly string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const added = parseList(process.env['ADDED']);
const promoted = parseList(process.env['PROMOTED']);
const notes = (process.env['NOTES'] ?? '').trim();

const lines: string[] = ['📊 סקירת מטבעות שבועית'];

if (added.length > 0) {
  lines.push('', `🧪 נוספו למעקב הדגמה (כסף מדומה בלבד, אפס סיכון אמיתי): ${added.join(', ')}`);
}
if (promoted.length > 0) {
  lines.push(
    '',
    `💰 קודמו למסחר האמיתי (${promoted.join(', ')}) — כל הזמנה בודדת עדיין דורשת ` +
      'את האישור שלך בטלגרם, קידום המטבע לבד לא מזיז כסף אמיתי.',
  );
}
if (added.length === 0 && promoted.length === 0) {
  lines.push('', 'לא נוסף ולא קודם שום מטבע השבוע.');
}
if (notes) lines.push('', notes);

const result = await sendTelegramMessage(lines.join('\n'), {
  token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
  chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
});

if (!result.sent) {
  console.error(`Telegram send failed: ${result.reason}`);
  process.exit(1);
}
console.log('Weekly coin review report sent.');
