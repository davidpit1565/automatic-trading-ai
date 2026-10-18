/**
 * Two small liveness helpers (David, 2026-10-18: "alert me automatically if the
 * bot stops"). Both are inert unless configured and can never affect trading.
 *
 * 1. `pingHealthcheck` — an external dead-man's switch. After every cycle that
 *    completed without throwing, the bot GETs a URL from a free external
 *    service (e.g. healthchecks.io). The SERVICE alerts (Telegram/email) when
 *    the pings STOP — so the alert still arrives if GitHub Actions itself is
 *    down, which no workflow running on GitHub can do. The URL is a repo
 *    secret (`HEALTHCHECK_PING_URL`); unset = no-op.
 * 2. `outageNotice` — when a run starts and the previous cycle was long ago,
 *    say so, so a silent outage is never discovered by accident.
 */

const PING_TIMEOUT_MS = 5_000;
/** A gap longer than this between the previous cycle and the start of a new run is an outage worth mentioning. */
export const OUTAGE_NOTICE_AFTER_MS = 30 * 60 * 1000;

/** GETs `url`; returns whether it succeeded. Never throws; an unset/blank url is a no-op (false). */
export async function pingHealthcheck(url: string | undefined, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const target = url?.trim();
  if (!target) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const response = await fetchFn(target, { method: 'GET', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hebrew notice for a run that starts after a long silence, or null when the
 * gap is normal (or there is no previous cycle on record).
 */
export function outageNotice(lastCycleAt: number | undefined, now: number): string | null {
  if (typeof lastCycleAt !== 'number' || !Number.isFinite(lastCycleAt)) return null;
  const gapMs = now - lastCycleAt;
  if (gapMs <= OUTAGE_NOTICE_AFTER_MS) return null;
  const minutes = Math.round(gapMs / 60000);
  const text = minutes >= 120 ? `${(minutes / 60).toFixed(1)} שעות` : `${minutes} דקות`;
  return `🔁 הבוט חזר לפעול אחרי הפסקה של ${text} (המחזור הקודם היה לפני כן). בזמן ההפסקה לא נבדקו סטופים ולא נשלחו בקשות אישור.`;
}
