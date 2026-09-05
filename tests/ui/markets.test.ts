import { describe, expect, it } from 'vitest';
import type { ActiveDataSource } from '../../src/ui/dataSource';
import type { Candle, Instrument } from '../../src/core/types';
import type { MarketDataSource } from '../../src/core/data/revolutClient';
import { fetchSnapshot } from '../../src/ui/markets';

const XBT: Instrument = { symbol: 'XBTEUR', base: 'BTC', quote: 'EUR' };
const candle = (close: number): Candle => ({ timestamp: 0, open: close, high: close, low: close, close, volume: 1 });

function dataSourceWithCloses(closes: number[]): ActiveDataSource {
  const source: MarketDataSource = {
    name: 'fake',
    getInstruments: async () => ({ ok: true, value: [XBT] }),
    getCandles: async () => ({ ok: true, value: closes.map(candle) }),
  };
  return { source, instruments: [XBT], isLive: true, kind: 'public', diagnostics: [] };
}

describe('fetchSnapshot changePct (real incident, 2026-09-05)', () => {
  it('anchors the change % 24 hours back from the latest close, not 48 — the default 48-candle fetch is for a smoother sparkline, not a wider change window', async () => {
    // 49 hourly closes: index 0 = 48h ago ... index 48 = now.
    const closes = Array.from({ length: 49 }, (_, i) => 100 + i);
    const data = dataSourceWithCloses(closes);

    const snap = await fetchSnapshot(data, 'XBTEUR', 'Bitcoin', 49);

    const now = closes[48]!; // 148
    const dayAgo = closes[49 - 25]!; // index 24 -> 124
    expect(snap!.price).toBe(now);
    expect(snap!.changePct).toBeCloseTo(((now - dayAgo) / dayAgo) * 100);
    // Sanity: this must differ from the old (wrong) 48h-window calculation.
    const wrong48hPct = ((now - closes[0]!) / closes[0]!) * 100;
    expect(snap!.changePct).not.toBeCloseTo(wrong48hPct, 3);
  });

  it('falls back to the oldest available close when fewer than 25 candles came back, rather than throwing', async () => {
    const closes = [100, 105, 110]; // only 3 candles — a network hiccup
    const data = dataSourceWithCloses(closes);

    const snap = await fetchSnapshot(data, 'XBTEUR', 'Bitcoin', 3);

    expect(snap!.price).toBe(110);
    expect(snap!.changePct).toBeCloseTo(((110 - 100) / 100) * 100);
  });
});
