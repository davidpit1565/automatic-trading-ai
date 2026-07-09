/*
 * Stage 3 — Risk engine.
 * Turns an actionable signal into a complete, hand-checkable trade plan:
 * entry, ATR-based stop-loss and take-profit, risk/reward, and a position
 * size derived from a fixed percentage risk budget. Long-only (spot).
 *
 * SIZING MODEL (documented contract, mirrored by the test suite)
 *   effectiveAtr = atr × (atrIsCloseOnly ? closeOnlyAtrFactor : 1)
 *     — close-only ATR (no highs/lows in the data) understates true range;
 *       the factor (default 2.0) was measured against real BTC daily OHLC.
 *   stop   = entry − atrStopMult × effectiveAtr        (default 2×)
 *   target = entry + atrTargetMult × effectiveAtr      (default 3×)
 *   riskReward = (target − entry) / (entry − stop)
 *   riskBudget = equity × riskPerTradePct/100           (default 1%)
 *   units  = riskBudget / (entry − stop), then capped so that
 *   position ≤ equity × maxPositionPct/100              (default 20%)
 *   (capping lowers effective risk below budget, never above)
 *
 * REJECTION GATES (any failure ⇒ valid = false, reason recorded)
 *   - signal not bullish / not actionable / confidence < minConfidence
 *   - ATR missing or non-positive; prices non-positive
 *   - stop ≤ 0
 *   - riskReward < minRiskReward (default 1.5)
 *   - openRiskEur + new risk > equity × maxPortfolioRiskPct/100 (default 5%)
 *   - position below minPositionEur (default €10)
 */

const RISK_DEFAULTS = {
  riskPerTradePct: 1,
  maxPositionPct: 20,
  maxPortfolioRiskPct: 5,
  atrStopMult: 2,
  atrTargetMult: 3,
  minRiskReward: 1.5,
  minConfidence: 40,
  minPositionEur: 10,
  closeOnlyAtrFactor: 2.0,
};

function buildRecommendation({ signal, price, atr, atrIsCloseOnly, equity, openRiskEur = 0, config = {} }) {
  const cfg = { ...RISK_DEFAULTS, ...config };
  const rejections = [];
  const explanation = [];

  if (!signal || signal.direction !== 'bullish') rejections.push('signal is not bullish — long-only spot engine produces no plan');
  if (signal && signal.direction === 'bullish' && !signal.actionable) rejections.push('signal failed its quality gates — not actionable');
  if (signal && signal.confidence < cfg.minConfidence) rejections.push(`confidence ${signal.confidence} below minimum ${cfg.minConfidence}`);
  if (!(price > 0)) rejections.push('price must be positive');
  if (!(equity > 0)) rejections.push('equity must be positive');
  if (atr === null || atr === undefined || !(atr > 0)) rejections.push('ATR unavailable or non-positive — stop distance undefined');

  if (rejections.length) return _rejected(signal, rejections);

  const effectiveAtr = atr * (atrIsCloseOnly ? cfg.closeOnlyAtrFactor : 1);
  if (atrIsCloseOnly) {
    explanation.push(`ATR ${_n(atr)} is close-only (no high/low data) — calibrated ×${cfg.closeOnlyAtrFactor} to ${_n(effectiveAtr)} to approximate true range`);
  }

  const entry = price;
  const stopDistance = cfg.atrStopMult * effectiveAtr;
  const stopLoss = entry - stopDistance;
  const takeProfit = entry + cfg.atrTargetMult * effectiveAtr;
  const riskReward = (takeProfit - entry) / stopDistance;

  if (stopLoss <= 0) rejections.push(`stop-loss ${_n(stopLoss)} not positive — ATR too large relative to price for a sane stop`);
  // 1e-9 tolerance: riskReward is computed from floating-point subtraction,
  // so a plan sitting exactly on the minimum (e.g. the default 3x/2x = 1.5)
  // must not be rejected by rounding noise.
  if (riskReward < cfg.minRiskReward - 1e-9) rejections.push(`risk/reward ${riskReward.toFixed(2)} below minimum ${cfg.minRiskReward}`);
  if (rejections.length) return _rejected(signal, rejections);

  const riskBudget = equity * cfg.riskPerTradePct / 100;
  let units = riskBudget / stopDistance;
  let positionEur = units * entry;
  const maxPositionEur = equity * cfg.maxPositionPct / 100;
  let capped = false;
  if (positionEur > maxPositionEur) {
    capped = true;
    units = maxPositionEur / entry;
    positionEur = maxPositionEur;
  }
  const riskEur = units * stopDistance;

  if (positionEur < cfg.minPositionEur) rejections.push(`position €${_n(positionEur)} below €${cfg.minPositionEur} minimum — too small to be meaningful after costs`);
  const maxPortfolioRiskEur = equity * cfg.maxPortfolioRiskPct / 100;
  if (openRiskEur + riskEur > maxPortfolioRiskEur) {
    rejections.push(`portfolio risk cap: €${_n(openRiskEur)} already at risk + €${_n(riskEur)} new would exceed €${_n(maxPortfolioRiskEur)} (${cfg.maxPortfolioRiskPct}% of equity)`);
  }
  if (rejections.length) return _rejected(signal, rejections);

  explanation.push(`entry at ${_n(entry)}, stop at ${_n(stopLoss)} (${cfg.atrStopMult}× ATR below), target at ${_n(takeProfit)} (${cfg.atrTargetMult}× ATR above) → risk/reward ${riskReward.toFixed(2)}`);
  explanation.push(`risk budget ${cfg.riskPerTradePct}% of €${_n(equity)} = €${_n(riskBudget)}; if the stop is hit the loss is €${_n(riskEur)}`);
  explanation.push(capped
    ? `raw size would exceed the ${cfg.maxPositionPct}% position cap — capped at €${_n(positionEur)} (effective risk €${_n(riskEur)}, below budget)`
    : `position €${_n(positionEur)} (${(positionEur / equity * 100).toFixed(1)}% of equity), ${_n(units)} units`);
  explanation.push(`plan invalid if price closes below ${_n(stopLoss)} — that is the signal being wrong, exit without debate`);

  return {
    valid: true,
    entry, stopLoss, takeProfit, riskReward,
    units, positionEur, riskEur,
    confidence: signal.confidence,
    rejections: [],
    explanation,
  };
}

function _rejected(signal, rejections) {
  return {
    valid: false,
    entry: null, stopLoss: null, takeProfit: null, riskReward: null,
    units: null, positionEur: null, riskEur: null,
    confidence: signal ? signal.confidence : null,
    rejections,
    explanation: ['no trade plan: ' + rejections.join('; ')],
  };
}

function _n(v) {
  if (v === null || v === undefined) return '—';
  const abs = Math.abs(v);
  return v.toLocaleString('en-IE', {
    minimumFractionDigits: abs < 10 ? 4 : 2,
    maximumFractionDigits: abs < 10 ? 4 : 2,
  });
}

const riskApi = { buildRecommendation, RISK_DEFAULTS };
if (typeof module !== 'undefined') module.exports = riskApi;
if (typeof window !== 'undefined') window.Risk = riskApi;
