/**
 * On-demand system health summary for Telegram (David asked 2026-10-17 for "a
 * message as a sign that everything works"). Pure: builds a fixed-template
 * Hebrew message from the committed state. It takes NO free text — the only
 * inputs are values read from the state file — so it is not a "send arbitrary
 * Telegram text" capability. Read-only: it never places or changes anything.
 */

const ALIVE_WITHIN_MS = 15 * 60 * 1000;
const DUST_NOTIONAL_EUR = 0.5;

type Get = (key: string) => unknown;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function lastOf(v: unknown): Record<string, unknown> | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const last = v[v.length - 1];
  return typeof last === 'object' && last !== null ? (last as Record<string, unknown>) : null;
}

function eur(v: number | null): string {
  return v === null ? '—' : `€${v.toFixed(2)}`;
}

export function buildHealthMessage(get: Get, now: number, codeVersion: string): string {
  const lines: string[] = ['🩺 בדיקת מערכת'];

  const lastRun = num((get('autopilot-last-run') as { at?: unknown } | undefined)?.at);
  if (lastRun === null) {
    lines.push('⚠️ לא נמצא מחזור אחרון של הבוט');
  } else {
    const ageMin = Math.max(0, Math.round((now - lastRun) / 60000));
    lines.push(
      now - lastRun <= ALIVE_WITHIN_MS
        ? `✅ הבוט רץ — מחזור אחרון לפני ${ageMin} דקות`
        : `⚠️ הבוט לא רץ כבר ${ageMin} דקות`,
    );
  }
  lines.push(`🔖 גרסת קוד: ${codeVersion ? codeVersion.slice(0, 7) : 'לא ידוע'}`);

  const kill = get('live:kill-switch') as { engaged?: unknown } | undefined;
  lines.push(kill?.engaged ? '🛑 מתג חירום: פעיל (אין פקודות אמיתיות)' : '🔓 מתג חירום: כבוי');

  const open = Object.values((get('live:live-open-positions') as Record<string, unknown> | undefined) ?? {}) as {
    quantity?: unknown;
    entryPrice?: unknown;
  }[];
  const real = open.filter((p) => (num(p.quantity) ?? 0) * (num(p.entryPrice) ?? 0) >= DUST_NOTIONAL_EUR).length;
  lines.push(`📦 פוזיציות אמיתיות פתוחות: ${real} (עוד ${open.length - real} שאריות זעירות)`);

  const pending = Object.keys((get('live:confirmation-gate-pending') as Record<string, unknown> | undefined) ?? {}).length;
  lines.push(pending === 0 ? '⏳ אין בקשות אישור ממתינות' : `⏳ בקשות אישור ממתינות: ${pending}`);

  const liveEq = num(lastOf(get('live:live-equity-history'))?.['equity']);
  lines.push(`💶 חשבון אמיתי: שווי ${eur(liveEq)}, מזומן ${eur(num(get('live:live-cash-eur')))}`);

  const paperEq = num(lastOf(get('equity-history'))?.['equity']);
  const initial = num((get('portfolio-engine') as { initialCash?: unknown } | undefined)?.initialCash);
  if (paperEq !== null && initial !== null && initial > 0) {
    lines.push(`🧪 חשבון דמו: ${eur(paperEq)} (${(((paperEq / initial) - 1) * 100).toFixed(1)}% מההתחלה)`);
  }

  const f2 = (get('sentiment-shadow-standings') as { standing?: Record<string, unknown> } | undefined)?.standing;
  if (f2) {
    const r = num(f2['returnPct']);
    const b = num(f2['btcReturnPct']);
    lines.push(
      `📈 בדיקת F2 (דמו): ${f2['inPosition'] ? 'מחזיק ביטקוין' : 'במזומן'}` +
        (r !== null && b !== null ? ` — ${r.toFixed(1)}% מול ביטקוין ${b.toFixed(1)}%` : ''),
    );
  }

  return lines.join('\n');
}
