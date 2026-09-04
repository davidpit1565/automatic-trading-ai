/**
 * Home — the primary dashboard. Presentation only: shows the REAL cloud
 * agent (committed autopilot-state.json) plus live prices, so what you see
 * here matches the Telegram alerts. Phone-first, English.
 */

import type { ActiveDataSource } from '../dataSource';
import { fetchCloudState, type CloudState } from '../cloudState';
import { fetchTopMarkets, fetchMarketRows, findBtcSymbol, type MarketSnapshot, type MarketRow } from '../markets';
import { topGainers, topLosers } from '../marketFilters';
import { openMarketsAt } from './marketsView';
import { sparklineSvg } from '../charts';
import { attachCoinLogoFallback, coinLogoHtml, completedLogoHtml } from '../coinLogo';
import { formatPrice, formatPct, formatPriceSplit, tieredPriceHtml } from '../format';
import { skeletonRowsHtml } from '../loadingStates';
import type { ViewHandle } from '../viewLifecycle';

const MOVERS_PREVIEW_COUNT = 5;
type MoverKey = 'gainers' | 'losers';

const PRICE_REFRESH_MS = 15_000;
const STATE_REFRESH_MS = 120_000;

const euro = (v: number): string => `€${formatPrice(v)}`;
const HOT = 'var(--hot)';
const COLD = 'var(--cold)';

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Clean asset code for a traded pair (BTC, ETH) — for the coin logo, from the majors/instrument table. */
function baseFor(data: ActiveDataSource, symbol: string): string {
  const inst = data.instruments.find((i) => i.symbol === symbol);
  return (inst?.base ?? symbol.replace(/EUR$|USD$/, '')).toUpperCase();
}

export interface PositionLike {
  readonly symbol: string;
  readonly entryPrice: number;
  readonly quantity: number;
}

/** One row of the Revolut-style holdings table: identity + Total/Price/
 * Allocation (desktop-only columns, see .col-total/.col-price/.col-alloc in
 * styles.css) + Value/Unrealised P&L (shown at every width). */
export interface HoldingRow {
  readonly logoHtml: string;
  readonly name: string;
  readonly sub: string;
  /** null for the Cash row — it has no quantity/price of its own. */
  readonly qty: string | null;
  readonly price: string | null;
  readonly value: number;
  readonly allocationPct: number;
  readonly pnl: { readonly abs: number; readonly pct: number } | null;
}

/** Cash + every open position, as real portfolio-table rows (Revolut X's own
 * Home shows a "Cash"/"Crypto" holdings table, not a bare list) — shared by
 * the SIMULATED and REAL (live) position tables since both have the same
 * cash + positions shape, and reused by the Stocks Overview panel (same
 * shape, dollar-denominated) so "open positions" looks identical everywhere
 * instead of each screen inventing its own row layout. `money` formats a
 * raw number in the caller's own currency (`euro`/`dollar`); `cashLogoCode`
 * picks the right cash icon ('EUR' vs 'USD'). */
export function buildHoldingsRows(
  cash: number,
  positions: readonly PositionLike[],
  prices: Record<string, number>,
  equity: number,
  baseOf: (symbol: string) => string,
  money: (v: number) => string,
  cashLogoCode = 'EUR',
): HoldingRow[] {
  const rows: HoldingRow[] = [
    {
      logoHtml: coinLogoHtml(cashLogoCode),
      name: 'Cash',
      sub: 'Available balance',
      qty: null,
      price: null,
      value: cash,
      allocationPct: equity > 0 ? (cash / equity) * 100 : 0,
      pnl: null,
    },
  ];
  for (const p of positions) {
    const price = prices[p.symbol] ?? p.entryPrice;
    const value = p.quantity * price;
    const movePct = p.entryPrice > 0 ? ((price - p.entryPrice) / p.entryPrice) * 100 : 0;
    rows.push({
      logoHtml: coinLogoHtml(baseOf(p.symbol)),
      name: p.symbol,
      sub: `entry ${money(p.entryPrice)}`,
      qty: p.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 }),
      price: money(price),
      value,
      allocationPct: equity > 0 ? (value / equity) * 100 : 0,
      pnl: { abs: (price - p.entryPrice) * p.quantity, pct: movePct },
    });
  }
  return rows;
}

export function holdingsTableHtml(rows: readonly HoldingRow[], money: (v: number) => string): string {
  const body = rows
    .map((r) => {
      const pnlCell = r.pnl
        ? `<span class="chg ${r.pnl.abs >= 0 ? 'up' : 'down'}">${tieredPriceHtml(money(r.pnl.abs))} (${formatPct(r.pnl.pct)})</span>`
        : '—';
      return `<tr>
        <td class="holdings-id">${r.logoHtml}<div><div class="row-title">${r.name}</div><div class="row-sub">${r.sub}</div></div></td>
        <td class="col-total">${r.qty ?? '—'}</td>
        <td class="col-price">${r.price ? tieredPriceHtml(r.price) : '—'}</td>
        <td>${tieredPriceHtml(money(r.value))}</td>
        <td class="col-alloc">${r.allocationPct.toFixed(1)}%</td>
        <td>${pnlCell}</td>
      </tr>`;
    })
    .join('');
  return `<table class="holdings-table">
    <thead><tr><th></th><th class="col-total">Total</th><th class="col-price">Price</th><th>Value</th><th class="col-alloc">Allocation</th><th>Unrealised P&L</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

async function livePrices(data: ActiveDataSource, symbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      const candles = await data.source.getCandles(symbol, '1h', 2);
      if (candles.ok && candles.value.length > 0) prices[symbol] = candles.value[candles.value.length - 1]!.close;
    }),
  );
  return prices;
}

export function renderHomeView(container: HTMLElement, data: ActiveDataSource): ViewHandle {
  container.innerHTML = '';
  // The REAL Revolut X account — separate section, hidden entirely until
  // the live ledger has ever been initialized (state.live !== null), so a
  // stocks view or a fresh crypto deploy with no live account yet never
  // shows a misleading "€0.00 real money" card. Deliberately kept as a
  // boxed SECONDARY card rather than also going `hero-bare`: #117's point
  // was ONE dominant bare hero (the sim balance, what David actually looks
  // at) with everything else — including this real-money card — boxed.
  const liveHero = el('section', 'hero');
  liveHero.id = 'home-live-hero';
  liveHero.hidden = true;
  liveHero.innerHTML = `
    <div class="hero-label">Real money <span class="tag-live">REAL</span></div>
    <div class="hero-value" id="hv-live-equity"><span class="hero-value-major">—</span></div>
    <div class="hero-split"><span id="hv-live-cash"></span></div>
    <div class="kill-switch-banner" id="hv-kill-switch" hidden></div>
  `;
  const livePosWrap = el('section', 'block');
  livePosWrap.id = 'home-live-positions-wrap';
  livePosWrap.hidden = true;
  livePosWrap.innerHTML = `<div class="block-head"><h2>Real open positions <span class="tag-live">REAL</span></h2></div>`;
  const livePosList = el('div', 'stack stack-card');
  livePosList.id = 'home-live-positions';
  livePosWrap.appendChild(livePosList);

  // `hero-bare` drops the card chrome so the balance sits directly on the
  // page as the screen's single dominant element, the way the Revolut X
  // reference opens its wallet screen. Boxing it made it read as one widget
  // among several.
  const hero = el('section', 'hero hero-bare tappable');
  hero.id = 'home-sim-hero';
  hero.dataset['nav'] = 'value';
  hero.innerHTML = `
    <div class="hero-label">Portfolio value <span class="tag-sim">SIMULATED</span><span class="hero-more">history ›</span></div>
    <div class="hero-value" id="hv-equity"><span class="hero-value-major">—</span></div>
    <div class="hero-change" id="hv-change"></div>
    <div class="hero-split"><span id="hv-cash"></span><span id="hv-invested"></span></div>
    <div class="hero-bench" id="hv-bench" hidden></div>
    <div class="hero-spark" id="hv-spark"></div>
  `;

  const readyWrap = el('section', 'block readiness');
  readyWrap.id = 'home-readiness';

  const marketsWrap = el('section', 'block');
  marketsWrap.innerHTML = `<div class="block-head"><h2>Markets</h2><button class="link-btn" data-nav="markets">See all</button></div>`;
  const marketsStrip = el('div', 'markets-strip');
  marketsStrip.id = 'home-markets';
  marketsWrap.appendChild(marketsStrip);

  const moversWrap = el('section', 'block');
  moversWrap.innerHTML = `
    <div class="block-head"><h2>Top movers</h2><button class="link-btn" id="movers-seeall" data-nav="markets">See all</button></div>
    <div class="mk-tabs movers-toggle" role="tablist">
      <button class="mk-tab active" role="tab" aria-selected="true" data-mover="gainers">Gainers</button>
      <button class="mk-tab" role="tab" aria-selected="false" data-mover="losers">Losers</button>
    </div>`;
  const moversList = el('div', 'stack stack-card');
  moversList.id = 'home-movers';
  moversList.innerHTML = skeletonRowsHtml(4);
  moversWrap.appendChild(moversList);

  const posWrap = el('section', 'block');
  posWrap.innerHTML = `<div class="block-head"><h2>Open positions <span class="tag-sim">SIMULATED</span></h2></div>`;
  const posList = el('div', 'stack stack-card');
  posList.id = 'home-positions';
  posList.innerHTML = skeletonRowsHtml(2);
  posWrap.appendChild(posList);

  const actWrap = el('section', 'block');
  actWrap.innerHTML = `<div class="block-head"><h2>Recent activity</h2><button class="link-btn" data-hub="history">See all</button></div>`;
  const actList = el('div', 'stack stack-card');
  actList.id = 'home-activity';
  actList.innerHTML = skeletonRowsHtml(3);
  actWrap.appendChild(actList);

  const status = el('p', 'muted-line', 'Loading the cloud agent…');
  status.id = 'home-status';

  // Desktop gets a genuine 2-column dashboard (main column + a right rail of
  // market widgets), matching Revolut X's Home/Analytics layout instead of a
  // single phone-width column stretched wide — see .home-grid in styles.css.
  // Below the desktop breakpoint `.home-grid` has no grid rule, so these are
  // just two plain blocks and phones see Markets/Top movers after Recent
  // activity rather than interleaved with Positions/Readiness as before —
  // a minor mobile reordering traded for a real desktop rail.
  const mainCol = el('div', 'home-main');
  mainCol.append(liveHero, livePosWrap, hero, posWrap, readyWrap, actWrap, status);
  const rail = el('div', 'home-rail');
  rail.append(marketsWrap, moversWrap);
  container.classList.add('home-grid');
  container.append(mainCol, rail);
  attachCoinLogoFallback(container);

  let state: CloudState | null = null;
  let moverRows: MarketRow[] = [];
  let moverKey: MoverKey = 'gainers';

  const setText = (id: string, text: string): void => {
    const node = container.querySelector<HTMLElement>(`#${id}`);
    if (node) node.textContent = text;
  };

  function renderMovers(): void {
    const picked = (moverKey === 'gainers' ? topGainers : topLosers)(moverRows, MOVERS_PREVIEW_COUNT);
    moversList.innerHTML = '';
    if (picked.length === 0) {
      moversList.appendChild(el('div', 'empty', 'No movers to show right now.'));
      return;
    }
    for (const m of picked) {
      const up = m.changePct >= 0;
      const row = el('div', 'row tappable');
      row.dataset['nav'] = 'markets';
      row.innerHTML = `
        <div class="row-main">${coinLogoHtml(m.base)}<div><div class="row-title">${m.label}</div><div class="row-sub">${m.base}</div></div></div>
        <div class="row-side"><span class="row-title">${euro(m.price)}</span><span class="chg ${up ? 'up' : 'down'}">${formatPct(m.changePct)}</span></div>`;
      moversList.appendChild(row);
    }
  }

  function renderMarkets(markets: MarketSnapshot[]): void {
    marketsStrip.innerHTML = '';
    if (markets.length === 0) {
      marketsStrip.appendChild(el('div', 'empty', 'Live market data unavailable right now.'));
      return;
    }
    for (const m of markets) {
      const up = m.changePct >= 0;
      const base = baseFor(data, m.symbol);
      const card = el('div', 'market-card tappable');
      card.dataset['nav'] = 'markets';
      card.innerHTML = `
        <div class="market-top"><div class="market-id">${coinLogoHtml(base)}<span class="market-name">${m.label}</span></div></div>
        <div class="market-price-row">
          <span class="market-price">${tieredPriceHtml(euro(m.price))}</span>
          <span class="chg ${up ? 'up' : 'down'}">${formatPct(m.changePct)}</span>
        </div>
        <div class="market-spark" style="color:${up ? HOT : COLD}">${sparklineSvg(m.closes, { stroke: up ? HOT : COLD, fill: true, width: 150, height: 44 })}</div>`;
      marketsStrip.appendChild(card);
    }
  }

  function renderPositions(prices: Record<string, number>): void {
    posList.innerHTML = '';
    if (!state) {
      posList.appendChild(el('div', 'empty', 'No open positions — holding cash and waiting for a good setup.'));
      return;
    }
    const invested = state.positions.reduce((s, p) => s + p.quantity * (prices[p.symbol] ?? p.entryPrice), 0);
    const equity = state.cash + invested;
    posList.innerHTML = holdingsTableHtml(
      buildHoldingsRows(state.cash, state.positions, prices, equity, (sym) => baseFor(data, sym), euro),
      euro,
    );
    if (state.positions.length === 0) {
      posList.appendChild(el('div', 'empty', 'Holding cash and waiting for a good setup.'));
    }
  }

  function renderLiveAccount(prices: Record<string, number>): void {
    const live = state?.live;
    liveHero.hidden = !live;
    livePosWrap.hidden = !live;
    // David asked (2026-09-04): once real money is actually live, the
    // SIMULATED portfolio card directly below it on this same Overview
    // screen reads as confusing clutter, not useful context — it's still
    // the algorithm's own track record (never removed from the app; see
    // the Profit tab, which keeps showing it alongside the real-money
    // card), just no longer the primary thing to look at on THIS screen
    // once there's real money to look at instead.
    hero.hidden = Boolean(live);
    // Same reasoning, same day: the readiness checklist answers "is it
    // time to turn real money on?" — once it's already on, that question
    // is already answered, so this card is redundant clutter on THIS
    // screen too. Left untouched on the Profit tab (assetHubView.ts),
    // which deliberately shows real and simulated side by side.
    readyWrap.hidden = Boolean(live);
    if (!live) return;

    const invested = live.positions.reduce((s, p) => s + p.quantity * (prices[p.symbol] ?? p.entryPrice), 0);
    // Prefer the server's own recorded equity (marks the untracked BTC
    // holding at its real current price); only fall back to a local
    // approximation before the very first cycle to record one.
    const equity = live.equityHistory.at(-1)?.equity ?? live.cash + invested;
    const { major, minor } = formatPriceSplit(equity);
    const equityEl = liveHero.querySelector<HTMLElement>('#hv-live-equity')!;
    equityEl.innerHTML = `<span class="hero-value-currency">€</span><span class="hero-value-major">${major}</span><span class="hero-value-minor">.${minor}</span>`;
    const btcSymbol = findBtcSymbol(data);
    const btcValue = live.externalBtcQuantity * (btcSymbol ? prices[btcSymbol] ?? 0 : 0);
    liveHero.querySelector<HTMLElement>('#hv-live-cash')!.textContent =
      live.externalBtcQuantity > 0
        ? `Cash ${euro(live.cash)} · BTC holding ${euro(btcValue)} (untracked)`
        : `Cash ${euro(live.cash)}`;

    const banner = liveHero.querySelector<HTMLElement>('#hv-kill-switch')!;
    if (live.killSwitchEngaged) {
      banner.hidden = false;
      banner.textContent = `⏸ Real-money trading paused${live.killSwitchReason ? ` — ${live.killSwitchReason}` : ''}`;
    } else {
      banner.hidden = true;
    }

    livePosList.innerHTML = holdingsTableHtml(
      buildHoldingsRows(live.cash, live.positions, prices, equity, (sym) => baseFor(data, sym), euro),
      euro,
    );
    if (live.positions.length === 0) {
      livePosList.appendChild(el('div', 'empty', 'No real positions open — holding cash.'));
    }
  }

  function renderHeroSpark(): void {
    const spark = container.querySelector<HTMLElement>('#hv-spark');
    if (!spark) return;
    if (!state || state.equityHistory.length < 2) {
      spark.innerHTML = '';
      hero.classList.remove('up', 'down');
      delete document.body.dataset['sentiment'];
      return;
    }
    const values = state.equityHistory.map((e) => e.equity);
    const up = values[values.length - 1]! >= values[0]!;
    hero.classList.toggle('up', up);
    hero.classList.toggle('down', !up);
    // Mirrored onto <body> (as a data attribute — bare .up/.down are already
    // global text-color classes elsewhere, so reusing them on <body> would
    // tint all inherited text) so the fixed ambient wash behind the glass
    // topbar (styles.css .ambient-wash) tracks the same real sentiment —
    // one signal, not an invented second one.
    document.body.dataset['sentiment'] = up ? 'up' : 'down';
    spark.innerHTML = sparklineSvg(values, { stroke: 'var(--accent-text)', fill: false, width: 320, height: 64 });
  }

  function renderReadiness(): void {
    const r = state?.readiness ?? null;
    if (!r) {
      readyWrap.innerHTML =
        `<div class="block-head"><h2>Real-money readiness</h2></div>` +
        `<div class="empty">Assessing the paper track record…</div>`;
      return;
    }
    const badge = r.ready
      ? `<span class="ready-badge go">READY</span>`
      : `<span class="ready-badge no">NOT READY</span>`;
    const items = r.criteria
      .map(
        (c) =>
          `<li class="${c.ok ? 'ok' : 'no'}"><svg class="crit-icon" viewBox="0 0 24 24" aria-hidden="true">${
            c.ok
              ? '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'
              : '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v6"/><path d="M12 16.5h.01"/>'
          }</svg><span>${c.detail}</span></li>`,
      )
      .join('');
    readyWrap.innerHTML =
      `<div class="block-head"><h2>Real-money readiness</h2>${badge}</div>` +
      `<p class="readiness-note">Is the SIMULATED record strong enough to risk real money yet? A checklist, not a profit promise.</p>` +
      `<ul class="readiness-list">${items}</ul>`;
  }

  function renderActivity(): void {
    actList.innerHTML = '';
    if (!state || state.history.length === 0) {
      actList.appendChild(el('div', 'empty', 'No trades yet — the agent is waiting for a qualified opportunity.'));
      return;
    }
    for (const t of state.history.slice(0, 5)) {
      const buy = t.kind === 'buy';
      const row = el('div', `row trade ${t.kind}`);
      row.innerHTML = `
        <div class="row-main">${completedLogoHtml(baseFor(data, t.symbol))}
          <div><div class="row-title"><span class="pill ${buy ? 'buy' : 'sell'}">${buy ? 'BUY' : 'SELL'}</span> ${t.symbol}</div>
            <div class="row-sub">${t.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} @ ${euro(t.price)}</div></div></div>
        <div class="row-side"><span class="row-sub">${new Date(t.at).toLocaleDateString('en-GB')}</span></div>`;
      actList.appendChild(row);
    }
  }

  async function refreshPrices(): Promise<void> {
    if (!state) return;
    const symbols = state.positions.map((p) => p.symbol);
    for (const p of state.live?.positions ?? []) symbols.push(p.symbol);
    const btc = findBtcSymbol(data);
    if (btc) symbols.push(btc);
    const prices = await livePrices(data, symbols);
    renderLiveAccount(prices);

    const invested = state.positions.reduce((s, p) => s + p.quantity * (prices[p.symbol] ?? p.entryPrice), 0);
    const equity = state.cash + invested;
    const totalReturn = state.initialCash > 0 ? ((equity - state.initialCash) / state.initialCash) * 100 : 0;

    const { major, minor } = formatPriceSplit(equity);
    const equityEl = container.querySelector<HTMLElement>('#hv-equity')!;
    equityEl.innerHTML = `<span class="hero-value-currency">€</span><span class="hero-value-major">${major}</span><span class="hero-value-minor">.${minor}</span>`;
    const change = container.querySelector<HTMLElement>('#hv-change')!;
    // The up/down colour + arrow (added via CSS) already convey direction,
    // so the leading +/- from formatPct would be a redundant third signal.
    change.textContent = `${formatPct(totalReturn).replace(/^[+-]/, '')} all time`;
    change.className = `hero-change ${totalReturn >= 0 ? 'up' : 'down'}`;
    setText('hv-cash', `Cash ${euro(state.cash)}`);
    setText('hv-invested', `Invested ${euro(invested)}`);

    const bench = container.querySelector<HTMLElement>('#hv-bench')!;
    if (btc && state.benchmark && prices[btc] && state.benchmark.btc > 0 && state.benchmark.equity > 0) {
      const bot = ((equity - state.benchmark.equity) / state.benchmark.equity) * 100;
      const btcPct = ((prices[btc]! - state.benchmark.btc) / state.benchmark.btc) * 100;
      bench.hidden = false;
      bench.textContent = `vs Bitcoin — agent ${formatPct(bot)} · BTC ${formatPct(btcPct)}${bot >= btcPct ? ' · leading' : ''}`;
    } else {
      // A transient failure to price just this one cycle (e.g. BTC's fetch
      // failed) must not leave a stale comparison on screen looking current.
      bench.hidden = true;
    }

    renderPositions(prices);
    const stamp = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    setText('home-status', `Live · updated ${stamp}`);
  }

  async function loadState(): Promise<void> {
    const fresh = await fetchCloudState();
    if (fresh) {
      state = fresh;
      renderReadiness();
      renderActivity();
      renderHeroSpark();
      await refreshPrices();
    } else if (!state) {
      // Swap the shimmering skeleton for an honest "still trying" message —
      // left alone, it would shimmer forever on a real outage, which reads
      // as a stuck/broken screen rather than a momentary loading state.
      setText('home-status', "Couldn't reach the cloud agent — retrying automatically.");
      posList.innerHTML = '';
      posList.appendChild(el('div', 'empty', 'Waiting for the cloud agent…'));
      actList.innerHTML = '';
      actList.appendChild(el('div', 'empty', 'Waiting for the cloud agent…'));
    }
  }

  async function loadMarkets(): Promise<void> {
    renderMarkets(await fetchTopMarkets(data, 6));
  }

  async function loadMovers(): Promise<void> {
    // One cheap batch-ticker request (fetchMarketRows) covers the WHOLE
    // market, unlike fetchTopMarkets above (one candle fetch per symbol) —
    // gainers/losers ranking needs the full universe, not just 6 majors.
    moverRows = await fetchMarketRows(data);
    renderMovers();
  }

  // Tapping any individual mover row also deep-links into the SAME
  // gainers/losers tab that's showing here, not the default "Popular" one.
  moversList.addEventListener('click', () => openMarketsAt(moverKey));

  moversWrap.querySelector('.movers-toggle')!.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-mover]');
    if (!btn) return;
    const key = btn.dataset['mover'] as MoverKey;
    if (key === moverKey) return;
    moverKey = key;
    for (const tab of moversWrap.querySelectorAll<HTMLElement>('.mk-tab')) {
      const active = tab === btn;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    }
    renderMovers();
  });
  // Deep-links "See all" straight into the Markets browser already scoped to
  // whichever tab (Gainers/Losers) is showing here — set BEFORE the click's
  // [data-nav="markets"] bubbles to main.ts's delegated navigation handler.
  container.querySelector<HTMLElement>('#movers-seeall')!.addEventListener('click', () => {
    openMarketsAt(moverKey);
  });

  let priceTimer = 0;
  let stateTimer = 0;
  let marketsTimer = 0;
  let moversTimer = 0;

  const start = (): void => {
    priceTimer = window.setInterval(() => void refreshPrices(), PRICE_REFRESH_MS);
    stateTimer = window.setInterval(() => void loadState(), STATE_REFRESH_MS);
    marketsTimer = window.setInterval(() => void loadMarkets(), PRICE_REFRESH_MS * 4);
    moversTimer = window.setInterval(() => void loadMovers(), PRICE_REFRESH_MS * 4);
  };

  renderReadiness();
  void loadState();
  void loadMarkets();
  void loadMovers();
  start();

  return {
    pause: () => {
      window.clearInterval(priceTimer);
      window.clearInterval(stateTimer);
      window.clearInterval(marketsTimer);
      window.clearInterval(moversTimer);
    },
    resume: () => {
      void loadState();
      void loadMarkets();
      void loadMovers();
      start();
    },
  };
}
