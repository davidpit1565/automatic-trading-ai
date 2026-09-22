/**
 * One-time Telegram send — David asked (2026-09-22) for a single message
 * summarizing this session's 5-item upgrade sequence, sent right after
 * everything merged. This script and its matching workflow
 * (.github/workflows/send-once-message.yml) exist ONLY to send this one
 * message and are meant to be deleted immediately afterward — this project
 * has no standing "send arbitrary Telegram text" capability, and none is
 * being added; see PROJECT_STATE.md for why. Not imported by anything else.
 */

import { sendTelegramMessage } from '../server/telegram.mts';

const telegram = {
  token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
  chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
};

const MESSAGE = `✅ סיימתי את חמשת השדרוגים שביקשת, כולם במיזוג ל-main:

1️⃣ התרעה מיידית בטלגרם כשה-kill switch נדלק לבד (לא רק בדוח היומי)
2️⃣ בדיקת trailing stop — נמדד מחדש, תוצאה מעורבת אז לא הודלק על כסף אמיתי; רץ כעת כמועמד-צל
3️⃣ פיוס מול Revolut X — כבר היה קיים; בדרך מצאתי ותיקנתי תקלה פעילה: פוזיציית אבק ששלחה בקשות אישור על כלום כ-9 שעות
4️⃣ שומר-סף אמיתי על המסחר החי — בודק שהמערכת באמת מתקדמת, לא רק שהיא תוזמנה
5️⃣ הגבלת חשיפה לפי קורלציה — גם קיים כבר; מצאתי ותיקנתי את אותה תקלת ה-trailing שהשפיעה על עוד כמה מועמדי-צל

כל שינוי עבר gate מלא (בדיקת טיפוסים + כל הטסטים + build) לפני מיזוג. פרטים מלאים ב-PROJECT_STATE.md.`;

const result = await sendTelegramMessage(MESSAGE, telegram);
if (result.sent) {
  console.log('One-time summary message sent.');
} else {
  console.error(`Send failed: ${result.reason}`);
  process.exit(1);
}
