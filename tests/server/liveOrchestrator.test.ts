import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import { PersistedAuditLog } from '../../src/core/autopilot/auditLog';
import { PersistedKillSwitch } from '../../src/core/autopilot/killSwitch';
import type {
  BrokerAdapter,
  BrokerPosition,
  ConfirmationDecision,
  ConfirmationGate,
  OrderIntent,
  OrderStatusReport,
} from '../../src/core/execution/types';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import { ConfirmationPendingError } from '../../server/telegramConfirmationGate.mts';
import { buildLiveOrderIntent, runLiveOrderFlow } from '../../server/liveOrchestrator.mts';

function approvedAssessment(overrides: Partial<TradeRiskAssessment> = {}): TradeRiskAssessment {
  return {
    approved: true,
    asset: 'BTC-USD',
    entry: 100,
    stopLoss: 95,
    takeProfit: 115,
    positionSize: 2,
    positionValue: 200,
    riskAmount: 10,
    riskPercentage: 1,
    rewardRiskRatio: 3,
    portfolioExposure: 2,
    reasons: [],
    warnings: [],
    ...overrides,
  };
}

function intent(overrides: Partial<OrderIntent> = {}): OrderIntent {
  return {
    id: 'BTC-USD:1000',
    createdAt: 1000,
    mode: 'live',
    symbol: 'BTC-USD',
    side: 'buy',
    quantity: 2,
    limitPrice: 100,
    stopLoss: 95,
    takeProfit: 115,
    assessment: approvedAssessment(),
    ...overrides,
  };
}

/** A confirmation gate whose decision (or thrown error) is fixed for the
 * test, tracking whether it was ever asked. */
function fakeConfirmationGate(
  outcome: ConfirmationDecision | Error,
): ConfirmationGate & { calls: OrderIntent[] } {
  const calls: OrderIntent[] = [];
  return {
    calls,
    async requestConfirmation(orderIntent: OrderIntent) {
      calls.push(orderIntent);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

/** mode defaults to 'live' — every test below exercises the real-broker path
 * unless it explicitly overrides mode to something else. */
function fakeBrokerAdapter(
  report: OrderStatusReport,
  mode: BrokerAdapter['mode'] = 'live',
): BrokerAdapter & { submitCalls: OrderIntent[] } {
  const submitCalls: OrderIntent[] = [];
  return {
    name: 'fake-broker',
    mode,
    submitCalls,
    async submit(orderIntent: OrderIntent) {
      submitCalls.push(orderIntent);
      return report;
    },
    async cancel(): Promise<OrderStatusReport> {
      throw new Error('not used in these tests');
    },
    async fetchPositions(): Promise<BrokerPosition[]> {
      return [];
    },
  };
}

function filledReport(): OrderStatusReport {
  return { intentId: 'BTC-USD:1000', state: 'filled', filledQuantity: 2, avgFillPrice: 100, detail: 'ok' };
}

describe('buildLiveOrderIntent', () => {
  it('maps a risk-approved assessment onto a live buy OrderIntent', () => {
    const assessment = approvedAssessment();
    const result = buildLiveOrderIntent('my-id', assessment, 12345, 'BTC-EUR');

    expect(result).toEqual({
      id: 'my-id',
      createdAt: 12345,
      mode: 'live',
      symbol: 'BTC-EUR',
      side: 'buy',
      quantity: 2,
      limitPrice: 100,
      stopLoss: 95,
      takeProfit: 115,
      assessment,
    });
  });

  it('uses the translated broker symbol, not the internal asset code, as the intent symbol', () => {
    const assessment = approvedAssessment({ asset: 'XBTEUR' });
    const result = buildLiveOrderIntent('my-id', assessment, 12345, 'BTC-EUR');

    expect(result.symbol).toBe('BTC-EUR');
    expect(result.assessment.asset).toBe('XBTEUR');
  });
});

describe('runLiveOrderFlow', () => {
  it('refuses immediately when the kill switch is engaged, never asking for confirmation, and audits the refusal', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    killSwitch.engage('testing');
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' });
    const broker = fakeBrokerAdapter(filledReport());

    const result = await runLiveOrderFlow({
      intent: intent(),
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    });

    expect(result).toEqual({ outcome: 'blocked-by-kill-switch' });
    expect(gate.calls).toHaveLength(0);
    expect(broker.submitCalls).toHaveLength(0);
    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({ intentId: 'BTC-USD:1000', event: 'cancelled' });
  });

  it('refuses a live order outright when no symbol check is wired, rather than silently skipping it, and audits the refusal', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' });
    const broker = fakeBrokerAdapter(filledReport(), 'live');

    const result = await runLiveOrderFlow({
      intent: intent(),
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
      // verifySymbolExists deliberately omitted
    });

    expect(result).toEqual({ outcome: 'missing-symbol-check' });
    expect(gate.calls).toHaveLength(0);
    expect(broker.submitCalls).toHaveLength(0);
    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({ intentId: 'BTC-USD:1000', event: 'rejected' });
  });

  it('does not require a symbol check for a non-live (e.g. paper) broker', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' });
    const broker = fakeBrokerAdapter(filledReport(), 'paper');

    const result = await runLiveOrderFlow({
      intent: intent({ mode: 'paper' }),
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
    });

    expect(result.outcome).toBe('submitted');
  });

  it('refuses an unknown symbol rather than guessing, before ever asking for confirmation, and audits the refusal', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' });
    const broker = fakeBrokerAdapter(filledReport());

    const result = await runLiveOrderFlow({
      intent: intent({ symbol: 'BTCEUR' }),
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
      verifySymbolExists: async () => false,
    });

    expect(result.outcome).toBe('unknown-symbol');
    expect(gate.calls).toHaveLength(0);
    expect(broker.submitCalls).toHaveLength(0);
    expect(audit.entries()).toHaveLength(1);
    expect(audit.entries()[0]).toMatchObject({ intentId: 'BTC-USD:1000', event: 'rejected' });
  });

  it('proceeds when the symbol check passes', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' });
    const broker = fakeBrokerAdapter(filledReport());

    const result = await runLiveOrderFlow({
      intent: intent(),
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    });

    expect(result).toEqual({ outcome: 'submitted', report: filledReport() });
  });

  it('reports pending, without touching the broker, when confirmation is still awaiting a human tap', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate(new ConfirmationPendingError('BTC-USD:1000'));
    const broker = fakeBrokerAdapter(filledReport());

    const result = await runLiveOrderFlow({
      intent: intent(),
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    });

    expect(result).toEqual({ outcome: 'pending' });
    expect(broker.submitCalls).toHaveLength(0);
  });

  it('lets a genuine, non-pending error from the confirmation gate propagate', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate(new Error('Telegram credentials are not configured'));
    const broker = fakeBrokerAdapter(filledReport());

    await expect(
      runLiveOrderFlow({
        intent: intent(),
        confirmationGate: gate,
        brokerAdapter: broker,
        killSwitch,
        audit,
        verifySymbolExists: async () => true,
      }),
    ).rejects.toThrow('Telegram credentials are not configured');
  });

  it('never submits to the broker when the human rejects the order', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate({ intentId: 'x', approved: false, decidedAt: 1, decidedBy: 'david' });
    const broker = fakeBrokerAdapter(filledReport());

    const result = await runLiveOrderFlow({
      intent: intent(),
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    });

    expect(result).toEqual({ outcome: 'rejected', decidedBy: 'david' });
    expect(broker.submitCalls).toHaveLength(0);
  });

  it('submits to the broker only after an explicit human approval', async () => {
    const killSwitch = new PersistedKillSwitch(new MemoryStore());
    const audit = new PersistedAuditLog(new MemoryStore());
    const gate = fakeConfirmationGate({ intentId: 'x', approved: true, decidedAt: 1, decidedBy: 'david' });
    const broker = fakeBrokerAdapter(filledReport());
    const theIntent = intent();

    const result = await runLiveOrderFlow({
      intent: theIntent,
      confirmationGate: gate,
      brokerAdapter: broker,
      killSwitch,
      audit,
      verifySymbolExists: async () => true,
    });

    expect(result).toEqual({ outcome: 'submitted', report: filledReport() });
    expect(broker.submitCalls).toEqual([theIntent]);
  });
});
