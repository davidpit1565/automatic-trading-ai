/**
 * Nudges a GitHub Actions scheduled workflow that has silently stopped
 * firing — a real, measured failure mode (2026-08-31: stocks-autopilot.yml's
 * every-15-minutes-during-market-hours cron simply stopped being triggered
 * by GitHub's scheduler for 3 full days, with the workflow itself still
 * marked "active" the whole time — a known, undocumented GitHub Actions
 * limitation, not a bug in our own code, confirmed by manually re-running
 * it and watching it succeed immediately).
 *
 * Calls the REST API directly (no `gh` CLI dependency, so this runs the same
 * way locally as in Actions) using the calling workflow's own GITHUB_TOKEN,
 * which can dispatch any OTHER workflow in the same repo once granted
 * `actions: write`.
 */

export interface WatchdogConfig {
  readonly owner: string;
  readonly repo: string;
  readonly workflowFile: string;
  readonly token: string;
  /**
   * Only nudge if the target workflow's own schedule SHOULD be firing right
   * now (e.g. US market hours for the stocks workflow) — omit for a 24/7
   * workflow (crypto), where staleness always warrants a nudge regardless
   * of time of day.
   */
  readonly shouldBeActive?: (now: number) => boolean;
  readonly staleAfterMs: number;
}

export interface WatchdogResult {
  readonly nudged: boolean;
  readonly reason: string;
}

/** Same bound every other external call in this codebase uses — found
 * 2026-09-03 in a full-system audit: this is the watchdog meant to catch a
 * stuck workflow, but had no bound of its own on a stuck GitHub API call. */
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(fetchFn: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAndNudgeStaleWorkflow(
  config: WatchdogConfig,
  now: number,
  fetchFn: typeof fetch = fetch,
): Promise<WatchdogResult> {
  if (config.shouldBeActive && !config.shouldBeActive(now)) {
    return { nudged: false, reason: "outside the target workflow's own active window — staleness is expected" };
  }

  const authHeaders = { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json' };
  const runsUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/runs?per_page=1`;
  const runsResponse = await fetchWithTimeout(fetchFn, runsUrl, { headers: authHeaders });
  if (!runsResponse.ok) {
    return { nudged: false, reason: `could not read ${config.workflowFile}'s run history (HTTP ${runsResponse.status})` };
  }
  const payload = (await runsResponse.json()) as { workflow_runs?: Array<{ created_at?: string }> };
  const lastRunAt = payload.workflow_runs?.[0]?.created_at;
  if (!lastRunAt) {
    return { nudged: false, reason: `${config.workflowFile} has no recorded runs yet` };
  }

  const gapMinutes = Math.round((now - Date.parse(lastRunAt)) / 60_000);
  if (now - Date.parse(lastRunAt) <= config.staleAfterMs) {
    return {
      nudged: false,
      reason: `last ran ${gapMinutes} min ago — within the ${Math.round(config.staleAfterMs / 60_000)}-min threshold`,
    };
  }

  const dispatchUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/dispatches`;
  const dispatchResponse = await fetchWithTimeout(fetchFn, dispatchUrl, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (!dispatchResponse.ok) {
    return { nudged: false, reason: `dispatch failed (HTTP ${dispatchResponse.status}) after ${gapMinutes} min of silence` };
  }
  return { nudged: true, reason: `stale for ${gapMinutes} min — triggered a fresh run` };
}
