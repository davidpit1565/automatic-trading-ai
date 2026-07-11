/**
 * Alert engine tests (TDD): alerts fire only for qualified opportunities,
 * never spam (cooldown + duplicate detection), fan out to pluggable
 * channels, and keep a persistent history.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { AlertEngine, type Alert, type AlertChannel } from '../../src/core/monitor/alerts';

const T = 1_700_000_000_000;
const COOLDOWN = 3_600_000; // 1h

function collector(): { channel: AlertChannel; delivered: Alert[] } {
  const delivered: Alert[] = [];
  return {
    delivered,
    channel: {
      name: 'collector',
      deliver: (alert) => {
        delivered.push(alert);
      },
    },
  };
}

function opportunity(symbol = 'BTC-USD', confidence = 60) {
  return { symbol, timeframe: '1h' as const, confidence, price: 60_000, explanation: 'test' };
}

describe('AlertEngine', () => {
  it('delivers a qualified opportunity to every channel and records history', async () => {
    const a = collector();
    const b = collector();
    const engine = new AlertEngine(new MemoryStore(), [a.channel, b.channel], { cooldownMs: COOLDOWN });
    const result = await engine.notify(opportunity(), T);
    expect(result.sent).toBe(true);
    expect(a.delivered).toHaveLength(1);
    expect(b.delivered).toHaveLength(1);
    expect(a.delivered[0]!.message).toContain('BTC-USD');
    expect(engine.history()).toHaveLength(1);
  });

  it('suppresses duplicates within the cooldown window', async () => {
    const { channel, delivered } = collector();
    const engine = new AlertEngine(new MemoryStore(), [channel], { cooldownMs: COOLDOWN });
    await engine.notify(opportunity(), T);
    const second = await engine.notify(opportunity(), T + COOLDOWN - 1);
    expect(second.sent).toBe(false);
    expect(second.reason).toContain('cooldown');
    expect(delivered).toHaveLength(1);
  });

  it('alerts again once the cooldown has expired', async () => {
    const { channel, delivered } = collector();
    const engine = new AlertEngine(new MemoryStore(), [channel], { cooldownMs: COOLDOWN });
    await engine.notify(opportunity(), T);
    const later = await engine.notify(opportunity(), T + COOLDOWN);
    expect(later.sent).toBe(true);
    expect(delivered).toHaveLength(2);
  });

  it('treats different symbols and timeframes independently', async () => {
    const { channel, delivered } = collector();
    const engine = new AlertEngine(new MemoryStore(), [channel], { cooldownMs: COOLDOWN });
    await engine.notify(opportunity('BTC-USD'), T);
    const other = await engine.notify(opportunity('ETH-USD'), T + 1);
    expect(other.sent).toBe(true);
    expect(delivered).toHaveLength(2);
  });

  it('cooldown state and history persist across instances', async () => {
    const store = new MemoryStore();
    const first = new AlertEngine(store, [collector().channel], { cooldownMs: COOLDOWN });
    await first.notify(opportunity(), T);

    const { channel, delivered } = collector();
    const restored = new AlertEngine(store, [channel], { cooldownMs: COOLDOWN });
    const result = await restored.notify(opportunity(), T + 1000);
    expect(result.sent).toBe(false);
    expect(delivered).toHaveLength(0);
    expect(restored.history()).toHaveLength(1);
  });

  it('a failing channel does not block the others or the history', async () => {
    const failing: AlertChannel = {
      name: 'broken',
      deliver: () => {
        throw new Error('boom');
      },
    };
    const { channel, delivered } = collector();
    const engine = new AlertEngine(new MemoryStore(), [failing, channel], { cooldownMs: COOLDOWN });
    const result = await engine.notify(opportunity(), T);
    expect(result.sent).toBe(true);
    expect(delivered).toHaveLength(1);
    expect(engine.history()).toHaveLength(1);
  });

  it('rejects a non-positive cooldown', () => {
    expect(() => new AlertEngine(new MemoryStore(), [], { cooldownMs: 0 })).toThrow(RangeError);
  });
});
