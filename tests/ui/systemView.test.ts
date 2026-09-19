// @vitest-environment happy-dom
/**
 * Operations Console — System. Only real signals (kill switch, automation
 * heartbeat) — no fabricated subsystem-health rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderSystemView } from '../../src/ui/views/systemView';

async function waitFor(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function stubState(overrides: Record<string, unknown> = {}): void {
  const raw: Record<string, unknown> = {
    'portfolio-engine': { cash: 10_000, initialCash: 10_000, baseCurrency: 'EUR' },
    'open-positions': [],
    'audit-log': [],
    ...overrides,
  };
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve(raw) }));
}

beforeEach(() => {
  document.body.innerHTML = '';
});
afterEach(() => vi.unstubAllGlobals());

describe('System (DOM integration)', () => {
  it('reports Operational when there is a live account and no kill switch', async () => {
    stubState({ 'live:live-cash-eur': 500, 'live:kill-switch': { engaged: false } });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderSystemView(container);

    await waitFor(() => container.querySelector('#sy-status')!.textContent!.startsWith('Updated'));
    expect(container.querySelector('#sy-kill-card')!.textContent).toContain('Operational');
  });

  it('reports Halted with the real reason when the kill switch is engaged', async () => {
    stubState({ 'live:live-cash-eur': 500, 'live:kill-switch': { engaged: true, reason: 'daily loss limit' } });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderSystemView(container);

    await waitFor(() => container.querySelector('#sy-status')!.textContent!.startsWith('Updated'));
    expect(container.querySelector('#sy-kill-card')!.textContent).toContain('HALTED');
    expect(container.querySelector('#sy-kill-card')!.textContent).toContain('daily loss limit');
  });

  it('reports "No live account yet" explicitly rather than a fabricated status', async () => {
    stubState();
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderSystemView(container);

    await waitFor(() => container.querySelector('#sy-status')!.textContent!.startsWith('Updated'));
    expect(container.querySelector('#sy-kill-card')!.textContent).toContain('No live account yet');
  });

  it('shows the heartbeat as stale past the 30-minute bound', async () => {
    stubState({ 'live:live-cash-eur': 500, 'autopilot-last-run': { at: Date.now() - 40 * 60_000 } });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderSystemView(container);

    await waitFor(() => container.querySelector('#sy-status')!.textContent!.startsWith('Updated'));
    expect(container.querySelector('#sy-heartbeat-card')!.textContent).toContain('no recent cycle recorded');
  });

  it('shows "No automation cycle recorded yet" rather than treating a missing timestamp as healthy', async () => {
    stubState({ 'live:live-cash-eur': 500 });
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderSystemView(container);

    await waitFor(() => container.querySelector('#sy-status')!.textContent!.startsWith('Updated'));
    expect(container.querySelector('#sy-heartbeat-card')!.textContent).toContain('No automation cycle recorded yet');
  });

  it('reports Unknown on both cards when the snapshot itself cannot be loaded', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const container = document.createElement('section');
    document.body.appendChild(container);
    renderSystemView(container);

    await waitFor(() => container.querySelector('#sy-kill-card')!.textContent !== '');
    expect(container.querySelector('#sy-kill-card')!.textContent).toContain('Unknown');
    expect(container.querySelector('#sy-heartbeat-card')!.textContent).toContain('Unknown');
  });
});
