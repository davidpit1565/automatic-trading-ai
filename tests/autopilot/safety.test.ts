/**
 * Kill switch and audit log tests (TDD) — the safety rails from the
 * execution architecture, implemented for paper mode first.
 */

import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';

const T = 1_700_000_000_000;

describe('PersistedKillSwitch', () => {
  it('starts disengaged and engages instantly without any confirmation', () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    expect(killSwitch.isEngaged()).toBe(false);
    killSwitch.engage('manual stop');
    expect(killSwitch.isEngaged()).toBe(true);
  });

  it('disengaging requires an explicit actor', () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    killSwitch.engage('test');
    expect(() => killSwitch.disengage('')).toThrow();
    expect(killSwitch.isEngaged()).toBe(true);
    killSwitch.disengage('dp');
    expect(killSwitch.isEngaged()).toBe(false);
  });

  it('persists across instances — a page reload cannot silently re-enable trading', () => {
    const store = new MemoryStore();
    new PersistedKillSwitch(store).engage('emergency');
    expect(new PersistedKillSwitch(store).isEngaged()).toBe(true);
  });
});

describe('PersistedAuditLog', () => {
  it('appends entries in order and persists them', () => {
    const store = new MemoryStore();
    const log = new PersistedAuditLog(store);
    log.append({ timestamp: T, intentId: 'a', event: 'filled', mode: 'paper', detail: 'opened' });
    log.append({ timestamp: T + 1, intentId: 'b', event: 'rejected', mode: 'paper', detail: 'risk refused' });
    const restored = new PersistedAuditLog(store);
    expect(restored.entries().map((e) => e.intentId)).toEqual(['a', 'b']);
  });

  it('is append-only: the exposed view cannot mutate the log', () => {
    const log = new PersistedAuditLog(new MemoryStore());
    log.append({ timestamp: T, intentId: 'a', event: 'filled', mode: 'paper', detail: 'x' });
    const view = [...log.entries()];
    view.pop();
    expect(log.entries()).toHaveLength(1);
  });

  it('exposes no edit or delete capability of any kind', () => {
    const log = new PersistedAuditLog(new MemoryStore());
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(log)).filter(
      (name) => name !== 'constructor',
    );
    expect(methods.sort()).toEqual(['append', 'entries']);
    for (const name of methods) {
      expect(name).not.toMatch(/delete|remove|clear|edit|update|set/i);
    }
  });
});
