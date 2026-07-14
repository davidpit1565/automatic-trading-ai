/**
 * Overfitting detection — Stage 3.5.
 *
 * Inspects walk-forward results and flags the classic failure modes. A
 * strategy that fails these checks is flagged automatically; refusing to
 * trust a fragile backtest is the harness succeeding, not failing.
 *
 * Thresholds are named constants, documented in place.
 */

export type RobustnessFlagKind =
  | 'degradation'
  | 'curve-fitting'
  | 'parameter-sensitivity'
  | 'unrealistic-win-rate'
  | 'small-sample';

export interface RobustnessFlag {
  readonly kind: RobustnessFlagKind;
  readonly detail: string;
}

export type RobustnessVerdict = 'robust' | 'caution' | 'overfitted' | 'insufficient-data';

export interface RobustnessInput {
  readonly avgTrainReturnPct: number;
  readonly avgTestReturnPct: number;
  readonly avgTrainSharpe: number | null;
  readonly avgTestSharpe: number | null;
  readonly totalTestTrades: number;
  readonly foldCount: number;
  readonly avgTestWinRatePct: number | null;
  /** Chosen candidate vs median of the optimisation grid (when optimising). */
  readonly parameterSpread?: {
    readonly chosenReturnPct: number;
    readonly medianReturnPct: number;
  };
}

export interface RobustnessAssessment {
  readonly flags: RobustnessFlag[];
  readonly verdict: RobustnessVerdict;
  readonly explanation: string;
}

/** Minimum out-of-sample trades for statistics to mean anything. */
const MIN_TEST_TRADES = 20;
/** Minimum folds for a walk-forward result to be taken seriously. */
const MIN_FOLDS = 3;
/** OOS return below this share of IS return counts as degradation. */
const DEGRADATION_SURVIVAL_RATIO = 0.5;
/** Win rates above this (with sample) are treated as too good to trust. */
const UNREALISTIC_WIN_RATE_PCT = 90;
/** Chosen-vs-median grid advantage beyond this gap flags sensitivity. */
const SENSITIVITY_GAP_PCT = 10;

export function assessRobustness(input: RobustnessInput): RobustnessAssessment {
  const flags: RobustnessFlag[] = [];

  // Small samples first — they undermine every other statistic.
  if (input.totalTestTrades < MIN_TEST_TRADES) {
    flags.push({
      kind: 'small-sample',
      detail:
        `only ${input.totalTestTrades} out-of-sample trades (minimum ${MIN_TEST_TRADES}) — ` +
        `results this small are dominated by luck, not edge`,
    });
  }
  if (input.foldCount < MIN_FOLDS) {
    flags.push({
      kind: 'small-sample',
      detail: `only ${input.foldCount} walk-forward folds (minimum ${MIN_FOLDS}) — not enough distinct market periods`,
    });
  }

  // Curve fitting: in-sample profits that disappear (or invert) out of sample.
  const isProfitableInSample = input.avgTrainReturnPct > 0;
  if (isProfitableInSample && input.avgTestReturnPct <= 0) {
    flags.push({
      kind: 'curve-fitting',
      detail:
        `in-sample return ${input.avgTrainReturnPct.toFixed(1)}% became ` +
        `${input.avgTestReturnPct.toFixed(1)}% on unseen data — the strategy fit the ` +
        `training history, not the market`,
    });
  } else if (
    isProfitableInSample &&
    input.avgTestReturnPct < input.avgTrainReturnPct * DEGRADATION_SURVIVAL_RATIO
  ) {
    flags.push({
      kind: 'degradation',
      detail:
        `out-of-sample return ${input.avgTestReturnPct.toFixed(1)}% keeps less than ` +
        `${(DEGRADATION_SURVIVAL_RATIO * 100).toFixed(0)}% of the in-sample ` +
        `${input.avgTrainReturnPct.toFixed(1)}% — expect live results closer to the lower number`,
    });
  }
  if (
    input.avgTrainSharpe !== null &&
    input.avgTestSharpe !== null &&
    input.avgTrainSharpe > 1 &&
    input.avgTestSharpe <= 0
  ) {
    flags.push({
      kind: 'curve-fitting',
      detail:
        `risk-adjusted quality collapsed: Sharpe ${input.avgTrainSharpe.toFixed(2)} in training ` +
        `vs ${input.avgTestSharpe.toFixed(2)} on unseen data`,
    });
  }

  // Parameter sensitivity: the chosen grid point towers over the median.
  if (input.parameterSpread) {
    const { chosenReturnPct, medianReturnPct } = input.parameterSpread;
    if (chosenReturnPct - medianReturnPct > SENSITIVITY_GAP_PCT) {
      flags.push({
        kind: 'parameter-sensitivity',
        detail:
          `the chosen parameters returned ${chosenReturnPct.toFixed(1)}% while the median ` +
          `candidate returned ${medianReturnPct.toFixed(1)}% — performance depends heavily ` +
          `on one lucky setting, a hallmark of curve fitting`,
      });
    }
  }

  // Unrealistic win rates (only meaningful with a sample behind them).
  if (
    input.avgTestWinRatePct !== null &&
    input.avgTestWinRatePct > UNREALISTIC_WIN_RATE_PCT &&
    input.totalTestTrades >= MIN_TEST_TRADES
  ) {
    flags.push({
      kind: 'unrealistic-win-rate',
      detail:
        `${input.avgTestWinRatePct.toFixed(0)}% win rate is above the ${UNREALISTIC_WIN_RATE_PCT}% ` +
        `plausibility ceiling — usually a sign of look-ahead bias, survivorship, or tiny targets ` +
        `hiding rare large losses`,
    });
  }

  const verdict = decideVerdict(flags);
  return { flags, verdict, explanation: explain(verdict, flags, input) };
}

function decideVerdict(flags: RobustnessFlag[]): RobustnessVerdict {
  if (flags.some((f) => f.kind === 'small-sample')) return 'insufficient-data';
  if (flags.some((f) => f.kind === 'curve-fitting')) return 'overfitted';
  const softFlags = flags.length;
  if (softFlags >= 2) return 'caution';
  if (softFlags === 1) return 'caution';
  return 'robust';
}

function explain(
  verdict: RobustnessVerdict,
  flags: RobustnessFlag[],
  input: RobustnessInput,
): string {
  const summary =
    `Across ${input.foldCount} walk-forward folds the strategy averaged ` +
    `${input.avgTrainReturnPct.toFixed(1)}% in training and ` +
    `${input.avgTestReturnPct.toFixed(1)}% on unseen data over ` +
    `${input.totalTestTrades} out-of-sample trades.`;
  switch (verdict) {
    case 'robust':
      return (
        `${summary} No robustness checks were triggered. This raises confidence that the ` +
        `edge is real, but past performance on any data never guarantees future results.`
      );
    case 'caution':
      return `${summary} ${flags.length} check(s) were triggered — treat the in-sample numbers with scepticism and prefer the out-of-sample figures.`;
    case 'overfitted':
      return `${summary} The pattern matches curve fitting: performance found in training did not exist on unseen data. This configuration should not be trusted.`;
    case 'insufficient-data':
      return `${summary} There is not enough out-of-sample evidence to judge this strategy either way — more data or a longer test period is needed before drawing any conclusion.`;
  }
}
