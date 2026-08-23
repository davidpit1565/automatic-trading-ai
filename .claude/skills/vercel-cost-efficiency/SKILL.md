---
name: vercel-cost-efficiency
description: Use whenever writing or reviewing code that runs as a Vercel serverless/edge function, fetches data in a loop, polls an API, or serves images/media — anything that affects runtime cost or performance rather than build/deploy count. Also trigger on "slow," "expensive," "N+1," "polling," "function timeout," "image size," or "why is this using so much." This is about runtime resource usage, not deployment frequency — it does not touch anything covered by this account's existing Vercel deployment-branch protections.
---

# Vercel Runtime Cost & Performance Efficiency

Distinct from the account's existing deployment-count protections
(`vercel.json`'s `git.deploymentEnabled`, which stops `claude/*` branches
from triggering builds): this is about what a function actually costs and
how it performs once it *is* deployed and running — query patterns, polling,
timeouts, image weight. Both matter, but they're different problems with
different fixes; this skill never touches deployment/branch settings.

## The checks

- **N+1 queries**: a loop that calls the database or an external API once
  per item instead of batching — the classic cost/latency multiplier that
  works fine with 5 test records and falls over (or gets slow/expensive)
  with real data volume. Check any loop containing an `await` to a
  database/API call for whether it can be batched instead.
- **Unbounded polling**: a client polling an endpoint on a fixed short
  interval forever, rather than backing off, stopping when the tab is
  hidden, or switching to a push mechanism (webhook, websocket) where one's
  available. Each poll is a function invocation that costs the same whether
  anything changed or not.
- **Function timeout headroom**: does a function's expected worst-case
  runtime (slow third-party API, large payload) leave meaningful margin
  under its configured/platform timeout, or is it one slow upstream
  response away from failing? Long-running work (video processing, large
  syncs) belongs in a background job/queue, not a request-response function
  with a hard timeout.
- **Image/media weight**: images served without `next/image` (or
  equivalent) optimization, at a resolution larger than they'll ever be
  displayed at, or in a format heavier than necessary — this affects both
  load time for the user and bandwidth cost.
- **Unnecessary cron frequency**: a scheduled job running more often than
  the data it syncs actually changes (see this account's own `/api/track`
  daily sync as the right-sized example) — running every minute when the
  underlying numbers update once a day is pure waste, and see
  `idempotency-safety` for the double-run risk on top of that.
- **Fetching more than is displayed**: an API route or page that fetches an
  entire table/collection when only a paginated slice or a specific field
  set is ever rendered.

## Process when this skill fires
1. Identify any loop-with-external-call, polling interval, cron frequency,
   or media asset in what's being built/reviewed.
2. Check for N+1 patterns and whether a batch/join replaces them.
3. Check polling/cron intervals are matched to how often the underlying
   data actually changes, not just copied from another feature's interval.
4. Check images are served through an optimizer at a size matched to
   display, not source resolution.
5. State what was checked and, where a cost issue is found, the concrete
   fix and its expected impact (fewer calls, smaller payload) — not just
   "optimized it."
