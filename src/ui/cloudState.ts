/**
 * Reads the cloud robot's real state — the same state/autopilot-state.json
 * the GitHub Actions autopilot commits after every run. This is what makes
 * the dashboard show the REAL robot (the one that sends Telegram alerts),
 * not a separate in-browser simulation.
 *
 * Public raw URL; read-only; no keys. Fails soft (returns null) so the UI
 * can show a friendly message instead of breaking.
 */

const STATE_URL =
  'https://raw.githubusercontent.com/davidpit1565/automatic-trading-ai/main/state/autopilot-state.json';

export interface CloudPosition {
  readonly symbol: string;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly openedAt: number;
}

export interface CloudTrade {
  readonly at: number;
  readonly kind: 'buy' | 'sell';
  readonly symbol: string;
  readonly quantity: number;
  readonly price: number;
  /** Exit reason for sells, if present. */
  readonly note: string | null;
}

export interface CloudState {
  readonly cash: number;
  readonly initialCash: number;
  readonly baseCurrency: string;
  readonly positions: CloudPosition[];
  /** Every buy/sell, newest first — parsed from the audit log. */
  readonly history: CloudTrade[];
  readonly lastRunAt: number | null;
  readonly benchmark: { btc: number; equity: number } | null;
  /** Portfolio value over time (oldest→newest), for the value chart. */
  readonly equityHistory: { at: number; equity: number }[];
}

interface RawState {
  'portfolio-engine'?: { cash?: number; initialCash?: number; baseCurrency?: string };
  'open-positions'?: Array<{ symbol: string; quantity: number; entryPrice: number; openedAt: number }>;
  'audit-log'?: Array<{ timestamp: number; event: string; detail: string }>;
  'autopilot-last-run'?: { at?: number };
  'benchmark-anchor'?: { btc?: number; equity?: number };
  'equity-history'?: Array<{ at: number; equity: number }>;
}

/** Parse "paper entry/exit SYMBOL: qty @ price (note)" into a trade. */
function parseTrade(timestamp: number, detail: string): CloudTrade | null {
  const match = /^paper (entry|exit) (\S+): ([\d.]+) @ ([\d.]+)(?:\s*\((.*)\))?/.exec(detail);
  if (!match) return null;
  return {
    at: timestamp,
    kind: match[1] === 'entry' ? 'buy' : 'sell',
    symbol: match[2]!,
    quantity: Number(match[3]),
    price: Number(match[4]),
    note: match[5] ?? null,
  };
}

export async function fetchCloudState(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<CloudState | null> {
  try {
    const response = await fetchFn(`${STATE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const raw = (await response.json()) as RawState;

    const pe = raw['portfolio-engine'] ?? {};
    const positions: CloudPosition[] = (raw['open-positions'] ?? []).map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      openedAt: p.openedAt,
    }));
    const history: CloudTrade[] = (raw['audit-log'] ?? [])
      .filter((e) => e.event === 'filled')
      .map((e) => parseTrade(e.timestamp, e.detail))
      .filter((t): t is CloudTrade => t !== null)
      .sort((a, b) => b.at - a.at);

    const anchor = raw['benchmark-anchor'];
    return {
      cash: pe.cash ?? 0,
      initialCash: pe.initialCash ?? 10_000,
      baseCurrency: pe.baseCurrency ?? 'EUR',
      positions,
      history,
      lastRunAt: raw['autopilot-last-run']?.at ?? null,
      benchmark:
        anchor && anchor.btc && anchor.equity ? { btc: anchor.btc, equity: anchor.equity } : null,
      equityHistory: Array.isArray(raw['equity-history']) ? raw['equity-history'] : [],
    };
  } catch {
    return null;
  }
}
