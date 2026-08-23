---
name: access-control-gating
description: Use whenever adding, moving, or reviewing any route, page, or API endpoint — especially in a Next.js/serverless app with a mix of public and gated pages. Also trigger on "PIN," "auth," "login," "protected route," "who can see this," "public page," "middleware," or "readable by anyone with the URL." Checks that every route's intended access level is actually enforced, not just assumed — a real gap found in this account's own videos-ai studio.
---

# Access Control & Gating

This isn't hypothetical: `videos-ai`'s own `studio/CLAUDE.md` states plainly
that "the studio is currently readable by anyone holding the URL" — a real,
already-documented gap. Every route added anywhere in this account should be
checked against this, not assumed to inherit protection from wherever it was
copy-pasted from.

## The core check

For every route/page/API endpoint touched:
1. **What access level is this supposed to have** — fully public, requires
   a PIN/password, requires an authenticated session, requires a specific
   role? If this isn't obvious from a single source of truth in the project
   (a route list, a middleware config), that's itself a finding — undeclared
   access level is how gaps happen.
2. **Is that level actually enforced**, not just intended? A page that
   *looks* gated (e.g. renders a PIN prompt client-side) but whose data or
   API route can still be fetched directly without the PIN is not actually
   protected — check the API/data layer, not just what the UI shows.
3. **Does a single declared list drive both the enforcement and the UI**,
   or can the two drift? (This account has hit exactly this: a route list
   duplicated in two files drifted three times in `videos-ai` — one file
   said a route was protected, the other didn't gate it.) One source of
   truth beats two files kept in sync by hand.

## Specific gaps to check for

- **A new API route with no auth check**, added because the page that calls
  it "already" has a login screen — the route itself needs its own check,
  since it can be called directly.
- **Middleware that gates pages but not their underlying API/data routes**,
  or vice versa.
- **A route added to the app but never added to the access-control list**
  at all — the silent-gap case, not a wrong-gap case.
- **Client-side-only gating** (a PIN check that runs in the browser before
  rendering, but the data was already fetched/embedded in the page payload
  regardless) — the data left the server before the check happened.
- **Session/PIN expiry**: does access actually expire, or does a PIN, once
  entered, grant access forever in that browser with no way to revoke it
  remotely?
- **A newly-public marketing/landing page accidentally sharing a layout or
  data-fetching path with a gated internal page** — check the public page
  doesn't pull in data meant only for the gated one.

## Process when this skill fires
1. Identify the route/endpoint being added or touched and its intended
   access level — ask if it's genuinely ambiguous.
2. Check enforcement at the layer that actually matters (API/data), not
   just the UI layer.
3. Confirm it's reflected in whatever this project's single source of truth
   for routing/access is — add it there if the project has one; flag that
   one should exist if it doesn't and gating is non-trivial.
4. State plainly what access level was set and how it's enforced — don't
   just say "added the page," say "added the page, gated behind X, enforced
   at Y."
