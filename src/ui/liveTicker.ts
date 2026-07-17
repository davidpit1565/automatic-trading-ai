/**
 * Near-real-time price feed for the open coin detail.
 *
 * Baseline (always on): a fast poll of the active data source for the latest
 * 1-minute candle close, every few seconds. This is reliable everywhere and
 * needs no extra endpoints — the in-progress candle's close is the live price.
 *
 * Upgrade (best-effort, public Kraken only): a Kraken WebSocket ticker
 * subscription that pushes the last trade price sub-second. It is fully
 * guarded — any failure (blocked socket, unexpected message, wrong pair) is
 * swallowed and the poll keeps the price fresh. The socket is always closed
 * when the feed stops, so nothing leaks between coins.
 *
 * Presentation-only: no orders, no core changes. SIMULATED money unchanged.
 */

import type { ActiveDataSource } from './dataSource';

export interface LiveTick {
  readonly price: number;
  /** Epoch ms of the observation. */
  readonly at: number;
}

/** Kraken WebSocket uses a few legacy asset codes that differ from ours. */
const KRAKEN_WS_ALIAS: Record<string, string> = { BTC: 'XBT', DOGE: 'XDG' };

/** Build Kraken's `BASE/QUOTE` ws pair name from an instrument, or null. */
function krakenWsPair(data: ActiveDataSource, symbol: string): string | null {
  const inst = data.instruments.find((i) => i.symbol === symbol);
  if (!inst) return null;
  const base = KRAKEN_WS_ALIAS[inst.base.toUpperCase()] ?? inst.base.toUpperCase();
  return `${base}/${inst.quote.toUpperCase()}`;
}

/**
 * Start a live price feed for `symbol`. Calls `onTick` with every fresh price.
 * Returns a stop() function — call it when leaving the coin/detail.
 */
export function startLivePrice(
  data: ActiveDataSource,
  symbol: string,
  onTick: (tick: LiveTick) => void,
  opts: { pollMs?: number } = {},
): () => void {
  const pollMs = opts.pollMs ?? 3000;
  let stopped = false;
  let socket: WebSocket | null = null;
  let pollTimer = 0;

  const emit = (price: number, at: number): void => {
    if (!stopped && Number.isFinite(price) && price > 0) onTick({ price, at });
  };

  // --- Baseline: poll the data source for the latest close. ---
  const poll = async (): Promise<void> => {
    if (stopped) return;
    try {
      const candles = await data.source.getCandles(symbol, '1m', 2);
      if (candles.ok && candles.value.length > 0) {
        const last = candles.value[candles.value.length - 1]!;
        emit(last.close, last.timestamp);
      }
    } catch {
      /* transient network hiccup — the next tick retries */
    }
  };
  void poll();
  pollTimer = window.setInterval(() => void poll(), pollMs);

  // --- Upgrade: Kraken WebSocket ticker (best-effort, never throws). ---
  // Only when the live source IS Kraken — its ws pair names and prices then
  // match our instruments. Any other source just uses the reliable poll.
  const isKraken = /kraken/i.test(data.source.name);
  if (data.kind === 'public' && isKraken && typeof WebSocket !== 'undefined') {
    const pair = krakenWsPair(data, symbol);
    if (pair) {
      try {
        socket = new WebSocket('wss://ws.kraken.com');
        socket.addEventListener('open', () => {
          try {
            socket?.send(
              JSON.stringify({ event: 'subscribe', pair: [pair], subscription: { name: 'ticker' } }),
            );
          } catch {
            /* ignore — poll still runs */
          }
        });
        socket.addEventListener('message', (ev: MessageEvent) => {
          try {
            const msg = JSON.parse(String(ev.data)) as unknown;
            // Ticker payload: [channelID, { c: [lastPrice, lotVol], ... }, "ticker", pair]
            if (Array.isArray(msg) && msg[2] === 'ticker') {
              const body = msg[1] as { c?: unknown } | undefined;
              const c = body?.c;
              if (Array.isArray(c) && c.length > 0) {
                const price = Number(c[0]);
                emit(price, Date.now());
              }
            }
          } catch {
            /* malformed frame — ignore, poll covers us */
          }
        });
        // Errors are non-fatal: the poll baseline keeps the price fresh.
        socket.addEventListener('error', () => {});
      } catch {
        socket = null;
      }
    }
  }

  return function stop(): void {
    stopped = true;
    window.clearInterval(pollTimer);
    if (socket) {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      socket = null;
    }
  };
}
