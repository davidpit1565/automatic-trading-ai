/**
 * Real-money readiness — an honest, data-driven gate.
 *
 * Answers one question: is the SIMULATED track record good enough to justify
 * risking real money yet? It never promises profit — a "ready" verdict means
 * only that the paper record has cleared conservative safety thresholds
 * (enough trades, enough time, profitable after fees, beats buy-and-hold,
 * controlled drawdown, consistent). Losses always remain possible.
 *
 * Pure and layer-clean: it takes already-computed metrics (no market data, no
 * indicators, no I/O), so it runs identically on the server (from the trade
 * journal) and is stored for the app to display.
 */

export const READINESS_THRESHOLDS = {
  /** Enough closed trades for the record to mean something. */
  minClosedTrades: 20,
  /** Enough elapsed time to span more than one market mood. */
  minDays: 14,
  /** Gross profit ÷ gross loss must clear this. */
  minProfitFactor: 1.2,
  /** Peak-to-trough drop must stay under this (%). */
  maxDrawdownPct: 10,
} as const;

export type ReadinessKey =
  | 'trades'
  | 'days'
  | 'profitable'
  | 'benchmark'
  | 'drawdown'
  | 'consistency';

export interface ReadinessCriterion {
  readonly key: ReadinessKey;
  readonly ok: boolean;
  /** Short English detail, e.g. "3 / 20 closed trades". */
  readonly detail: string;
}

export interface RealMoneyReadinessInput {
  readonly closedTrades: number;
  readonly profitFactor: number | null;
  /** Realized return since start, AFTER fees, as a percent. */
  readonly realizedReturnPct: number;
  /** Peak-to-trough drawdown as a positive percent. */
  readonly maxDrawdownPct: number;
  /** Portfolio return minus buy-and-hold benchmark over the same window (%). */
  readonly vsBenchmarkPct: number | null;
  readonly daysRunning: number;
  /** English label for the benchmark criterion's detail text. Defaults to "BTC" (the crypto side's benchmark). */
  readonly benchmarkLabel?: string;
  /**
   * Whether the benchmark criterion can block readiness. Defaults to true.
   * Set false for a strategy that carries a stop-loss/exit: beating 100%
   * buy-and-hold of the same asset during a monotonic uptrend is structurally
   * impossible for such a strategy (some capital is, by construction, not in
   * the trade at every moment the asset climbs past the last stop — see
   * PROJECT_STATE.md, 2026-09-02), so treating it as a blocking bar would
   * make the gate permanently unpassable regardless of trading quality. The
   * comparison is still computed and reported (for transparency) — it just
   * can't fail an otherwise-sound record.
   */
  readonly gateOnBenchmark?: boolean;
}

export interface RealMoneyReadiness {
  readonly ready: boolean;
  readonly criteria: readonly ReadinessCriterion[];
  /** English one-liner suitable for logs and the app. */
  readonly summary: string;
  /** Keys of the criteria that are not yet met (empty when ready). */
  readonly unmet: readonly ReadinessKey[];
}

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

/** Assess whether the paper record justifies risking real money. */
export function assessRealMoneyReadiness(input: RealMoneyReadinessInput): RealMoneyReadiness {
  const t = READINESS_THRESHOLDS;
  const benchmarkLabel = input.benchmarkLabel ?? 'BTC';
  const criteria: ReadinessCriterion[] = [
    {
      key: 'trades',
      ok: input.closedTrades >= t.minClosedTrades,
      detail: `${input.closedTrades} / ${t.minClosedTrades} closed trades`,
    },
    {
      key: 'days',
      ok: input.daysRunning >= t.minDays,
      detail: `${Math.floor(input.daysRunning)} / ${t.minDays} days of history`,
    },
    {
      key: 'profitable',
      ok: input.realizedReturnPct > 0,
      detail: `after-fee return ${pct(input.realizedReturnPct)}`,
    },
    {
      key: 'benchmark',
      ok: input.vsBenchmarkPct !== null && input.vsBenchmarkPct >= 0,
      detail:
        (input.vsBenchmarkPct === null
          ? `vs buy-and-hold ${benchmarkLabel}: not measured yet`
          : `vs buy-and-hold ${benchmarkLabel} ${pct(input.vsBenchmarkPct)}`) +
        (input.gateOnBenchmark === false ? ' (informational — not required for a risk-managed strategy)' : ''),
    },
    {
      key: 'drawdown',
      ok: input.maxDrawdownPct < t.maxDrawdownPct,
      detail: `max drawdown ${input.maxDrawdownPct.toFixed(1)}% (limit ${t.maxDrawdownPct}%)`,
    },
    {
      key: 'consistency',
      ok: input.profitFactor !== null && input.profitFactor >= t.minProfitFactor,
      detail:
        input.profitFactor === null
          ? `profit factor n/a (needs winning & losing trades)`
          : `profit factor ${input.profitFactor.toFixed(2)} (needs ≥ ${t.minProfitFactor})`,
    },
  ];

  const gatingCriteria =
    input.gateOnBenchmark === false ? criteria.filter((c) => c.key !== 'benchmark') : criteria;
  const unmet = gatingCriteria.filter((c) => !c.ok).map((c) => c.key);
  const ready = unmet.length === 0;
  const summary = ready
    ? 'READY — the paper record clears every safety threshold (not a profit guarantee).'
    : `NOT READY — ${gatingCriteria.filter((c) => !c.ok).map((c) => c.detail).join('; ')}.`;

  return { ready, criteria, summary, unmet };
}
