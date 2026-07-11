# Execution Control Layer — Design (Stage 6 preparation)

**Status: design only. No execution code is implemented or enabled.**
The contracts live in `src/core/execution/types.ts`; architecture tests enforce
that the module stays implementation-free until Stage 6 is formally started.

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

## What Stage 6 must add (and only then)

- Paper `BrokerAdapter` implementation driven through the full state machine.
- A confirmation UI that shows the complete `TradeRiskAssessment` beside the
  order before asking for approval.
- Persistent audit log storage.
- Revolut X adapter behind a separate, explicitly-scoped API key.

Until then: the platform reads market data, analyses, and simulates — nothing else.
