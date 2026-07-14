/**
 * Telegram notification tests (TDD): message formatting for autopilot
 * trades and graceful no-op when credentials are absent.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error plain-TS server module run via tsx; imported directly in tests
import { buildCycleMessage, sendTelegramMessage } from '../../server/telegram.mts';

describe('buildCycleMessage', () => {
  it('returns null when the cycle opened and closed nothing', () => {
    expect(buildCycleMessage({ opened: [], closed: [], timestamp: 0 })).toBeNull();
  });

  it('describes a buy with symbol, size and price', () => {
    const msg = buildCycleMessage({
      timestamp: 0,
      opened: [{ symbol: 'BTC-EUR', quantity: 0.01, entry: 54700 }],
      closed: [],
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain('BTC-EUR');
    expect(msg).toContain('54');
    expect(msg!.toLowerCase()).toContain('bought');
  });

  it('describes a sell with the exit reason', () => {
    const msg = buildCycleMessage({
      timestamp: 0,
      opened: [],
      closed: [{ symbol: 'ETH-EUR', reason: 'take-profit', price: 1600 }],
    });
    expect(msg).toContain('ETH-EUR');
    expect(msg).toContain('take-profit');
    expect(msg!.toLowerCase()).toContain('sold');
  });

  it('combines opens and closes in one message', () => {
    const msg = buildCycleMessage({
      timestamp: 0,
      opened: [{ symbol: 'BTC-EUR', quantity: 0.01, entry: 54700 }],
      closed: [{ symbol: 'ETH-EUR', reason: 'stop-loss', price: 1500 }],
    });
    expect(msg).toContain('BTC-EUR');
    expect(msg).toContain('ETH-EUR');
  });
});

describe('sendTelegramMessage', () => {
  it('skips (does not throw) when credentials are missing', async () => {
    const result = await sendTelegramMessage('hi', { token: '', chatId: '' });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain('credentials');
  });

  it('posts to the Telegram API when configured', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string, init: { body: string }) => {
      calls.push(url);
      const body = JSON.parse(init.body) as { chat_id: string; text: string };
      expect(body.chat_id).toBe('123');
      expect(body.text).toBe('hello');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await sendTelegramMessage('hello', {
      token: 'TOK',
      chatId: '123',
      fetchFn: fakeFetch,
    });
    expect(result.sent).toBe(true);
    expect(calls[0]).toContain('/botTOK/sendMessage');
  });

  it('reports an error result on HTTP failure instead of throwing', async () => {
    const fakeFetch = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const result = await sendTelegramMessage('x', { token: 'T', chatId: 'C', fetchFn: fakeFetch });
    expect(result.sent).toBe(false);
  });
});
