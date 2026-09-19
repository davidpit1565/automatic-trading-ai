/**
 * Operations Console — Overview. The control room: what the live trading
 * system is doing right now, not another market-browsing screen. Answers
 * "what do I need to know right now?" before anything else — an open
 * Telegram approval or an engaged kill switch renders ABOVE the live
 * account figures, never buried in a sub-tab.
 *
 * Deliberately reads ONLY the real Revolut X account (`CloudState.live`) —
 * this screen is not where simulated/shadow standings live (see
 * `renderAssetHub`'s existing Crypto/Stocks tabs for that), matching this
 * project's non-negotiable rule that live and simulated money must never
 * visually blend together.
 *
 * First vertical slice (2026-09-19): header, Action Required, kill-switch
 * banner, live account KPIs, recent activity. Performance/System-health/
 * Reports are separate, later screens — not fabricated here as fake
 * placeholders.
 */

import { fetchCloudState, type CloudPendingApproval } from '../cloudState';
import { escapeHtml } from '../format';
import { baseOf, euro, signedEuro, relativeTime, STALE_MS } from '../opsFormat';
import type { ViewHandle } from '../viewLifecycle';

const REFRESH_MS = 60_000;

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function actionCardHtml(a: CloudPendingApproval, now: number): string {
  const base = escapeHtml(baseOf(a.symbol));
  const expiry = a.expiresAt !== null ? formatClock(a.expiresAt) : 'pending send';
  const expired = a.expiresAt !== null && a.expiresAt <= now;
  const position = a.positionValue !== null ? euro(a.positionValue) : 'calculated at confirmation time';
  // Not formatPct: that prepends '+' for a positive value, which reads
  // oddly for a risk figure (it's a cost, never a gain to highlight).
  const risk = a.riskPercentage !== null ? `${a.riskPercentage.toFixed(2)}%` : '—';
  return `
    <div class="ops-action-card">
      <div class="ops-action-symbol">${base} · LONG</div>
      <div class="ops-action-row"><span>Confidence</span><span>${Math.round(a.confidence)}/100</span></div>
      <div class="ops-action-row"><span>Proposed entry</span><span>${euro(a.entryPrice)}</span></div>
      <div class="ops-action-row"><span>Position</span><span>${position}</span></div>
      <div class="ops-action-row"><span>Risk</span><span>${risk}</span></div>
      <div class="ops-action-row"><span>Reward:Risk</span><span>${a.rewardRiskRatio.toFixed(1)}:1</span></div>
      <div class="ops-action-row${expired ? ' ops-expired' : ''}"><span>${expired ? 'Expired' : 'Expires'}</span><span>${expiry}</span></div>
    </div>`;
}

export function renderOverviewView(container: HTMLElement): ViewHandle {
  container.innerHTML = `
    <div class="ops-header">
      <div class="ops-title">OPERATIONS</div>
      <div class="ops-header-meta">
        <span id="ov-live-badge" class="ops-live-badge" hidden>LIVE · REAL MONEY · REVOLUT X</span>
        <span id="ov-system-status" class="ops-status" data-nav="system" role="button" tabindex="0">● checking…</span>
      </div>
    </div>
    <!-- This app reads a periodically-committed JSON snapshot, not a live
         API — the freshness badge makes that architecture explicit instead
         of letting the operator mistake the console for real-time. Never
         says "live" itself; "Fresh"/"Stale"/"Unknown" only. -->
    <p id="ov-freshness" class="ops-freshness"></p>
    <div id="ov-kill-switch" class="ops-banner ops-banner-critical" hidden>
      <div class="ops-banner-title">TRADING HALTED</div>
      <div class="ops-banner-body">Reason: <span id="ov-kill-reason"></span></div>
      <div class="ops-banner-note">New orders are blocked. Existing positions are not modified automatically.</div>
    </div>
    <div id="ov-action-required" class="ops-banner ops-banner-action" hidden>
      <div class="ops-banner-title">ACTION REQUIRED</div>
      <div id="ov-action-list" class="ops-action-list"></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">
        <span class="ops-section-label">LIVE ACCOUNT</span> <span class="ops-tag-live">REAL MONEY · REVOLUT X</span>
        <button class="ops-view-all" data-nav="reports">Reports →</button>
      </div>
      <div id="ov-live-empty" class="ops-empty" hidden>No live account yet.</div>
      <div id="ov-kpis" class="ops-kpi-row"></div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">
        <span class="ops-section-label">RECENT ACTIVITY</span>
        <button class="ops-view-all" data-nav="trades">View trades →</button>
      </div>
      <div id="ov-activity" class="ops-activity-list"></div>
      <div id="ov-activity-empty" class="ops-empty" hidden>No recent activity.</div>
    </div>
    <div class="ops-section">
      <div class="ops-section-title">
        <span class="ops-section-label">STRATEGIES</span>
        <button class="ops-view-all" data-nav="strategies">Champion vs. challengers →</button>
      </div>
      <div class="ops-empty">Forward-tested candidates, all simulated — never real money.</div>
    </div>
    <p class="muted-line" id="ov-status">Loading…</p>`;

  const liveBadgeEl = container.querySelector<HTMLElement>('#ov-live-badge')!;
  const systemStatusEl = container.querySelector<HTMLElement>('#ov-system-status')!;
  const freshnessEl = container.querySelector<HTMLElement>('#ov-freshness')!;
  const killSwitchEl = container.querySelector<HTMLElement>('#ov-kill-switch')!;
  const killReasonEl = container.querySelector<HTMLElement>('#ov-kill-reason')!;
  const actionRequiredEl = container.querySelector<HTMLElement>('#ov-action-required')!;
  const actionListEl = container.querySelector<HTMLElement>('#ov-action-list')!;
  const liveEmptyEl = container.querySelector<HTMLElement>('#ov-live-empty')!;
  const kpisEl = container.querySelector<HTMLElement>('#ov-kpis')!;
  const activityEl = container.querySelector<HTMLElement>('#ov-activity')!;
  const activityEmptyEl = container.querySelector<HTMLElement>('#ov-activity-empty')!;
  const statusEl = container.querySelector<HTMLElement>('#ov-status')!;

  async function load(): Promise<void> {
    const state = await fetchCloudState();
    const now = Date.now();
    if (!state) {
      statusEl.textContent = 'Unable to load the operations state. Retrying automatically.';
      systemStatusEl.textContent = '● Unknown';
      systemStatusEl.className = 'ops-status ops-status-unknown';
      freshnessEl.textContent = 'Snapshot: Unknown';
      freshnessEl.className = 'ops-freshness ops-freshness-unknown';
      return;
    }
    const live = state.live;
    liveBadgeEl.hidden = !live;

    if (state.lastRunAt === null) {
      freshnessEl.textContent = 'Snapshot: Unknown — no automation cycle recorded yet';
      freshnessEl.className = 'ops-freshness ops-freshness-unknown';
    } else {
      const stale = now - state.lastRunAt > STALE_MS;
      freshnessEl.textContent = `Snapshot updated ${relativeTime(state.lastRunAt)}${stale ? ' — stale' : ''}`;
      freshnessEl.className = `ops-freshness ${stale ? 'ops-freshness-stale' : 'ops-freshness-fresh'}`;
    }

    // Kill-switch state is real, measured data (server/liveOrchestrator.mts's
    // own gate) — genuinely all this slice knows about "system health" so
    // far. Exchange API / Market Data / Execution / Reconciliation status
    // (section 22) is a separate, later piece — not faked here as green.
    if (live?.killSwitchEngaged) {
      systemStatusEl.textContent = '● Halted';
      systemStatusEl.className = 'ops-status ops-status-critical';
      killSwitchEl.hidden = false;
      killReasonEl.textContent = live.killSwitchReason ?? 'no reason recorded';
    } else {
      systemStatusEl.textContent = live ? '● Operational' : '● No live account';
      systemStatusEl.className = `ops-status ${live ? 'ops-status-ok' : 'ops-status-unknown'}`;
      killSwitchEl.hidden = true;
    }

    const pending = live?.pendingApprovals ?? [];
    actionRequiredEl.hidden = pending.length === 0;
    actionListEl.innerHTML = pending.map((a) => actionCardHtml(a, now)).join('');

    liveEmptyEl.hidden = !!live;
    kpisEl.hidden = !live;
    if (live) {
      const equity = live.equityHistory.at(-1)?.equity ?? live.cash;
      const todayStart = new Date().setHours(0, 0, 0, 0);
      const todayPnl = live.tradeJournal
        .filter((t) => t.exitTimestamp >= todayStart)
        .reduce((sum, t) => sum + t.realizedPnl, 0);
      const todayCount = live.tradeJournal.filter((t) => t.exitTimestamp >= todayStart).length;
      kpisEl.innerHTML = `
        <div class="ops-kpi"><div class="ops-kpi-value">${euro(equity)}</div><div class="ops-kpi-label">Equity</div></div>
        <div class="ops-kpi"><div class="ops-kpi-value">${euro(live.cash)}</div><div class="ops-kpi-label">Available cash</div></div>
        <div class="ops-kpi"><div class="ops-kpi-value">${live.positions.length}</div><div class="ops-kpi-label">Open positions</div></div>
        <div class="ops-kpi"><div class="ops-kpi-value ${todayPnl >= 0 ? 'ops-up' : 'ops-down'}">${todayCount === 0 ? '—' : signedEuro(todayPnl)}</div><div class="ops-kpi-label">Today's P&L (${todayCount} closed)</div></div>`;
    }

    const events = live?.recentEvents ?? [];
    activityEmptyEl.hidden = events.length !== 0;
    // detail can embed a raw broker/exchange response string (see
    // revolutXBrokerAdapter.mts) — escaped before going into innerHTML, not
    // trusted as safe markup just because it usually looks like plain text.
    activityEl.innerHTML = events
      .map(
        (e) => `
        <div class="ops-activity-row">
          <span class="ops-activity-time">${formatClock(e.at)}</span>
          <span class="ops-activity-event ops-activity-${escapeHtml(e.event)}">${escapeHtml(e.event)}</span>
          <span class="ops-activity-detail">${e.symbol ? `${escapeHtml(baseOf(e.symbol))} — ` : ''}${escapeHtml(e.detail)}</span>
        </div>`,
      )
      .join('');

    statusEl.textContent = `Updated ${formatClock(now)}`;
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
