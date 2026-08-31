/**
 * SEC EDGAR 13F institutional-holdings reader — "what is the smart money
 * actually holding", for a short, named list of well-known investors.
 *
 * Free, keyless, official (data.sec.gov / www.sec.gov) — same "public,
 * no-secret" pattern as `krakenPublic.ts`. Two real constraints, both
 * inherent to the SEC's own filing rules, not an implementation gap:
 *
 * 1. **Never real-time.** Form 13F is a QUARTERLY snapshot filed up to 45
 *    days after quarter-end. What this reads is always at least 45 days
 *    stale, sometimes closer to 135 (a position opened right after one
 *    quarter's snapshot won't surface until the NEXT quarter's filing).
 *    This is a background/retrospective signal, never a trade trigger.
 * 2. **CUSIP, not ticker.** The filing identifies each holding by CUSIP
 *    (a licensed identifier — there is no free official CUSIP<->ticker
 *    table), not by our own symbols. Matching here is by normalized
 *    ISSUER NAME against `KNOWN_ISSUER_NAMES` below, scoped to our own
 *    curated+browsable stock universe — accept-and-document limitation:
 *    a filer's own name spelling can miss a match; it will never falsely
 *    match a DIFFERENT company (matching is exact after normalization).
 *
 * Endpoints (verified against a live response, not assumed from memory):
 *   - `browse-edgar?action=getcompany&CIK=...&type=13F-HR&output=atom`
 *     lists that filer's 13F filings newest-first, with each entry's
 *     accession number.
 *   - The filing's own index page lists its documents; the holdings table
 *     is the one .xml file that is NOT `primary_doc.xml` (the cover page).
 *   - That XML's `<value>` field is already whole US dollars (verified by
 *     back-computing price-per-share against a real, known filing —
 *     NOT the older thousands-of-dollars convention some pre-2023
 *     write-ups describe).
 */

import type { Result } from '../types';
import { err, ok } from '../types';

const DEFAULT_TIMEOUT_MS = 15_000;
/** SEC's own published limit is 10 req/sec; this project issues far fewer
 * than that per run (a handful of filers, sequential), so no throttling
 * beyond the retry backoff below is needed. */
const USER_AGENT = 'automatic-trading-ai research contact@automatic-trading-ai.invalid';

export interface TopInvestor {
  readonly name: string;
  readonly cik: string;
}

/** A short, named list — not an attempt at "every" institutional filer.
 * Add more by CIK (look up via the same browse-edgar company-search
 * endpoint) rather than guessing a number. */
export const TOP_INVESTORS: readonly TopInvestor[] = [
  { name: 'Berkshire Hathaway', cik: '0001067983' },
  { name: 'Bridgewater Associates', cik: '0001350694' },
];

/**
 * Issuer-name fragments (as they tend to appear in a 13F, uppercase, before
 * normalization) for our own curated + browsable stock universe. Scoped
 * deliberately small — matching only symbols we actually track, not the
 * whole market — so a near-miss can be reviewed by hand rather than
 * silently mismatching an unrelated company.
 */
export const KNOWN_ISSUER_NAMES: Readonly<Record<string, string>> = {
  AAPL: 'APPLE INC',
  MSFT: 'MICROSOFT CORP',
  GOOGL: 'ALPHABET INC',
  AMZN: 'AMAZON COM INC',
  NVDA: 'NVIDIA CORP',
  META: 'META PLATFORMS INC',
  TSLA: 'TESLA INC',
  JPM: 'JPMORGAN CHASE & CO',
  V: 'VISA INC',
  WMT: 'WALMART INC',
  TTWO: 'TAKE TWO INTERACTIVE SOFTWARE',
};

export interface Holding {
  readonly issuerName: string;
  readonly cusip: string;
  readonly valueUsd: number;
  readonly shares: number;
}

export interface InvestorHoldings {
  readonly investor: string;
  readonly filedAt: string;
  /** Our own symbol, only for holdings that matched `KNOWN_ISSUER_NAMES`. */
  readonly matched: readonly (Holding & { readonly symbol: string })[];
}

function normalizeIssuerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Reverse-index of KNOWN_ISSUER_NAMES, built once. */
const SYMBOL_BY_NORMALIZED_NAME = new Map(
  Object.entries(KNOWN_ISSUER_NAMES).map(([symbol, name]) => [normalizeIssuerName(name), symbol]),
);

export class Sec13FSource {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: { fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The investor's most recent 13F-HR (or 13F-HR/A), matched against our
   * own tracked symbols only. */
  async fetchLatest(investor: TopInvestor): Promise<Result<InvestorHoldings>> {
    const feed = await this.getText(
      `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${investor.cik}` +
        `&type=13F-HR&dateb=&owner=include&count=1&output=atom`,
    );
    if (!feed.ok) return feed;
    const accession = feed.value.match(/<accession-number>([\d-]+)<\/accession-number>/)?.[1];
    const filedAt = feed.value.match(/<filing-date>([\d-]+)<\/filing-date>/)?.[1];
    if (!accession || !filedAt) {
      return err(`no 13F-HR filing found for ${investor.name} (CIK ${investor.cik})`);
    }

    const accessionNoDashes = accession.replace(/-/g, '');
    const cik = investor.cik.replace(/^0+/, '');
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionNoDashes}/`;
    const index = await this.getText(indexUrl);
    if (!index.ok) return index;
    // The information table is whichever .xml in this filing is NOT the
    // cover-page document — verified against a real filing, where the two
    // documents present were exactly `primary_doc.xml` and one other.
    const xmlFiles = [...index.value.matchAll(/href="([^"]+\.xml)"/g)].map((m) => m[1]!);
    const holdingsFile = xmlFiles.find((f) => !f.endsWith('primary_doc.xml'));
    if (!holdingsFile) {
      return err(`no holdings-table document found in filing ${accession} for ${investor.name}`);
    }
    const holdingsUrl = holdingsFile.startsWith('http') ? holdingsFile : `https://www.sec.gov${holdingsFile}`;
    const xml = await this.getText(holdingsUrl);
    if (!xml.ok) return xml;

    const holdings = parseInformationTable(xml.value);
    const matched = aggregateBySymbol(
      holdings.flatMap((h) => {
        const symbol = SYMBOL_BY_NORMALIZED_NAME.get(normalizeIssuerName(h.issuerName));
        return symbol ? [{ ...h, symbol }] : [];
      }),
    );
    return ok({ investor: investor.name, filedAt, matched });
  }

  private async getText(url: string): Promise<Result<string>> {
    let lastError = `request failed for ${url}`;
    for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await delay(RETRY_BASE_MS * 2 ** (attempt - 1));
      const result = await this.getTextOnce(url);
      if (result.ok) return result;
      lastError = result.error;
      if (!isTransient(result.error)) return result;
    }
    return err(`${lastError} (after ${RETRY_MAX_ATTEMPTS} retries)`);
  }

  private async getTextOnce(url: string): Promise<Result<string>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        signal: controller.signal,
      });
      if (!response.ok) return err(`HTTP ${response.status} from ${url}`);
      return ok(await response.text());
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return err(`request failed for ${url}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Extracts each `<infoTable>` block's fields. Regex-based rather than a
 * general XML parser: this is one narrow, stable, government-published
 * schema (unchanged for years), not arbitrary untrusted markup. */
export function parseInformationTable(xml: string): Holding[] {
  const blocks = xml.match(/<infoTable>[\s\S]*?<\/infoTable>/g) ?? [];
  const holdings: Holding[] = [];
  for (const block of blocks) {
    const issuerName = block.match(/<nameOfIssuer>([^<]*)<\/nameOfIssuer>/)?.[1];
    const cusip = block.match(/<cusip>([^<]*)<\/cusip>/)?.[1];
    const value = Number(block.match(/<value>([^<]*)<\/value>/)?.[1]);
    const shares = Number(block.match(/<sshPrnamt>([^<]*)<\/sshPrnamt>/)?.[1]);
    if (!issuerName || !cusip || !(value > 0) || !(shares > 0)) continue;
    holdings.push({ issuerName, cusip, valueUsd: value, shares });
  }
  return holdings;
}

/**
 * A large filer reports one position as SEVERAL line items — one per
 * managing sub-account/discretion (the filing's own `otherManager` field) —
 * not one row per issuer. Verified against a real filing: Berkshire's latest
 * 13F lists AAPL across 11 separate rows that sum to its one true position.
 * Left unaggregated, this would misrepresent a single large holding as many
 * separate ones. Sums shares/value per symbol; keeps the first-seen issuer
 * name and CUSIP (identical across the split rows for the same security).
 */
function aggregateBySymbol(
  rows: readonly (Holding & { symbol: string })[],
): (Holding & { symbol: string })[] {
  const bySymbol = new Map<string, Holding & { symbol: string }>();
  for (const row of rows) {
    const existing = bySymbol.get(row.symbol);
    bySymbol.set(
      row.symbol,
      existing
        ? { ...existing, valueUsd: existing.valueUsd + row.valueUsd, shares: existing.shares + row.shares }
        : { ...row },
    );
  }
  return [...bySymbol.values()];
}

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function isTransient(error: string): boolean {
  return /HTTP (429|5\d\d) /.test(error);
}
