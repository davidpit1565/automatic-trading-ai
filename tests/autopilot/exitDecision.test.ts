import { describe, expect, it } from 'vitest';
import { decideExit, type ExitCandidatePosition } from '../../src/core/autopilot/exitDecision';

function position(overrides: Partial<ExitCandidatePosition> = {}): ExitCandidatePosition {
  return {
    entryPrice: 100,
    stopLoss: 90,
    takeProfit: 120,
    highestPrice: 100,
    ...overrides,
  };
}

describe('decideExit', () => {
  it('returns null when the price is between the stop and the target', () => {
    expect(decideExit(position(), 105, [100, 102, 105], {})).toBeNull();
  });

  it('exits on stop-loss when price falls to or below the fixed stop', () => {
    expect(decideExit(position(), 90, [100, 95, 90], {})).toBe('stop-loss');
    expect(decideExit(position(), 85, [100, 95, 85], {})).toBe('stop-loss');
  });

  it('exits on take-profit when price rises to or above the fixed target', () => {
    expect(decideExit(position(), 120, [100, 110, 120], {})).toBe('take-profit');
  });

  it('trails the stop up as the trade runs, using the highest price seen', () => {
    const opts = { trailing: { activateR: 1, trailR: 1 } };
    // entry 100, stop 90 -> risk 10. Highest 130 -> run-up 30 >= activateR*risk(10) -> trail activates.
    // trailed = highest(130) - trailR(1)*risk(10) = 120; effective stop = max(90, entry 100, 120) = 120.
    const pos = position({ highestPrice: 130, takeProfit: 200 });
    expect(decideExit(pos, 121, [110, 125, 121], opts)).toBeNull();
    expect(decideExit(pos, 120, [110, 125, 120], opts)).toBe('stop-loss');
  });

  it('never trails the stop below the original fixed stop', () => {
    const opts = { trailing: { activateR: 1, trailR: 1 } };
    // Barely run up, trail not activated yet -> falls back to the original stop.
    expect(decideExit(position({ highestPrice: 102 }), 90, [100, 101, 90], opts)).toBe('stop-loss');
  });

  it('trend-exit fires when price closes below the EMA, and REPLACES the take-profit check entirely', () => {
    const opts = { trendExit: { emaPeriod: 3 } };
    // Rising closes -> EMA(3) trails below the current price -> no exit yet even near the fixed target.
    expect(decideExit(position(), 118, [100, 105, 110, 115, 118], opts)).toBeNull();
    // Sharp drop below the EMA -> signal-exit, even though price never reached the fixed stop-loss.
    expect(decideExit(position(), 95, [100, 105, 110, 115, 95], opts)).toBe('signal-exit');
    // Above the fixed take-profit, but trendExit is configured so take-profit is never checked.
    expect(decideExit(position(), 130, [100, 110, 120, 125, 130], opts)).toBeNull();
  });

  it('stop-loss is still checked first even when trend-exit is configured', () => {
    const opts = { trendExit: { emaPeriod: 3 } };
    expect(decideExit(position(), 90, [100, 95, 92, 91, 90], opts)).toBe('stop-loss');
  });
});
