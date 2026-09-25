/**
 * Per-symbol forward-test readiness for every `CANDIDATE_INSTRUMENTS` coin —
 * the missing piece `shadowStandings.mts` can't show, since `candidate-watch`
 * pools all candidates into one basket. Answers "does any specific candidate
 * have enough of its OWN real trades to responsibly consider promoting it
 * into `CURATED_INSTRUMENTS`," never decides the promotion itself.
 *
 * Read-only. Run: npx tsx scripts/candidateReadiness.mts
 */

import { FileStore } from '../server/fileStore.mts';
import { PrefixedStore } from '../src/core/data/prefixedStore';
import { candidateReadinessBySymbol } from '../src/core/autopilot/candidateReadiness';
import { SHADOW_MEANINGFUL_TRADES } from '../src/core/autopilot/shadowEvaluator';
import { TradeJournal } from '../src/core/position/tradeJournal';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';

const store = new FileStore(STATE_PATH);
const journal = new TradeJournal(new PrefixedStore(store, 'shadow:candidate-watch'));
const bySymbol = candidateReadinessBySymbol(journal.entries());

if (bySymbol.length === 0) {
  console.log('No candidate-watch trades recorded yet — the cloud runner writes them each cycle.');
  process.exit(0);
}

console.log(`Candidate readiness, ${bySymbol.length} symbols with at least one closed trade:\n`);
console.log('symbol       | trades |  win%  |   PF   |   return €');
console.log('-------------|--------|--------|--------|-----------');
for (const { symbol, analytics } of bySymbol) {
  console.log(
    `${symbol.padEnd(12)} | ${String(analytics.tradeCount).padStart(6)} | ` +
      `${(analytics.winRatePct === null ? '—' : `${analytics.winRatePct.toFixed(0)}%`).padStart(6)} | ` +
      `${(analytics.profitFactor === null ? '—' : analytics.profitFactor.toFixed(2)).padStart(6)} | ` +
      `${analytics.totalPnl >= 0 ? '+' : ''}${analytics.totalPnl.toFixed(2)}`,
  );
}

const mature = bySymbol.filter((r) => r.mature);
console.log('');
if (mature.length === 0) {
  const busiest = bySymbol[0]!;
  console.log(
    `No symbol has cleared ${SHADOW_MEANINGFUL_TRADES} of its OWN trades yet — the busiest ` +
      `(${busiest.symbol}) has ${busiest.analytics.tradeCount}. Nothing here is ready to ` +
      'consider for CURATED_INSTRUMENTS from this data alone.',
  );
} else {
  console.log(`${mature.length} symbol(s) have cleared ${SHADOW_MEANINGFUL_TRADES} of their own trades:`);
  for (const r of mature) {
    console.log(
      `  ${r.symbol}: ${r.analytics.tradeCount} trades, PF ${r.analytics.profitFactor?.toFixed(2) ?? '—'}, ` +
        `${r.analytics.totalPnl >= 0 ? '+' : ''}${r.analytics.totalPnl.toFixed(2)} — still verify against ` +
        'Revolut X tradability and a second window before promoting.',
    );
  }
}
