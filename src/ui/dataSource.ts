/**
 * Data source selection for the dashboard.
 *
 * Priority order:
 *   1. Revolut X via the local read-only signing proxy (when running).
 *   2. Kraken public market data — browser-direct, keyless, CORS-open.
 *      This is what makes the platform fully usable on a phone.
 *   3. Deterministic synthetic demo data, loudly labelled.
 *
 * `?demo=1` in the URL forces demo mode (used by deterministic e2e runs
 * and available to users who want to explore without live data).
 */

import type { MarketDataSource } from '../core/data/revolutClient';
import { RevolutXClient } from '../core/data/revolutClient';
import { KrakenPublicSource } from '../core/data/krakenPublic';
import { SyntheticDataSource } from '../core/data/synthetic';
import type { Instrument } from '../core/types';

export type DataSourceKind = 'revolut' | 'public' | 'demo';

export interface ActiveDataSource {
  readonly source: MarketDataSource;
  readonly instruments: Instrument[];
  readonly isLive: boolean;
  readonly kind: DataSourceKind;
}

function demoForced(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('demo');
  } catch {
    return false;
  }
}

export async function initDataSource(): Promise<ActiveDataSource> {
  if (!demoForced()) {
    // 1. Revolut X through the local proxy (desktop setups).
    const revolut = new RevolutXClient({ timeoutMs: 6000 });
    const revolutInstruments = await revolut.getInstruments();
    if (revolutInstruments.ok && revolutInstruments.value.length > 0) {
      return {
        source: revolut,
        instruments: [...revolutInstruments.value].sort((a, b) => a.symbol.localeCompare(b.symbol)),
        isLive: true,
        kind: 'revolut',
      };
    }

    // 2. Kraken public — verify reachability with one real candle request.
    const kraken = new KrakenPublicSource();
    const probe = await kraken.getCandles('XBTEUR', '1h', 2);
    if (probe.ok) {
      const instruments = await kraken.getInstruments();
      if (instruments.ok) {
        return { source: kraken, instruments: instruments.value, isLive: true, kind: 'public' };
      }
    }
  }

  // 3. Demo fallback — never presented as live data.
  const demo = new SyntheticDataSource(Date.now());
  const demoInstruments = await demo.getInstruments();
  return {
    source: demo,
    instruments: demoInstruments.ok ? demoInstruments.value : [],
    isLive: false,
    kind: 'demo',
  };
}
