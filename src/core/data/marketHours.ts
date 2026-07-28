/**
 * US stock market regular-hours check (NYSE/Nasdaq: 09:30-16:00 America/New_York,
 * Monday-Friday). Deliberately does NOT account for market holidays (Thanksgiving,
 * Christmas, etc.) — a known simplification for the first version. The practical
 * effect of missing a holiday is a wasted cycle (the data source will simply
 * return no fresh bar), never a wrong trade, so it fails safe.
 */
export function isUsMarketOpen(now: number): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  const value = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = value('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const hour = Number(value('hour')) % 24; // some Intl engines emit '24' at midnight
  const minute = Number(value('minute'));
  const minutesSinceMidnight = hour * 60 + minute;
  return minutesSinceMidnight >= 9 * 60 + 30 && minutesSinceMidnight < 16 * 60;
}
