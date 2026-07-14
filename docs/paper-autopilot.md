# Paper Autopilot

**Fully autonomous trading with simulated funds only.** There is no live
execution mode, no broker integration, and no code path capable of sending a
real order — all of this is enforced by architecture tests, not just policy.
Any future live trading must go through the blocking human `ConfirmationGate`
defined in `docs/execution-architecture.md`; automation is permitted below
that gate (simulation), never above it.

## What it does each cycle

1. **Protect open positions first.** Every open paper position is checked
   against current market data. Price at/below the stop loss closes it with
   reason `stop-loss`; price at/above the target closes it with reason
   `take-profit`. Exits carry full details into the trade journal
   (timestamps, weighted exit price, fees, MFE/MAE, P&L, return %).
2. **Discover opportunities.** The verified pipeline runs unchanged:
   Market Scanner → Signal Engine → Risk Engine. A paper position opens
   automatically **only** when every gate passes, sized by the Risk Engine's
   1%-risk rules (`DEFAULT_RISK_LIMITS`). A symbol already held is never
   pyramided. Risk refusals are audited with their reasons, never silent.
3. **Audit everything.** Every fill, refusal, and kill-switch event is
   appended to the audit log. The log's API is `append` and `entries` —
   nothing else exists; edits and deletions are impossible.

## Controls (Portfolio tab)

- **Start / Stop** with a configurable cycle interval (5m / 15m / 30m / 1h /
  4h / 1d) on the shared Scheduler abstraction.
- **Run cycle now** for an immediate pass.
- **⛔ Kill switch** — halts all automation instantly, persists across
  reloads, and only resumes on explicit user action.

## Reload survival

The desired running state (running + interval) is persisted. When the app
loads, `resume()` restores the schedule automatically — unless the kill
switch is engaged, in which case the autopilot stays down until a human
explicitly restarts it.

## Analytics integration

Autopilot trades flow through the same Position Engine and Trade Journal as
manual paper trades, so they feed the equity curve, win rate, profit factor,
drawdown, and all other Portfolio-tab statistics with no duplicated logic.
Strategy metadata (`autopilot-paper-v1`, confidence, notes) is recorded on
every position for later per-strategy analysis.

## Module map

| Module | Responsibility |
| --- | --- |
| `src/core/autopilot/paperAutoPilot.ts` | cycle orchestration (exits → entries), scheduling, reload survival |
| `src/core/autopilot/killSwitch.ts` | `KillSwitch` contract implementation, persisted |
| `src/core/autopilot/auditLog.ts` | `AuditLog` contract implementation, append-only |
| `tests/autopilot/*` | TDD suites: cycle behaviour, safety rails, reload survival |

## Safety invariants (architecture-tested)

- No `'live'` execution-mode literal anywhere in the automation layer.
- No `BrokerAdapter` implementation anywhere in `src`.
- No network calls in the automation layer.
- Entries only via `openFromAssessment` (risk-approved proposals).
- Every cycle checks the kill switch before doing anything.
