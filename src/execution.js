/*
 * Execution layer — Revolut X connector boundary.
 * STRICTLY ISOLATED from analysis: nothing in the data/indicator/signal/
 * risk/validation layers imports this module. It consumes their outputs.
 *
 * SAFETY MODEL
 *   modes: 'disconnected' (nothing works), 'read-only' (market data and
 *   account reads only — the DEFAULT and the required first step),
 *   'trading' (order placement possible, but only for a proposal that a
 *   human explicitly confirmed with the literal phrase "CONFIRM TRADE",
 *   and only within hard guardrails).
 *
 *   Guardrails in trading mode (all mandatory):
 *     maxPositionEur          — per-order position cap
 *     maxDailyLossEur         — cumulative at-risk cap per session/day
 *     maxPortfolioExposureEur — total open exposure cap
 *     emergencyStop()         — kill switch: blocks all orders, reads stay up
 *   Every action AND every refusal is appended to an immutable log.
 *
 *   The transport (real Revolut X API client, or a mock in tests) is
 *   INJECTED — this module contains no network code and no credentials.
 *   A real transport must never be wired up before: validation harness
 *   passes, paper trading proves behavior, risk limits are tested, and a
 *   security review is complete (see docs/ROADMAP.md and Revolut's
 *   security policy).
 *
 *   Unattended trading is not supported by design: there is no code path
 *   to an order without a fresh human confirmation.
 */

const READ_METHODS = ['getPrices', 'getCandles', 'getBalances', 'getPositions', 'listAssets'];
const CONFIRMATION_PHRASE = 'CONFIRM TRADE';

function createConnector({ mode, transport, guards = {}, now = Date.now }) {
  if (!['disconnected', 'read-only', 'trading'].includes(mode)) {
    throw new Error(`unknown mode: ${mode}`);
  }
  const log = [];
  const state = {
    stopped: false,
    dailyRiskUsedEur: 0,
    openExposureEur: 0,
  };
  const record = (event, detail) => log.push({ t: now(), event, ...detail });

  const api = { mode, getLog: () => log.slice() };

  for (const m of READ_METHODS) {
    api[m] = async (...args) => {
      if (mode === 'disconnected') {
        record('read_refused', { method: m, reason: 'connector disconnected — no permissions' });
        throw new Error(`permission denied: connector is disconnected (${m})`);
      }
      record('read', { method: m });
      return transport[m](...args);
    };
  }

  api.emergencyStop = (reason) => {
    state.stopped = true;
    record('emergency_stop', { reason: reason || 'unspecified' });
  };

  api.placeOrder = async (proposal) => {
    const refuse = (reason) => {
      record('order_refused', { pair: proposal && proposal.pair, reason });
      throw new Error(reason);
    };
    if (mode !== 'trading') {
      refuse(`read-only/disconnected mode: order placement has no permission (mode=${mode})`);
    }
    if (state.stopped) refuse('emergency stop is active — all trading halted');
    if (!proposal || proposal.confirmed !== true || proposal.confirmationPhrase !== CONFIRMATION_PHRASE) {
      refuse('order requires an explicitly confirmed proposal (human must type CONFIRM TRADE)');
    }
    if (!(guards.maxPositionEur > 0) || !(guards.maxDailyLossEur > 0) || !(guards.maxPortfolioExposureEur > 0)) {
      refuse('trading mode requires all guardrails: maxPositionEur, maxDailyLossEur, maxPortfolioExposureEur');
    }
    if (proposal.positionEur > guards.maxPositionEur) {
      refuse(`position €${proposal.positionEur} exceeds max position size €${guards.maxPositionEur}`);
    }
    if (state.dailyRiskUsedEur + proposal.riskEur > guards.maxDailyLossEur) {
      refuse(`daily loss limit: €${state.dailyRiskUsedEur} already at risk + €${proposal.riskEur} would exceed €${guards.maxDailyLossEur}`);
    }
    if (state.openExposureEur + proposal.positionEur > guards.maxPortfolioExposureEur) {
      refuse(`portfolio exposure: €${state.openExposureEur} open + €${proposal.positionEur} would exceed €${guards.maxPortfolioExposureEur}`);
    }
    const order = await transport.placeOrder({
      pair: proposal.pair, side: 'buy',
      units: proposal.units, limitPrice: proposal.entry,
      stopLoss: proposal.stopLoss, takeProfit: proposal.takeProfit,
    });
    state.dailyRiskUsedEur += proposal.riskEur;
    state.openExposureEur += proposal.positionEur;
    record('order_placed', { pair: proposal.pair, orderId: order.id, positionEur: proposal.positionEur, riskEur: proposal.riskEur });
    return order;
  };

  record('connector_created', { mode });
  return api;
}

let _proposalSeq = 0;

/* Build a complete, human-readable trade proposal from verified engine
 * output. Refuses anything the risk engine did not mark valid. */
function createTradeProposal({ pair, signal, recommendation, now = Date.now }) {
  if (!recommendation || recommendation.valid !== true) {
    throw new Error('cannot propose: recommendation is not valid (risk engine rejected it)');
  }
  if (!signal || signal.direction !== 'bullish' || !signal.actionable) {
    throw new Error('cannot propose: signal is not an actionable bullish signal');
  }
  _proposalSeq += 1;
  return {
    id: `prop-${_proposalSeq}`,
    createdAt: now(),
    pair,
    direction: 'long',
    entry: recommendation.entry,
    stopLoss: recommendation.stopLoss,
    takeProfit: recommendation.takeProfit,
    riskReward: recommendation.riskReward,
    units: recommendation.units,
    positionEur: recommendation.positionEur,
    riskEur: recommendation.riskEur,
    confidence: signal.confidence,
    reasoning: [...signal.reasons, ...recommendation.explanation],
    status: 'pending',
    requiresConfirmation: true,
    confirmed: false,
  };
}

/* The human gate. Returns a NEW object; the pending proposal is never
 * mutated. Only the literal phrase passes. */
function confirmProposal(proposal, phrase, { now = Date.now } = {}) {
  if (phrase !== CONFIRMATION_PHRASE) {
    return { ok: false, error: `confirmation phrase must be exactly "${CONFIRMATION_PHRASE}"` };
  }
  return {
    ok: true,
    proposal: {
      ...proposal,
      confirmed: true,
      status: 'confirmed',
      confirmationPhrase: phrase,
      confirmedAt: now(),
    },
  };
}

function _fmt(v) {
  const abs = Math.abs(v);
  return v.toLocaleString('en-IE', {
    minimumFractionDigits: abs < 10 ? 4 : 2,
    maximumFractionDigits: abs < 10 ? 4 : 2,
  });
}

function formatProposal(p) {
  return [
    `${p.pair} ${p.direction} proposal (confidence ${p.confidence}/100):`,
    `  Entry:  €${_fmt(p.entry)}`,
    `  Stop:   €${_fmt(p.stopLoss)}`,
    `  Target: €${_fmt(p.takeProfit)}  (risk/reward ${p.riskReward.toFixed(2)})`,
    `  Size:   €${_fmt(p.positionEur)} (${p.units} units) — risk €${_fmt(p.riskEur)} if stopped`,
    `  Reason:`,
    ...p.reasoning.map(r => `   • ${r}`),
    ``,
    `  This is a proposal, not an order. Nothing executes unless a human`,
    `  replies with exactly: ${CONFIRMATION_PHRASE}`,
  ].join('\n');
}

const executionApi = {
  createConnector, createTradeProposal, confirmProposal, formatProposal,
  CONFIRMATION_PHRASE, READ_METHODS,
};
if (typeof module !== 'undefined') module.exports = executionApi;
if (typeof window !== 'undefined') window.Execution = executionApi;
