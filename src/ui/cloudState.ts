/**
 * Reads the cloud agent's real state — the same state/autopilot-state.json
 * the GitHub Actions autopilot commits after every run. This is what makes
 * the dashboard show the REAL agent (the one that sends Telegram alerts),
 * not a separate in-browser simulation.
 *
 * Public raw URL; read-only; no keys. Fails soft (returns null) so the UI
 * can show a friendly message instead of breaking.
 */

import { formatPrice } from './format';

const STATE_URL =
  'https://raw.githubusercontent.com/davidpit1565/automatic-trading-ai/main/state/autopilot-state.json';
export const STOCKS_STATE_URL =
  'https://raw.githubusercontent.com/davidpit1565/automatic-trading-ai/main/state/stocks-state.json';

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

/** One real-money-readiness check, e.g. "3 / 20 closed trades". */
export interface CloudReadinessCriterion {
  readonly key: string;
  readonly ok: boolean;
  readonly detail: string;
}
export interface CloudReadiness {
  readonly ready: boolean;
  readonly summary: string;
  readonly criteria: CloudReadinessCriterion[];
}

/** One curated symbol's last-known price, as recorded by the cloud agent's
 * own cycle — not a live tick. This is the read-only, no-keys way to show
 * "what does the agent see right now" for a source (like Alpaca) that
 * requires a secret per request and can never be called from the browser. */
export interface MarketSnapshotEntry {
  readonly symbol: string;
  readonly price: number;
  readonly changePct: number;
  readonly updatedAt: number;
}

/** One shadow-portfolio candidate's forward-test standing (see
 * `shadowEvaluator.ts`/`stocksRunner.mts`'s `STOCKS_SHADOW_CANDIDATES`) —
 * e.g. the stocks "long-term investing" wallet, key `'long-term'`. */
export interface CloudShadowStanding {
  readonly key: string;
  readonly label: string;
  readonly equity: number;
  readonly returnPct: number;
  readonly trades: number;
  readonly winRatePct: number | null;
  readonly profitFactor: number | null;
  readonly openPositions: number;
  readonly startedAt: number;
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
  /** Honest real-money readiness verdict, or null if not computed yet. */
  readonly readiness: CloudReadiness | null;
  /** Last-known price per curated symbol, or empty if the agent hasn't
   * recorded one yet (e.g. the crypto state file, which has no such field). */
  readonly marketSnapshot: MarketSnapshotEntry[];
  /** Shadow-portfolio candidate standings, or empty if none have run yet. */
  readonly shadowStandings: CloudShadowStanding[];
  /** The REAL Revolut X account — separate from everything else above,
   * which is all SIMULATED. Null until the live ledger has ever been
   * initialized (e.g. the stocks state file, which has no live account). */
  readonly live: LiveAccountState | null;
}

/** One currently open REAL position — `symbol` is this project's internal
 * instrument code (e.g. 'XBTEUR'), read from the position's own entry
 * assessment, not the broker-native pair symbol it's stored under. */
export interface LiveOpenPosition {
  readonly symbol: string;
  readonly quantity: number;
  readonly entryPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly openedAt: number;
}

/** The real Revolut X account's current state, mirrored from the same
 * committed file the cloud agent (server/liveLedger.mts, liveExitFlow.mts)
 * writes to under its 'live:'-prefixed keys. */
export interface LiveAccountState {
  readonly cash: number;
  readonly positions: LiveOpenPosition[];
  readonly killSwitchEngaged: boolean;
  readonly killSwitchReason: string | null;
  /** Real (not simulated) trade outcomes — filled or broker-rejected —
   * newest first, capped to a short recent list. `symbol`, when parseable
   * from the audit entry's own intent id (not every entry has one — e.g. a
   * pre-trade symbol-verification failure or the kill switch), lets the UI
   * show the same coin icon its simulated trade rows already do instead of
   * a bare status pill with no identity at all. */
  readonly recentEvents: { at: number; event: string; detail: string; symbol?: string | null }[];
  /** BTC sitting in the real account outside the bot's own tracked
   * positions (David converted EUR→BTC manually while funding the account,
   * 2026-09-03) — reporting only, never included in trade-sizing equity. */
  readonly externalBtcQuantity: number;
  /** The real account's own value-over-time series — cash + tracked
   * positions + the untracked BTC above — mirroring `equityHistory` above
   * but for real, not simulated, money. */
  readonly equityHistory: Array<{ at: number; equity: number }>;
}

interface RawState {
  'portfolio-engine'?: { cash?: number; initialCash?: number; baseCurrency?: string };
  'open-positions'?: Array<{ symbol: string; quantity: number; entryPrice: number; openedAt: number }>;
  'audit-log'?: Array<{ timestamp: number; event: string; detail: string }>;
  'autopilot-last-run'?: { at?: number };
  'benchmark-anchor'?: { btc?: number; equity?: number };
  'equity-history'?: Array<{ at: number; equity: number }>;
  'real-money-readiness'?: {
    ready?: boolean;
    summary?: string;
    criteria?: Array<{ key?: string; ok?: boolean; detail?: string }>;
  };
  'market-snapshot'?: {
    symbols?: Array<{ symbol?: string; price?: number; changePct?: number; updatedAt?: number }>;
  };
  'shadow-standings'?: {
    standings?: Array<{
      key?: string;
      label?: string;
      equity?: number;
      returnPct?: number;
      trades?: number;
      winRatePct?: number | null;
      profitFactor?: number | null;
      openPositions?: number;
      startedAt?: number;
    }>;
  };
  'live:live-cash-eur'?: number;
  'live:live-open-positions'?: Record<string, RawLivePosition> | null;
  'live:kill-switch'?: { engaged?: boolean; reason?: string | null };
  'live:audit-log'?: Array<{ timestamp?: number; event?: string; detail?: string; intentId?: string }>;
  'live:live-external-btc-qty'?: number;
  'live:live-equity-history'?: Array<{ at: number; equity: number }>;
}

interface RawLivePosition {
  symbol?: string;
  quantity?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt?: number;
  entryAssessment?: { asset?: string };
}

/**
 * Round the raw numbers inside an audit note for display.
 *
 * The audit log is an immutable record and stores full float precision, so an
 * entry note reads `stop 0.7205806407366144, target 0.7389387185267711` — 17
 * digits of noise in a phone-sized list. Rounding belongs here, at the
 * presentation layer, rather than in the record itself: it also cleans up notes
 * already written. Non-numeric notes (`stop-loss`, `take-profit`) pass through
 * untouched, and `formatPrice` keeps 4 significant digits below 1 so a
 * sub-cent crypto level is not flattened to 0.00.
 */
export function tidyNoteNumbers(note: string): string {
  return note.replace(/\d+\.\d{5,}/g, (n) => formatPrice(Number(n)));
}

/** Pull the traded symbol out of a live audit entry's own intent id, e.g.
 * `"live-entry:ADAEUR:manual-reconcile-20260904:exit:..."` → `"ADAEUR"`.
 * Not every intent carries one (a pre-trade symbol-verification failure like
 * `"verify-symbol-exists"`, or `"manual-kill-switch"`) — those correctly
 * return null rather than a wrong guess. */
function parseLiveEntrySymbol(intentId: string | undefined): string | null {
  return /^live-entry:([A-Z0-9]+):/.exec(intentId ?? '')?.[1] ?? null;
}

/** Real account state is null (not an all-zero object) until the live
 * ledger has ever been initialized — e.g. the stocks state file, which
 * carries no 'live:' keys at all, must not render an empty "€0.00" real
 * account that never existed. */
function parseLiveAccountState(raw: RawState): LiveAccountState | null {
  const cash = raw['live:live-cash-eur'];
  if (typeof cash !== 'number') return null;
  const rawPositions = raw['live:live-open-positions'];
  const positions: LiveOpenPosition[] = rawPositions
    ? Object.values(rawPositions).map((p) => ({
        symbol: p.entryAssessment?.asset ?? p.symbol ?? '',
        quantity: p.quantity ?? 0,
        entryPrice: p.entryPrice ?? 0,
        stopLoss: p.stopLoss ?? 0,
        takeProfit: p.takeProfit ?? 0,
        openedAt: p.openedAt ?? 0,
      }))
    : [];
  const killSwitch = raw['live:kill-switch'];
  const recentEvents = (raw['live:audit-log'] ?? [])
    .filter((e) => e.event === 'filled' || e.event === 'rejected')
    .map((e) => ({
      at: e.timestamp ?? 0,
      event: e.event ?? '',
      detail: tidyNoteNumbers(e.detail ?? ''),
      symbol: parseLiveEntrySymbol(e.intentId),
    }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  return {
    cash,
    positions,
    killSwitchEngaged: killSwitch?.engaged === true,
    killSwitchReason: killSwitch?.reason ?? null,
    recentEvents,
    externalBtcQuantity: raw['live:live-external-btc-qty'] ?? 0,
    equityHistory: Array.isArray(raw['live:live-equity-history']) ? raw['live:live-equity-history'] : [],
  };
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
    note: match[5] ? tidyNoteNumbers(match[5]) : null,
  };
}

export async function fetchCloudState(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
  stateUrl: string = STATE_URL,
): Promise<CloudState | null> {
  // One automatic retry: a single transient failure no longer flashes
  // "couldn't reach the cloud agent" on the value/history pages.
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await fetchCloudStateOnce(fetchFn, stateUrl);
    if (state) return state;
  }
  return null;
}

/** Same shape, the separate stocks agent's state file. */
export async function fetchStocksState(
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<CloudState | null> {
  return fetchCloudState(fetchFn, STOCKS_STATE_URL);
}

async function fetchCloudStateOnce(fetchFn: typeof fetch, stateUrl: string): Promise<CloudState | null> {
  try {
    const response = await fetchFn(`${stateUrl}?t=${Date.now()}`, { cache: 'no-store' });
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
    const rawReadiness = raw['real-money-readiness'];
    const readiness: CloudReadiness | null =
      rawReadiness && typeof rawReadiness.ready === 'boolean'
        ? {
            ready: rawReadiness.ready,
            summary: rawReadiness.summary ?? '',
            criteria: (rawReadiness.criteria ?? []).map((c) => ({
              key: c.key ?? '',
              ok: c.ok === true,
              detail: c.detail ?? '',
            })),
          }
        : null;
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
      readiness,
      marketSnapshot: (raw['market-snapshot']?.symbols ?? [])
        .filter(
          (s): s is { symbol: string; price: number; changePct: number; updatedAt: number } =>
            typeof s.symbol === 'string' && typeof s.price === 'number' && typeof s.changePct === 'number' &&
            typeof s.updatedAt === 'number',
        ),
      shadowStandings: (raw['shadow-standings']?.standings ?? [])
        .filter(
          (s): s is Required<Pick<NonNullable<typeof s>, 'key' | 'label' | 'equity' | 'returnPct' | 'trades' | 'openPositions' | 'startedAt'>> & { winRatePct?: number | null; profitFactor?: number | null } =>
            typeof s.key === 'string' && typeof s.label === 'string' && typeof s.equity === 'number' &&
            typeof s.returnPct === 'number' && typeof s.trades === 'number' && typeof s.openPositions === 'number' &&
            typeof s.startedAt === 'number',
        )
        .map((s) => ({
          key: s.key,
          label: s.label,
          equity: s.equity,
          returnPct: s.returnPct,
          trades: s.trades,
          winRatePct: typeof s.winRatePct === 'number' ? s.winRatePct : null,
          profitFactor: typeof s.profitFactor === 'number' ? s.profitFactor : null,
          openPositions: s.openPositions,
          startedAt: s.startedAt,
        })),
      live: parseLiveAccountState(raw),
    };
  } catch {
    return null;
  }
}
