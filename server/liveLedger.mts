/**
 * Local cash ledger for the real live account (2026-09-02).
 *
 * There is no `PortfolioEngine` for live money — that class is paper-only
 * (its whole job is simulating fills locally; a live fill is real and comes
 * from the broker). But sizing a live entry via `assessTrade` still needs
 * SOME notion of "current equity" for the real account, and Revolut X's
 * `fetchPositions()` reports raw balances with no cost basis (see
 * `revolutXBrokerAdapter.mts`) — not enough on its own to compute equity
 * against an entry price. This is the minimal, LOCAL equivalent of what
 * `PortfolioEngine` already does for paper: track cash starting from a
 * configured amount, debit/credit it on real fills, and derive equity as
 * cash + the mark-to-market value of tracked open positions
 * (`liveExitFlow.mts`'s `openLivePositions`).
 *
 * Deliberately NOT a full port of `PortfolioEngine` (no daily-return
 * anchor, no allocation breakdown, no journal) — the live account only
 * ever needs "how much can I safely risk right now," not the paper
 * account's full reporting surface.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { BrokerAdapter } from '../src/core/execution/types';
import { openLivePositions } from './liveExitFlow.mts';

const LIVE_CASH_KEY = 'live-cash-eur';
const LIVE_EXTERNAL_BTC_KEY = 'live-external-btc-qty';
const LIVE_EQUITY_HISTORY_KEY = 'live-equity-history';
const LIVE_EQUITY_HISTORY_CAP = 5000; // matches the paper account's own EQUITY_HISTORY_CAP

/** Sets the starting cash ONLY if this ledger has never been initialized —
 * safe to call every cycle without ever resetting a real, already-moving
 * balance back to the starting figure. */
export function initLiveCash(store: KeyValueStore, startingCash: number): void {
  if (!(startingCash > 0)) throw new RangeError(`startingCash must be > 0, got ${startingCash}`);
  if (store.get<number>(LIVE_CASH_KEY) === undefined) store.set(LIVE_CASH_KEY, startingCash);
}

export function liveCash(store: KeyValueStore): number {
  return store.get<number>(LIVE_CASH_KEY) ?? 0;
}

/** True once the live ledger has ever been initialized — distinguishes "no
 * live account at all" (real money never enabled) from a genuine €0
 * balance, mirroring the UI's own `parseLiveAccountState` convention
 * (`src/ui/cloudState.ts`). */
export function hasLiveAccount(store: KeyValueStore): boolean {
  return store.get<number>(LIVE_CASH_KEY) !== undefined;
}

/**
 * Overwrites the tracked cash figure with Revolut X's own real EUR balance —
 * the broker is the only genuine source of truth for real money, and this
 * project's local debit/credit bookkeeping had never once been checked
 * against it. Real incident (2026-09-03): the tracker said €100.15 while the
 * real account had €0.11 available — nothing had ever reconciled the two,
 * so every live entry all night was sized against a fictional balance.
 *
 * Call this at the START of every live cycle, before any entry is sized —
 * self-heals any drift (a manual trade on the Revolut X app, an untracked
 * fee, a missed fill) instead of requiring a human to report the true
 * number by hand. No-ops (keeps the last-known value) on a fetch failure,
 * rather than zeroing out real cash on a transient network hiccup.
 */
export async function syncLiveCashFromBroker(store: KeyValueStore, brokerAdapter: BrokerAdapter): Promise<void> {
  let positions: Awaited<ReturnType<BrokerAdapter['fetchPositions']>>;
  try {
    positions = await brokerAdapter.fetchPositions();
  } catch {
    return; // network failure — keep the last-known value, don't zero out real cash
  }
  const eur = positions.find((p) => p.symbol === 'EUR');
  if (eur) store.set(LIVE_CASH_KEY, eur.quantity);
}

/** Call the moment a live BUY genuinely fills (see `recordLiveEntryFill`) —
 * `amount` is the real cost (fill price × filled quantity + fee). */
export function debitLiveCash(store: KeyValueStore, amount: number): void {
  store.set(LIVE_CASH_KEY, liveCash(store) - amount);
}

/** Call the moment a live SELL genuinely fills — `amount` is the real
 * proceeds (fill price × filled quantity − fee). */
export function creditLiveCash(store: KeyValueStore, amount: number): void {
  store.set(LIVE_CASH_KEY, liveCash(store) + amount);
}

/**
 * Reconciles the BTC balance sitting in the real Revolut X account OUTSIDE
 * the bot's own tracked positions — David converted EUR to BTC manually
 * while moving money into the account (2026-09-03), then sold part of it
 * back to EUR himself, keeping the rest as a personal holding the bot never
 * opened. REPORTING ONLY: this never feeds `liveEquity()` (used to size a
 * live entry's risk) — the bot must keep sizing trades against real spendable
 * cash, not a BTC holding it can't itself deploy. Same no-op-on-failure
 * safety as `syncLiveCashFromBroker`.
 */
export async function syncLiveExternalBtc(store: KeyValueStore, brokerAdapter: BrokerAdapter): Promise<void> {
  let positions: Awaited<ReturnType<BrokerAdapter['fetchPositions']>>;
  try {
    positions = await brokerAdapter.fetchPositions();
  } catch {
    return;
  }
  const btc = positions.find((p) => p.symbol === 'BTC');
  // `fetchPositions` reports the ENTIRE broker-side BTC balance — once the
  // bot itself holds a live BTC position, that quantity is already part of
  // this same total (real incident, 2026-09-03: after the first live
  // XBTEUR fill, this raw balance silently absorbed the bot's own tracked
  // position, double-counting its value in `recordLiveEquity`'s chart —
  // once via `liveEquity()`'s invested sum, again via this "untracked"
  // figure). Subtract whatever the bot itself currently tracks so this
  // stays what it's documented to be: the personal holding the bot never
  // opened.
  const trackedBtc = openLivePositions(store)
    .filter((p) => p.symbol.split(/[/-]/)[0] === 'BTC')
    .reduce((sum, p) => sum + p.quantity, 0);
  store.set(LIVE_EXTERNAL_BTC_KEY, Math.max(0, (btc?.quantity ?? 0) - trackedBtc));
}

export function liveExternalBtcQuantity(store: KeyValueStore): number {
  return store.get<number>(LIVE_EXTERNAL_BTC_KEY) ?? 0;
}

/**
 * Appends one point to the real account's OWN equity history — cash +
 * tracked positions (`liveEquity`) + the untracked BTC holding above, valued
 * at the current XBTEUR price — so the app can chart the real account's
 * total value over time, same as it already does for the simulated
 * portfolio (`autopilotRunner.mts`'s `recordEquity`/`EQUITY_HISTORY_KEY`).
 * Reporting only; does not affect trade sizing.
 */
export function recordLiveEquity(
  store: KeyValueStore,
  prices: Readonly<Record<string, number>>,
  now: number,
): void {
  const btcValue = liveExternalBtcQuantity(store) * (prices['XBTEUR'] ?? 0);
  const equity = liveEquity(store, prices) + btcValue;
  const history = store.get<Array<{ at: number; equity: number }>>(LIVE_EQUITY_HISTORY_KEY) ?? [];
  history.push({ at: now, equity: Math.round(equity * 100) / 100 });
  store.set(
    LIVE_EQUITY_HISTORY_KEY,
    history.length > LIVE_EQUITY_HISTORY_CAP ? history.slice(-LIVE_EQUITY_HISTORY_CAP) : history,
  );
}

/**
 * Cash plus the mark-to-market value of every tracked open live position.
 * `prices` is keyed by this project's INTERNAL instrument symbol (e.g.
 * 'XBTEUR', the same code `entryAssessment.asset` carries) — NOT the
 * broker-native pair symbol `LiveOpenPosition.symbol` holds. A position
 * with no current price available falls back to its own entry price
 * (same convention `PortfolioEngine.snapshot` already uses for paper).
 */
export function liveEquity(store: KeyValueStore, prices: Readonly<Record<string, number>>): number {
  const invested = openLivePositions(store).reduce((sum, position) => {
    const price = prices[position.entryAssessment.asset] ?? position.entryPrice;
    return sum + position.quantity * price;
  }, 0);
  return liveCash(store) + invested;
}
