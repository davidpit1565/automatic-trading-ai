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
import { CoinbasePublicSource } from '../core/data/coinbasePublic';
import { KrakenPublicSource } from '../core/data/krakenPublic';
import { SyntheticDataSource } from '../core/data/synthetic';
import type { Instrument } from '../core/types';

export type DataSourceKind = 'revolut' | 'public' | 'demo';

export interface ActiveDataSource {
  readonly source: MarketDataSource;
  readonly instruments: Instrument[];
  readonly isLive: boolean;
  readonly kind: DataSourceKind;
  /** Why earlier sources in the chain were skipped — shown when in demo. */
  readonly diagnostics: string[];
}

function demoForced(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('demo');
  } catch {
    return false;
  }
}

export async function initDataSource(): Promise<ActiveDataSource> {
  const diagnostics: string[] = [];

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
        diagnostics,
      };
    }
    diagnostics.push('Revolut proxy: not running');

    // 2/3. Public browser-direct sources — probe with one real candle
    // request each; regional blocks on one provider fall through to the next.
    const publicSources: MarketDataSource[] = [
      new KrakenPublicSource(),
      new CoinbasePublicSource(),
    ];
    for (const candidate of publicSources) {
      const instruments = await candidate.getInstruments();
      if (!instruments.ok) continue;
      const probe = await candidate.getCandles(instruments.value[0]!.symbol, '1h', 2);
      if (probe.ok) {
        return {
          source: candidate,
          instruments: instruments.value,
          isLive: true,
          kind: 'public',
          diagnostics,
        };
      }
      diagnostics.push(`${candidate.name}: ${probe.error}`);
    }
  } else {
    diagnostics.push('demo mode forced via ?demo=1');
  }

  // 4. Demo fallback — never presented as live data.
  const demo = new SyntheticDataSource(Date.now());
  const demoInstruments = await demo.getInstruments();
  return {
    source: demo,
    instruments: demoInstruments.ok ? demoInstruments.value : [],
    isLive: false,
    kind: 'demo',
    diagnostics,
  };
}
