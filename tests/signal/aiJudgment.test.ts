import { describe, expect, it } from 'vitest';
import {
  buildAiJudgmentPrompt,
  isAiJudgmentBearish,
  parseAiJudgmentResponse,
  type AiJudgmentInput,
} from '../../src/core/signal/aiJudgment';

const baseInput: AiJudgmentInput = {
  symbol: 'BTC/USD',
  score: 42,
  warnings: [],
  snapshot: {
    price: 50_000,
    changePct: 1.2,
    rsi: 55,
    macdHistogram: 12.3,
    emaFast: 49_800,
    emaSlow: 49_200,
    adx: 28,
    plusDi: 25,
    minusDi: 15,
    atrPct: 1.8,
    bollingerBandwidth: 0.05,
    percentB: 0.6,
    stochasticK: 60,
    stochasticD: 55,
    relativeVolume: 1.3,
  },
};

describe('buildAiJudgmentPrompt', () => {
  it('includes the symbol and every indicator value', () => {
    const prompt = buildAiJudgmentPrompt(baseInput);
    expect(prompt).toContain('BTC/USD');
    expect(prompt).toContain('55'); // rsi
    expect(prompt).toContain('42'); // composite score
    expect(prompt).toContain('JSON');
  });

  it('renders missing indicators as n/a rather than "null"', () => {
    const prompt = buildAiJudgmentPrompt({
      ...baseInput,
      snapshot: { ...baseInput.snapshot, rsi: null, adx: null },
    });
    expect(prompt).toContain('n/a');
    expect(prompt).not.toContain('null');
  });

  it('lists scanner warnings when present, and says "none" when empty', () => {
    expect(buildAiJudgmentPrompt(baseInput)).toContain('none');
    const withWarnings = buildAiJudgmentPrompt({ ...baseInput, warnings: ['overextended'] });
    expect(withWarnings).toContain('overextended');
  });
});

describe('parseAiJudgmentResponse', () => {
  it('parses a well-formed bearish verdict', () => {
    const result = parseAiJudgmentResponse('{"verdict": "bearish", "reasoning": "overbought"}');
    expect(result).toEqual({ bearish: true, reasoning: 'overbought' });
  });

  it('parses bullish and neutral as not-bearish', () => {
    expect(parseAiJudgmentResponse('{"verdict": "bullish", "reasoning": "strong trend"}')?.bearish).toBe(false);
    expect(parseAiJudgmentResponse('{"verdict": "neutral", "reasoning": "mixed"}')?.bearish).toBe(false);
  });

  it('strips a markdown code fence some models wrap JSON in', () => {
    const result = parseAiJudgmentResponse('```json\n{"verdict": "bearish", "reasoning": "x"}\n```');
    expect(result?.bearish).toBe(true);
  });

  it('returns null for invalid JSON', () => {
    expect(parseAiJudgmentResponse('not json at all')).toBeNull();
  });

  it('returns null for a missing or invalid verdict field', () => {
    expect(parseAiJudgmentResponse('{"reasoning": "no verdict field"}')).toBeNull();
    expect(parseAiJudgmentResponse('{"verdict": "maybe", "reasoning": "x"}')).toBeNull();
  });

  it('defaults reasoning to an empty string when absent', () => {
    expect(parseAiJudgmentResponse('{"verdict": "bullish"}')).toEqual({ bearish: false, reasoning: '' });
  });
});

describe('isAiJudgmentBearish', () => {
  it('returns true only when the model returns a bearish verdict', async () => {
    const callModel = async () => '{"verdict": "bearish", "reasoning": "weak momentum"}';
    expect(await isAiJudgmentBearish(baseInput, callModel)).toBe(true);
  });

  it('returns false for a bullish/neutral verdict', async () => {
    const callModel = async () => '{"verdict": "bullish", "reasoning": "ok"}';
    expect(await isAiJudgmentBearish(baseInput, callModel)).toBe(false);
  });

  it('fails open (false) when the model call throws', async () => {
    const callModel = async (): Promise<string> => {
      throw new Error('network down');
    };
    expect(await isAiJudgmentBearish(baseInput, callModel)).toBe(false);
  });

  it('fails open (false) when the response is unparseable', async () => {
    const callModel = async () => 'garbage response';
    expect(await isAiJudgmentBearish(baseInput, callModel)).toBe(false);
  });
});
