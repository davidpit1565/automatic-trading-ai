import { describe, expect, it } from 'vitest';
import { OUTAGE_NOTICE_AFTER_MS, outageNotice, pingHealthcheck } from '../../server/heartbeat.mts';

function fakeFetch(status: number, calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(String(url));
    return new Response('OK', { status });
  }) as unknown as typeof fetch;
}

describe('pingHealthcheck', () => {
  it('is a no-op (no request) when the URL is unset or blank', async () => {
    const calls: string[] = [];
    expect(await pingHealthcheck(undefined, fakeFetch(200, calls))).toBe(false);
    expect(await pingHealthcheck('   ', fakeFetch(200, calls))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('GETs the URL and reports success; never throws on HTTP errors or network failures', async () => {
    const calls: string[] = [];
    expect(await pingHealthcheck('https://hc-ping.com/abc', fakeFetch(200, calls))).toBe(true);
    expect(calls).toEqual(['https://hc-ping.com/abc']);
    expect(await pingHealthcheck('https://hc-ping.com/abc', fakeFetch(500))).toBe(false);
    const boom = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await pingHealthcheck('https://hc-ping.com/abc', boom)).toBe(false);
  });
});

describe('outageNotice', () => {
  const NOW = 1_800_000_000_000;

  it('is silent for a normal handoff gap or when there is no previous cycle', () => {
    expect(outageNotice(NOW - 2 * 60_000, NOW)).toBeNull();
    expect(outageNotice(NOW - OUTAGE_NOTICE_AFTER_MS, NOW)).toBeNull();
    expect(outageNotice(undefined, NOW)).toBeNull();
    expect(outageNotice(Number.NaN, NOW)).toBeNull();
  });

  it('reports minutes for a medium gap and hours for a long one', () => {
    expect(outageNotice(NOW - 46 * 60_000, NOW)).toContain('46 דקות');
    expect(outageNotice(NOW - 5 * 3_600_000, NOW)).toContain('5.0 שעות');
  });
});
