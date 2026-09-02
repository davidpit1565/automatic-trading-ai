# Execution Control Layer — Design (Stage 6 in progress)

**Status: Stage 6 started 2026-08-27 (David's explicit go-ahead), building in
the safe order below. No real broker and no real money are connected yet —
what exists so far is paper-only and not wired into any live orchestrator.**
The contracts live in `src/core/execution/types.ts`, still implementation-free
itself; an architecture test enforces that exactly one whitelisted file
(`paperBrokerAdapter.ts`, paper-only, no network) may implement `BrokerAdapter`
today, and that no other file — anywhere, real broker included — does.

## Position in the architecture

```
Signal Engine ──▶ Risk Engine ──▶ Trade Proposal (TradeRiskAssessment)
                                        │
                                        ▼
                              ┌─ Execution Control ─┐
                              │  ConfirmationGate    │  ← human, blocking, no default
                              │  KillSwitch          │  ← halts everything, instantly
                              │  AuditLog            │  ← append-only, every transition
                              └──────────┬───────────┘
                                         ▼
                                  BrokerAdapter
                              (paper simulator | Revolut X | future brokers)
```

## Non-negotiable properties

1. **Human confirmation** — an `OrderIntent` can only move from
   `awaiting-confirmation` to `confirmed` through `ConfirmationGate`, which
   blocks for an explicit decision. There is no auto-approve, no timeout-approve,
   and no batch-approve of live orders.
2. **Kill switch** — one control halts all submission paths immediately.
   Engaging it never asks for confirmation (stopping is always safe);
   disengaging always requires explicit human action.
3. **Paper and live are the same pipeline** — paper mode runs the identical
   state machine against a local fill simulator, so the confirmation and audit
   flow is exercised long before any live order exists.
4. **Audit everything** — every state transition, confirmation decision, and
   kill-switch event is appended to an immutable log with timestamps and actor.
5. **Position synchronisation** — local state is reconciled against broker
   truth; drift is *reported*, never silently auto-corrected.
6. **Broker abstraction** — Revolut X first (its API supports order placement
   with the same Ed25519 signing already used read-only), but nothing above
   `BrokerAdapter` may know which broker is in use. Order-capable credentials
   will be separate from the read-only key and will live server-side only,
   like the current market-data key.

## Order lifecycle

`proposed → awaiting-confirmation → confirmed → submitted → filled`
with `cancelled` / `rejected` reachable from every pre-fill state.
An engaged kill switch forces every in-flight intent to `cancelled`.

## What Stage 6 must add

- [x] **Paper `BrokerAdapter`** (`src/core/execution/paperBrokerAdapter.ts`,
      2026-08-27) — implements the full state machine against the existing
      paper `PortfolioEngine`, no network, mode fixed to `'paper'`. Not wired
      into `paperAutoPilot.ts`, which stays exactly as it was (autonomous,
      ungated, paper-only) — this is separate machinery, proven in isolation.
- [x] **A confirmation UI** (`server/telegramConfirmationGate.mts`,
      2026-08-27) — sends the order's real numbers (risk %, reward:risk,
      resulting portfolio exposure) to Telegram with Approve/Reject buttons,
      short-polls for the tap. No code path in this class can resolve
      `approved: true` without one. Adapted to this project's cyclical
      GitHub-Actions runtime: a single call polls for a bounded window and
      throws `ConfirmationPendingError` if unanswered rather than fabricating
      a decision; the SAME intent is resumed (not re-sent) on the next
      scheduled run via a persisted pending record.
- [x] **Persistent audit log storage** — already existed
      (`PersistedAuditLog`, `src/core/autopilot/auditLog.ts`), reused as-is
      by both pieces above.
- [x] **Revolut X adapter behind a separate, explicitly-scoped API key**
      (`server/revolutXBrokerAdapter.mts`, 2026-09-02) — David created a
      Spot-trade-only Revolut X API key (Ed25519, no withdraw permission)
      distinct from the existing read-only market-data key, stored as
      `REVOLUT_X_API_KEY`/`REVOLUT_X_PRIVATE_KEY` GitHub secrets. Reuses the
      exact signing already built and tested for read-only calls
      (`server/signing.mjs`) against `POST/DELETE/GET /orders` and
      `GET /balances`. `mode` fixed to `'live'`; `submit()` refuses
      paper-mode intents and refuses everything when the kill switch is
      engaged. Places the order, reads its state back ONCE (no wait/poll
      loop — that is separate wiring-layer work) and reports honestly
      (`'submitted'`, never fabricated as `'filled'`) when Revolut X hasn't
      filled it yet. `cancel()` looks up the venue order id from a persisted
      intentId→venueOrderId map and throws rather than silently no-op'ing
      when asked to cancel an intent it never placed. `fetchPositions()`
      reports raw spot balances; Revolut X's balances endpoint carries no
      cost basis, so `avgCost` is always `0` — reconciliation must compare
      quantity only, never cost, against this adapter's positions.
      **Known open question, not yet resolved**: this adapter sends
      `intent.symbol` as-is to Revolut X's own pair format (e.g. `'BTC-USD'`).
      Whether the project's own internal asset codes (e.g. `'BTCEUR'`) need
      translation to Revolut X's actual quoted pairs is wiring-layer work,
      not yet done — do not wire this adapter to a live orchestrator without
      resolving it first.
- [ ] **Wiring**: nothing yet calls `TelegramConfirmationGate` →
      `RevolutXBrokerAdapter` (or the paper one) as a live orchestrator loop —
      today they are tested, working machinery, not a running feature.

Until the last two items: the platform reads market data, analyses, and
simulates — nothing it does can reach a real account.
