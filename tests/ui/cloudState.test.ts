/**
 * Tests for the cloud-state reader — the layer that turns the agent's committed
 * state file into what the app shows. Previously untested, which is how raw
 * 17-digit floats reached the History list in production.
 */

import { describe, expect, it, vi } from 'vitest';
import { fetchCloudState, fetchStocksState, tidyNoteNumbers, STOCKS_STATE_URL } from '../../src/ui/cloudState';

/** A state file shaped exactly like the ones the runners commit. */
function stateFile(auditDetails: string[]): string {
  return JSON.stringify({
    'portfolio-engine': { cash: 7998, initialCash: 10_000, baseCurrency: 'USD' },
    'open-positions': [{ symbol: 'V', quantity: 5.373310765428119, entryPrice: 372.21, openedAt: 1785344321660 }],
    'audit-log': auditDetails.map((detail, i) => ({ timestamp: 1785344321660 + i, event: 'filled', detail })),
    'autopilot-last-run': { at: 1785344321660 },
    'equity-history': [{ at: 1785344321660, equity: 9998 }],
  });
}

const okFetch = (body: string): typeof fetch =>
  vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

describe('tidyNoteNumbers', () => {
  it('rounds the long floats an entry note carries', () => {
    expect(tidyNoteNumbers('stop 365.69091538956104, target 385.24816922087786, confidence 31')).toBe(
      'stop 365.69, target 385.25, confidence 31',
    );
  });

  it('keeps significant digits on sub-1 crypto levels instead of flattening them', () => {
    // 0.0635... must not become "0.06" — that loses the level entirely.
    const tidied = tidyNoteNumbers('stop 0.06356005875727756, target 0.06592328248544485, confidence 40');
    expect(tidied).toBe('stop 0.06356, target 0.06592, confidence 40');
    expect(tidied).not.toContain('0.06,');
  });

  it('leaves non-numeric exit reasons untouched', () => {
    expect(tidyNoteNumbers('stop-loss')).toBe('stop-loss');
    expect(tidyNoteNumbers('take-profit')).toBe('take-profit');
  });

  it('leaves already-short numbers alone', () => {
    expect(tidyNoteNumbers('confidence 31, adx 22.5')).toBe('confidence 31, adx 22.5');
  });
});

describe('fetchCloudState', () => {
  it('parses a stocks entry, including a one-character ticker', async () => {
    const state = await fetchCloudState(
      okFetch(stateFile(['paper entry V: 5.373310765428119 @ 372.21 (stop 365.69091538956104, target 385.24816922087786, confidence 31)'])),
    );

    expect(state).not.toBeNull();
    expect(state!.baseCurrency).toBe('USD');
    expect(state!.positions).toHaveLength(1);
    expect(state!.positions[0]!.symbol).toBe('V');
    const trade = state!.history[0]!;
    expect(trade.kind).toBe('buy');
    expect(trade.symbol).toBe('V');
    expect(trade.price).toBe(372.21);
    // The note reaching the UI is rounded, not raw float noise.
    expect(trade.note).toBe('stop 365.69, target 385.25, confidence 31');
  });

  it('parses an exit and marks it a sell', async () => {
    const state = await fetchCloudState(okFetch(stateFile(['paper exit DOTEUR: 2629.060537225495 @ 0.7202 (stop-loss)'])));
    expect(state!.history[0]!.kind).toBe('sell');
    expect(state!.history[0]!.note).toBe('stop-loss');
  });

  it('orders history newest-first', async () => {
    const state = await fetchCloudState(
      okFetch(stateFile([
        'paper entry AAA: 1 @ 10 (stop-loss)',
        'paper entry BBB: 1 @ 11 (stop-loss)',
      ])),
    );
    expect(state!.history.map((t) => t.symbol)).toEqual(['BBB', 'AAA']);
  });

  it('drops audit lines it cannot parse rather than throwing', async () => {
    const state = await fetchCloudState(okFetch(stateFile(['halted: daily loss limit reached'])));
    expect(state!.history).toEqual([]);
  });

  it('returns null on a failed fetch instead of breaking the view', async () => {
    const failing = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchCloudState(failing)).toBeNull();
    // Two attempts: one transient failure must not flash an error at the user.
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe('market-snapshot parsing', () => {
  it('parses a well-formed snapshot', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'market-snapshot': { at: 1, symbols: [{ symbol: 'AAPL', price: 210.5, changePct: 1.2, updatedAt: 1 }] },
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.marketSnapshot).toEqual([{ symbol: 'AAPL', price: 210.5, changePct: 1.2, updatedAt: 1 }]);
  });

  it('drops malformed entries and defaults to empty when the field is absent', async () => {
    const withMalformed = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'market-snapshot': { symbols: [{ symbol: 'AAPL', price: 'not a number' }] },
    });
    expect((await fetchCloudState(okFetch(withMalformed)))!.marketSnapshot).toEqual([]);
    expect((await fetchCloudState(okFetch(stateFile([]))))!.marketSnapshot).toEqual([]);
  });
});

describe('benchmark-result parsing', () => {
  it('parses the precomputed agent-vs-buy-and-hold comparison the stocks runner writes', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'benchmark-result': { label: 'S&P 500 (SPY)', portfolioPct: 0.6277077892764502, assetPct: 0.9005468775583718 },
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.benchmarkResult).toEqual({
      label: 'S&P 500 (SPY)',
      portfolioPct: 0.6277077892764502,
      assetPct: 0.9005468775583718,
    });
  });

  it('defaults to null when the field is absent (crypto) or malformed', async () => {
    expect((await fetchCloudState(okFetch(stateFile([]))))!.benchmarkResult).toBeNull();
    const malformed = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'benchmark-result': { label: 'S&P 500 (SPY)', portfolioPct: 'not a number' },
    });
    expect((await fetchCloudState(okFetch(malformed)))!.benchmarkResult).toBeNull();
  });
});

describe('real-money-readiness parsing (2026-09-06 readiness/kill-switch audit)', () => {
  it('parses `unmet` — needed to tell a genuinely-blocking criterion apart from an informational one that also reads !ok', async () => {
    // Shaped exactly like the real committed state/stocks-state.json: two
    // criteria are !ok but informational-only (trades/consistency, for a
    // hold-only strategy), only "benchmark" actually blocks readiness.
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'real-money-readiness': {
        ready: false,
        summary: 'NOT READY — vs buy-and-hold S&P 500 (SPY) -0.27%.',
        criteria: [
          { key: 'trades', ok: false, detail: '11 / 20 closed trades (informational)' },
          { key: 'benchmark', ok: false, detail: 'vs buy-and-hold S&P 500 (SPY) -0.27%' },
          { key: 'consistency', ok: false, detail: 'profit factor 1.17 (informational)' },
        ],
        unmet: ['benchmark'],
      },
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.readiness!.unmet).toEqual(['benchmark']);
  });

  it('defaults `unmet` to an empty array when there are no criteria and the field is absent, rather than crashing', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'real-money-readiness': { ready: true, summary: 'READY', criteria: [] },
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.readiness!.unmet).toEqual([]);
  });

  it('falls back to treating every !ok criterion as blocking when `unmet` itself is absent (old/malformed state) — never silently demotes a real blocker to "just informational"', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'real-money-readiness': {
        ready: false,
        summary: 'NOT READY',
        criteria: [
          { key: 'trades', ok: false, detail: '1 / 20 closed trades' },
          { key: 'days', ok: true, detail: '20 / 14 days of history' },
        ],
        // no `unmet` field at all
      },
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.readiness!.unmet).toEqual(['trades']);
  });
});

describe('shadow-standings parsing', () => {
  it('parses a well-formed standing, defaulting missing winRatePct/profitFactor to null', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'shadow-standings': {
        at: 1,
        standings: [
          { key: 'long-term', label: 'Long-term investing', equity: 10_500, returnPct: 5, trades: 3, openPositions: 1, startedAt: 0 },
        ],
      },
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.shadowStandings).toEqual([
      { key: 'long-term', label: 'Long-term investing', equity: 10_500, returnPct: 5, trades: 3, winRatePct: null, profitFactor: null, openPositions: 1, startedAt: 0 },
    ]);
  });

  it('drops malformed entries and defaults to empty when the field is absent', async () => {
    const withMalformed = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'shadow-standings': { standings: [{ key: 'long-term', equity: 'not a number' }] },
    });
    expect((await fetchCloudState(okFetch(withMalformed)))!.shadowStandings).toEqual([]);
    expect((await fetchCloudState(okFetch(stateFile([]))))!.shadowStandings).toEqual([]);
  });
});

describe('live account state parsing (the real Revolut X account, separate from the simulated one above)', () => {
  it('is null when the live ledger has never been initialized (e.g. the stocks state file)', async () => {
    const state = await fetchCloudState(okFetch(stateFile([])));
    expect(state!.live).toBeNull();
  });

  it('parses cash, open positions (by internal symbol from entryAssessment.asset), kill-switch state, and recent real trade outcomes', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'live:live-cash-eur': 100.15,
      'live:live-open-positions': {
        'live-entry:XBTEUR': {
          symbol: 'BTC/EUR',
          quantity: 0.001,
          entryPrice: 95_000,
          stopLoss: 90_000,
          takeProfit: 105_000,
          openedAt: 1_000,
          entryAssessment: { asset: 'XBTEUR' },
        },
      },
      'live:kill-switch': { engaged: true, reason: 'network failure before a response was received' },
      'live:audit-log': [
        { timestamp: 2_000, event: 'awaiting-confirmation', detail: 'confirmation request sent to Telegram' },
        {
          timestamp: 3_000,
          event: 'rejected',
          detail: "Revolut X rejected the order: HTTP 400 — Invalid client order ID",
          intentId: 'live-entry:DOTEUR:1788602254561',
        },
      ],
      'live:live-external-btc-qty': 0.00075,
      'live:live-equity-history': [{ at: 4_000, equity: 150.42 }],
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.live).toEqual({
      cash: 100.15,
      positions: [{ symbol: 'XBTEUR', quantity: 0.001, entryPrice: 95_000, stopLoss: 90_000, takeProfit: 105_000, openedAt: 1_000 }],
      killSwitchEngaged: true,
      killSwitchReason: 'network failure before a response was received',
      // Only real outcome events (filled/rejected) — 'awaiting-confirmation' is excluded.
      // symbol is parsed from the entry's own intentId, for the real-activity
      // list's coin icon (see assetHubView.ts's renderRealActivity).
      recentEvents: [{
        at: 3_000,
        event: 'rejected',
        detail: "Revolut X rejected the order: HTTP 400 — Invalid client order ID",
        symbol: 'DOTEUR',
      }],
      externalBtcQuantity: 0.00075,
      equityHistory: [{ at: 4_000, equity: 150.42 }],
    });
  });

  it('falls back to a null symbol when the intent id carries no parseable one (e.g. a pre-trade verification failure or the kill switch)', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'live:live-cash-eur': 50,
      'live:audit-log': [
        { timestamp: 1_000, event: 'rejected', detail: "'USELESS/EUR' not found among tradable pairs", intentId: 'verify-symbol-exists' },
        { timestamp: 2_000, event: 'rejected', detail: 'kill switch engaged' }, // no intentId at all
      ],
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.live!.recentEvents.every((e) => e.symbol === null)).toBe(true);
  });

  it('defaults an absent kill-switch/positions/audit-log/external-btc/equity-history to a safe empty state, not a crash', async () => {
    const body = JSON.stringify({
      'portfolio-engine': { cash: 100, initialCash: 100, baseCurrency: 'USD' },
      'live:live-cash-eur': 50,
    });
    const state = await fetchCloudState(okFetch(body));
    expect(state!.live).toEqual({
      cash: 50,
      positions: [],
      killSwitchEngaged: false,
      killSwitchReason: null,
      recentEvents: [],
      externalBtcQuantity: 0,
      equityHistory: [],
    });
  });
});

describe('fetchStocksState', () => {
  it('reads the separate stocks state file, not the crypto one', async () => {
    const seen: string[] = [];
    const spy: typeof fetch = async (input) => {
      seen.push(String(input));
      return new Response(stateFile(['paper entry V: 1 @ 372.21 (stop-loss)']), { status: 200 });
    };
    await fetchStocksState(spy);
    expect(seen[0]).toContain(STOCKS_STATE_URL);
    expect(seen[0]).toContain('stocks-state.json');
  });
});
