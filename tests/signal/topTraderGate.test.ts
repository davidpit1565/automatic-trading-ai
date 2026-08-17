import { describe, expect, it } from 'vitest';
import { buildTopTraderGate } from '../../src/core/signal/topTraderGate';

const point = (timestamp: number, ratio: number) => ({ timestamp, ratio });

describe('buildTopTraderGate', () => {
  it('allows entries when the latest known ratio is at or above the bearish threshold', () => {
    const gate = buildTopTraderGate([point(1000, 1.2), point(2000, 1.5)]);
    expect(gate(2000)).toBe(true);
  });

  it('blocks entries when the latest known ratio is net-short', () => {
    const gate = buildTopTraderGate([point(1000, 1.2), point(2000, 0.8)]);
    expect(gate(2000)).toBe(false);
  });

  it('never looks ahead: uses only points at or before the decision timestamp', () => {
    // Latest point (bearish) is in the FUTURE relative to the decision time.
    const gate = buildTopTraderGate([point(1000, 1.2), point(5000, 0.5)]);
    expect(gate(2000)).toBe(true);
  });

  it('fails open (allows the entry) with no data at or before the timestamp', () => {
    const gate = buildTopTraderGate([point(5000, 0.5)]);
    expect(gate(1000)).toBe(true);
  });

  it('fails open with an empty series', () => {
    const gate = buildTopTraderGate([]);
    expect(gate(1000)).toBe(true);
  });

  it('respects a custom bearish threshold', () => {
    const gate = buildTopTraderGate([point(1000, 1.05)], { bearishRatio: 1.1 });
    expect(gate(1000)).toBe(false); // below the stricter 1.1 threshold
  });
});
