---
name: idempotency-safety
description: Use whenever building or reviewing a webhook handler, cron/scheduled job, retry logic, or any action that moves money, places a trade, or publishes content publicly (a social post, a notification). Also trigger on "webhook," "cron," "retry," "duplicate," "posted twice," "double-charged," "executed twice," or "what if this runs again." Checks that an action which is NOT safe to repeat can't actually be repeated by a retry, a redelivered webhook, or an overlapping scheduled run.
---

# Idempotency & Double-Execution Safety

This is the one that doesn't show up in normal testing at all — everything
works the first time, every time, until a webhook gets redelivered, a cron
job overlaps its own previous run, or a network retry fires a request that
actually succeeded the first time but timed out on the response. Then a
trade executes twice, or the same clip posts to Instagram twice, or a
balance gets debited twice. This account has two systems where that's a real
cost, not an inconvenience: automatic-trading-ai (real/simulated trade
execution) and the Zernio-connected posting pipeline (publishes to a real,
public account).

## Where this actually bites, and what to check

- **Webhooks can be delivered more than once for the same event.** This is
  documented, expected behavior for most webhook providers (including
  GitHub, and — check before assuming otherwise — Zernio/Vercel), not an
  edge case. A handler that isn't idempotent will double-process on a
  redelivery. Fix: key off the event's own unique id (not just its content)
  and skip/no-op if that id was already processed — store processed ids
  somewhere that survives a restart, not just in memory.
- **Cron jobs can overlap** if a run takes longer than the interval between
  runs, or if the platform ever fires a job twice for the same slot (which
  happens). A job that isn't safe to run concurrently with itself needs
  either a lock (only one instance runs at a time) or work that's naturally
  idempotent (e.g. "sync what changed since last successful run," where
  running it twice in a row just does nothing the second time).
- **Network retries can duplicate a request whose response was lost**, even
  though the original request actually succeeded server-side. This is the
  classic double-charge/double-post scenario: client times out waiting for
  a response, retries, and the server had already completed the first one.
  Fix: an idempotency key sent with the request (many payment/posting APIs
  support this explicitly — check if Zernio/the trading exchange's API
  does) so the server can recognize and no-op a retried request rather than
  executing it again.
- **A user double-clicking submit** is the same failure with a human cause
  instead of a network one — see `empty-loading-error-states` for the
  UI-side fix (disable during request); this skill is about the
  server/job side being safe even if a duplicate request does get through.

## Specifically for this account

- **Trading execution**: before any code path that places or would place a
  trade, confirm what happens if that exact call fires twice in a row (a
  retried order, a re-run of a scheduled strategy check). It should be
  provably impossible to double-execute the same intended trade — not just
  "unlikely because the schedule runs once a day."
- **Zernio posting**: confirm what happens if a post-publishing call is
  retried or a scheduling job re-fires — does it check whether that specific
  piece of content was already published before calling the API again?
  Posting the same clip twice to a real account is a visible, public mistake
  a viewer will notice, not a silent internal one.
- **Any Vercel cron** (e.g. a daily sync/track job): confirm re-running it
  manually or having it overlap a slow previous run doesn't double-write
  data (duplicate activity-feed entries, doubled counters).

## Process when this skill fires
1. Identify whether what's being built/reviewed can plausibly be invoked
   more than once for what should be a single logical action (webhook
   redelivery, cron overlap, network retry, human double-click).
2. If yes: confirm there's an actual mechanism preventing a repeat from
   having a repeated effect — an idempotency key, a processed-ids store, a
   lock, or the operation being naturally safe to repeat (e.g. "set to X"
   rather than "add X"). "It probably won't happen twice" is not a
   mechanism.
3. If no mechanism exists and the action is one of the ones listed above
   (money, trading, public posting), treat it as a real finding, not a
   nice-to-have — this is exactly the class of bug that costs money or is
   publicly visible when it happens.
4. State plainly which repeat-safety mechanism was checked or added, and for
   which specific action.
