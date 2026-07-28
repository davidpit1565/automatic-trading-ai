/**
 * Print the shadow candidates' forward-test scoreboard from the state file.
 *
 * These records are built cycle by cycle on live data by the cloud runner, so
 * unlike a sweep they cannot have been fitted to the window they are scored on.
 * That is the whole point: a candidate that looks good here looked good on bars
 * it had never seen.
 *
 * Read-only. Run: npx tsx scripts/shadowStandings.mts
 */

import { FileStore } from '../server/fileStore.mts';
import type { ShadowStanding } from '../src/core/autopilot/shadowEvaluator';

const STATE_PATH = process.env['AUTOPILOT_STATE_PATH'] ?? 'state/autopilot-state.json';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Below this, a record is too short to mean anything — say so rather than rank it. */
const MEANINGFUL_TRADES = 20;

const store = new FileStore(STATE_PATH);
const saved = store.get<{ at: number; standings: ShadowStanding[] }>('shadow-standings');

if (!saved || saved.standings.length === 0) {
  console.log('No shadow standings recorded yet — the cloud runner writes them each cycle.');
} else {
  const age = (Date.now() - saved.at) / 1000 / 60;
  console.log(`Shadow standings, recorded ${age.toFixed(0)} minutes ago:\n`);
  console.log('candidate         |   return |  PF   | trades | win%  | open | days');
  console.log('------------------|----------|-------|--------|-------|------|-----');

  for (const s of [...saved.standings].sort((a, b) => b.returnPct - a.returnPct)) {
    const days = (Date.now() - s.startedAt) / DAY_MS;
    console.log(
      `${s.key.padEnd(17)} | ${`${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(2)}%`.padStart(8)} | ` +
        `${(s.profitFactor === null ? '—' : s.profitFactor.toFixed(2)).padStart(5)} | ` +
        `${String(s.trades).padStart(6)} | ` +
        `${(s.winRatePct === null ? '—' : `${s.winRatePct.toFixed(0)}%`).padStart(5)} | ` +
        `${String(s.openPositions).padStart(4)} | ${days.toFixed(1)}`,
    );
  }

  console.log('');
  for (const s of saved.standings) console.log(`  ${s.key.padEnd(17)} ${s.label}`);

  const ranked = saved.standings.filter((s) => s.trades >= MEANINGFUL_TRADES);
  console.log('');
  if (ranked.length === 0) {
    const most = Math.max(...saved.standings.map((s) => s.trades));
    console.log(
      `Too early to rank: the busiest candidate has ${most} trades, under the ` +
        `${MEANINGFUL_TRADES} needed before a difference means anything. Let it run.`,
    );
  } else {
    console.log(
      `${ranked.length} candidate(s) have cleared ${MEANINGFUL_TRADES} trades and can be compared.`,
    );
  }
}
