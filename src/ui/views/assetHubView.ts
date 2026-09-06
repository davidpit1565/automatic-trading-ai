/**
 * Shared shell for an asset class's own section (Crypto, Stocks): one
 * primary nav destination with four sub-pages — Overview, History, Market,
 * Profit. History and Profit are generic (both `CloudState` shapes are
 * identical — see `cloudState.ts`, which parses both
 * `state/autopilot-state.json` and `state/stocks-state.json` the same way).
 * Overview and Market differ per asset class (crypto reuses the existing
 * rich Home/Markets views; stocks gets simpler built-ins), so both are
 * injected by the caller.
 */

import { mountEquityChartPanel } from '../equityChartPanel';
import { attachCoinLogoFallback, baseCodeFromSymbol, completedLogoHtml } from '../coinLogo';
import { formatPrice, formatPct, formatPriceSplit, escapeHtml } from '../format';
import { skeletonRowsHtml } from '../loadingStates';
import type { CloudState } from '../cloudState';
import type { ViewHandle } from '../viewLifecycle';

const STATE_REFRESH_MS = 60_000;
type HubTab = 'overview' | 'history' | 'market' | 'profit' | 'longterm';

export interface AssetHubOptions {
  readonly title: string;
  readonly subtitle: string;
  readonly currencySymbol: string;
  readonly fetchState: () => Promise<CloudState | null>;
  /** True to show the "vs Bitcoin" benchmark line on the Profit sub-page. */
  readonly showBenchmark: boolean;
  /**
   * Replaces `subtitle` once a live (real-money) account exists. Found
   * missing in the 2026-09-06 readiness/kill-switch audit: Crypto's own
   * `subtitle` hardcodes "SIMULATED money", which read as flatly false once
   * real money actually went live (2026-09-03) on this exact screen — right
   * next to the real-money hero. Omit for a section that never goes live
   * (Stocks today), where the static `subtitle` is always accurate.
   */
  readonly liveSubtitle?: string;
  /** Mounted eagerly (Overview is the default sub-tab). */
  readonly renderOverview: (container: HTMLElement) => ViewHandle | void;
  /** Mounted lazily, once, the first time the Market sub-tab is opened. */
  readonly renderMarket: (container: HTMLElement) => ViewHandle | void;
  /**
   * Mounted lazily, once, the first time the Long-Term sub-tab is opened.
   * Omit entirely to hide that tab — only Stocks has a long-term shadow
   * wallet today (see `stocksLongTermPanel.ts`); Crypto doesn't pass this.
   */
  readonly renderLongTerm?: (container: HTMLElement) => ViewHandle | void;
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function renderAssetHub(container: HTMLElement, opts: AssetHubOptions): ViewHandle {
  const money = (v: number): string => `${opts.currencySymbol}${formatPrice(v)}`;

  container.innerHTML = `
    <h2 class="view-title">${opts.title}</h2>
    <p class="view-sub" id="hub-subtitle">${opts.subtitle}</p>
    <div class="hub-tabs" role="tablist">
      <button class="hub-tab active" data-hub="overview" role="tab" aria-selected="true">Overview</button>
      <button class="hub-tab" data-hub="history" role="tab" aria-selected="false">History</button>
      <button class="hub-tab" data-hub="market" role="tab" aria-selected="false">Market</button>
      <button class="hub-tab" data-hub="profit" role="tab" aria-selected="false">Profit</button>
      ${opts.renderLongTerm ? '<button class="hub-tab" data-hub="longterm" role="tab" aria-selected="false">Long-Term</button>' : ''}
    </div>
    <div class="hub-panel active" data-hub-panel="overview"></div>
    <div class="hub-panel" data-hub-panel="history">
      <!-- Real activity — hidden entirely until the live ledger has ever
           been initialized (state.live !== null), same convention homeView.ts
           uses, so this never appears for Stocks (no live account there)
           and never shows a misleading empty "real" section. David reported
           2026-09-03: this tab only ever showed the SIMULATED chart/list
           below, with no real counterpart anywhere on it — easy to mistake
           for "the real wallet still isn't reflected", when the real card
           simply only existed on the Overview tab. -->
      <section class="block" id="hub-real-activity" hidden>
        <div class="block-head"><h2>Real activity <span class="tag-live">REAL</span></h2></div>
        <div class="stack stack-card" id="hub-real-activity-list"></div>
      </section>
      <!-- The SIMULATED chart+list below — hidden once a live account exists
           (David asked, 2026-09-05, to stop showing the not-real wallet at
           all once real money is live), same as #hub-sim-hero on the
           Profit tab. Stays visible for Stocks (no live account there). -->
      <div id="hub-sim-history">
        <div id="hub-history-chart"></div>
        <!-- Shimmering row placeholders, not a bare "Loading…" line — a
             plain text row collapses this whole card down to one short line
             (confirmed by screenshot: a single pill floating over an
             otherwise-blank viewport) and then the real rows shove
             everything below back down once they land. skeletonRowsHtml
             already existed for exactly this (marketsView.ts/valueView.ts
             use the same shimmer treatment for their own first paint) but
             had no caller on this tab. -->
        <div class="stack stack-card" id="hub-history-list">${skeletonRowsHtml(3)}</div>
      </div>
    </div>
    <div class="hub-panel" data-hub-panel="market"></div>
    <div class="hub-panel" data-hub-panel="profit">
      <!-- Once a live account exists, "Real money" IS the dominant figure on
           this tab (same reasoning as Home's #home-live-hero) — hero-bare,
           not a boxed secondary. Before that (or for Stocks, which has no
           live account), stays hidden and the simulated hero below is all
           there is to show. David asked (2026-09-05) to stop showing the
           simulated ("not real") wallet at all once real money exists — see
           #hub-sim-hero's own hiding below. -->
      <section class="hero hero-bare" id="hub-real-money" hidden>
        <div class="hero-label">Real money <span class="tag-live">REAL</span></div>
        <div class="hero-value" id="hub-real-equity"><span class="hero-value-major">—</span></div>
        <div class="hero-change" id="hub-real-change" hidden></div>
        <div class="hero-bench" id="hub-real-breakdown"></div>
        <!-- Found in the 2026-09-06 readiness/kill-switch audit: this exact
             "Real money" card is duplicated from Home (homeView.ts's
             #home-live-hero), but only Home ever showed the kill-switch
             banner — anyone landing here directly (Crypto/Stocks → Profit,
             without passing through Home first) saw the real-money balance
             with zero indication that trading might currently be paused. -->
        <div class="kill-switch-banner" id="hub-kill-switch" hidden></div>
        <div id="hub-real-equity-chart"></div>
      </section>
      <!-- Dominant figure ONLY while there's no live account to show instead
           (Stocks today, or Crypto before real money went live) — hidden
           entirely once one exists, per David's 2026-09-05 ask. -->
      <section class="hero hero-bare" id="hub-sim-hero">
        <div class="hero-label">Total return <span class="tag-sim">SIMULATED</span></div>
        <div class="hero-value" id="hub-return">—</div>
        <div class="hero-bench" id="hub-bench" hidden></div>
      </section>
      <section class="block readiness" id="hub-readiness"></section>
    </div>
    ${opts.renderLongTerm ? '<div class="hub-panel" data-hub-panel="longterm"></div>' : ''}`;
  attachCoinLogoFallback(container);

  const overviewPanel = container.querySelector<HTMLElement>('[data-hub-panel="overview"]')!;
  const simHistoryWrap = container.querySelector<HTMLElement>('#hub-sim-history')!;
  const historyChartSlot = container.querySelector<HTMLElement>('#hub-history-chart')!;
  const historyListEl = container.querySelector<HTMLElement>('#hub-history-list')!;
  const marketPanel = container.querySelector<HTMLElement>('[data-hub-panel="market"]')!;
  const simHeroWrap = container.querySelector<HTMLElement>('#hub-sim-hero')!;
  const returnEl = container.querySelector<HTMLElement>('#hub-return')!;
  const benchEl = container.querySelector<HTMLElement>('#hub-bench')!;
  const readinessEl = container.querySelector<HTMLElement>('#hub-readiness')!;
  const longTermPanel = container.querySelector<HTMLElement>('[data-hub-panel="longterm"]');
  const realActivityWrap = container.querySelector<HTMLElement>('#hub-real-activity')!;
  const realActivityListEl = container.querySelector<HTMLElement>('#hub-real-activity-list')!;
  const realMoneyWrap = container.querySelector<HTMLElement>('#hub-real-money')!;
  const realEquityEl = container.querySelector<HTMLElement>('#hub-real-equity')!;
  const realChangeEl = container.querySelector<HTMLElement>('#hub-real-change')!;
  const realBreakdownEl = container.querySelector<HTMLElement>('#hub-real-breakdown')!;
  const killSwitchBanner = container.querySelector<HTMLElement>('#hub-kill-switch')!;
  const subtitleEl = container.querySelector<HTMLElement>('#hub-subtitle')!;
  const realEquityChartSlot = container.querySelector<HTMLElement>('#hub-real-equity-chart')!;

  const historyChart = mountEquityChartPanel(historyChartSlot, { currencySymbol: opts.currencySymbol });
  // showHero: false — the "Real money" hero just above this chart (a few
  // pixels up in the same section) already shows this exact figure; the
  // chart's own big "Now €X" header would just repeat it (David flagged
  // this 2026-09-04 as a disproportionate duplicate).
  const realEquityChart = mountEquityChartPanel(realEquityChartSlot, {
    currencySymbol: opts.currencySymbol,
    live: true,
    showHero: false,
  });

  let marketMounted = false;
  let marketHandle: ViewHandle | void;
  let longTermMounted = false;
  let longTermHandle: ViewHandle | void;
  const overviewHandle = opts.renderOverview(overviewPanel);

  function renderHistoryList(state: CloudState): void {
    // Once a live account exists, "Real activity" above is the only history
    // worth showing — David asked (2026-09-05) to stop showing the
    // simulated ("not real") wallet at all at that point, same reasoning as
    // `#hub-sim-hero` on the Profit tab. Stays visible for Stocks (no live
    // account there).
    simHistoryWrap.hidden = Boolean(state.live);
    if (state.live) return;
    historyChart.setHistory(state.equityHistory, state.initialCash);
    if (state.history.length === 0) {
      historyListEl.innerHTML = '<div class="empty">No trades yet.</div>';
      return;
    }
    historyListEl.innerHTML = '';
    for (const t of state.history) {
      const buy = t.kind === 'buy';
      const row = el('div', `row trade ${t.kind}`);
      row.innerHTML = `
        <div class="row-main">${completedLogoHtml(baseCodeFromSymbol(t.symbol))}
          <div><div class="row-title"><span class="pill ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span> ${t.symbol}</div>
            <div class="row-sub">${t.note ? t.note : buy ? 'opened' : 'closed'}</div></div></div>
        <div class="row-side"><span class="row-title">${money(t.price)}</span>
          <span class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>
          <span class="row-sub">${new Date(t.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`;
      historyListEl.appendChild(row);
    }
  }

  function renderRealActivity(state: CloudState): void {
    const live = state.live;
    realActivityWrap.hidden = !live;
    if (!live) return;
    if (live.recentEvents.length === 0) {
      realActivityListEl.innerHTML = '<div class="empty">No real trades yet.</div>';
      return;
    }
    realActivityListEl.innerHTML = '';
    for (const e of live.recentEvents) {
      const filled = e.event === 'filled';
      const row = el('div', `row trade ${filled ? 'buy' : 'sell'}`);
      // Same coin-logo treatment the SIMULATED trade rows just above already
      // use (renderHistoryList) — real bug, found 2026-09-06 by screenshot:
      // this list showed a bare status pill with no identity at all, reading
      // sparser/less finished than every other trade row in the app. Not
      // every real audit entry's intent id carries a parseable symbol (a
      // pre-trade verification failure, the kill switch) — those correctly
      // fall back to the plain layout rather than a wrong or missing icon.
      const icon = e.symbol ? completedLogoHtml(baseCodeFromSymbol(e.symbol)) : '';
      row.innerHTML = `
        <div class="row-main">${icon}<div><div class="row-title"><span class="pill ${filled ? 'buy' : 'sell'}">${filled ? 'FILLED' : 'REJECTED'}</span>${e.symbol ? ` ${e.symbol}` : ''}</div>
          <div class="row-sub">${e.detail}</div></div></div>
        <div class="row-side"><span class="row-sub">${new Date(e.at).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>`;
      realActivityListEl.appendChild(row);
    }
  }

  function renderRealMoney(state: CloudState): void {
    const live = state.live;
    realMoneyWrap.hidden = !live;
    if (!live) return;
    const invested = live.positions.reduce((s, p) => s + p.quantity * p.entryPrice, 0);
    // Prefer the server's own recorded equity (marks the untracked BTC
    // holding at its real current price) — only fall back to the
    // entry-price approximation before the very first cycle to record one.
    const equity = live.equityHistory.at(-1)?.equity ?? live.cash + invested;
    // Same big-integer/small-decimal split as Home's identical "Real money"
    // card (hv-live-equity) — this widget is the exact same concept shown a
    // second time (Crypto/Stocks Profit tab), and previously rendered as one
    // flat string here while Home tiered it, two different typographic
    // treatments for one idea.
    const { major, minor } = formatPriceSplit(equity);
    realEquityEl.innerHTML = `<span class="hero-value-currency">${opts.currencySymbol}</span><span class="hero-value-major">${major}</span><span class="hero-value-minor">.${minor}</span>`;
    // Mirrors Home's own hero glow: the ambient tint behind this card should
    // track whether the real account is actually up or down since tracking
    // began, not sit permanently colourless the way this secondary card
    // always has.
    // Same "since tracking began" figure as Home's identical live hero
    // (homeView.ts's #hv-live-change) — this card previously drove its
    // up/down glow from the same first-recorded-sample baseline but never
    // surfaced the number itself, so the glow had no text backing it up
    // anywhere on this tab.
    const firstEquity = live.equityHistory[0]?.equity;
    if (firstEquity !== undefined && firstEquity > 0) {
      const liveReturn = ((equity - firstEquity) / firstEquity) * 100;
      const up = liveReturn >= 0;
      realMoneyWrap.classList.toggle('up', up);
      realMoneyWrap.classList.toggle('down', !up);
      realChangeEl.hidden = false;
      realChangeEl.textContent = `${formatPct(liveReturn).replace(/^[+-]/, '')} since tracking began`;
      realChangeEl.className = `hero-change ${up ? 'up' : 'down'}`;
    } else {
      realMoneyWrap.classList.remove('up', 'down');
      realChangeEl.hidden = true;
    }

    // Always show cash (matches Home's #hv-live-cash) — previously this
    // whole line vanished whenever there was no untracked BTC holding,
    // leaving the card with no cash/composition detail at all.
    const btcPrice = state.marketSnapshot.find((m) => m.symbol === 'XBTEUR')?.price;
    realBreakdownEl.hidden = false;
    // Real-money-safety fix, found 2026-09-06 by checking the actual
    // committed crypto state file: it carries no `market-snapshot` field at
    // all (that field only ever gets populated for Stocks), so `btcPrice`
    // is always undefined here for Crypto today. The previous `?? 0`
    // fallback would have priced any real untracked BTC holding at €0.00 —
    // a confidently-wrong figure for an actual balance, not an honestly
    // "unavailable" one — the moment `externalBtcQuantity` is next nonzero
    // (it has been before: David converted EUR→BTC manually, 2026-09-03).
    // Not reproducible against today's real state (externalBtcQuantity is 0
    // right now, so nothing currently renders €0.00), but the code path is
    // real and provably reachable, so it's fixed rather than left latent.
    realBreakdownEl.textContent =
      live.externalBtcQuantity > 0
        ? btcPrice
          ? `Cash ${money(live.cash)} · BTC holding ${money(live.externalBtcQuantity * btcPrice)} (untracked)`
          : `Cash ${money(live.cash)} · BTC holding ${live.externalBtcQuantity} BTC (untracked, price unavailable)`
        : `Cash ${money(live.cash)}`;

    // Same wording and icon as Home's identical banner (homeView.ts,
    // #hv-kill-switch) — found missing here entirely in the 2026-09-06
    // readiness/kill-switch audit. This is the exact same "Real money" hero,
    // shown a second time on this tab; the kill-switch state must be visible
    // wherever that hero is, not only when a viewer happens to have passed
    // through Home first.
    if (live.killSwitchEngaged) {
      killSwitchBanner.hidden = false;
      const reason = live.killSwitchReason ? ` — ${escapeHtml(live.killSwitchReason)}` : '';
      killSwitchBanner.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12"/><path d="M15 6v12"/></svg><span>Real-money trading paused — no new trades or exits can execute; open positions stay open, unmonitored, until resumed${reason}</span>`;
    } else {
      killSwitchBanner.hidden = true;
    }
    realEquityChart.setHistory(live.equityHistory);
  }

  function renderProfit(state: CloudState): void {
    // Once a live account exists, "Real money" above (now hero-bare) is the
    // dominant figure on this tab — David asked (2026-09-05) to stop showing
    // the simulated ("not real") wallet at all at that point. Stays visible
    // for Stocks (no live account there) and for Crypto before real money
    // went live.
    simHeroWrap.hidden = Boolean(state.live);
    if (state.live) {
      // Readiness only ever answers "is it time to turn real money on?" —
      // already moot once it's on, same as the check further down for the
      // not-yet-live path.
      readinessEl.hidden = true;
      return;
    }
    const equity = state.equityHistory.at(-1)?.equity ?? state.cash;
    const totalReturn = state.initialCash > 0 ? ((equity - state.initialCash) / state.initialCash) * 100 : 0;
    returnEl.textContent = formatPct(totalReturn);
    returnEl.className = `hero-value ${totalReturn >= 0 ? 'up' : 'down'}`;
    // Drives the card's own ambient glow (::before), the same signal Home's
    // hero uses — previously only the number itself changed colour and the
    // card stayed permanently colourless behind it.
    simHeroWrap.classList.toggle('up', totalReturn >= 0);
    simHeroWrap.classList.toggle('down', totalReturn < 0);

    const btcPriceNow = state.marketSnapshot.find((m) => m.symbol === 'XBTEUR')?.price ?? 0;
    if (
      opts.showBenchmark &&
      state.benchmark &&
      btcPriceNow > 0 &&
      state.benchmark.btc > 0 &&
      state.benchmark.equity > 0
    ) {
      const bot = ((equity - state.benchmark.equity) / state.benchmark.equity) * 100;
      // "leading" means beating Bitcoin's OWN return over the same window,
      // not merely being profitable — found in review, 2026-09-03: this used
      // to show "leading" whenever bot >= 0, so the agent could read as
      // "leading" while actually trailing a Bitcoin that ran up even more.
      const btcPct = ((btcPriceNow - state.benchmark.btc) / state.benchmark.btc) * 100;
      benchEl.hidden = false;
      benchEl.textContent = `vs Bitcoin — agent ${formatPct(bot)} · BTC ${formatPct(btcPct)}${bot >= btcPct ? ' · leading' : ''}`;
    } else {
      benchEl.hidden = true;
    }

    // David asked (2026-09-04): once real money is live, "is it time to
    // turn real money on?" is already answered on every screen, not just
    // Overview — same reasoning and pattern as homeView.ts's readiness
    // card, applied here too since this tab kept showing it regardless.
    readinessEl.hidden = Boolean(state.live);
    if (state.live) return;

    const r = state.readiness;
    if (!r) {
      readinessEl.innerHTML =
        `<div class="block-head"><h2>Real-money readiness</h2></div><div class="empty">Assessing the paper track record…</div>`;
      return;
    }
    const badge = r.ready
      ? `<span class="ready-badge go">READY</span>`
      : `<span class="ready-badge no">NOT READY</span>`;
    // Same outlined SVG icon family Home's identical readiness list uses
    // (renderReadiness in homeView.ts) — this list previously fell back to
    // raw ✓/✗ text glyphs, the one place in the app still mixing an
    // unrelated icon style into an otherwise consistent outlined set.
    // Found in the 2026-09-06 readiness/kill-switch audit, verified against
    // the real committed `state/stocks-state.json`: a criterion that's !ok
    // but NOT in `r.unmet` is informational only (see
    // `assessRealMoneyReadiness`'s `gateOnBenchmark`/`gateOnTradeStats`) —
    // its own `detail` text already says "(informational — ...)", but it
    // used to render with the exact same amber warning icon and "no" styling
    // as a criterion that actually blocks readiness. Live example right now:
    // Stocks reads "NOT READY" for one real reason (benchmark), yet the list
    // showed THREE warning icons (trades, benchmark, consistency) with no way
    // to tell at a glance that two of them don't count. A neutral "info"
    // state (`r.unmet` is the one source of truth for what's actually
    // blocking) fixes that without touching the assessment logic itself.
    const items = r.criteria
      .map((c) => {
        const state = c.ok ? 'ok' : r.unmet.includes(c.key) ? 'no' : 'info';
        const icon =
          state === 'ok'
            ? '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'
            : state === 'no'
              ? '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><path d="M12 16.5h.01"/>'
              : '<circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>';
        return `<li class="${state}"><svg class="crit-icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${c.detail}</span></li>`;
      })
      .join('');
    readinessEl.innerHTML =
      `<div class="block-head"><h2>Real-money readiness</h2>${badge}</div><ul class="readiness-list">${items}</ul>`;
  }

  // Found in review, 2026-09-03: on a PERSISTENT fetch failure, `load()`
  // used to just `return` — every panel here started on its own initial
  // "Loading…"/blank skeleton and nothing ever replaced it, so it kept
  // looking like it was still loading no matter how long the cloud agent
  // stayed unreachable. Mirrors valueView.ts's own once-only fallback message.
  let loadedOnce = false;
  async function load(): Promise<void> {
    const state = await opts.fetchState();
    if (!state) {
      if (!loadedOnce) {
        historyListEl.innerHTML = '<div class="empty">Couldn\'t reach the cloud agent — retrying.</div>';
      }
      return;
    }
    loadedOnce = true;
    // Swap to the real-money-aware subtitle once a live account exists —
    // see `liveSubtitle`'s own doc comment for why this can't stay static.
    if (opts.liveSubtitle) {
      subtitleEl.textContent = state.live ? opts.liveSubtitle : opts.subtitle;
    }
    renderHistoryList(state);
    renderRealActivity(state);
    renderProfit(state);
    renderRealMoney(state);
  }

  container.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const btn = target.closest<HTMLElement>('[data-hub]');
    if (!btn) return;
    const tab = btn.dataset['hub'] as HubTab;
    // Match by the target tab VALUE, not object identity to `btn` — a
    // deep-link button elsewhere on the page (Home's "Recent activity → See
    // all", now also its "Real money → profit ›") also carries `data-hub`
    // and correctly switches the panel below via this same value, but is
    // never itself one of the `.hub-tab` pills, so `b === btn` could never
    // match any of them: the panel changed while the tab bar quietly showed
    // no active tab at all. Real, pre-existing bug for "See all", surfaced
    // again by wiring the new real-money deep link the same way.
    container.querySelectorAll<HTMLElement>('.hub-tab').forEach((b) => {
      const active = b.dataset['hub'] === tab;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    container.querySelectorAll<HTMLElement>('[data-hub-panel]').forEach((p) => {
      p.classList.toggle('active', p.dataset['hubPanel'] === tab);
    });
    if (tab === 'market' && !marketMounted) {
      marketHandle = opts.renderMarket(marketPanel) ?? undefined;
      marketMounted = true;
    }
    if (tab === 'longterm' && !longTermMounted && opts.renderLongTerm && longTermPanel) {
      longTermHandle = opts.renderLongTerm(longTermPanel) ?? undefined;
      longTermMounted = true;
    }
  });

  let timer = 0;
  void load();
  timer = window.setInterval(() => void load(), STATE_REFRESH_MS);

  return {
    pause: () => {
      window.clearInterval(timer);
      overviewHandle?.pause();
      marketHandle?.pause();
      longTermHandle?.pause();
    },
    resume: () => {
      void load();
      timer = window.setInterval(() => void load(), STATE_REFRESH_MS);
      overviewHandle?.resume();
      marketHandle?.resume();
      longTermHandle?.resume();
    },
  };
}
