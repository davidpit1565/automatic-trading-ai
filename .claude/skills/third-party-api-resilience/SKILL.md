---
name: third-party-api-resilience
description: Use whenever building or reviewing code that calls an external API — Kraken, Zernio, Instagram/Meta Graph, Supabase, Beehiiv, Anthropic, or any third-party service. Also trigger on "API is down," "rate limit," "timeout," "external service," "third-party," or "what if it fails." Checks that a third-party outage or rate-limit doesn't silently break the feature or leave the user staring at a stuck screen.
---

# Third-Party API Resilience

This account depends on several external services for core functionality —
Kraken (trading data), Zernio (posting/scheduling), Instagram/Meta Graph,
Supabase (database), Beehiiv (newsletter), Anthropic (the agent itself). Any
of these can be slow, rate-limited, or fully down, and that has to degrade
gracefully rather than break the feature silently.

## The checks

- **Timeouts on every external call.** A call with no timeout can hang the
  request indefinitely when the third party is slow rather than down —
  check every fetch/API client has an explicit, reasonable timeout, not the
  runtime's default (which may be much longer than acceptable).
- **Rate-limit responses (429) are handled, not treated as a generic
  error.** Distinguish "this specific request was bad" from "we're being
  rate-limited, back off and retry later" — a 429 retried immediately makes
  the rate-limit worse, not better.
- **Retries use backoff, and are bounded.** An unbounded retry loop against
  a struggling service compounds the problem (for the third party and for
  this account's own resource usage); a fixed number of attempts with
  increasing delay is the baseline. See `idempotency-safety` for making sure
  a retried call is also safe to repeat.
- **A failed external call has a visible, specific effect for the user**,
  not a silently stuck spinner or a blank screen — see
  `empty-loading-error-states` for the UI-side pattern. The message should
  distinguish "we couldn't reach X" from a generic error where that
  information is available and useful.
- **Graceful degradation over hard failure, where the feature allows it.**
  This account's own `studio/` app already does this well for its database
  connection (falls back to a local mode with a visible badge rather than
  crashing) — apply the same principle elsewhere: if a non-critical
  third-party call fails, can the rest of the page/feature still work with
  that one piece missing or stale, rather than the whole thing failing?
- **Stale-but-available beats unavailable**, for read-heavy integrations —
  if cached/last-known data exists (follower counts, account status, a
  previous sync), showing it with an "as of [time]" note is usually better
  than blocking on a fresh call that might fail.
- **Credentials/token expiry is a distinct failure mode from an outage** —
  a 401 from Instagram/Zernio after a token expires should be reported as
  "reconnect needed," not lumped in with a generic network error, since the
  fix is different (re-auth, not retry).

## Process when this skill fires
1. Identify every external service call in what's being built/reviewed.
2. Check each has a timeout, and that 429/5xx responses are distinguished
   from 4xx client errors and handled accordingly (backoff+retry vs.
   surfacing a specific error).
3. Check the user-facing effect of a failure is specific and visible, not a
   silent stall — and that a degraded-but-working state exists where the
   feature allows it.
4. State which services were checked and what happens for each on failure —
   don't just assert "handles errors" without naming the actual behavior.
