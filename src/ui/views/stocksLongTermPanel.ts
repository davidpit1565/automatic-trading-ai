/**
 * Stocks "Long-Term" sub-page: a separate, fully simulated shadow wallet that
 * holds through a trend for weeks/months (daily bars, EMA50 trend-exit
 * instead of a fixed take-profit) rather than the main account's tight
 * stop-loss trading — see `shadowEvaluator.ts` / `stocksRunner.mts`'s
 * `STOCKS_SHADOW_CANDIDATES`. Fully isolated: cannot affect the real stocks
 * account or real money. Reads the same committed `state/stocks-state.json`
 * as the rest of the Stocks hub (see `cloudState.ts`).
 */

import { fetchStocksState } from '../cloudState';
import { formatPct, formatPriceSplit } from '../format';
import { skeletonRowsHtml } from '../loadingStates';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;
const LONG_TERM_KEY = 'long-term';
/**
 * Mirrors `SHADOW_MEANINGFUL_TRADES` in `shadowEvaluator.ts` — below this
 * many closed trades, a return is noise, not proven edge. Duplicated rather
 * than imported: the browser and server sides are kept independent here
 * (see `cloudState.ts`'s own doc comment on why state is read from a plain
 * JSON file rather than any shared runtime module).
 */
const MEANINGFUL_TRADES = 20;

function row(title: string, value: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  r.innerHTML = `
    <div class="row-main"><div><div class="row-title">${title}</div></div></div>
    <div class="row-side"><span class="row-title">${value}</span></div>`;
  return r;
}

export function renderStocksLongTermPanel(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <section class="block">
      <div class="block-head"><h2>Long-term investing</h2></div>
      <p class="view-sub">A separate simulated wallet that holds through a trend for weeks or months
        instead of the main strategy's tight stop-loss trading — same signal engine, daily bars, no fixed take-profit.</p>
    </section>
    <div class="stack stack-card" id="lt-waiting">${skeletonRowsHtml(2)}</div>
    <div id="lt-content" hidden>
      <section class="hero">
        <div class="hero-label">Long-term wallet <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value" id="lt-equity">—</div>
        <div class="hero-change" id="lt-change"></div>
        <div class="hero-split"><span id="lt-trades"></span><span id="lt-open"></span></div>
      </section>
      <section class="block"><div class="block-head"><h2>Track record</h2></div>
        <div class="stack stack-card" id="lt-stats"></div>
      </section>
      <p class="muted-line" id="lt-status">Loading…</p>
    </div>`;

  const waitingEl = container.querySelector<HTMLElement>('#lt-waiting')!;
  const contentEl = container.querySelector<HTMLElement>('#lt-content')!;
  const heroEl = container.querySelector<HTMLElement>('.hero')!;
  const equityEl = container.querySelector<HTMLElement>('#lt-equity')!;
  const changeEl = container.querySelector<HTMLElement>('#lt-change')!;
  const tradesEl = container.querySelector<HTMLElement>('#lt-trades')!;
  const openEl = container.querySelector<HTMLElement>('#lt-open')!;
  const statsEl = container.querySelector<HTMLElement>('#lt-stats')!;
  const statusEl = container.querySelector<HTMLElement>('#lt-status')!;
  let loadedOnce = false;

  function showWaiting(message: string): void {
    // Only ever shown before the first successful read — left unguarded this
    // would flash over real data on a single transient fetch failure.
    if (loadedOnce) return;
    contentEl.hidden = true;
    // Not just `.hidden` — `.stack` sets `display: flex`, which (same CSS
    // specificity as the `[hidden]` UA rule, declared later) would otherwise
    // win and keep the skeleton visible. Switching to `.empty` (no `display`
    // override) sidesteps that, but set `display` explicitly too so this
    // can't silently break again if either class changes.
    waitingEl.style.display = '';
    waitingEl.hidden = false;
    waitingEl.className = 'empty';
    waitingEl.textContent = message;
  }

  async function load(): Promise<void> {
    const state = await fetchStocksState();
    if (!state) {
      showWaiting('Waiting for the stocks agent…');
      return;
    }
    const standing = state.shadowStandings.find((s) => s.key === LONG_TERM_KEY);
    if (!standing) {
      showWaiting('Not started yet — runs alongside the main stocks agent, one cycle at a time.');
      return;
    }
    loadedOnce = true;
    // See the doc comment in `showWaiting` — `.stack`'s `display: flex`
    // beats a bare `[hidden]` toggle, so hide this explicitly.
    waitingEl.style.display = 'none';
    contentEl.hidden = false;

    const { major, minor } = formatPriceSplit(standing.equity);
    equityEl.innerHTML = `<span class="hero-value-currency">$</span><span class="hero-value-major">${major}</span><span class="hero-value-minor">.${minor}</span>`;
    changeEl.textContent = `${formatPct(standing.returnPct)} all time`;
    changeEl.className = `hero-change ${standing.returnPct >= 0 ? 'up' : 'down'}`;
    heroEl.classList.toggle('up', standing.returnPct >= 0);
    heroEl.classList.toggle('down', standing.returnPct < 0);
    tradesEl.textContent = `${standing.trades} trades`;
    openEl.textContent = `${standing.openPositions} open`;

    statsEl.innerHTML = '';
    if (standing.trades < MEANINGFUL_TRADES) {
      statsEl.appendChild(
        Object.assign(document.createElement('div'), {
          className: 'empty',
          textContent: `Still gathering data — ${standing.trades}/${MEANINGFUL_TRADES} trades. Too early to trust the win rate.`,
        }),
      );
    } else {
      statsEl.appendChild(row('Win rate', standing.winRatePct === null ? 'n/a' : `${standing.winRatePct.toFixed(1)}%`));
      statsEl.appendChild(row('Profit factor', standing.profitFactor === null ? 'n/a' : standing.profitFactor.toFixed(2)));
    }
    const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    statusEl.textContent = `Live · updated ${stamp}`;
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
