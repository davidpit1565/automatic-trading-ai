/**
 * Data source selection for the dashboard.
 *
 * The browser talks to Revolut X through the local read-only signing proxy
 * (`npm run proxy`), which holds the API credentials in .env and can only
 * forward whitelisted market-data GETs. When the proxy is not running or
 * not configured, the app falls back to deterministic synthetic data and
 * says so loudly in the banner — demo data is never silently presented as
 * live market data.
 */

import type { MarketDataSource } from '../core/data/revolutClient';
import { RevolutXClient } from '../core/data/revolutClient';
import { SyntheticDataSource } from '../core/data/synthetic';
import type { Instrument } from '../core/types';

export interface ActiveDataSource {
  readonly source: MarketDataSource;
  readonly instruments: Instrument[];
  readonly isLive: boolean;
}

export async function initDataSource(): Promise<ActiveDataSource> {
  const live = new RevolutXClient({ timeoutMs: 8000 });
  const instruments = await live.getInstruments();
  if (instruments.ok && instruments.value.length > 0) {
    return {
      source: live,
      instruments: [...instruments.value].sort((a, b) => a.symbol.localeCompare(b.symbol)),
      isLive: true,
    };
  }

  const demo = new SyntheticDataSource(Date.now());
  const demoInstruments = await demo.getInstruments();
  return {
    source: demo,
    instruments: demoInstruments.ok ? demoInstruments.value : [],
    isLive: false,
  };
}
