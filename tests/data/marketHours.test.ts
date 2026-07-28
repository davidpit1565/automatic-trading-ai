import { describe, expect, it } from 'vitest';
import { isUsMarketOpen } from '../../src/core/data/marketHours';

describe('isUsMarketOpen', () => {
  it('is open at 10:00 ET on a Tuesday', () => {
    // 2024-06-04 is a Tuesday. 14:00 UTC = 10:00 EDT.
    expect(isUsMarketOpen(Date.parse('2024-06-04T14:00:00Z'))).toBe(true);
  });

  it('is closed before 09:30 ET', () => {
    // 13:00 UTC = 09:00 EDT.
    expect(isUsMarketOpen(Date.parse('2024-06-04T13:00:00Z'))).toBe(false);
  });

  it('is closed at/after 16:00 ET', () => {
    // 20:00 UTC = 16:00 EDT.
    expect(isUsMarketOpen(Date.parse('2024-06-04T20:00:00Z'))).toBe(false);
  });

  it('is closed right at the open/close boundaries the other direction', () => {
    // 13:30 UTC = 09:30 EDT — market opens exactly here.
    expect(isUsMarketOpen(Date.parse('2024-06-04T13:30:00Z'))).toBe(true);
    // 19:59 UTC = 15:59 EDT — still open.
    expect(isUsMarketOpen(Date.parse('2024-06-04T19:59:00Z'))).toBe(true);
  });

  it('is closed on Saturday and Sunday regardless of time', () => {
    // 2024-06-08 is a Saturday, 2024-06-09 a Sunday.
    expect(isUsMarketOpen(Date.parse('2024-06-08T14:00:00Z'))).toBe(false);
    expect(isUsMarketOpen(Date.parse('2024-06-09T14:00:00Z'))).toBe(false);
  });

  it('handles the winter EST offset correctly (no DST)', () => {
    // 2024-01-09 is a Tuesday. 15:00 UTC = 10:00 EST (UTC-5 in winter).
    expect(isUsMarketOpen(Date.parse('2024-01-09T15:00:00Z'))).toBe(true);
    // 14:00 UTC = 09:00 EST — before open.
    expect(isUsMarketOpen(Date.parse('2024-01-09T14:00:00Z'))).toBe(false);
  });
});
