/**
 * Overfitting detection tests (TDD).
 *
 * The robustness assessor inspects a walk-forward report and flags
 * degradation, parameter sensitivity, unrealistic win rates, and small
 * samples. Strategies failing checks are flagged automatically — a harsh
 * verdict is the harness working, not failing.
 */

import { describe, expect, it } from 'vitest';
import {
  assessRobustness,
  type RobustnessInput,
} from '../../src/core/validation/robustness';

function makeInput(overrides: Partial<RobustnessInput> = {}): RobustnessInput {
  return {
    avgTrainReturnPct: 10,
    avgTestReturnPct: 8,
    avgTrainSharpe: 1.2,
    avgTestSharpe: 1.0,
    totalTestTrades: 60,
    foldCount: 5,
    avgTestWinRatePct: 55,
    parameterSpread: { chosenReturnPct: 10, medianReturnPct: 8 },
    ...overrides,
  };
}

describe('assessRobustness', () => {
  it('passes a healthy strategy with no flags and a robust verdict', () => {
    const result = assessRobustness(makeInput());
    expect(result.flags).toEqual([]);
    expect(result.verdict).toBe('robust');
    expect(result.explanation.length).toBeGreaterThan(20);
  });

  it('flags performance degradation when out-of-sample collapses', () => {
    const result = assessRobustness(makeInput({ avgTrainReturnPct: 12, avgTestReturnPct: 1 }));
    expect(result.flags.some((f) => f.kind === 'degradation')).toBe(true);
  });

  it('flags curve fitting when in-sample profits vanish out of sample', () => {
    const result = assessRobustness(
      makeInput({ avgTrainReturnPct: 15, avgTestReturnPct: -4, avgTrainSharpe: 2, avgTestSharpe: -0.5 }),
    );
    expect(result.flags.some((f) => f.kind === 'curve-fitting')).toBe(true);
    expect(result.verdict).toBe('overfitted');
  });

  it('flags parameter sensitivity when the chosen candidate towers over the median', () => {
    const result = assessRobustness(
      makeInput({ parameterSpread: { chosenReturnPct: 20, medianReturnPct: 1 } }),
    );
    expect(result.flags.some((f) => f.kind === 'parameter-sensitivity')).toBe(true);
  });

  it('flags unrealistic win rates with a meaningful sample', () => {
    const result = assessRobustness(makeInput({ avgTestWinRatePct: 96, totalTestTrades: 60 }));
    expect(result.flags.some((f) => f.kind === 'unrealistic-win-rate')).toBe(true);
  });

  it('flags small samples and returns an insufficient-data verdict', () => {
    const fewTrades = assessRobustness(makeInput({ totalTestTrades: 5 }));
    expect(fewTrades.flags.some((f) => f.kind === 'small-sample')).toBe(true);
    expect(fewTrades.verdict).toBe('insufficient-data');

    const fewFolds = assessRobustness(makeInput({ foldCount: 2 }));
    expect(fewFolds.verdict).toBe('insufficient-data');
  });

  it('multiple soft flags escalate the verdict to caution', () => {
    const result = assessRobustness(
      makeInput({
        avgTrainReturnPct: 12,
        avgTestReturnPct: 3, // degradation but still positive
        avgTestWinRatePct: 96, // unrealistic
      }),
    );
    expect(result.flags.length).toBeGreaterThanOrEqual(2);
    expect(['caution', 'overfitted']).toContain(result.verdict);
  });

  it('every flag explains itself in plain language', () => {
    const result = assessRobustness(
      makeInput({
        avgTrainReturnPct: 15,
        avgTestReturnPct: -4,
        totalTestTrades: 5,
        avgTestWinRatePct: 97,
        parameterSpread: { chosenReturnPct: 20, medianReturnPct: 0.5 },
      }),
    );
    expect(result.flags.length).toBeGreaterThanOrEqual(3);
    for (const flag of result.flags) {
      expect(flag.detail.length).toBeGreaterThan(20);
    }
    expect(result.explanation).not.toMatch(/guaranteed|certain/i);
  });

  it('is deterministic', () => {
    const input = makeInput();
    expect(assessRobustness(input)).toEqual(assessRobustness(input));
  });
});
