/**
 * Operations Console — Strategies. Shadow candidates the system forward-
 * tests for free (`shadowEvaluator.ts`) against the CHAMPION — the one
 * shadow whose config mirrors real production exactly (`CHAMPION_KEY`).
 *
 * Everything on this screen is SIMULATED — nothing here trades or risks
 * real money (see `shadowEvaluator.ts`'s own top comment). It exists
 * purely to make a promotion decision informed, never automatic: this
 * project's own established rule is that promoting a challenger still
 * always needs separate validation against real history and explicit
 * human approval — `compareToChampion` is only one input to that,
 * deliberately never collapsed into a single "wins" verdict here either.
 */

import { fetchCloudState, type CloudShadowStanding } from '../cloudState';
import {
  CHAMPION_KEY,
  SHADOW_MEANINGFUL_TRADES,
  compareToChampion,
  type ChallengerComparison,
} from '../../core/autopilot/championComparison';
import { formatPct, escapeHtml } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

const METRIC_LABEL: Record<string, string> = {
  returnPct: 'Return',
  profitFactor: 'Profit factor',
  winRatePct: 'Win rate',
};

function metricNames(keys: readonly string[]): string {
  return keys.length === 0 ? '—' : keys.map((k) => METRIC_LABEL[k] ?? k).join(', ');
}

function comparisonHtml(comparison: ChallengerComparison | null): string {
  if (!comparison) return `<div class="ops-action-row"><span>vs. champion</span><span>no champion running yet</span></div>`;
  if (!comparison.comparable) {
    return `<div class="ops-action-row"><span>vs. champion</span><span>not yet comparable</span></div>
      <div class="ops-empty">${escapeHtml(comparison.reason ?? '')}</div>`;
  }
  return `
    <div class="ops-action-row"><span>Ahead on</span><span>${metricNames(comparison.challengerAheadOn)}</span></div>
    <div class="ops-action-row"><span>Behind on</span><span>${metricNames(comparison.championAheadOn)}</span></div>`;
}

/** "17 closed trades / Minimum evaluation sample: 20 / Not yet meaningful" —
 * makes the sample-size bar visible even for a candidate ahead of it,
 * rather than only implicitly hiding the comparison below the threshold. */
function sampleSizeHtml(trades: number): string {
  const tooEarly = trades < SHADOW_MEANINGFUL_TRADES;
  return `
      <div class="ops-action-row"><span>Sample size</span><span>${trades} closed trade${trades === 1 ? '' : 's'}</span></div>
      <div class="ops-action-row"><span>Minimum evaluation sample</span><span>${SHADOW_MEANINGFUL_TRADES}</span></div>
      ${tooEarly ? '<div class="ops-note">Not yet meaningful</div>' : ''}`;
}

function standingCardHtml(s: CloudShadowStanding, isChampion: boolean, comparison: ChallengerComparison | null): string {
  const winRate = s.winRatePct !== null ? `${s.winRatePct.toFixed(1)}%` : '—';
  const profitFactor = s.profitFactor !== null ? s.profitFactor.toFixed(2) : '—';
  return `
    <div class="ops-action-card">
      <div class="ops-action-symbol">${escapeHtml(s.label)}${isChampion ? ' · CHAMPION' : ''}</div>
      <div class="ops-action-row"><span>Return</span><span>${formatPct(s.returnPct)}</span></div>
      <div class="ops-action-row"><span>Win rate</span><span>${winRate}</span></div>
      <div class="ops-action-row"><span>Profit factor</span><span>${profitFactor}</span></div>
      <div class="ops-action-row"><span>Open positions</span><span>${s.openPositions}</span></div>
      ${sampleSizeHtml(s.trades)}
      ${isChampion ? '' : comparisonHtml(comparison)}
    </div>`;
}

export function renderStrategiesView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Strategies</h2>
    <p class="view-sub ops-shadow-label">SHADOW · SIMULATION · NO REAL MONEY — forward-tested candidates compared against the champion that mirrors live production.</p>
    <div id="sv-empty" class="ops-empty" hidden>No shadow candidates have run yet.</div>
    <div id="sv-list" class="ops-action-list"></div>
    <p class="muted-line" id="sv-status">Loading…</p>`;

  const emptyEl = container.querySelector<HTMLElement>('#sv-empty')!;
  const listEl = container.querySelector<HTMLElement>('#sv-list')!;
  const statusEl = container.querySelector<HTMLElement>('#sv-status')!;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    if (!state) {
      statusEl.textContent = 'Unable to load the operations state. Retrying automatically.';
      return;
    }
    const standings = state.shadowStandings;
    emptyEl.hidden = standings.length !== 0;
    const champion = standings.find((s) => s.key === CHAMPION_KEY) ?? null;
    listEl.innerHTML = standings
      .map((s) => {
        const isChampion = s.key === CHAMPION_KEY;
        const comparison = !isChampion && champion ? compareToChampion(champion, s) : null;
        return standingCardHtml(s, isChampion, comparison);
      })
      .join('');
    statusEl.textContent = `Updated ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  }

  let timer = 0;
  void load();
  timer = window.setInterval(() => void load(), REFRESH_MS);

  return {
    pause: () => window.clearInterval(timer),
    resume: () => {
      void load();
      timer = window.setInterval(() => void load(), REFRESH_MS);
    },
  };
}
