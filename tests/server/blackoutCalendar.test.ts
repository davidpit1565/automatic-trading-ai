import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { ensureBlackoutWindows, isBlackout, parseBlackoutWindows } from '../../server/blackoutCalendar.mts';

const CANDLES = (date: string) => ({ category: 'candles', date, title: 'Candle lighting' });
const HAVDALAH = (date: string) => ({ category: 'havdalah', date, title: 'Havdalah' });
const HOLIDAY = (date: string, title: string, yomtov = true) => ({ category: 'holiday', date, title, yomtov });

describe('parseBlackoutWindows', () => {
  it('pairs a plain Shabbat candle-lighting with its own havdalah, labeled שבת', () => {
    const windows = parseBlackoutWindows([
      CANDLES('2026-09-04T20:03:00+02:00'),
      HAVDALAH('2026-09-05T21:11:00+02:00'),
    ]);
    expect(windows).toEqual([
      {
        start: new Date('2026-09-04T20:03:00+02:00').getTime(),
        end: new Date('2026-09-05T21:11:00+02:00').getTime(),
        label: 'שבת',
      },
    ]);
  });

  it('spans a 2-day Yom Tov as ONE window, skipping the internal candle-lighting between the two days', () => {
    // Real Rosh Hashana 5787 shape: candle-lighting before day 1, the
    // yomtov day-1 holiday marker, ANOTHER candle-lighting (from day 1's
    // flame) before day 2, day-2's holiday marker, then one havdalah.
    const windows = parseBlackoutWindows([
      CANDLES('2026-09-11T19:48:00+02:00'),
      HOLIDAY('2026-09-12', 'Rosh Hashana 5787'),
      CANDLES('2026-09-12T20:54:00+02:00'), // must NOT open a second window
      HOLIDAY('2026-09-13', 'Rosh Hashana II'),
      HAVDALAH('2026-09-13T20:51:00+02:00'),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toEqual({
      start: new Date('2026-09-11T19:48:00+02:00').getTime(),
      end: new Date('2026-09-13T20:51:00+02:00').getTime(),
      label: 'Rosh Hashana 5787',
    });
  });

  it('excludes Chol HaMoed (intermediate) days — they carry no candle-lighting/havdalah of their own', () => {
    const windows = parseBlackoutWindows([
      CANDLES('2026-09-25T19:16:00+02:00'),
      HOLIDAY('2026-09-26', 'Sukkot I'),
      CANDLES('2026-09-26T20:21:00+02:00'),
      HOLIDAY('2026-09-27', 'Sukkot II'),
      HAVDALAH('2026-09-27T20:18:00+02:00'),
      HOLIDAY('2026-09-28', "Sukkot III (CH''M)", false),
      HOLIDAY('2026-09-29', "Sukkot IV (CH''M)", false),
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.end).toBe(new Date('2026-09-27T20:18:00+02:00').getTime());
  });
});

describe('isBlackout', () => {
  const windows = [{ start: 1000, end: 2000, label: 'שבת' }];

  it('returns the matching window when now falls inside [start, end)', () => {
    expect(isBlackout(windows, 1500)).toEqual(windows[0]);
    expect(isBlackout(windows, 1000)).toEqual(windows[0]);
  });

  it('returns null outside the window, including exactly at end (exclusive)', () => {
    expect(isBlackout(windows, 999)).toBeNull();
    expect(isBlackout(windows, 2000)).toBeNull();
  });
});

describe('ensureBlackoutWindows', () => {
  it('fetches and caches windows on first use', async () => {
    const store = new MemoryStore();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ items: [CANDLES('2026-09-04T20:03:00+02:00'), HAVDALAH('2026-09-05T21:11:00+02:00')] }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const windows = await ensureBlackoutWindows(store, Date.parse('2026-09-01T00:00:00Z'), fetchFn);
    expect(windows).toHaveLength(1);
    expect(store.get('blackout-windows-cache')).toBeTruthy();
  });

  it('reuses the cache without fetching when it already covers the horizon', async () => {
    const store = new MemoryStore();
    const now = Date.parse('2026-09-01T00:00:00Z');
    store.set('blackout-windows-cache', {
      fetchedAt: now,
      windows: [{ start: now, end: now + 60 * 24 * 60 * 60 * 1000, label: 'שבת' }],
    });
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      throw new Error('must not be called');
    }) as unknown as typeof fetch;

    const windows = await ensureBlackoutWindows(store, now, fetchFn);
    expect(calls).toBe(0);
    expect(windows).toHaveLength(1);
  });

  it('fails OPEN (falls back to the stale cache) when a refetch fails — never blocks trading on a calendar outage', async () => {
    const store = new MemoryStore();
    const now = Date.parse('2026-09-01T00:00:00Z');
    const staleWindows = [{ start: now - 1000, end: now + 1000, label: 'שבת' }];
    store.set('blackout-windows-cache', { fetchedAt: now - 999_999_999, windows: staleWindows });
    const fetchFn = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;

    const windows = await ensureBlackoutWindows(store, now, fetchFn);
    expect(windows).toEqual(staleWindows);
  });

  it('fails OPEN to an empty list (not a thrown error) when there is no cache at all and the fetch throws', async () => {
    const store = new MemoryStore();
    const fetchFn = (async () => {
      throw new Error('network error');
    }) as unknown as typeof fetch;

    const windows = await ensureBlackoutWindows(store, Date.parse('2026-09-01T00:00:00Z'), fetchFn);
    expect(windows).toEqual([]);
  });
});
