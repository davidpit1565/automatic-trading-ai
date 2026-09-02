import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import { checkManualKillSwitchCommands, parseKillSwitchCommand } from '../../server/manualKillSwitchCommand.mts';
import { checkManualSellRequests } from '../../server/manualSellCommand.mts';
import type { MarketDataSource } from '../../src/core/data/revolutClient';

function seedTelegram(messages: { update_id: number; message?: { text?: string; chat?: { id: string } } }[]) {
  return (async () =>
    new Response(JSON.stringify({ ok: true, result: messages }), { status: 200 })) as unknown as typeof fetch;
}

describe('parseKillSwitchCommand', () => {
  it('parses /pause and /resume, case-insensitively and with surrounding whitespace', () => {
    expect(parseKillSwitchCommand('/pause')).toBe('pause');
    expect(parseKillSwitchCommand('/PAUSE')).toBe('pause');
    expect(parseKillSwitchCommand('  /resume  ')).toBe('resume');
  });

  it('returns null for anything else', () => {
    expect(parseKillSwitchCommand('/pause now')).toBeNull();
    expect(parseKillSwitchCommand('/sell XBTEUR')).toBeNull();
    expect(parseKillSwitchCommand('hello')).toBeNull();
  });
});

describe('checkManualKillSwitchCommands', () => {
  it('does nothing when no command has arrived', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn: seedTelegram([]) },
      killSwitch,
      audit,
      'C',
      1000,
    );
    expect(outcomes).toEqual([]);
    expect(killSwitch.isEngaged()).toBe(false);
  });

  it('/pause engages the kill switch and audits it', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const fetchFn = seedTelegram([{ update_id: 1, message: { text: '/pause', chat: { id: 'C' } } }]);
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      killSwitch,
      audit,
      'C',
      1000,
    );
    expect(outcomes).toEqual([{ command: 'pause', applied: true }]);
    expect(killSwitch.isEngaged()).toBe(true);
    expect(audit.entries().map((e) => e.event)).toEqual(['kill-switch-engaged']);
  });

  it('/pause is a no-op (applied: false) when already engaged', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    killSwitch.engage('already paused for another reason');
    const fetchFn = seedTelegram([{ update_id: 1, message: { text: '/pause', chat: { id: 'C' } } }]);
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      killSwitch,
      audit,
      'C',
      1000,
    );
    expect(outcomes).toEqual([{ command: 'pause', applied: false }]);
    expect(audit.entries()).toEqual([]);
  });

  it('/resume disengages the kill switch and audits it', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    killSwitch.engage('test');
    const fetchFn = seedTelegram([{ update_id: 1, message: { text: '/resume', chat: { id: 'C' } } }]);
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      killSwitch,
      audit,
      'C',
      1000,
    );
    expect(outcomes).toEqual([{ command: 'resume', applied: true }]);
    expect(killSwitch.isEngaged()).toBe(false);
    expect(audit.entries().map((e) => e.event)).toEqual(['kill-switch-disengaged']);
  });

  it('/resume is a no-op (applied: false) when already disengaged', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const fetchFn = seedTelegram([{ update_id: 1, message: { text: '/resume', chat: { id: 'C' } } }]);
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      killSwitch,
      audit,
      'C',
      1000,
    );
    expect(outcomes).toEqual([{ command: 'resume', applied: false }]);
    expect(audit.entries()).toEqual([]);
  });

  it('ignores a message from any chat other than the configured one', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const fetchFn = seedTelegram([{ update_id: 1, message: { text: '/pause', chat: { id: 'someone-else' } } }]);
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      killSwitch,
      audit,
      'C',
      1000,
    );
    expect(outcomes).toEqual([]);
    expect(killSwitch.isEngaged()).toBe(false);
  });

  it('applies multiple commands in order', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const fetchFn = seedTelegram([
      { update_id: 1, message: { text: '/pause', chat: { id: 'C' } } },
      { update_id: 2, message: { text: '/resume', chat: { id: 'C' } } },
    ]);
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      killSwitch,
      audit,
      'C',
      1000,
    );
    expect(outcomes).toEqual([
      { command: 'pause', applied: true },
      { command: 'resume', applied: true },
    ]);
    expect(killSwitch.isEngaged()).toBe(false);
  });

  it('a /pause is not lost even when checkManualSellRequests polls first and does not recognise it (the shared-offset bug this fixes)', async () => {
    const store = new MemoryStore();
    const audit = new PersistedAuditLog(store);
    const killSwitch = new PersistedKillSwitch(store);
    const noopSource: MarketDataSource = {
      name: 'noop',
      getInstruments: async () => ({ ok: true, value: [] }),
      getCandles: async () => ({ ok: false, error: 'unused in this test' }),
    };

    // The manual-sell poller runs FIRST in this cycle (as it would in a real
    // orchestrator) and sees BOTH the /pause message and an unrelated
    // callback_query in the same batch — it must recognise neither as its
    // own and stash both back rather than discarding them.
    const fetchFn = seedTelegram([
      { update_id: 1, message: { text: '/pause', chat: { id: 'C' } } },
    ]);
    const sellOutcomes = await checkManualSellRequests(
      store,
      { token: 'T', chatId: 'C', fetchFn },
      noopSource,
      '1h',
      {
        confirmationGate: { async requestConfirmation() { throw new Error('not used'); } },
        brokerAdapter: {
          name: 'unused',
          mode: 'live',
          async submit() { throw new Error('not used'); },
          async cancel() { throw new Error('not used'); },
          async fetchPositions() { return []; },
        },
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      },
      1000,
    );
    expect(sellOutcomes).toEqual([]); // no /sell command in this batch — nothing to do

    // The kill-switch poller, running afterward with no further Telegram
    // traffic, must still find the /pause the sell poller didn't touch.
    const outcomes = await checkManualKillSwitchCommands(
      store,
      { token: 'T', chatId: 'C', fetchFn: seedTelegram([]) },
      killSwitch,
      audit,
      'C',
      2000,
    );
    expect(outcomes).toEqual([{ command: 'pause', applied: true }]);
    expect(killSwitch.isEngaged()).toBe(true);
  });
});
