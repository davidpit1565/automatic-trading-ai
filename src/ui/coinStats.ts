/**
 * Per-coin market stats (market cap, rank, supply) from CoinGecko's public
 * API — no key required, unlike anything Kraken's ticker exposes. Only a
 * curated subset of symbols is mapped to CoinGecko ids; an unmapped symbol
 * returns null rather than guessing at one.
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/** Curated majors + the broader browsable universe already listed in
 * krakenPublic.ts's FALLBACK_DISPLAY_INSTRUMENTS — kept in sync manually
 * since the two lists serve different purposes (tradeable pairs vs. stats
 * lookup) and don't share a module. */
const GECKO_ID_BY_BASE: Readonly<Record<string, string>> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', XRP: 'ripple', ADA: 'cardano',
  DOGE: 'dogecoin', LTC: 'litecoin', DOT: 'polkadot', LINK: 'chainlink', AVAX: 'avalanche-2',
  TRX: 'tron', ATOM: 'cosmos', XLM: 'stellar', BCH: 'bitcoin-cash', UNI: 'uniswap',
  AAVE: 'aave', ETC: 'ethereum-classic', FIL: 'filecoin', NEAR: 'near', ALGO: 'algorand',
  INJ: 'injective-protocol', ARB: 'arbitrum', OP: 'optimism', APT: 'aptos', PAXG: 'pax-gold',
};

export interface CoinStats {
  readonly marketCap: number;
  readonly marketCapRank: number | null;
  readonly maxSupply: number | null;
  readonly circulatingSupply: number | null;
}

interface CoinGeckoMarketRow {
  readonly market_cap?: unknown;
  readonly market_cap_rank?: unknown;
  readonly max_supply?: unknown;
  readonly circulating_supply?: unknown;
}

/** null if the symbol isn't mapped, or the lookup fails for any reason — a
 * missing Stats section is honest; a wrong or stale number is not. */
export async function fetchCoinStats(
  base: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<CoinStats | null> {
  const id = GECKO_ID_BY_BASE[base.toUpperCase()];
  if (!id) return null;
  try {
    const response = await fetchFn(`${COINGECKO_BASE}/coins/markets?vs_currency=eur&ids=${id}`);
    if (!response.ok) return null;
    const rows = (await response.json()) as CoinGeckoMarketRow[];
    const row = rows[0];
    if (!row || typeof row.market_cap !== 'number') return null;
    return {
      marketCap: row.market_cap,
      marketCapRank: typeof row.market_cap_rank === 'number' ? row.market_cap_rank : null,
      maxSupply: typeof row.max_supply === 'number' ? row.max_supply : null,
      circulatingSupply: typeof row.circulating_supply === 'number' ? row.circulating_supply : null,
    };
  } catch {
    return null;
  }
}
