/**
 * AI second-opinion judgment gate — pure prompt-building + response parsing.
 *
 * David asked whether an AI "reasoning" layer could do better than a fixed
 * technical-indicator formula. This is the responsible version of that idea:
 *
 * - It can NEVER touch position sizing, stop-loss, or exposure caps — those
 *   stay deterministic (capital protection first, non-negotiable).
 * - It can NEVER be cleanly backtested: a model may carry latent knowledge
 *   of what actually happened next to a real historical chart, which would
 *   silently contaminate any "replay history" test with hindsight the
 *   strategy could never have had live. So this is wired ONLY into shadow
 *   evaluation (see `autopilot/shadowEvaluator.ts`), accumulating a genuine
 *   forward record before ever being trusted with even simulated risk.
 *
 * The actual model call is injected (`AiJudgmentModelCall`) so this file has
 * no network dependency and stays fully unit-testable; the real call lives
 * in `server/autopilotRunner.mts`, gated behind an `ANTHROPIC_API_KEY` that
 * must be configured before this does anything but fail open.
 */

export interface AiJudgmentSnapshot {
  readonly price: number;
  readonly changePct: number;
  readonly rsi: number | null;
  readonly macdHistogram: number | null;
  readonly emaFast: number | null;
  readonly emaSlow: number | null;
  readonly adx: number | null;
  readonly plusDi: number | null;
  readonly minusDi: number | null;
  readonly atrPct: number | null;
  readonly bollingerBandwidth: number | null;
  readonly percentB: number | null;
  readonly stochasticK: number | null;
  readonly stochasticD: number | null;
  readonly relativeVolume: number | null;
}

export interface AiJudgmentInput {
  readonly symbol: string;
  readonly snapshot: AiJudgmentSnapshot;
  /** Composite scanner score (-100..100, sign = direction). */
  readonly score: number;
  readonly warnings: readonly string[];
}

export type AiJudgmentModelCall = (prompt: string) => Promise<string>;

export interface AiJudgmentVerdict {
  readonly bearish: boolean;
  readonly reasoning: string;
}

const n = (v: number | null): string => (v === null ? 'n/a' : v.toString());

/** Builds the exact prompt sent to the model — a pure function, easy to snapshot-test. */
export function buildAiJudgmentPrompt(input: AiJudgmentInput): string {
  const s = input.snapshot;
  return (
    `You are a skeptical, risk-averse second opinion on a crypto/stock trade setup. ` +
    `Given this technical snapshot for ${input.symbol}, decide whether the near-term ` +
    `setup looks BEARISH enough that a new long entry should be avoided right now, or ` +
    `whether it is acceptable (bullish or neutral).\n\n` +
    `Price: ${s.price}\n` +
    `Change: ${s.changePct}%\n` +
    `RSI: ${n(s.rsi)}\n` +
    `MACD histogram: ${n(s.macdHistogram)}\n` +
    `EMA fast/slow: ${n(s.emaFast)} / ${n(s.emaSlow)}\n` +
    `ADX (+DI/-DI): ${n(s.adx)} (${n(s.plusDi)}/${n(s.minusDi)})\n` +
    `ATR%: ${n(s.atrPct)}\n` +
    `Bollinger bandwidth / %B: ${n(s.bollingerBandwidth)} / ${n(s.percentB)}\n` +
    `Stochastic K/D: ${n(s.stochasticK)} / ${n(s.stochasticD)}\n` +
    `Relative volume: ${n(s.relativeVolume)}\n` +
    `Composite scanner score (-100..100, sign = direction): ${input.score}\n` +
    `Scanner warnings: ${input.warnings.length ? input.warnings.join('; ') : 'none'}\n\n` +
    `Respond with ONLY a JSON object, no other text: ` +
    `{"verdict": "bullish" | "neutral" | "bearish", "reasoning": "<one short sentence>"}`
  );
}

/** Parses the model's response. Returns null on anything unparseable — callers fail open. */
export function parseAiJudgmentResponse(raw: string): AiJudgmentVerdict | null {
  let parsed: unknown;
  try {
    // Models sometimes wrap JSON in a code fence despite instructions; strip it.
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const verdict = (parsed as { verdict?: unknown }).verdict;
  if (verdict !== 'bullish' && verdict !== 'neutral' && verdict !== 'bearish') return null;
  const reasoning = (parsed as { reasoning?: unknown }).reasoning;
  return { bearish: verdict === 'bearish', reasoning: typeof reasoning === 'string' ? reasoning : '' };
}

/**
 * Fails open (not bearish) on any model-call error or unparseable response —
 * the same contract as every other gate in this codebase: an outage or a
 * malformed answer must never silently block trading.
 */
export async function isAiJudgmentBearish(
  input: AiJudgmentInput,
  callModel: AiJudgmentModelCall,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await callModel(buildAiJudgmentPrompt(input));
  } catch {
    return false;
  }
  return parseAiJudgmentResponse(raw)?.bearish ?? false;
}
