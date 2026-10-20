/**
 * Scores the production record and every shadow candidate against the
 * pre-registered promotion bar (`src/core/autopilot/promotionBar.ts`), on NET
 * P&L. Read-only.
 *
 *   npx tsx scripts/promotionScorecard.mts          # state/autopilot-state.json
 *   AUTOPILOT_STATE_PATH=/tmp/state.json npx tsx scripts/promotionScorecard.mts
 */

import { readFileSync } from 'node:fs';
import { HIGH_RISK_MAX_DRAWDOWN_PCT, PROMOTION_BAR, assessPromotion, type PromotionTrade } from '../src/core/autopilot/promotionBar';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Record<string, unknown>;
const INITIAL = 10_000;

const rows: { name: string; journal: PromotionTrade[] }[] = [
  { name: 'PRODUCTION', journal: (state['trade-journal'] as PromotionTrade[] | undefined) ?? [] },
];
for (const key of Object.keys(state)) {
  const m = /^shadow:(.+):trade-journal$/.exec(key);
  if (m) rows.push({ name: m[1]!, journal: state[key] as PromotionTrade[] });
}

const yn = (b: boolean): string => (b ? 'ok ' : 'NO ');
console.log(
  `Promotion bar: >=${PROMOTION_BAR.minTrades} trades, PF>=${PROMOTION_BAR.minProfitFactor}, ` +
    `>=${PROMOTION_BAR.minPartsProfitable}/${PROMOTION_BAR.parts} parts profitable, ` +
    `P(mean<=0)<=${PROMOTION_BAR.maxProbabilityMeanNotPositive}, maxDD<${PROMOTION_BAR.maxDrawdownPct}% (NET of fees); risk-* candidates: maxDD<${HIGH_RISK_MAX_DRAWDOWN_PCT}%\n`,
);
console.log('candidate'.padEnd(24), 'trades  PF    parts  P(<=0)  maxDD   net EUR   verdict');
for (const { name, journal } of rows.sort((a, b) => b.journal.length - a.journal.length)) {
  const highRisk = name.startsWith('risk-');
  const v = assessPromotion(journal, INITIAL, highRisk ? HIGH_RISK_MAX_DRAWDOWN_PCT : undefined);
  const verdict = v.passes ? 'PASSES (still needs the random-entry control)' : v.testable ? 'fails' : `not testable yet (${v.trades}/${PROMOTION_BAR.minTrades})`;
  console.log(
    name.padEnd(24),
    String(v.trades).padStart(6),
    (v.profitFactor === null ? '  -  ' : v.profitFactor === Infinity ? '  inf' : v.profitFactor.toFixed(2).padStart(5)),
    `${v.partsProfitable}/${PROMOTION_BAR.parts}`.padStart(5),
    v.probabilityMeanNotPositive.toFixed(2).padStart(7),
    `${v.maxDrawdownPct.toFixed(1)}%`.padStart(7),
    v.totalNetPnl.toFixed(0).padStart(9),
    ' ',
    yn(v.checks.profitFactor) + yn(v.checks.parts) + yn(v.checks.significance) + yn(v.checks.drawdown),
    verdict,
  );
}
