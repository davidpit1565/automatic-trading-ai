import { describe, expect, it } from 'vitest';
import {
  formatMarketPrice,
  formatNumber,
  formatPct,
  formatPriceSplit,
  formatSignedPrice,
  tieredPriceHtml,
  truncate,
} from '../../src/ui/format';

describe('tieredPriceHtml', () => {
  it('splits at the last decimal point, keeping the exact digits the caller already formatted', () => {
    // Correctness requirement: this must never re-round or re-format the
    // number — a sub-€1 asset price (4 significant figures, not 2dp) must
    // come through with every digit intact, just visually restyled.
    expect(tieredPriceHtml('€0.1770')).toBe('<span class="tiered-price">€0<span class="tiered-minor">.1770</span></span>');
  });

  it('splits a whole-euro-amount price the same way', () => {
    expect(tieredPriceHtml('€3,391.09')).toBe(
      '<span class="tiered-price">€3,391<span class="tiered-minor">.09</span></span>',
    );
  });

  it('passes a string with no decimal point through unchanged, wrapped but not split', () => {
    expect(tieredPriceHtml('€69,275')).toBe('<span class="tiered-price">€69,275</span>');
  });
});

describe('truncate', () => {
  it('returns short text unchanged, with no ellipsis appended', () => {
    expect(truncate('short alert', 140)).toBe('short alert');
  });

  it('cuts long text to max length and appends an ellipsis', () => {
    const long = 'x'.repeat(150);
    const result = truncate(long, 140);
    expect(result).toBe(`${'x'.repeat(140)}…`);
  });

  it('leaves text exactly at the limit unchanged (not truncated)', () => {
    const exact = 'x'.repeat(140);
    expect(truncate(exact, 140)).toBe(exact);
  });
});

describe('market list formatting', () => {
  it('keeps cents on large prices instead of rounding to whole units', () => {
    expect(formatMarketPrice(56370.6)).toBe('56,370.60');
    expect(formatMarketPrice(64161.15)).toBe('64,161.15');
  });

  it('never emits exponential notation for sub-cent assets', () => {
    expect(formatMarketPrice(0.0000123)).toBe('0.0000123');
    expect(formatMarketPrice(0.0000001)).not.toContain('e');
    expect(formatMarketPrice(0.0000001)).toBe('0.0000001');
  });

  it('scales decimals to the size of the price', () => {
    expect(formatMarketPrice(3.5)).toBe('3.50');
    expect(formatMarketPrice(0.5)).toBe('0.5000');
    expect(formatMarketPrice(0)).toBe('0.00');
  });

  it('signs absolute changes explicitly in both directions', () => {
    expect(formatSignedPrice(1243.7)).toBe('+1,243.70');
    expect(formatSignedPrice(-58.5)).toBe('-58.50');
    expect(formatSignedPrice(0)).toBe('+0.00');
  });

  it('returns a dash rather than NaN for unusable input', () => {
    expect(formatMarketPrice(Number.NaN)).toBe('—');
    expect(formatSignedPrice(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('change decimals follow the price', () => {
  it('renders a small change at the same scale as its price', () => {
    // Cardano: price €0.1372 — the change must not sprawl to 6 decimals.
    expect(formatSignedPrice(-0.008137, 0.1372)).toBe('-0.0081');
    expect(formatSignedPrice(-0.0022084, 0.0621)).toBe('-0.0022');
  });

  it('keeps two decimals on large prices', () => {
    expect(formatSignedPrice(-1192.4, 56168)).toBe('-1,192.40');
    expect(formatSignedPrice(-1.43, 40.54)).toBe('-1.43');
  });

  it('still trims sub-cent assets sensibly', () => {
    expect(formatMarketPrice(0.0000123, 0.0000456)).toBe('0.0000123');
  });

  it('defaults the reference to the value itself when none is given', () => {
    expect(formatSignedPrice(-1192.4)).toBe('-1,192.40');
  });
});

describe('formatPct / formatNumber: no spurious "-0.00" for a negative value that rounds to zero', () => {
  it('formatPct drops the minus sign once the value rounds to exactly zero', () => {
    // Below 2dp's rounding floor — a real case (a near-flat asset, or a
    // 48h/24h anchor landing a hair under zero) that must read as flat, not
    // as a fake small decline.
    expect(formatPct(-0.001)).toBe('0.00%');
    expect(formatPct(-0.004)).toBe('0.00%');
  });

  it('formatPct is unaffected for values that genuinely round to a non-zero display', () => {
    expect(formatPct(5.2)).toBe('+5.20%');
    expect(formatPct(-5.2)).toBe('-5.20%');
    expect(formatPct(0)).toBe('0.00%');
    expect(formatPct(null)).toBe('—');
  });

  it('formatNumber drops the minus sign once the value rounds to exactly zero', () => {
    expect(formatNumber(-0.001, 2)).toBe('0.00');
    expect(formatNumber(-0.03, 1)).toBe('0.0');
  });

  it('formatNumber is unaffected for values that genuinely round to a non-zero display', () => {
    expect(formatNumber(-5.2, 1)).toBe('-5.2');
    expect(formatNumber(5.2, 1)).toBe('5.2');
    expect(formatNumber(null)).toBe('—');
  });
});

describe('formatPriceSplit: no negative-zero hero balance', () => {
  it('renders float dust near zero as a clean "0"/"00", never "-0"/"00"', () => {
    // The exact class of dust formatPrice's own comment describes: cash
    // computed as equity minus the sum of positions, landing at e.g.
    // -1.137e-12 instead of exactly zero.
    expect(formatPriceSplit(-1.137e-12)).toEqual({ major: '0', minor: '00' });
    expect(formatPriceSplit(-0.004)).toEqual({ major: '0', minor: '00' });
  });

  it('is unaffected for a genuine negative balance', () => {
    expect(formatPriceSplit(-12.5)).toEqual({ major: '-12', minor: '50' });
  });

  it('still splits a normal positive balance correctly', () => {
    expect(formatPriceSplit(26.85)).toEqual({ major: '26', minor: '85' });
    expect(formatPriceSplit(3391.09)).toEqual({ major: '3,391', minor: '09' });
  });
});
