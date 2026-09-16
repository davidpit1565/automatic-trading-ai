/**
 * Daily strategy sweep reporter — a thin, read-only wrapper that runs
 * scripts/sweepStrategy.mts and scripts/validateStrategy.mts EXACTLY as they
 * are (no reimplemented logic), captures their stdout, parses the tables
 * they already print, and sends ONE Telegram summary using the exact same
 * `sendTelegramMessage` mechanism scripts/discoverCryptoCandidates.mts uses.
 *
 * Purely a reporting agent: it NEVER edits any strategy config, commits,
 * opens a PR, or changes what the live autopilot trades. It only measures
 * (on real Kraken history, via the two existing scripts) and tells David
 * whether anything beat the current PROD baseline — he decides whether to
 * adopt it.
 *
 *   npx tsx scripts/reportStrategySweep.mts
 */

import { spawnSync } from 'node:child_process';
import { sendTelegramMessage } from '../server/telegram.mts';

interface SweepRow {
  name: string;
  retMean: number;
  ddMean: number;
  trades: number;
  winPct: number;
  pf: number;
  oosPf: number;
}

interface ValidateRow {
  label: string;
  returnPct: number;
  trades: number;
  winPct: number | null;
  pf: number | null;
  buyHoldPct: number;
}

const NAME_COL_WIDTH = 34; // matches `pad(r.name, 34)` in sweepStrategy.mts

function runScript(relativePath: string): string {
  const result = spawnSync('npx', ['tsx', relativePath], { encoding: 'utf8' });
  if (result.error) throw result.error;
  // Print through so the job log still shows full detail, same as running it directly.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${relativePath} exited with status ${result.status}`);
  }
  return result.stdout;
}

/** Parses sweepStrategy.mts's fixed-width table rows into structured data. */
function parseSweepRows(output: string): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const line of output.split('\n')) {
    if (line.length <= NAME_COL_WIDTH) continue;
    const name = line.slice(0, NAME_COL_WIDTH).trim();
    const rest = line.slice(NAME_COL_WIDTH).trim();
    const parts = rest.split(/\s+/);
    if (parts.length !== 6) continue;
    const [retMean, ddMean, trades, winPct, pf, oosPf] = parts.map(Number);
    if ([retMean, ddMean, trades, winPct, pf, oosPf].some((v) => v === undefined || Number.isNaN(v))) continue;
    rows.push({ name, retMean: retMean!, ddMean: ddMean!, trades: trades!, winPct: winPct!, pf: pf!, oosPf: oosPf! });
  }
  return rows;
}

/** Parses validateStrategy.mts's AGGREGATE row. */
function parseValidateAggregate(output: string): ValidateRow | null {
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('AGGREGATE')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 7) continue;
    const [, returnPct, , trades, winPct, pf, buyHoldPct] = parts;
    return {
      label: 'AGGREGATE',
      returnPct: Number(returnPct),
      trades: Number(trades),
      winPct: winPct === 'n/a' ? null : Number(winPct),
      pf: pf === 'n/a' ? null : Number(pf),
      buyHoldPct: Number(buyHoldPct),
    };
  }
  return null;
}

const fmtPf = (v: number): string => (v >= 999 ? '∞' : v.toFixed(2));
const fmtPct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

async function main(): Promise<void> {
  console.log('='.repeat(78));
  console.log('Daily strategy sweep — running sweepStrategy.mts + validateStrategy.mts');
  console.log('='.repeat(78));

  const sweepOutput = runScript('scripts/sweepStrategy.mts');
  const validateOutput = runScript('scripts/validateStrategy.mts');

  const sweepRows = parseSweepRows(sweepOutput);
  const aggregate = parseValidateAggregate(validateOutput);

  const telegram = {
    token: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
    chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
  };

  if (sweepRows.length === 0) {
    const msg =
      '⚠️ בדיקת אסטרטגיה יומית נכשלה — לא הצלחתי לפרש את פלט הסריקה (sweepStrategy.mts). ' +
      'בדוק את לוג ה-GitHub Actions.';
    console.error('Could not parse sweepStrategy output — sending failure notice.');
    const sent = await sendTelegramMessage(msg, telegram);
    if (!sent.sent) console.error(`Telegram send failed: ${sent.reason}`);
    process.exitCode = 1;
    return;
  }

  const baseline = sweepRows.find((r) => r.name === 'PROD baseline (live today)') ?? sweepRows[0]!;
  // Rows are already sorted by PF desc by sweepStrategy.mts itself.
  const best = sweepRows[0]!;
  const isBaselineBest = best.name === baseline.name;
  // A "measured" improvement must beat the baseline BOTH in-sample and
  // out-of-sample — an in-sample-only win is exactly the overfitting this
  // repo's own OOS column exists to catch (see sweepStrategy.mts's doc
  // comment), so it is reported as inconclusive rather than as a win.
  const isMeasuredImprovement = !isBaselineBest && best.pf > baseline.pf && best.oosPf > baseline.oosPf;

  const lines: string[] = [];
  lines.push(`📈 בדיקת אסטרטגיה יומית — ${sweepRows.length} קונפיגורציות נמדדו על נתוני Kraken אמיתיים`);
  lines.push('');
  lines.push(
    `בייסליין נוכחי (PROD): PF ${fmtPf(baseline.pf)} (OOS ${fmtPf(baseline.oosPf)}), ` +
      `תשואה ${fmtPct(baseline.retMean)}, ${baseline.trades} עסקאות, ${baseline.winPct.toFixed(1)}% הצלחה`,
  );

  if (isBaselineBest) {
    lines.push('');
    lines.push('הבייסליין הנוכחי עדיין המוביל — לא נמצא שיפור מדוד היום.');
  } else {
    lines.push('');
    lines.push(
      `הכי טוב שנמדד: "${best.name}" — PF ${fmtPf(best.pf)} (OOS ${fmtPf(best.oosPf)}), ` +
        `תשואה ${fmtPct(best.retMean)}, ${best.trades} עסקאות, ${best.winPct.toFixed(1)}% הצלחה`,
    );
    lines.push(
      isMeasuredImprovement
        ? '✅ שיפור מדוד: PF גבוה יותר גם ב-in-sample וגם ב-out-of-sample לעומת הבייסליין.'
        : '⚠️ נראה טוב יותר ב-in-sample בלבד (או שה-OOS לא תומך) — לא מספיק חזק כדי להיחשב שיפור מדוד.',
    );
  }

  if (aggregate) {
    lines.push('');
    lines.push('--- אימות מול הקונפיגורציה החיה (validateStrategy.mts) ---');
    lines.push(
      `תשואה ${fmtPct(aggregate.returnPct)}, PF ${aggregate.pf === null ? 'n/a' : fmtPf(aggregate.pf)}, ` +
        `${aggregate.trades} עסקאות, ${aggregate.winPct === null ? 'n/a' : `${aggregate.winPct.toFixed(1)}%`} הצלחה, ` +
        `מול Buy&Hold ${fmtPct(aggregate.buyHoldPct)}`,
    );
  }

  lines.push('');
  lines.push('זו רק מדידה יומית — שום דבר לא הוחלף אוטומטית באסטרטגיה החיה. אתה מחליט אם לאמץ שינוי.');

  const message = lines.join('\n');
  console.log('\n--- Telegram message ---\n' + message);
  const sent = await sendTelegramMessage(message, telegram);
  if (!sent.sent) console.error(`Telegram send failed: ${sent.reason}`);
}

main().catch((error) => {
  console.error('reportStrategySweep failed:', error);
  process.exitCode = 1;
});
