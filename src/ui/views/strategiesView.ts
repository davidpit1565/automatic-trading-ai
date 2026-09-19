/**
 * Operations Console — Strategies. Shadow candidates the system forward-
 * tests for free (`shadowEvaluator.ts`) against the CHAMPION — the one
 * shadow whose config mirrors real production exactly (`CHAMPION_KEY`).
 *
 * Everything on this screen is SIMULATED — nothing here trades or risks
 * real money (see `shadowEvaluator.ts`'s own top comment). It exists
 * purely to make a promotion decision informed, never automatic: this
 * project's own established rule is that promoting a challenger still
 * always needs separate validation against real history and David's
 * explicit approval — `compareToChampion` is only one input to that,
 * deliberately never collapsed into a single "wins" verdict here either.
 */

import { fetchCloudState, type CloudShadowStanding } from '../cloudState';
import { formatPct, escapeHtml } from '../format';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

/** Mirrors `src/core/autopilot/shadowEvaluator.ts`'s own `CHAMPION_KEY` and
 * `SHADOW_MEANINGFUL_TRADES` — kept as local constants (rather than
 * imported) because the UI layer's architecture test deliberately restricts
 * which `core/autopilot` modules it may import from (`paperAutoPilot` /
 * `killSwitch` / `auditLog` only — see `tests/ui/architecture.test.ts`), and
 * `shadowEvaluator.ts` pulls in the full signal/portfolio/trailing-stop
 * stack that boundary exists to keep out of presentation code. Same
 * approach `cloudState.ts` already uses for `CONFIRMATION_WINDOW_MS`. */
const CHAMPION_KEY = 'live-mirror';
const SHADOW_MEANINGFUL_TRADES = 20;

interface ChallengerComparison {
  readonly comparable: boolean;
  readonly reason?: string;
  readonly challengerAheadOn: readonly string[];
  readonly championAheadOn: readonly string[];
}

/** Same comparison `shadowEvaluator.ts`'s own `compareToChampion` computes —
 * deliberately never collapsed into a single "wins" verdict (this project's
 * rule: don't judge by profit factor alone), just which named metrics each
 * side leads on. */
function compareToChampion(champion: CloudShadowStanding, challenger: CloudShadowStanding): ChallengerComparison {
  if (challenger.trades < SHADOW_MEANINGFUL_TRADES) {
    return {
      comparable: false,
      reason: `challenger '${challenger.key}' has only ${challenger.trades}/${SHADOW_MEANINGFUL_TRADES} trades — too early to trust`,
      challengerAheadOn: [],
      championAheadOn: [],
    };
  }
  if (champion.trades < SHADOW_MEANINGFUL_TRADES) {
    return {
      comparable: false,
      reason: `champion '${champion.key}' itself has only ${champion.trades}/${SHADOW_MEANINGFUL_TRADES} trades — no reliable baseline to compare against yet`,
      challengerAheadOn: [],
      championAheadOn: [],
    };
  }
  const challengerAheadOn: string[] = [];
  const championAheadOn: string[] = [];
  const compare = (name: string, championValue: number | null, challengerValue: number | null): void => {
    if (championValue === null || challengerValue === null) return;
    if (challengerValue > championValue) challengerAheadOn.push(name);
    else if (championValue > challengerValue) championAheadOn.push(name);
  };
  compare('returnPct', champion.returnPct, challenger.returnPct);
  compare('profitFactor', champion.profitFactor, challenger.profitFactor);
  compare('winRatePct', champion.winRatePct, challenger.winRatePct);
  return { comparable: true, challengerAheadOn, championAheadOn };
}

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

function standingCardHtml(s: CloudShadowStanding, isChampion: boolean, comparison: ChallengerComparison | null): string {
  const winRate = s.winRatePct !== null ? `${s.winRatePct.toFixed(1)}%` : '—';
  const profitFactor = s.profitFactor !== null ? s.profitFactor.toFixed(2) : '—';
  const tooEarly = s.trades < SHADOW_MEANINGFUL_TRADES;
  return `
    <div class="ops-action-card">
      <div class="ops-action-symbol">${escapeHtml(s.label)}${isChampion ? ' · CHAMPION' : ''}</div>
      <div class="ops-action-row"><span>Return</span><span>${formatPct(s.returnPct)}</span></div>
      <div class="ops-action-row"><span>Trades</span><span>${s.trades}${tooEarly ? ` (< ${SHADOW_MEANINGFUL_TRADES}, too early)` : ''}</span></div>
      <div class="ops-action-row"><span>Win rate</span><span>${winRate}</span></div>
      <div class="ops-action-row"><span>Profit factor</span><span>${profitFactor}</span></div>
      <div class="ops-action-row"><span>Open positions</span><span>${s.openPositions}</span></div>
      ${isChampion ? '' : comparisonHtml(comparison)}
    </div>`;
}

export function renderStrategiesView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <button class="tool-back" data-nav="overview">← Overview</button>
    <h2 class="view-title">Strategies</h2>
    <p class="view-sub">Forward-tested candidates — all simulated, never real money — compared against the champion that mirrors live production.</p>
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
