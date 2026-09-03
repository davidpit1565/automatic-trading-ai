import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/core/data/storage';
import type { TradeRiskAssessment } from '../../src/core/risk/riskEngine';
import type { TradeOpportunity } from '../../src/core/signal/signalEngine';
import type { TipResult } from '../../src/core/autopilot/paperAutoPilot';
import { checkTipRequests, formatTipMessage, parseTipCommand } from '../../server/manualTipCommand.mts';

function seedTelegram(messages: { update_id: number; message?: { text?: string; chat?: { id: string } } }[]) {
  return (async () =>
    new Response(JSON.stringify({ ok: true, result: messages }), { status: 200 })) as unknown as typeof fetch;
}

function opportunity(confidence: number): TradeOpportunity {
  return {
    symbol: 'XBTEUR',
    timeframe: '1h',
    direction: 'long',
    levels: { entry: 100, stopLoss: 95, takeProfit: 115, riskReward: 3 },
    confidence,
    confidenceComponents: [
      { label: 'Trend strength', detail: '', effect: 10 },
      { label: 'Scanner evidence', detail: '', effect: 5 },
    ],
    explanation: 'test',
    warnings: [],
    basedOn: { score: 1, candleCount: 100 },
  };
}

function assessment(): TradeRiskAssessment {
  return {
    approved: true,
    asset: 'XBTEUR',
    entry: 100,
    stopLoss: 95,
    takeProfit: 115,
    positionSize: 1,
    positionValue: 100,
    riskAmount: 5,
    riskPercentage: 5,
    rewardRiskRatio: 3,
    portfolioExposure: 10,
    reasons: [],
    warnings: [],
  };
}

describe('parseTipCommand', () => {
  it('matches /tip case-insensitively with surrounding whitespace', () => {
    expect(parseTipCommand('/tip')).toBe(true);
    expect(parseTipCommand('/TIP')).toBe(true);
    expect(parseTipCommand('  /tip  ')).toBe(true);
  });

  it('rejects anything else, including /tip with extra text', () => {
    expect(parseTipCommand('/tip XBTEUR')).toBe(false);
    expect(parseTipCommand('hello')).toBe(false);
    expect(parseTipCommand('/buy XBTEUR')).toBe(false);
  });
});

describe('formatTipMessage', () => {
  it('reports the qualified opportunity with levels, confidence and top reasons', () => {
    const message = formatTipMessage({
      qualified: { symbol: 'XBTEUR', opportunity: opportunity(72), assessment: assessment() },
      closestMiss: null,
    });
    expect(message).toContain('XBTEUR');
    expect(message).toContain('100');
    expect(message).toContain('95');
    expect(message).toContain('115');
    expect(message).toContain('72');
    expect(message).toContain('/buy XBTEUR');
  });

  it('reports the closest miss and why, when nothing qualifies', () => {
    const message = formatTipMessage({
      qualified: null,
      closestMiss: { symbol: 'ETHEUR', confidence: 35, reason: 'daily regime filter: larger trend is down' },
    });
    expect(message).toContain('ETHEUR');
    expect(message).toContain('35');
    expect(message).toContain('daily regime filter');
  });

  it('reports plainly when there is no signal at all anywhere', () => {
    const message = formatTipMessage({ qualified: null, closestMiss: null });
    expect(message).toContain('אין כרגע אף איתות');
  });
});

describe('checkTipRequests', () => {
  it('answers a /tip command by calling previewBestOpportunity and sending the result', async () => {
    const store = new MemoryStore();
    const sent: string[] = [];
    let sawFetch = false;
    const telegram = {
      token: 'T',
      chatId: 'C',
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('getUpdates')) {
          return new Response(
            JSON.stringify({ ok: true, result: [{ update_id: 1, message: { text: '/tip', chat: { id: 'C' } } }] }),
            { status: 200 },
          );
        }
        if (url.includes('sendMessage') && init?.body) {
          sawFetch = true;
          sent.push(JSON.parse(init.body as string).text);
        }
        return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
      }) as unknown as typeof fetch,
    };

    const result: TipResult = {
      qualified: { symbol: 'XBTEUR', opportunity: opportunity(80), assessment: assessment() },
      closestMiss: null,
    };
    const fakeAutopilot = { previewBestOpportunity: async () => result } as unknown as import('../../src/core/autopilot/paperAutoPilot').PaperAutoPilot;

    const answered = await checkTipRequests(store, telegram, fakeAutopilot, 1000);

    expect(answered).toBe(true);
    expect(sawFetch).toBe(true);
    expect(sent[0]).toContain('XBTEUR');
  });

  it('does nothing, and stashes the message back, when there is no /tip command', async () => {
    const store = new MemoryStore();
    const telegram = { token: 'T', chatId: 'C', fetchFn: seedTelegram([{ update_id: 1, message: { text: '/pause', chat: { id: 'C' } } }]) };
    const fakeAutopilot = {
      previewBestOpportunity: async () => {
        throw new Error('must not be called');
      },
    } as unknown as import('../../src/core/autopilot/paperAutoPilot').PaperAutoPilot;

    const answered = await checkTipRequests(store, telegram, fakeAutopilot, 1000);

    expect(answered).toBe(false);
    expect(store.get<unknown[]>('telegram-unclaimed-messages')).toHaveLength(1);
  });
});
