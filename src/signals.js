/*
 * Stage 2 — Signal engine.
 * Transforms verified indicator outputs into a structured, explainable,
 * fully reproducible signal. No randomness, no unexplainable heuristics:
 * every number below is derived from the indicator engine by the
 * documented formulas, so any score can be recomputed by hand.
 *
 * SCORING MODEL (documented contract, mirrored by the test suite)
 *   trend score   ∈ [-1, 1]: (price vs SMA50 → ±0.5) + (SMA50 vs SMA200 → ±0.5)
 *   momentum score∈ [-1, 1]: clamp((RSI14−50)/25, −1, 1)·0.5 + sign(MACD hist)·0.5
 *   directional   = 0.6·trend + 0.4·momentum
 *   volatility factor: 30d annualized vol <60% → 1.0, <100% → 0.75, else 0.4
 *   volume factor: clamp(1 + 0.2·(volumeRatio − 1), 0.85, 1.1); unknown → 1.0
 *   confidence    = round(min(100, |directional|·100·volFactor·volumeFactor))
 *   direction     = bullish if directional > 0.05, bearish if < −0.05, else neutral
 *
 * QUALITY GATES (any failure ⇒ actionable = false, reason recorded)
 *   - history < 210 bars (SMA200 needs data)
 *   - direction neutral
 *   - direction bearish (spot market: no short execution — avoid/exit only)
 *   - RSI14 ≥ 75 on a bullish read (chasing overbought)
 *   - trend and momentum in strong opposition (|both| ≥ 0.5, opposite signs)
 *   - extreme volatility regime (30d annualized ≥ 100%)
 *   - confidence < minConfidence (default 40)
 */

function _sigDeps() {
  if (typeof module !== 'undefined') return require('./indicators');
  return window.Indicators;
}
const _clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function _volatilityFactor(vol30) {
  if (vol30 === null) return 1;
  if (vol30 < 60) return 1;
  if (vol30 < 100) return 0.75;
  return 0.4;
}

function _volumeFactor(ratio) {
  if (ratio === null) return 1;
  return _clamp(1 + 0.2 * (ratio - 1), 0.85, 1.1);
}

function evaluateSignal(closes, volumes, opts = {}) {
  const I = _sigDeps();
  const minConfidence = opts.minConfidence ?? 40;
  const rejections = [], reasons = [];

  if (closes.length < 210) {
    return {
      direction: 'neutral', confidence: 0, actionable: false,
      directionalScore: 0, components: null,
      rejections: [`insufficient history: ${closes.length} bars, need 210+ for the 50/200-day trend test`],
      reasons: [],
    };
  }

  const price = closes[closes.length - 1];
  const sma50A = I.sma(closes, 50), sma200A = I.sma(closes, 200);
  const sma50 = sma50A[sma50A.length - 1], sma200 = sma200A[sma200A.length - 1];
  const rsiA = I.rsi(closes, 14);
  const rsi = rsiA[rsiA.length - 1];
  const macdA = I.macd(closes);
  const hist = macdA.histogram[macdA.histogram.length - 1];
  const vol30 = I.annualizedVolatility(closes, 30);
  const volRatio = volumes && volumes.length === closes.length ? I.volumeRatio(volumes, 20) : null;

  /* trend: structure of price vs the 50- and 200-day averages */
  const trendScore =
    (price > sma50 ? 0.5 : price < sma50 ? -0.5 : 0) +
    (sma50 > sma200 ? 0.5 : sma50 < sma200 ? -0.5 : 0);
  const trend = {
    score: trendScore, price, sma50, sma200,
    text: `price ${price > sma50 ? 'above' : 'below'} SMA50 and SMA50 ${sma50 > sma200 ? 'above' : 'below'} SMA200 → trend score ${trendScore.toFixed(2)}`,
  };

  /* momentum: RSI distance from neutral + MACD histogram sign */
  const rsiComp = _clamp((rsi - 50) / 25, -1, 1) * 0.5;
  const macdComp = hist > 0 ? 0.5 : hist < 0 ? -0.5 : 0;
  const momentumScore = rsiComp + macdComp;
  const momentum = {
    score: momentumScore, rsi, macdHistogram: hist,
    text: `RSI14 ${rsi.toFixed(0)} contributes ${rsiComp.toFixed(2)}, MACD histogram ${hist > 0 ? 'positive' : hist < 0 ? 'negative' : 'flat'} contributes ${macdComp.toFixed(2)} → momentum score ${momentumScore.toFixed(2)}`,
  };

  /* condition factors */
  const volFactor = _volatilityFactor(vol30);
  const regime = vol30 === null ? 'unknown' : vol30 < 30 ? 'calm' : vol30 < 60 ? 'normal' : vol30 < 100 ? 'elevated' : 'extreme';
  const volatility = {
    factor: volFactor, vol30, regime,
    text: `30d volatility ${vol30 === null ? 'unknown' : vol30.toFixed(0) + '% annualized'} (${regime}) → quality ×${volFactor}`,
  };
  const uFactor = _volumeFactor(volRatio);
  const volume = {
    factor: uFactor, ratio: volRatio,
    text: volRatio === null
      ? 'volume data unavailable → quality ×1'
      : `volume at ${(volRatio * 100).toFixed(0)}% of its 20d average → quality ×${uFactor.toFixed(2)}`,
  };

  const directionalScore = 0.6 * trendScore + 0.4 * momentumScore;
  const confidence = Math.round(Math.min(100, Math.abs(directionalScore) * 100 * volFactor * uFactor));
  const direction = directionalScore > 0.05 ? 'bullish' : directionalScore < -0.05 ? 'bearish' : 'neutral';

  reasons.push(trend.text, momentum.text, volatility.text, volume.text);
  reasons.push(`directional score 0.6×${trendScore.toFixed(2)} + 0.4×${momentumScore.toFixed(2)} = ${directionalScore.toFixed(2)} → ${direction}, confidence ${confidence}/100`);

  /* quality gates */
  if (direction === 'neutral') rejections.push('no directional edge (score within ±0.05)');
  if (direction === 'bearish') rejections.push('bearish read — spot market allows no short; treat as avoid/exit, not an entry');
  if (direction === 'bullish' && rsi >= 75) rejections.push(`overbought: RSI14 ${rsi.toFixed(0)} ≥ 75 — entering here chases an extended move`);
  if (trendScore >= 0.5 && momentumScore <= -0.5) rejections.push('indicator conflict: trend up but momentum strongly down');
  if (trendScore <= -0.5 && momentumScore >= 0.5) rejections.push('indicator conflict: trend down but momentum strongly up');
  if (regime === 'extreme') rejections.push(`extreme volatility (${vol30.toFixed(0)}% annualized) — position math unreliable`);
  if (confidence < minConfidence) rejections.push(`confidence ${confidence} below minimum ${minConfidence}`);

  return {
    direction, confidence,
    actionable: direction === 'bullish' && rejections.length === 0,
    directionalScore,
    components: { trend, momentum, volatility, volume },
    rejections, reasons,
  };
}

const signalsApi = { evaluateSignal, _volatilityFactor, _volumeFactor };
if (typeof module !== 'undefined') module.exports = signalsApi;
if (typeof window !== 'undefined') window.Signals = signalsApi;
