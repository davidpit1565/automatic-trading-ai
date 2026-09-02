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
      Also exports `toRevolutXSymbol(internalSymbol, instruments)` — RESOLVES
      the symbol-translation question below by translating this project's
      internal instrument symbol (e.g. `'XBTEUR'`) to Revolut X's own pair
      format (e.g. `'BTC-EUR'`), using the SAME `base`/`quote` breakdown the
      trading engine already relies on (never by guessing where a
      concatenated symbol string splits). Returns `null` — never guesses —
      when the internal symbol isn't recognised.
- [x] **Wiring** (`server/liveOrchestrator.mts`, 2026-09-02) —
      `runLiveOrderFlow` chains kill-switch check → mandatory symbol
      verification → `ConfirmationGate` → `BrokerAdapter.submit`, as tested,
      reusable machinery. `buildLiveOrderIntent` maps an already
      risk-approved `TradeRiskAssessment` (buy/entry side only) to a live
      `OrderIntent`. The exit side (below) reuses this exact same function —
      `runLiveOrderFlow` is side-agnostic, buy or sell.
      **Every refusal path is audited**, not just the eventual
      approve/reject/submit, and the symbol check is MANDATORY whenever
      `brokerAdapter.mode === 'live'` — `runLiveOrderFlow` refuses outright
      (`'missing-symbol-check'`) rather than silently placing an order with
      no real-instrument verification if the check is missing.
      **This closes the checklist item as tested code — it is NOT invoked
      by any scheduled workflow.** Nothing in `.github/workflows/*.yml`
      calls this file; no cron job generates live signals or feeds them
      through it. Turning continuous live trading on — which live signal
      source feeds this, which asset universe, on what schedule — is a
      separate, larger decision not made here.
      **RESOLVED same night**: `buildLiveOrderIntent` now takes the
      ALREADY-translated broker symbol as an explicit parameter — a caller
      must call `toRevolutXSymbol` first and pass its result, not
      `assessment.asset` directly. With that, `verifySymbolExists` really
      can be `revolutXAdapter.listTradablePairs().then(pairs =>
      pairs.includes(intent.symbol))`, safely, because by that point
      `intent.symbol` is already broker-native.

**What's still genuinely unresolved** (not a code gap — an external fact
this session has no way to check): whether Revolut X actually LISTS a
given asset's EUR pair at all. Public Revolut X docs are
inconsistent/contradictory on this, and the authoritative answer needs the
authenticated `/configuration/pairs` call, which requires credentials this
session doesn't hold. This is exactly what `listTradablePairs()` checks for
real at runtime — a live order for an asset Revolut X doesn't quote in EUR
will correctly refuse as `'unknown-symbol'` rather than guessing a
different currency, which is safe, not broken.

- [x] **Live position exits** (`server/liveExitFlow.mts`,
      `src/core/autopilot/exitDecision.ts`, 2026-09-02) — the entry-side
      wiring above only opens positions; nothing tracked when to CLOSE one
      until now.
  - `exitDecision.ts`: extracted `decideExit` — the exact stop-loss /
    trailing-stop / trend-exit / take-profit logic `paperAutoPilot.ts` used
    inline, now shared pure code. Paper trading was refactored to call it
    (behavior-preserving — its own 45 tests still pass unchanged); live
    exits (`decideLiveExit`) call the SAME function. This is what "paper
    and live are the same pipeline" (property 3, above) actually requires:
    shared decision logic, not two implementations that could drift.
  - `liveExitFlow.mts`: `recordLiveEntryFill` persists a filled BUY's real
    stop/target/fill-price the moment it fills — the broker's own
    `fetchPositions()` has no idea what WE consider this position's stop or
    target, only local state does (mirrors what paper trading gets for
    free from its local `PortfolioEngine`). `buildLiveExitIntent` then
    builds a SELL `OrderIntent` that goes through the EXACT SAME
    `runLiveOrderFlow` safety chain as any entry — kill-switch, mandatory
    symbol check, human confirmation, only then `submit`. Nothing
    special-cases exits past the confirmation gate.
  - `telegramConfirmationGate.mts`'s confirmation message now branches on
    `intent.side`: a sell renders which position, at what price, and the
    real P&L — showing the entry's risk%/reward-ratio numbers (as if they
    applied to an exit decision) would be actively misleading.
  - **Red-team review before committing caught a real bug**: the exit P&L
    was computed against the originally PROPOSED entry price, not the real
    fill price — wrong whenever an entry fills with any slippage. Fixed:
    `recordLiveEntryFill` overrides the tracked position's
    `entryAssessment.entry` to the real `avgFillPrice`, so the exit's math
    is honest about what was actually paid.
  - **Still NOT wired into any workflow**, same posture as the entry side —
    tested, reusable machinery, not a running feature.

- [x] **Confirmation expiry** (`server/telegramConfirmationGate.mts`,
      2026-09-02) — a sent confirmation now auto-expires (`approved: false,
      decidedBy: 'system'`, audited) if 20 minutes pass with no reply,
      instead of resuming to poll indefinitely across runs. The order is a
      LIMIT order at the price current when the message was sent; the crypto
      autopilot cron fires roughly every 30 minutes, so a much later tap
      would submit at a price with no real relation to the market by then.
      Nothing auto-*approves* — this only ever produces a rejection.
- [x] **Manual sell override** (`server/manualSellCommand.mts`, 2026-09-02)
      — David asked "can I sell whenever I want?" (yes, but the built system
      only proposed exits when the algorithm's own exit logic fired).
      `checkManualSellRequests` polls for a `/sell <SYMBOL>` text command and,
      for a matching tracked live position, builds an exit intent at the
      current price and runs it through the EXACT SAME `runLiveOrderFlow`
      chain as an automatic exit — kill-switch, symbol check, confirmation
      tap, nothing bypassed. This only changes what TRIGGERS the exit
      intent, not the safety chain around submitting it. Still tested,
      reusable machinery — not called from any scheduled workflow yet.

- [x] **Manual kill-switch override** (`server/manualKillSwitchCommand.mts`,
      2026-09-02) — the kill switch previously only ever engaged
      automatically (drawdown breaker etc.); David had no way to halt
      everything himself on demand. `/pause`/`/resume` Telegram commands
      now engage/disengage it directly, audited either way, a no-op (not an
      error) if already in the requested state. Independent of the
      algorithm's own automatic triggers — a human override that works
      regardless of what those currently think. Still tested, reusable
      machinery, not called from any scheduled workflow yet.

- [x] **Shared Telegram update cursor** (`telegram.mts`'s
      `pollAllTelegramUpdates`/`stashUnclaimedTelegramUpdates`, 2026-09-02)
      — a deep pre-go-live review found that `TelegramConfirmationGate` (one
      offset PER pending intent), the manual sell override, and the manual
      kill-switch override each tracked their OWN independent "last seen
      update_id" and called Telegram's `getUpdates` directly. Telegram's
      `getUpdates(offset)` is a single GLOBAL cursor per bot token, though —
      confirming (advancing past) an update from ANY one of these
      permanently discarded it for every other one too, regardless of
      `allowed_updates` filtering. A human's `/pause` or `/sell` could
      silently, permanently vanish with no error if a different consumer's
      poll happened to run first. Fixed by centralizing: every poll now
      requests both `message` and `callback_query` types, advances the ONE
      shared offset, and returns everything to the caller; anything not
      acted on is stashed back (`stashUnclaimedTelegramUpdates`) so a
      different consumer can still find it on its own next check — the raw
      Telegram update is already gone by then, so nothing not stashed is
      recoverable. All three consumers were migrated to this and their old,
      now-dangerous per-consumer offset functions were removed entirely
      (not just deprecated) so the mistake can't quietly resurface.

Until something explicitly decides to generate real signals and feed them
through this machinery: the platform reads market data, analyses, and
simulates — nothing it does can reach a real account.
