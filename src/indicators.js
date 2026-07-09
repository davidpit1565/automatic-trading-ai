/*
 * Technical indicator engine.
 * Pure functions over arrays of numbers. No side effects, no I/O.
 * All array-returning indicators return arrays the SAME LENGTH as the
 * input, with `null` for warm-up positions where the value is undefined.
 * Descriptive only: nothing in this file produces trade advice.
 */

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with SMA of the first `period` values (standard convention).
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/* Wilder's RSI. First value at index `period` (needs `period` deltas). */
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  const toRsi = (g, l) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[period] = toRsi(avgGain, avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = toRsi(avgGain, avgLoss);
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i] - emaSlow[i] : null);
  // Signal = EMA of the macd line, computed over its non-null tail.
  const firstIdx = macdLine.findIndex(v => v !== null);
  const signal = new Array(values.length).fill(null);
  const histogram = new Array(values.length).fill(null);
  if (firstIdx !== -1) {
    const tail = macdLine.slice(firstIdx);
    const sigTail = ema(tail, signalPeriod);
    for (let i = 0; i < sigTail.length; i++) {
      if (sigTail[i] !== null) {
        signal[firstIdx + i] = sigTail[i];
        histogram[firstIdx + i] = tail[i] - sigTail[i];
      }
    }
  }
  return { macd: macdLine, signal, histogram };
}

/* Population standard deviation over a rolling window. */
function rollingStd(values, period) {
  const out = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

function bollinger(values, period = 20, mult = 2) {
  const middle = sma(values, period);
  const std = rollingStd(values, period);
  const upper = middle.map((m, i) => (m !== null ? m + mult * std[i] : null));
  const lower = middle.map((m, i) => (m !== null ? m - mult * std[i] : null));
  return { middle, upper, lower };
}

/* Annualized volatility (%) from daily log returns over a lookback window. */
function annualizedVolatility(closes, lookback = 30) {
  if (closes.length < lookback + 1) return null;
  const rets = [];
  for (let i = closes.length - lookback; i < closes.length; i++) {
    rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(365) * 100;
}

/* Max peak-to-trough drawdown (%, positive number) of a series. */
function maxDrawdown(values) {
  let peak = -Infinity, maxDd = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak * 100;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

/*
 * Wilder's Average True Range. First value at index `period` (needs
 * `period` true ranges, which start at index 1).
 * With close-only data pass highs = lows = closes: TR then reduces to
 * |close - prevClose|, which understates range-based ATR — callers must
 * account for that when data has no highs/lows.
 */
function atr(highs, lows, closes, period = 14) {
  const n = closes.length;
  const out = new Array(n).fill(null);
  if (n <= period) return out;
  const tr = i => Math.max(
    highs[i] - lows[i],
    Math.abs(highs[i] - closes[i - 1]),
    Math.abs(lows[i] - closes[i - 1]));
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < n; i++) {
    prev = (prev * (period - 1) + tr(i)) / period;
    out[i] = prev;
  }
  return out;
}

/* Latest volume relative to its N-day average (1.0 = average). */
function volumeRatio(volumes, period = 20) {
  const avg = sma(volumes, period);
  const last = avg[avg.length - 1];
  if (last === null || last === 0) return null;
  return volumes[volumes.length - 1] / last;
}

function pctChange(closes, days) {
  if (closes.length <= days) return null;
  const then = closes[closes.length - 1 - days];
  return (closes[closes.length - 1] - then) / then * 100;
}

/*
 * Descriptive market reading for one asset. Returns factual observations
 * with plain-language labels. Explicitly NOT a recommendation.
 */
function analyzeMarket(closes, volumes) {
  const last = closes[closes.length - 1];
  const sma50 = sma(closes, 50), sma200 = sma(closes, 200);
  const s50 = sma50[sma50.length - 1], s200 = sma200[sma200.length - 1];
  const r = rsi(closes, 14);
  const lastRsi = r[r.length - 1];
  const m = macd(closes);
  const lastHist = m.histogram[m.histogram.length - 1];
  const prevHist = m.histogram[m.histogram.length - 2];
  const bb = bollinger(closes, 20, 2);
  const bbU = bb.upper[bb.upper.length - 1], bbL = bb.lower[bb.lower.length - 1];
  const vol30 = annualizedVolatility(closes, 30);
  const volR = volumes && volumes.length ? volumeRatio(volumes, 20) : null;

  let trend = 'unclear';
  if (s50 !== null && s200 !== null) {
    if (last > s50 && s50 > s200) trend = 'uptrend';
    else if (last < s50 && s50 < s200) trend = 'downtrend';
    else trend = 'mixed';
  } else if (s50 !== null) {
    trend = last > s50 ? 'above 50-day average' : 'below 50-day average';
  }

  let momentum = 'neutral';
  if (lastRsi !== null) {
    if (lastRsi >= 70) momentum = 'overbought';
    else if (lastRsi <= 30) momentum = 'oversold';
    else if (lastRsi > 55) momentum = 'positive';
    else if (lastRsi < 45) momentum = 'negative';
  }

  let macdState = 'flat';
  if (lastHist !== null && prevHist !== null) {
    if (lastHist > 0) macdState = lastHist > prevHist ? 'bullish, strengthening' : 'bullish, weakening';
    else if (lastHist < 0) macdState = lastHist < prevHist ? 'bearish, strengthening' : 'bearish, weakening';
  }

  let bbPos = null;
  if (bbU !== null && bbU !== bbL) bbPos = (last - bbL) / (bbU - bbL);

  let volRegime = 'unknown';
  if (vol30 !== null) {
    if (vol30 < 30) volRegime = 'calm';
    else if (vol30 < 60) volRegime = 'normal';
    else if (vol30 < 100) volRegime = 'elevated';
    else volRegime = 'extreme';
  }

  return {
    price: last,
    change7d: pctChange(closes, 7),
    change30d: pctChange(closes, 30),
    trend, momentum,
    rsi: lastRsi,
    macdState,
    bollingerPosition: bbPos,
    volatility30d: vol30,
    volatilityRegime: volRegime,
    volumeRatio: volR,
    maxDrawdown365: maxDrawdown(closes),
  };
}

const api = {
  sma, ema, rsi, macd, rollingStd, bollinger, atr,
  annualizedVolatility, maxDrawdown, volumeRatio, pctChange, analyzeMarket,
};
if (typeof module !== 'undefined') module.exports = api;
if (typeof window !== 'undefined') window.Indicators = api;
