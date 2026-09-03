# PROJECT_STATE

## The confirmation-message deadline clock disagreed with the digest clock (2026-09-03)
David pointed out the confirmation message's "בתוקף עד HH:MM" deadline still
showed Israel time while he's travelling. Root cause: two independent
timezone sources existed — `autopilotRunner.mts`'s digest scheduling
already defaults to `Europe/Brussels` for his trip (overridable via the
`SUMMARY_TIMEZONE` repo variable), but `telegramConfirmationGate.mts`'s
`formatDeadline` hardcoded `'Asia/Jerusalem'` directly and never read that
override — so the two clocks disagreed by an hour. This likely explains
some of the earlier "the time doesn't match my phone" reports too, not
just phone/DST quirks.

Fixed: moved `getSummaryTimezone()` into `telegram.mts` (a shared module
both files already import, avoiding a circular import between
`autopilotRunner.mts` and `telegramConfirmationGate.mts`) and pointed the
confirmation deadline at the same shared function the digests use — one
timezone source now, not two.

Also confirmed (from a real order this morning): the UUID `client_order_id`
fix is fully verified working — Revolut X now evaluates orders on their
real merits instead of bouncing every one with "Invalid client order ID".
The next rejection was a legitimate business one ("Estimated amount for
order is too small") — an expected consequence of the real account's tiny
balance (now correctly synced, see the cash-reconciliation entry below),
not a bug: any properly-sized position against a ~€0.11 balance is below
Revolut X's minimum order size. No code change needed there — it resolves
once the account is funded further.

Tests: a regression setting `SUMMARY_TIMEZONE` to a timezone far from both
Jerusalem and Brussels and confirming the confirmation deadline actually
reflects it. Full gate green (tsc server+app, 1003 tests, build).

## Extending true-black: every dominant-balance hero goes bare, not just Home's (2026-09-03)
Continuing the true-black direction (previous entry) — David said this is an
ongoing target, so kept going rather than treating #133 as one-shot. Found
that `hero-bare` (the "balance sits directly on the page, no card chrome"
treatment) had only ever been applied to Home's Crypto-Overview balance,
even though the identical dominant-figure pattern exists on five other
screens: Paper Portfolio's Equity, Stocks' Overview balance, the shared
Profit tab's "Total return" (used by both Crypto's and Stocks' hub —
`assetHubView.ts`), the shared History tab's "Now" figure
(`equityChartPanel.ts`, also shared by both hubs), and Stocks' Long-term
wallet balance. Each of these is genuinely the dominant element of its own
screen, exactly the situation `hero-bare` was designed for — so each now
gets the identical one-added-class treatment Home's hero got in #133.
`src/ui/views/portfolioView.ts`, `stocksOverviewPanel.ts`,
`stocksLongTermPanel.ts`, `assetHubView.ts`, `equityChartPanel.ts` — one
class added per file, no other changes.

Verified visually: dev server + Playwright at 400x860 (`?demo=1`) — Paper
Portfolio, Stocks Overview, Stocks Long-Term, and both hubs' Profit tab all
now render their balance bare and centered like Home's, instead of the old
boxed card. Full gate green: tsc, vitest (1002 tests, none touched), build.

Deliberately NOT touched in this pass (real component-level work, not a
free token win, left for a future increment): Grid Sim, Backtest and
Validation tool panels already read as fully consistent with the true-black
palette purely from the token change (verified visually) — their
inputs/buttons/pills inherit correctly and none of them has a dominant-
balance hero to convert, so there's no cheap win left there.

## True-black Revolut X theme landed — supersedes PR #117 (2026-09-03)
David: "do the direction of #117, this is your next target now." PR #117
(`claude/market-scan-integration-r9lck1`) proposed the true-black theme but
was hours stale with real merge conflicts against everything the redesign
pass above landed since (chart polish, typography tokens, Home/Markets/
controls press states, the real-money account card, the live-cash
reconciliation fix). Rather than merge it as-is, recreated its direction on
top of current `main`: cherry-picked its commit, resolved every conflict by
hand, reconciled it against what landed after it, then re-verified. `src/ui/
styles.css` + `src/ui/views/homeView.ts` + this file only.

**Token changes (authoritative, `:root`)**: `--bg: #000`, `--surface:
#141416`/`#1e1e21`/`#27272b`, `--border` now a near-invisible white hairline
(`rgba(255,255,255,.07)`/`.15`, was a solid navy-tinted hex) with card
OUTLINES REMOVED entirely, radius scale bumped a full step (`--r-xl: 30px`),
a new named type scale (`--fs-hero/display/section/body/sub/micro`). The
newer `--fw-*`/`--tracking-*`/`--sp-*` tokens (from tonight's typography-
foundation pass) are palette-agnostic and carried over untouched, applied
via the token where its value was an exact match (e.g. `--fw-semibold` for
literal 650) and left as a literal where PR #117's number didn't match any
existing step (e.g. button.primary's 700).

**Reconciliation calls made explicitly**:
- Home's PRIMARY simulated-portfolio hero gets `hero-bare` exactly as #117
  did — the balance sits directly on the page, no card chrome. The newer
  "Real money" hero (added after #117, `#home-live-hero`) stays a BOXED
  secondary card — #117's whole point was ONE dominant bare hero with
  everything else boxed, and a live-money card is secondary, not the
  screen's hero. Concretely: `.hero-value`'s giant `--fs-hero` sizing is now
  scoped to `.hero-bare .hero-value` only; a bare `.hero .hero-value` (i.e.
  a boxed card) keeps the previous moderate card-appropriate size — without
  this split the boxed real-money card would have inherited the same giant
  balance font as the dominant hero.
- Every `:active` press-state rule added tonight (`.nav-btn`, `.hub-tab`,
  `.mk-tab`, `.mk-star`, `.market-card` hover-lift, etc.) was preserved
  alongside #117's color/shape changes rather than dropped by the cherry-
  pick — e.g. `.market-card:hover` keeps its lift+shadow (adjusted to
  `--shadow-lg` since there's no border to swap on true black anymore).
  `.mk-star`'s `translateY(-50%) scale(0.85)` press composition (not a bare
  `scale()`, which would re-anchor it) is unaffected.
- Markets' "one grouped card, hairline separators" restructuring (`#mk-list`
  + `.market-row-wrap ~ .market-row-wrap` dividers) merged with ZERO DOM
  changes needed — `marketsView.ts` already wraps rows in `.market-row-wrap`
  inside a `.stack` with `id="mk-list"`, so #117's CSS-only restructuring
  slotted in directly.
- Fixed two more hardcoded pre-true-black leftovers #117 didn't touch: the
  `<select>`/`.mk-sort` chevron SVG data-URIs hardcoded the old `--text-dim`
  hex (`#929bb0`) directly in an inline `stroke` attribute rather than a
  token, now `#9a9aa4`.

**Bugs from #117 verified still present on current `main` and fixed**: the
`.up`/`.hero.up` selector collision (equity card rendering solid green) —
`.chg.up, .up:not(.hero)`; `.content` bottom padding clipping the last list
row under the floating nav (84px → 128px); desktop sidebar drawing over the
topbar (`top: 0` → `top: 5rem`); white outer glow on `button.primary` and
`.mk-tab.active` (removed).

Verified visually: dev server + Playwright (`playwright-core`,
`/opt/pw-browsers/chromium`) at 400x860 (`?demo=1`) — Home reads as pure
black with the balance as the dominant bare element and no market-card
outlines; Markets is one grouped hairline-separated card with 40px logos and
a filled `Popular` pill, no per-row borders; Tools inherits the palette
cleanly with no component-level changes needed. Also checked 1280px desktop:
sidebar now sits cleanly below the topbar with no overlap.

Full gate green: `tsc --noEmit`, `vitest run` (1002 tests, all passing, none
needed updating — the design change didn't touch any DOM structure or class
name the tests assert on beyond the one added `hero-bare` class), `npm run
build`.

PR #117 itself: commented that its direction landed via this PR and closed
without merging (its branch was stale/conflicted; this reimplementation is
what actually ships).

Left for a future pass (per David: this is an ongoing target, not one-shot):
extending true-black component-level polish to Portfolio/Grid/Backtest/
Validation/Stocks beyond what the token change already gives them for free.

## UI redesign pass: press feedback for every pill/icon control (Markets/coin-detail) (2026-09-03)
Continuing David's dashboard visual-elevation request — this increment targets
the coin-detail view's control vocabulary (range selector, chart-type toggle,
view tabs, pager, back/star icon buttons) plus the shared hub-tab/nav-bar
controls, all of which had a `:hover` state but **no `:active`/press state at
all** — the one micro-interaction gap left after the chart-polish and Home
passes already merged/opened. `src/ui/styles.css` only.

Added a `scale()` press state to: `.nav-btn`, `.hub-tab`, `.mk-tab`,
`.mk-star`, `.icon-btn`, `.star-btn`, `.view-tab`, `.pager`, `.range-btn`,
`.ctoggle-btn`. One subtlety worth flagging for review: `.mk-star` already
carries a base `translateY(-50%)` for vertical centering (it's an absolutely-
positioned overlay on a market row) — its `:active` rule composes
`translateY(-50%) scale(0.85)` rather than a bare `scale()`, which would have
silently re-anchored and visibly shifted the star on every press.

Verified visually: dev server + Playwright, opened the coin-detail view,
confirmed via `getComputedStyle` that `.icon-btn` actually applies
`scale(0.9)` on press (matrix confirms it); the other nine follow the
identical, lower-risk `transform: scale()` pattern.

Full gate green: `tsc`, `vitest run` (999 tests, none touched), `build`.
Branch `claude/ui-redesign-controls`, based on latest `main` (which already
includes the merged chart-polish PR).

## UI redesign pass: Home (Crypto Overview) micro-interactions (2026-09-03)
Part of David's dashboard visual-elevation request, Home view increment
(the "Overview" tab of the Crypto hub — `homeView.ts`, the screen David looks
at most). `src/ui/styles.css` only, no DOM/structure changes:

- `.tappable` (the hero card, market cards, mover rows — every "whole element
  is a button" surface on Home) had no press feedback at all before; added a
  `scale(0.985)` + slight opacity dip on `:active`, respecting
  `prefers-reduced-motion`.
- `.market-card` declared a `transform` transition that no rule ever
  triggered (dead code) — added the matching `:hover` (border + a 2px lift +
  `--shadow-sm`), the same tactile-depth treatment `.tool-card` already has
  elsewhere, so Home's market-card row is no longer the one card style in the
  app with an inert hover.

Verified visually: dev server + Playwright at a 400px phone viewport with
`?demo=1`; confirmed the hover lift and press-scale actually apply via
`getComputedStyle` (`transform: matrix(1,0,0,1,0,-2)` on hover) since a static
screenshot alone can't show a transient `:active` state. Full gate green:
tsc, vitest (999 tests, none touched), build.

Opened as its own PR (`claude/ui-redesign-home`), based on `main`
independently of the two already-open PRs (chart polish, theme-foundation
tokens) — deliberately did NOT reference the new `--fw-*`/`--tracking-*`
tokens from the foundation PR here since it isn't merged yet and those
custom properties don't exist on `main`; this PR uses plain literals
matching the surrounding code, to stay safe to merge in any order.

## UI redesign pass: typography/weight/tracking/spacing foundation tokens (2026-09-03)
Part of David's request to visually elevate the dashboard to Revolut X /
Investing.com polish. This increment lays the token foundation the task asked
for first ("cascades everywhere") — `src/ui/styles.css` only, and deliberately
a **zero-visual-change** pass: every substitution maps an existing literal
value to a newly-named token with the identical number, so nothing on screen
moves. Extends the existing `:root` token system (--hot/--cold, --shadow-*,
--r-*) rather than introducing a parallel one:

- `--fw-medium` (550), `--fw-semibold` (650), `--fw-bold` (750) — the three
  font-weight values already used dozens of times each across the file — and
  `--tracking-tight` (-0.01em), `--tracking-wide` (0.06em), likewise the two
  dominant recurring letter-spacing values. Applied via exact-match
  substitution everywhere they occurred (49 font-weight + 25 letter-spacing
  declarations).
- `--sp-1` through `--sp-7` (0.25rem-2rem, 4px rhythm), applied so far to the
  top-level shared layout containers (`.content`, `.block`) where an exact
  match existed.
- Deliberately NOT done here (left as literals): one-off weight/tracking
  values used once or twice (600, 680, 700, 800, etc.) — tokenising a value
  with no reuse adds indirection without a consistency payoff, and would be
  unnecessary refactoring. Font-size stays un-tokenised for now: the existing
  sizes are legitimately context-tuned per component rather than drawn from a
  shared scale, and consolidating ~30 distinct values into a clean scale
  without visual regression is a larger, separate, higher-risk pass than this
  one. Card/border/shadow treatment was reviewed and left alone — it's
  already a consistent, shared system (`--shadow-xs/sm/md/lg`, `--border`,
  `--r-*` used uniformly across every card class already), not something
  needing a foundation pass.

Verified visually: dev server + Playwright at a 400px phone viewport with
`?demo=1`, Home/Crypto and Tools views — pixel-identical to before, as
expected for a token-naming-only change. Full gate green: `tsc`, `vitest run`
(999 tests, all passing, none touched), `npm run build`.

Opened as its own PR (branch `claude/ui-redesign-theme-foundation`), based on
`main` independently of the chart-polish PR (`claude/ui-redesign-charts`) so
the two can be reviewed and merged separately. Next passes: home view and
markets view visual polish (spacing/elevation applied at the component level,
building on these tokens).

## UI redesign pass: press feedback for Tools-grid and remaining-views controls (2026-09-03)
Last increment of this pass of David's dashboard visual-elevation request,
covering the lowest-priority bucket ("remaining views — portfolio, grid,
backtest, validation, stocks, as time allows"): the Tools navigation grid
that leads to all of them, plus its back button and the Market Scan table
rows, none of which had press feedback. `src/ui/styles.css` only.

- `.tool-card` (the Backtest/Validation/Grid/Portfolio/Stocks nav grid on the
  Tools tab) had a hover lift but nothing for the tap itself — added
  `scale(0.97)` + `--shadow-xs` on `:active`.
- `.tool-back` (the back button inside every one of those tool panels) —
  added `scale(0.96)` on `:active`.
- `.scan-row` (Market Scan's table rows) — a `<tr>` can't take a scale-press
  without misaligning its cells, so it gets a background darken on `:active`
  instead, matching what `.tappable`/`.row` cards elsewhere already do for
  their own press state.

Verified visually: dev server + Playwright, confirmed via `getComputedStyle`
that `.tool-card` applies `scale(0.97)` on press (matrix confirms it).

Full gate green: `tsc`, `vitest run` (1002 tests — 3 more than earlier today
from other work landed on `main` meanwhile; none touched by this diff),
`build`. Branch `claude/ui-redesign-tools-controls`, based on latest `main`.

This closes out the micro-interaction gap across every priority tier from
the original request (charts → theme tokens → Home → Markets/coin-detail →
remaining views). Five PRs total from this pass; see each PR's own
description for specifics. Anything beyond press-state consistency and the
chart/token work already done — e.g. a full font-size scale consolidation,
or component-level (not just token-level) spacing/elevation redesign of
individual remaining views — is intentionally left for a future pass rather
than attempted as one large, harder-to-review change.

## The live cash tracker was never reconciled against the real Revolut X balance (2026-09-03)
Real incident: the first order that ever reached the broker after the UUID
`client_order_id` fix landed got rejected with `HTTP 422 — "Insufficient
balance of €0.11; required €20.03"`. The bot's internal `live-cash-eur`
tracker said €100.15 the whole time. Root cause: `server/liveLedger.mts`
only ever *initializes* cash from `LIVE_STARTING_CASH_EUR` and then
debits/credits it locally on fills the bot itself observes — nothing had
ever checked that number against Revolut X's own `/balances` endpoint
(`RevolutXBrokerAdapter.fetchPositions()` already existed for exactly this
"reconciliation" purpose per its own doc comment, but was never called
anywhere). This is a real correctness bug, not cosmetic: every live entry's
position size (`assessTrade({equity, ...})` in `liveEntryMirror.mts`) was
sized against the wrong, larger equity figure all night.

Fixed: new `syncLiveCashFromBroker(store, brokerAdapter)` in
`liveLedger.mts` overwrites the tracked cash with the broker's real EUR
balance from `fetchPositions()` — called at the start of every live cycle
in `autopilotRunner.mts`, before anything sizes a trade. Self-heals any
future drift (a manual trade on the Revolut X app, an untracked fee, a
missed fill) automatically, rather than needing a human to report the true
number. No-ops (keeps the last-known value) on a fetch failure rather than
zeroing out real cash on a transient network hiccup.

Tests: overwrites cash to the broker's real EUR figure; leaves cash
untouched when no EUR balance is reported; leaves cash untouched on a
fetch failure. Full gate green (tsc server+app, 1002 tests, build).

## UI redesign pass 1: chart visual polish (2026-09-03)
David asked for the whole dashboard visually elevated to Revolut X / Investing.com
polish, "especially all the graphs." First increment of that pass, scoped to
`src/ui/styles.css` only (no `charts.ts` markup/geometry changes, no view changes) —
smallest possible diff for a change this visible, and zero risk to the SVG
structure the chart tests and crosshair-overlay code depend on:

- Candlestick bodies/wicks: solid full-opacity fill (was 0.8/0.88, which
  muddied the down-candle red especially) with a crisper, thinner stroke and
  a smaller corner radius — professional charts (Investing.com/TradingView)
  render solid bodies, not translucent ones.
- Chart grid lines: solid hairlines instead of a dashed pattern — a dashed
  grid reads as a sketch, not a finished instrument. Axis labels gained
  tabular-nums and a touch of letter-spacing so ticks line up cleanly.
- Support/resistance dashed lines and volume-bar underlay opacity now come
  from CSS class rules (which the cascade lets win over the low-specificity
  inline presentation attributes `charts.ts` sets) so they can be tuned
  without touching the chart-generation code at all; volume bars dialled
  down to a quiet underlay instead of competing visually with the candles.
- Sparklines (`.spark polyline`, home/market cards) and the line-mode price
  chart's polyline both got a hair thinner via the same CSS-overrides-inline-
  attribute mechanism, for a more restrained "instrument" line vs. the
  previous thicker default.

Verified visually: ran the dev server, opened the BTC candlestick detail
chart in a real browser at a 400px phone viewport with `?demo=1` (Playwright,
`/opt/pw-browsers/chromium`) and inspected the screenshot — crisp solid
candles, clean hairline grid, subtle volume bars, all rendering correctly.
(Noted in passing, not fixed here — out of scope for a chart-only diff: the
"Crypto" hub's portfolio-value hero and open-positions list stay in their
loading/"waiting for the cloud agent" state in this sandbox even under
`?demo=1`, because that data comes from a separate cloud-state fetch that
`?demo=1` does not stub — a pre-existing sandbox network limitation, not a
regression from this change.)

Full gate green: `tsc --project tsconfig.app.json --noEmit`, `vitest run`
(999 tests, all passing, none touched), `npm run build`. Opened as its own
PR (branch `claude/ui-redesign-charts`) rather than folded into a larger
diff — David asked for focused, reviewable increments, not one big unreviewable
change. Next passes (not done here): global typography/spacing token
refinement, then home/markets view polish.

## The website now shows the REAL Revolut X account, not just the simulated one (2026-09-03)
David asked why the website "still shows the money as demo" even though
real money is live — correct: `homeView.ts`'s hero card only ever read the
SIMULATED paper-trading state (`portfolio-engine`, `open-positions`, etc.),
never the real account. The real data was already being tracked and
committed server-side (`server/liveLedger.mts`'s `live-cash-eur`,
`server/liveExitFlow.mts`'s `live-open-positions`, all under the
`live:`-prefixed keys `autopilotRunner.mts` writes via `PrefixedStore`) —
the UI simply never read them.

Added: `cloudState.ts` now also parses the `live:` keys into a new
`CloudState.live` field (cash, open positions by internal symbol, kill-
switch state, recent real filled/rejected events) — `null` until the live
ledger has ever been initialized, so the stocks state file (no live
account) or a fresh deploy never shows a misleading "€0.00 real account".
`homeView.ts` renders it as a distinct "Real money" card (red `.tag-live`
badge, deliberately never the same color as the existing `.tag-sim`
badge), with its own open-positions list, and a paused banner when the
kill switch is engaged. Verified visually in a real browser (Playwright,
`?demo=1`): the card and the kill-switch-paused state both render
correctly, and no infrastructure exists yet to test this against the live
GitHub-hosted state directly, but the parsing is unit-tested against the
exact committed shape.

Tests: `cloudState.test.ts` (parses cash/positions/kill-switch/recent
events; null when uninitialized; safe defaults when partially absent),
`homeView.integration.test.ts` (hidden when no live account; shown with
correct equity/positions; kill-switch banner). Full gate green (tsc
server+app, 999 tests, build).

## client_order_id must be a real UUID — the colon fix was incomplete (2026-09-03)
The earlier fix tonight (sanitizing `:` → `-` in `client_order_id`) was not
enough: the very next live order still got `HTTP 400 — "Invalid client
order ID: 'live-entry-XBTEUR'"` (confirmed in the live audit log — same
message, now with the hyphenated id, still rejected). Checked Revolut X's
own API docs directly (developer.revolut.com/docs/x-api/place-order):
`client_order_id: string(uuid) required` — it must be an actual UUID, not
any sanitized string.

Fixed properly: `deterministicClientOrderId(intent.id)` (new, exported
from `revolutXBrokerAdapter.mts`) derives a UUID-shaped id via SHA-256 of
`intent.id`, rather than `crypto.randomUUID()` — deliberately
deterministic, so an accidental retry of `submit()` for the exact same
intent sends the exact same `client_order_id` every time (idempotency-
safety project rule: a retry must be safe to repeat, not look like a
brand new order to the broker). `intent.id` itself is still the internal
tracking key everywhere else (audit log, `orderMap`, Telegram callback
tokens) — only the wire value changed.

Tests: format assertion (real UUID shape, version/variant nibbles) and a
determinism test (same intent id → same client_order_id, different ids →
different). Full gate green (tsc, 993 tests, build).

## CRITICAL: a trade could be "approved" without the human ever tapping anything (2026-09-03)
David reported the exact violation of this project's core safety rule: he
got "✅ אישרת — שולח לבורסה..." (you approved — sending to exchange) for a
`/buy XBTEUR` he explicitly did NOT tap approve on. Root cause found and
confirmed against the live committed state:

`intent.id` for a live entry is deterministic per symbol
(`live-entry:${symbol}` — the exact same string every single time that
symbol is requested), and the Telegram inline button `callback_data` was
built directly from it (`confirm:approve:live-entry:XBTEUR`), with the
SAME value on every confirmation request for that symbol, forever. A tap
that arrives late (e.g. after its own message already auto-expired, or a
duplicate/retried Telegram delivery) becomes "unclaimed" and sits in the
persisted unclaimed-callbacks store (`telegram-unclaimed-callbacks`,
capped at 200) — where ANY future confirmation request for the same
symbol, having the identical expected `callback_data`, matches it as if it
were a fresh tap on the CURRENT message. Checked the live state directly:
`live:telegram-unclaimed-callbacks` currently holds 3 stale
`confirm:approve:live-entry:XBTEUR` entries and 1
`confirm:reject:live-entry:XBTEUR` — exactly the poisoned leftovers from
tonight's repeated `/buy XBTEUR` attempts.

Fixed in `TelegramConfirmationGate`: `callback_data` now embeds the
request's own `sentAt` (`confirm:approve:<sentAt>:<intent.id>`), making it
unique per confirmation instance, not just per symbol — a stale callback
from any earlier request can structurally never match a later one again.
The 4 already-stale entries in production state are automatically inert
under this fix (they'll simply never match anything going forward); no
state edit was needed.

Tests: a new regression reproducing the exact incident (a stale
old-format unclaimed callback present before a brand-new request is
created, asserting it does NOT resolve to an approval), plus every
existing fixture updated to the new token format. Full gate green (tsc
server+app, 992 tests, build).

## Revolut X rejects ':' in client_order_id — found from a live rejection (2026-09-03)
Right after the kill-switch-keyboard/education-tips PR shipped, David's next
real `/buy XBTEUR` got approved and actually reached the broker for the
first time tonight — and Revolut X rejected it: `HTTP 400 — {"message":
"Invalid client order ID: 'live-entry:XBTEUR'", ...}`. This is new,
previously-invisible information (only surfaced because PR #118 added the
raw rejection body to the Telegram message) — Revolut X does not accept
`:` in `client_order_id`, but this project's internal order id
(`live-entry:${symbol}`) is built with one and was being sent to the
broker verbatim.

Fixed in `RevolutXBrokerAdapter.submit()`: only the `client_order_id` field
sent over the wire is sanitized (`:` → `-`), leaving `intent.id` itself
untouched everywhere else it's used as the internal tracking key (audit
log, `rememberVenueOrderId`/`orderMap`, the Telegram approve/reject
callback data) — so nothing that correlates by `intent.id` needed to
change, only what Revolut X actually sees.

Tests: a regression reproducing the exact real error string and asserting
the sanitized id reaches the request while `report.intentId` keeps the
original. Full gate green (tsc, 991 tests, build).

## Persistent kill-switch keyboard + periodic education tips (2026-09-03)
David asked for two engagement features, both shipped:

1. **Always-visible kill-switch button.** A persistent Telegram reply
   keyboard (`killSwitchKeyboard()`, distinct from the per-message inline
   confirmation buttons) with two buttons whose text is literally `/pause`
   and `/resume` — tapping one just sends that text as an ordinary message,
   so `checkManualKillSwitchCommands` already handles it with zero new
   parsing. Sent once (an intro message explaining the buttons) the first
   time `runLiveMirror` runs, tracked via a `kill-switch-keyboard-sent`
   store flag so it's never resent every cycle — a persistent reply
   keyboard stays pinned at the bottom of the chat once sent.
2. **Periodic trading-education tips.** `maybeSendEducationTip` sends the
   next tip from a 10-entry Hebrew `EDUCATION_TIPS` rotation roughly every
   2 days (not gated behind `REAL_MONEY_ENABLED` — paper trading benefits
   too), wraps around forever, and only advances its index/timestamp on a
   confirmed send so a failed send retries next cycle instead of skipping
   a tip. Wired into the main cycle after `maybeSendPeriodicReports`.

Deliberately NOT done as part of this: auto-executing high-confidence
trades without approval. David's own answer, once asked, was to explicitly
reject that and keep the safe current default (no response = nothing
happens) — see `TelegramConfirmationGate`. What he actually wants instead
(escalating reminder(s) if a ≥70%-confidence trade sits unanswered for the
first ~10 minutes, a "you missed a good trade" message on final expiry, and
later a retrospective "here's what you would have earned" message once the
hypothetical trade's outcome resolves) is a real, separate feature: it
requires threading `confidence` through `TradeOpportunity` →
`TradeRiskAssessment` → `OrderIntent` → `TelegramConfirmationGate`, none of
which carry it today, touching ~10 test fixtures. Scoped as its own
follow-up rather than rushed into this diff.

The "best trading course in the world" request is left as background
research to start once current fixes are stable — no work started yet.

Tests: `maybeSendEducationTip` (first-send, interval-gated, rotates,
wraps, retries on failed send), kill-switch keyboard send-once. Full gate
green (tsc server+app, 990 tests, build).

## Found why every /buy after the first got silently swallowed (2026-09-03)
David reported still getting no response at all to repeated `/buy XBTEUR`
sends even after the previous fixes landed. Root cause: the very first
approved-and-broker-rejected order (HTTP 400, earlier tonight) marked
`XBTEUR` "outstanding" in `mirrorApprovedEntries` — and `outstanding` is only
ever cleared by `clearOutstandingEntry`, called when a position is later
confirmed CLOSED. Since that order was rejected, no position was ever
opened, so nothing could ever clear the flag — every subsequent `/buy`
(manual or mirrored) hit the `outstanding.has(symbol)` guard at the top of
the function and was silently dropped as `'entry-already-outstanding'` with
zero Telegram response, indistinguishable from the bot being broken.

Fixed: only a report representing REAL still-live exposure (a genuine fill,
partial or full, or a resting order still open at the broker) marks a
symbol outstanding now — `state === 'rejected'`/`'cancelled'` no longer
does, since nothing is actually open. Also manually cleared the live
account's already-stuck `XBTEUR` outstanding flag directly in the committed
state (verified first: no open position, cash untouched — purely a bug
artifact, safe to clear) since the code fix alone can't undo already-corrupt
persisted state.

Also, David asked to see the trade's EUR value and % of the wallet directly
in the confirmation message (he's traveling and wants the numbers spelled
out, not implied by the risk-sizing line) — added `שווי העסקה: €X (Y%
מהארנק)` using the risk engine's own `positionValue`/`portfolioExposure`.

Tests: a new regression (`liveEntryMirror.test.ts`) proving a rejected order
does NOT block the next attempt. Full gate green (tsc, 982 tests, build).

## Telegram now confirms the human's tap and the final trade outcome (2026-09-03)
David correctly reported the approve/reject buttons felt broken — tapping
"אשר" registered fine server-side (confirmed by the audit log), but nothing
in the chat ever changed, and no message ever reported what happened to the
order afterward. Two real gaps, now closed:

1. **`TelegramConfirmationGate`** now edits the original prompt immediately
   after a decision (stripping the inline keyboard, replacing the text with
   "✅ אישרת — שולח לבורסה..." / "❌ דחית..."), and does the same on
   auto-expiry ("⌛ פג התוקף..."). Requires storing the sent message's
   `message_id` in the pending record (added a new `editTelegramMessage` to
   `server/telegram.mts`, alongside `sendTelegramMessage`).
2. **A separate follow-up message** now reports the actual broker result —
   `server/autopilotRunner.mts`'s `runLiveMirror` now captures the
   `LiveEntryOutcome[]` that `checkManualBuyRequests`/`mirrorApprovedEntries`
   already returned (previously discarded entirely) and sends one message
   per outcome that reached an actual human decision (`buildLiveEntryResultMessage`):
   filled (qty + avg price), still-resting/not-yet-filled, broker-rejected
   (with the real detail, e.g. the HTTP 400 body from PR #118's fix), or a
   human decline. Outcomes that never reached a tap (`'not-approved'`,
   `'no-broker-symbol'`, `'unknown-symbol'`, etc.) stay audit-log-only, same
   as before — this is specifically the "I tapped a button, what happened?"
   gap, not a general notification pass.

Separately checked and ruled out: David also reported the printed expiry
clock (`בתוקף עד HH:MM`) looked wrong relative to his phone's clock. Verified
the server's own clock and `Asia/Jerusalem` conversion directly (`date -u`
vs `TZ=Asia/Jerusalem date`) — both correct, and the printed deadline in the
actual audit-logged message matches `sentAt + 20min` in real IDT exactly.
The mismatch is on the phone's side (likely a stale/manual timezone setting
not reflecting Israel's DST), not something this project's code can fix.

Tests: `editTelegramMessage` (3 new, `tests/server/telegram.test.ts`); the
gate's edit-on-approve/reject/expiry (extended `tests/server/
telegramConfirmationGate.test.ts`'s shared fake-Telegram router to capture
edits); `buildLiveEntryResultMessage`'s message selection for every outcome
shape (5 new, `tests/server/autopilotRunner.test.ts`). Full gate green (tsc,
981 tests, build).

## First real end-to-end confirmation worked — now blocked one step later (2026-09-03)
The pair-key fix (previous entry below) worked immediately: the very next
`/buy XBTEUR` produced a real Telegram confirmation prompt, David tapped
"אשר" (approve), and `TelegramConfirmationGate` correctly registered it
(`'confirmed'` audited ~19s after the prompt was sent — the button DID
register; David just never saw any follow-up, see below). The order was
then submitted to Revolut X, which rejected it with HTTP 400 — but
`submit()`'s rejection path discarded the response body, so — same class of
bug as `listTradablePairs()` — there's no way yet to see WHY. Fixed the same
way: audits the real response body (truncated) alongside the HTTP status.

**Separately flagged, not yet fixed**: nothing sends David a Telegram
message reporting the final outcome after he approves — `runLiveOrderFlow`
takes a `ConfirmationGate` interface, deliberately not Telegram-specific, so
a post-decision notification needs to be plumbed through the caller
(`autopilotRunner.mts`'s `runLiveMirror`) instead. This is why the approved
tap looked like it "didn't register" — it did, but he had no way to know
without me reading the audit log for him. Real gap for a real-money bot;
next.

## THE go-live blocker, actually fixed: pair keys use '/' not '-' (2026-09-03)
The raw-response diagnostic (previous entry below) landed and immediately
paid off: the real `GET /configuration/pairs` response is
`{"LINK/USD":{"base":"LINK","quote":"USD",...}, "BTC-EUR-shaped-guess-was-wrong": ...}` —
Revolut X separates base/quote with a **forward slash**, not a hyphen. This
project's own parsing (`readPairSymbols` in `server/revolutXBrokerAdapter.mts`,
and the mirrored `getInstruments()` in `src/core/data/revolutClient.ts`)
assumed a hyphen, so `Object.keys(body).filter(s => s.split('-'))` matched
**zero** real keys — `listTradablePairs()` was silently returning an empty
list on every single call, with a genuinely successful HTTP 200 the whole
time. `toRevolutXSymbol` also built its candidate symbol with a hyphen
(`'BTC-EUR'`), which could never have matched anyway even if parsing worked.

Fixed both: `readPairSymbols` now validates each entry by its own `base`/
`quote` fields (present on every real pair config) instead of guessing a
separator from the key at all — robust to whatever the key format actually
is. `toRevolutXSymbol` now joins with `/` to match. 3 new regression tests
lock in the real production shape (`'LINK/USD'`), that entries missing
base/quote are still excluded, and that a 200-with-0-symbols still audits
the raw body. `src/core/data/revolutClient.ts`'s `getInstruments()` has the
identical latent bug (same hyphen assumption) but is NOT on the live-trading
path (`runLiveMirror` gets its `instruments` from Kraken via `pickSource()`,
never from this Revolut client) — left as a flagged follow-up, not fixed
here, to keep this change scoped to what's actually blocking real money
tonight. Full gate green (tsc, 973 tests, build).

## Definitive answer: Revolut X returns 0 tradable pairs, not an HTTP failure (2026-09-03)
The same-base-pair diagnostic (previous entry below) reported the real
finding on its first live cycle: `'BTC-EUR' not found among 0 tradable pairs
from revolut-x; no pair with base 'BTC' listed at all`. Zero pairs, with NO
HTTP-failure audit entry from `listTradablePairs()` — meaning `GET
/configuration/pairs` returns `200 OK`, but `readPairSymbols()` parses zero
symbols out of it. The parsing assumes an object keyed by pair symbol (e.g.
`{"BTC-USD": {...}}`, mirroring `RevolutXClient.getInstruments()`'s own
assumption for the read-only market-data key) — the live trading key's
response may genuinely be shaped differently (e.g. an array of pair objects,
which this parsing explicitly discards rather than guess-parses). Added one
more layer: `listTradablePairs()` now audits the raw response body (truncated
to 500 chars) whenever it gets a 200 OK but 0 parseable symbols, so the very
next attempt will show the actual JSON shape Revolut X returns for this key,
instead of another guess. Full gate green (tsc, 970 tests, build).

## The go-live blocker's diagnostic fix didn't actually diagnose it — narrowed further (2026-09-03)
PR #113's diagnostic logging in `listTradablePairs()` shipped and ran for real
(after two more stale-workflow-run cancellations), but the next `/buy XBTEUR`
still logged the exact same ambiguous `'could not verify... either it doesn't
exist there, or the check itself failed'` message — because that logging only
fires when the `/configuration/pairs` HTTP call itself fails, and it wasn't
failing. `listTradablePairs()` was succeeding and simply not returning
`'BTC-EUR'` in its list — indistinguishable, from the caller's side, from a
fetch failure. Narrowed further: `runLiveMirror`'s `verifySymbolExists`
closure (`server/autopilotRunner.mts`) now audits, on a miss, the pairs count
and whether ANY same-base pair exists (e.g. `'BTC-USD'` present but not
`'BTC-EUR'`, vs. no `'BTC-*'` pair at all, vs. an empty/unreachable list) —
so the NEXT `/buy` attempt's audit log will finally say which of those three
it actually is, instead of another round of the same guess. Full gate green
(tsc, 970 tests, build).

## Found and fixed the real go-live blocker, plus the two flagged review gaps (2026-09-03)
The first real `/buy XBTEUR` attempts against production went unanswered —
no Telegram confirmation ever arrived. Root cause, found by pulling the
committed `state/autopilot-state.json`'s `live:audit-log` directly (the
running workflow's own logs aren't fetchable while in-progress): every
attempt was silently refused as `'unknown-symbol'` because
`RevolutXBrokerAdapter.listTradablePairs()`'s `GET /configuration/pairs`
call was failing, and that failure was previously invisible — the only
trace was an ambiguous "could not verify... either it doesn't exist there,
or the check itself failed" message with no real HTTP status or body
anywhere. Fixed: `listTradablePairs()` now audits the ACTUAL failure (HTTP
status + response body, or the thrown error message) under a
`'list-tradable-pairs'` intentId, so the next attempt's real cause is
readable from the audit log instead of guessed at. (Diagnosis, not a
guessed fix — the underlying cause, whatever it turns out to be signing,
permissions, or a genuine symbol-format mismatch, will now be visible in
the very next failed attempt.)

Also fixed the two smaller gaps the earlier adversarial review flagged but
left for a design call:
- **Confidence-scaled risk now applies to live entries** — `liveEntryMirror.mts`'s
  `mirrorApprovedEntries` gained an optional `confidenceRisk` option
  (floor/ceiling %, confidence floor, max confidence); `autopilotRunner.mts`
  passes the SAME `AUTOPILOT_CONFIDENCE_RISK`/`AUTOPILOT_MIN_CONFIDENCE`
  paper already uses, so a live entry's size now actually reflects signal
  strength instead of always sizing at the flat 1% ceiling. Applies
  uniformly to mirrored AND manual `/buy` entries — the latter's fixed
  `confidence: 0` naturally floors to the smallest (0.5%) size, a sensible
  default for a human-triggered test entry.
- **Partial-fill SELLs are no longer invisible** — `liveExitFlow.mts` gained
  `reduceLivePositionQuantity`, called by both `liveExitMirror.mts` and
  `manualSellCommand.mts` when an exit's `OrderStatusReport` says
  `state: 'submitted'` with a genuine nonzero `filledQuantity` less than the
  tracked quantity: credits only the partial proceeds and shrinks the
  tracked quantity by that amount, keeping the remainder under normal
  stop-loss/take-profit monitoring instead of vanishing from tracking
  (mirrors the partial-fill BUY handling already fixed earlier tonight).
  `outstandingExitSubmittedAt` deliberately stays set — a resting order for
  the unfilled remainder is still real exposure at the broker.

Tests: 3 new (`reduceLivePositionQuantity` unit tests plus its wiring in
`liveExitMirror.test.ts`/`manualSellCommand.test.ts`), 1 new
(confidence-scaled sizing in `liveEntryMirror.test.ts`), 2 updated
(`revolutXBrokerAdapter.test.ts`'s failure-path tests now assert the
diagnostic audit entry). Full gate green (tsc, 970 tests, build).

## Design-system consistency pass across all views (2026-09-03)
UI-only, token-driven (`src/ui/styles.css`'s existing Revolut-X-informed
`--hot`/`--cold`/`--r-*`/`--shadow-*` tokens and `.hero`/`.row`/`.stack-card`/
`.pill`/`.empty`/`.block-head`/`.view-title` classes — no new palette). The
Home/Markets/Crypto/Stocks hub views were already fully on this system; this
pass brought the remaining Tools views in line: `portfolioView.ts` (Equity
promoted to a `.hero` big-number card with all-time change; Positions and
Trade journal rewritten as `.stack stack-card` rows with coin logos and
colored `.chg up/down` deltas, replacing plain `<table>`s), `monitoringView.ts`
(section headers moved to `.block`/`.block-head`, every bare-text empty state
swapped for a `.empty` card), and header/subtitle classes standardized to
`.view-title`/`.view-sub` in `gridView.ts`, `marketScanView.ts`,
`validationView.ts`, `backtestView.ts`, and the Learn panel in `index.html`.
Added `box-shadow: var(--shadow-sm)` to the shared `.data-table` class so
every dense analytical grid (scan results, walk-forward folds, watchlist,
opportunity/alert history) picks up the same card elevation without a
per-view change. Analytical multi-column tables (market scan, walk-forward
folds, monitoring's watchlist/opportunity/alert history) were deliberately
kept as `<table>` rather than forced into a two-value row pattern — converting
7-9 column data into left/right rows would lose information, and
`monitoringView.integration.test.ts` asserts on `tbody tr` structure there.
Full gate (tsc/vitest 963 passed/build) green.

## Adversarial review of the live-money wiring (PRs #107-#110) — 3 real bugs fixed (2026-09-03)
Real funds are now live (100.15€), so a full adversarial review (not a
formality) was run against `liveEntryMirror.mts`/`liveExitMirror.mts`/
`liveOrchestrator.mts`/`liveLedger.mts`/`autopilotRunner.mts`'s `runLiveMirror`
and the manual override commands. Three confirmed, fixed:

1. **Stale equity/open-positions across multiple entries in one cycle**
   (`liveEntryMirror.mts`) — `mirrorApprovedEntries` snapshotted `equity`/
   `openPositions` ONCE before its retry loop, then reused that snapshot for
   every pending symbol. The paper autopilot can approve more than one entry
   in a single scan, so a fill from an earlier symbol in the same loop
   (debited cash, a new tracked position) was invisible to a later symbol's
   risk sizing — two entries could jointly blow past
   `maxOpenPositions`/`maxTotalExposurePct`/per-asset caps that each looked
   fine in isolation, and `debitLiveCash` has no floor check. Fixed: both are
   now re-read fresh at the top of every loop iteration.
2. **The `revalidate` post-approval re-check was never wired up** —
   `runLiveOrderFlow` grew an optional `revalidate` hook earlier tonight
   specifically for "after I approve, check again it's still good", but
   `runLiveMirror`'s `flowParams` never set it — the feature did nothing on
   the real trading path. Fixed with the one check available without
   plumbing a fresh price fetch through several signatures: re-checks
   `killSwitch.isEngaged()` right before submission, so a `/pause` that lands
   while a confirmation is already pending is honored even if a stale
   approval tap comes in afterward. (Re-validating the PRICE itself would
   need `source`/candle plumbing through `liveEntryMirror`/`liveExitMirror`/
   both manual commands — left as a follow-up, not attempted here.)
3. **The live daily-loss circuit breaker was never wired at all** —
   PROJECT_STATE already flagged (2026-09-02) that `DailyLossTracker` needed
   a live-scoped instance; `runLiveMirror` never actually created one, so
   `dailyLossSoFar` was always 0 and the `dailyLossLimitPct` check inside
   `assessTrade` could never engage for real money regardless of how much
   was actually lost in a day. Fixed: a `DailyLossTracker` over
   `PrefixedStore(store, 'live')` now feeds `dailyLossSoFar` into every live
   entry attempt (mirrored and manual `/buy`) and records realized P&L on
   every genuinely filled live exit (automatic and manual `/sell`).

**Flagged but NOT auto-fixed** (real, smaller-impact, needs a design call):
live entries size at the flat `maxRiskPerTradePct` ceiling regardless of the
opportunity's confidence, while the paper account scales risk 0.5%-1% by
confidence for the same signal — a real mismatch with this module's own
"same risk sizing" claim, though the euro impact on a 100€ account is small.
Also: a partially-filled live SELL (`state: 'submitted'`, `filledQuantity >
0`) neither credits the partial proceeds nor reduces the tracked quantity
(only a genuine `'filled'` does) — asymmetric with how a partial BUY is
already handled, and a real (if narrow) gap until the broker-level
reconciliation loop noted below exists.

Tests: 2 new regression tests (the multi-entry sizing race,
`liveEntryMirror.test.ts`; the daily-loss block, `autopilotRunner.test.ts`).
Full gate green (tsc, 963 tests, build).

## Vercel deploys re-enabled, skipping only the noisy state commits (2026-09-03)
`vercel.json` had `deploymentEnabled: false` since 2026-08-19 — David disabled
it deliberately because every ~15-minute "Autopilot state (mid-run cycle
N/70)" commit to `main` triggered its own Vercel deployment, exhausting the
100/day account-wide quota shared by every project on the account (this one
starved his separate Bet-El siddur app of deploys for two days). Re-enabled
now with a targeted fix instead of a blanket one: `ignoreCommand` checks the
latest commit's message and skips the build ONLY for `Autopilot state`/
`Stocks autopilot state` commits (exit 0 = Vercel's own "skip this build"
signal), so a real code change (a PR merge) still deploys normally while the
bot's own state-persistence commits — the actual source of the quota
exhaustion — never trigger a build at all. GitHub Pages
(davidpit1565.github.io/automatic-trading-ai) remains the primary,
continuously-updated deployment either way; Vercel is now a working SECOND
mirror, not the noisy one it was before 2026-08-19.
## Real money is now LIVE (2026-09-03)
David generated real Revolut X trading credentials, funded the account
(100.15€), and set `REAL_MONEY_ENABLED=true` as a repo Variable. The
platform is no longer simulated-only — `runLiveMirror` now actually runs
its full chain every cycle.

**`server/manualBuyCommand.mts` (new)** — David asked to prove the pipeline
end-to-end without waiting on the algorithm's own (genuinely selective)
signal, which can go days without opening anything. `/buy <SYMBOL>` triggers
ONE real entry attempt right now: fixed 2:1 reward:risk levels (-1.5%/+3%
around the current price, since there's no scanner opportunity to size
against for a manual request), but otherwise reuses `liveEntryMirror.mts`'s
`mirrorApprovedEntries` AS-IS — same risk sizing against live equity, same
symbol verification, same Telegram confirmation. Symmetric to
`/sell`'s relationship to `decideLiveExit`: only what TRIGGERS the attempt
changes, never the safety chain around it. Wired into `runLiveMirror`
alongside the other manual overrides.

## Completed Modules
- Core pipeline: data (Kraken/Coinbase public, synthetic) → indicators →
  scanner → signal engine → risk engine → position/portfolio → paper autopilot.
- Cloud autopilot: `server/autopilotRunner.mts` on GitHub Actions
  (`.github/workflows/autopilot.yml`); state in `state/autopilot-state.json`,
  committed each run + mid-run (~30 min) with resilient rebase+retry push.
  Long runs (LOOP_CYCLES 70) so it runs continuously without an external clock.
- Telegram (Hebrew): per-trade buy/sell (deduped by position id), 08:00/22:00
  digests + weekly/monthly reports — all gated by elapsed-time-since-last-send
  (never an exact calendar/hour match), so a coverage gap only DELAYS a
  message, never silently loses it. Move/risk/drawdown-halt/all-clear alerts,
  real-money readiness line. Secrets only in Actions.
- App (English, phone-first): Home (hero, readiness card, markets, positions,
  activity), interactive Markets detail chart (candles default + line toggle,
  crosshair/OHLC tooltip, live marker, 1D→All), interactive Portfolio value
  history, History. Live at davidpit1565.github.io/automatic-trading-ai.
- Validation harness: `src/core/backtest/livePipeline.ts` replays the REAL
  decision pipeline on history; `scripts/sweepStrategy.mts` +
  `validateStrategy.mts` = the measurement scoreboard.

## Real-money go-live: building the actual entry wiring (2026-09-02, in progress)
With the safety layer independently reviewed twice and everything fixable
fixed, David asked to start building the actual connection. First pieces,
all tested, full gate green:

- **Post-approval re-validation** (`runLiveOrderFlow`, `liveOrchestrator.mts`)
  — the check David asked for earlier tonight ("after I approve, check
  again it's still good") finally built: an optional `revalidate` hook
  runs AFTER a human approves, BEFORE the broker ever sees the order. It
  can only ADD a refusal (`'stale-after-approval'`) — it never runs unless
  `decision.approved` is already true, so it can't remove the human gate,
  only strengthen it.
- **`server/liveLedger.mts`** (new) — a minimal local cash ledger for the
  REAL account. There is no `PortfolioEngine` for live money (that class
  simulates fills; a live fill is real, from the broker) — this is the
  smallest equivalent: `initLiveCash` (idempotent — never resets an
  already-moving balance), `debitLiveCash`/`creditLiveCash` on real fills,
  `liveEquity` = cash + mark-to-market of tracked open live positions. Not
  a full `PortfolioEngine` port (no daily-return anchor, no journal) — the
  live account only needs "how much can I safely risk right now."
- **`server/liveEntryMirror.mts`** (new) — mirrors a paper-approved crypto
  entry into a real order, SIZED INDEPENDENTLY against the live account's
  own equity (never the paper account's $10,000): re-runs `assessTrade` on
  the same underlying `TradeOpportunity` (entry/stop/target/confidence
  don't depend on account size) against live equity/positions. Reuses the
  exact queue-with-stable-id-until-terminal pattern already proven correct
  in `manualSellCommand.mts`'s fix (a paper-approved entry is a one-time
  event per symbol, same "lost forever if not resumed" risk). Also guards
  against the SAME double-submission risk found there: a resting
  (submitted, not-yet-filled) entry marks its symbol "outstanding" and
  refuses a second attempt until `clearOutstandingEntry` is called once
  that symbol's position is later confirmed closed — a resting order that
  never resolves stays outstanding forever (no reconciliation poller
  exists yet), which is the safe direction to fail in, not a bug.
- **`DailyLossTracker` reuse note for whoever finishes the wiring**: it
  keys its storage under a fixed `'daily-loss'` key already used by the
  crypto PAPER autopilot on the same store — instantiate it against a
  `PrefixedStore(store, 'live')` (already exists, `src/core/data/
  prefixedStore.ts`, used by the shadow evaluator for the same reason) for
  live money, never the raw store directly, or paper and live losses would
  conflate into one circuit breaker.

**Still to build**: the automatic EXIT-side mirror (checking `decideLiveExit`
against tracked live positions each cycle, not just the manual `/sell`
override), the actual `autopilotRunner.mts` integration point, the
`REAL_MONEY_ENABLED` opt-in flag, and — separately, on David's side —
generating fresh Revolut X API credentials. Continuing next.

## Real-money go-live: entry-mirror bug fix + the full wiring (2026-09-02)
Self-review of the entry mirror just written above caught a real bug in it
before it ever shipped: `mirrorApprovedEntries`'s `'submitted'` branch marked
the symbol outstanding but never called `recordLiveEntryFill`/
`debitLiveCash` — a real, successfully filled BUY would never actually be
tracked as an open position. No stop-loss/take-profit enforcement, invisible
to the new exit mirror, invisible to `liveEquity`. The exact same
"invisible real exposure" class already fixed once tonight at the
broker-adapter level (partial fills), reintroduced here at the caller level.
Fixed the same way; a new test asserts `openLivePositions`/`liveCash`
actually update after a submitted+filled outcome (the previous 8 tests did
not check this — exactly how it went unnoticed).

Then built the rest, all tested, full gate green:
- **`server/liveExitMirror.mts`** (new) — the automatic counterpart to
  `manualSellCommand.mts`: each cycle, checks every tracked live position
  against the SAME `decideLiveExit` paper trading uses, and proposes a real
  exit through the same `runLiveOrderFlow` chain when it fires. No separate
  pending-queue needed (unlike the entry mirror) — the tracked position
  itself is the persistent retry trigger, so a `'pending'` confirmation just
  gets retried next cycle against the same stable id
  (`${position.id}:auto-exit`, distinct from manual-sell's `:manual-sell`
  suffix). Shares the same `outstandingExitSubmittedAt` guard, so an
  automatic exit and a manual `/sell` can never race into two real sell
  orders for one position.
- **The actual `autopilotRunner.mts` integration** (`runLiveMirror`, called
  once per cycle) — wires everything built tonight together: the manual
  `/pause`/`/resume` kill switch and `/sell` override are checked FIRST (a
  human's own command always takes effect before this cycle's automatic
  mirroring), then this cycle's newly paper-approved entries are mirrored,
  then every tracked live position is checked for an automatic exit. A
  failure anywhere in this function is caught and logged, never allowed to
  take down the paper cycle that already completed. `CycleResult['opened']`
  gained an optional `opportunity` field (the underlying `TradeOpportunity`,
  populated where paper decides an entry) so the runner can hand this
  cycle's approved entries to the live mirror without re-deciding anything.
- **`REAL_MONEY_ENABLED` opt-in flag** — off by construction. `runLiveMirror`
  no-ops unless `REAL_MONEY_ENABLED=true` (repo Variable) AND real Revolut X
  credentials (`REVOLUT_X_API_KEY`/`REVOLUT_X_PRIVATE_KEY_PEM`, repo
  secrets) are BOTH configured, AND Telegram is configured (every live order
  still needs a human tap). Missing any of these is silent, never an error —
  this repo stays exactly the simulated-money-only system it has always
  been until a human deliberately turns it on. `.github/workflows/
  autopilot.yml` now passes these through (secrets stay secrets, per this
  project's rule — only in GitHub Actions, never elsewhere).
- **Live-scoped `DailyLossTracker`, kill switch, audit log, and Telegram
  poller state** — all built against `new PrefixedStore(store, 'live')`, not
  the raw store, so nothing about real money conflates with the paper
  autopilot's own state on the same underlying file. This is deliberately
  the ONLY code in the project that ever polls Telegram, so namespacing its
  offset/pending-confirmation state under `'live:'` too costs nothing (no
  other consumer to keep in sync with) and keeps every trace of real-money
  state in one place.
- **`LIVE_STARTING_CASH_EUR`** (repo Variable, defaults to 100 in code) —
  David's confirmed starting real capital: 100€.

**Still needed before this can actually go live**: David's own action —
generate fresh Revolut X API credentials (Ed25519 keypair) and add
`REVOLUT_X_API_KEY`/`REVOLUT_X_PRIVATE_KEY_PEM` as GitHub Actions secrets,
then deliberately set the `REAL_MONEY_ENABLED` repo Variable to `true`. Until
then this is tested, reusable machinery that the scheduled workflow calls
every cycle but that stays a complete no-op.

## Real-money go-live: independent re-review + fixed everything fixable (2026-09-02)
David asked for the shared-Telegram-cursor fix and partial-fill tracking to
be "fully fixed, not partial", and to keep checking until 100% confident a
real wallet can be connected. Ran an independent adversarial review of
tonight's own shared-poller redesign (not just the original bug) — it found
3 more real issues, all fixed now, plus confirmed one genuine, honest limit:

**Fixed:**
1. **`manualKillSwitchCommand.mts` stashed only once, at the very end**, after
   the loop that calls `killSwitch.engage/disengage` and `audit.append` — an
   exception partway through would lose every update fetched that cycle
   (the exact same "lost update" bug shape, just relocated). Fixed: separate
   recognised commands from everything else FIRST, stash the everything-else
   immediately, then act on the commands — matching the ordering
   `manualSellCommand.mts` already used correctly.
2. **`callback_query` updates were never filtered by chat id** — only text
   messages were. A real-money confirmation button tap from any chat would
   have been honored. Fixed: `pollAllTelegramUpdates` now checks
   `callback_query.message.chat.id` too.
3. **A resting (not-yet-filled) manual sell could be double-submitted**: once
   an exit reached `runLiveOrderFlow`'s `'submitted'` outcome, the stable
   intent id's confirmation record was already resolved, so a SECOND `/sell`
   for the same symbol would be treated as brand-new and could place a real
   second sell order while the first was still open on the exchange. Fixed:
   `LiveOpenPosition.outstandingExitSubmittedAt` (set by the new
   `markExitSubmitted`, `liveExitFlow.mts`) now blocks a second exit attempt
   for the same position until it's actually resolved (filled → forgotten,
   or otherwise reconciled) — `manualSellCommand.mts` checks this before
   ever building a new exit intent, reporting `'exit-already-submitted'`
   instead of submitting again.

**Also added**: `revolutXBrokerAdapter.mts`'s submit() now auto-engages the
kill switch on a network failure during order placement — checked directly
against Revolut X's own API docs and confirmed there is NO way to look up
an order by `client_order_id` (only by a `venue_order_id` a successful
response provides, which this failure path by definition never receives).
Automated certainty about what happened is genuinely unavailable from
documented capabilities, so instead of guessing either way, this halts all
further live trading until a human manually verifies in the Revolut X app
and explicitly `/resume`s.

**Honest remaining limit, not a code gap**: a full broker-side order-status
RECONCILIATION LOOP (periodically re-checking a resting or partially-filled
order's eventual final state) still doesn't exist — it needs a scheduled
caller, which doesn't exist yet either (nothing runs this live-execution
code on a cron; that's the deliberate next decision, "the actual wiring").
Everything that COULD be fixed without that scheduler now is: the
capability to safely refuse a duplicate submission, the capability to
recognize a partial fill, and a hard stop (kill switch) for the one failure
mode with no automated answer at all. Tests: 920 passing, full gate green.

## Real-money go-live: closed both remaining findings (2026-09-02)
David asked to fix the 2 open findings from the prior deep review, and to
keep checking for more while at it. Both closed now:

**#3 fixed — shared Telegram update cursor.** The real fix, not a patch:
added `pollAllTelegramUpdates`/`stashUnclaimedTelegramUpdates` (`telegram.mts`)
as the ONE place allowed to call Telegram's real `getUpdates` with an
advancing offset. Migrated all three consumers (`TelegramConfirmationGate`,
`manualSellCommand.mts`, `manualKillSwitchCommand.mts`) to it — each now
polls both `message` and `callback_query` types, acts on what it recognises,
and stashes everything else back so a DIFFERENT consumer can still find it.
Deleted the old per-consumer `getTelegramUpdates`/`getTelegramMessages`
entirely (not deprecated — removed) so the same mistake can't quietly
resurface later. New regression tests prove the actual scenario: a
confirmation-gate approval survives a different consumer polling first
(`telegramConfirmationGate.test.ts`), and a `/pause` survives
`checkManualSellRequests` polling first and not recognising it
(`manualKillSwitchCommand.test.ts`).

**#4 partially fixed, partially still open by design.**
- `liveExitFlow.mts`'s `recordLiveEntryFill` now also tracks a PARTIALLY
  filled buy (`state: 'submitted'` with `filledQuantity > 0`, which is how
  `RevolutXBrokerAdapter` maps Revolut X's `partially_filled`) — tracking
  whatever quantity genuinely filled is strictly safer than tracking
  nothing, even though the untracked remainder still has no poller
  watching it if it fills more later.
- `revolutXBrokerAdapter.mts`'s network-failure-during-submit path now says
  explicitly that the order MAY have reached Revolut X despite the lost
  response, instead of a flat "rejected" that implied false certainty.
- **Still genuinely open, by design, not attempted tonight**: a real
  order-status reconciliation mechanism (periodic `fetchPositions()`
  cross-check against locally tracked state, or a poller that catches up a
  resting/partially-filled order to its eventual final state) does not
  exist anywhere in this codebase. Building it in isolation, with no
  orchestrator yet to run it periodically, risks building into a vacuum —
  this belongs with the actual live-wiring work, not before it.

Tests: 918 passing. Full gate green.

## Real-money go-live: deep review — 2 fixed, 2 real gaps still open (2026-09-02)
David asked for an even deeper check specifically on "are we really ready
for this" (real money). Ran the `code-review` skill at max effort against
the full Stage 6 live-execution path. Five findings; two fixed now, two
left genuinely OPEN (must be resolved before wiring goes live), one
(the Telegram offset issue) is the most architecturally significant.

**FIXED:**
1. **`telegramConfirmationGate.mts`**: a failed Telegram send (rate limit,
   transient 5xx) still persisted the "pending" record, so the `if
   (!pending)` send path was never re-entered — the human would NEVER
   actually be notified, yet the audit log claimed "will retry next run"
   and the order would silently auto-expire as rejected 20 minutes later
   with no real message ever delivered. Fixed: only persist `pending` once
   `sendTelegramMessage` actually reports `sent: true`; a failed send now
   genuinely retries the send itself on the next call.
2. **`manualSellCommand.mts`**: never called `forgetLivePosition` after a
   filled sell, so a symbol stayed tracked as "open" even after being sold
   — a second `/sell` for the same symbol would find it again and could
   submit a real duplicate sell order. Fixed: `forgetLivePosition` is now
   called once `result.report.state === 'filled'` (not merely
   `'submitted'` — a resting, not-yet-filled order must stay tracked).
   Also fixed a related robustness gap the reviewer found: the pending-
   symbols queue was only persisted once at the very end of the whole
   batch, so an exception partway through processing multiple queued
   symbols could roll back an already-resolved symbol's outcome back into
   the queue — now persisted immediately after each symbol is resolved.

**STILL OPEN — must be resolved before this goes live:**
3. **Shared Telegram `getUpdates` offset collision (architectural).**
   `telegramConfirmationGate.mts` (one offset PER pending intent),
   `manualSellCommand.mts`, and `manualKillSwitchCommand.mts` each
   maintain their OWN persisted "last seen update_id" cursor and poll
   independently — but Telegram's `getUpdates(offset)` is a single GLOBAL
   cursor per bot token: calling it with a higher offset from ANY one of
   these permanently discards every not-yet-read update below that point
   for ALL the others too, regardless of `allowed_updates` filtering.
   Concretely: if the confirmation gate's poll advances past a `/pause` or
   `/sell` message the manual-command pollers haven't read yet, that
   message is gone forever — silently, with no error. This wasn't
   introduced tonight (the confirmation gate's per-intent-offset design is
   older), but adding more independent pollers made it a live risk. Needs
   a real fix before the actual live-wiring PR: one shared cursor, one
   `getUpdates` call per cycle covering both `message` and
   `callback_query` types, dispatched to whichever consumer cares — not a
   quick patch, a genuine (if contained) redesign of the polling layer.
4. **`revolutXBrokerAdapter.mts` has no order-status reconciliation.**
   (a) A network failure during `submit()` (timeout, dropped connection)
   is unconditionally reported as `rejected` with no check for whether
   Revolut X actually accepted the order before the response was lost —
   a real fill could exist at the broker with zero local tracking (no
   stop-loss/target, invisible to `decideLiveExit` and the kill switch's
   per-position awareness) while our own records say it never happened.
   (b) A partially-filled order maps to `state: 'submitted'`, which
   `recordLiveEntryFill` correctly does NOT track (by design — only a
   genuine `'filled'` is tracked) — but nothing ever polls the order again
   afterward to catch it up once it eventually fills, so a partial live
   fill can go completely untracked indefinitely. Both need an actual
   reconciliation mechanism (periodic `fetchPositions()` cross-check
   against locally tracked state) that doesn't exist anywhere yet — a
   real, separate piece of work, not a quick fix, and squarely a capital-
   protection gap per this project's own priority order.

Tests: 915 passing (11 + 10 in the two touched test files). Full gate
green. Findings 3 and 4 are reported here as genuinely unresolved — real
money should not move through this path until they are.

## Real-money go-live: manual /sell could silently lose a request (2026-09-02)
David asked for a broad audit ("look for anything to improve, in any area")
of the whole project. The most severe finding was a real bug in the manual
`/sell` feature shipped earlier tonight: `checkManualSellRequests`
(`server/manualSellCommand.mts`) built the exit intent's id as
`` `${position.id}:manual-sell:${now}` `` — wall-clock-suffixed — and
consumed the Telegram message's offset (marking `/sell` as "read") BEFORE
the order actually resolved. `TelegramConfirmationGate` can only resume
polling a not-yet-answered confirmation by being called again with the
EXACT SAME intent id (documented in its own header). Since the id changed
every cycle and the triggering message was already gone, a `/sell` that
wasn't approved within the ~15s a single cycle actively polls would vanish
permanently — even tapping the still-visible Telegram button later did
nothing, because nothing was polling for it anymore. This directly
undermined the feature's whole point ("sell whenever you want").

Fixed: the intent id is now stable (`${position.id}:manual-sell`, no
timestamp), and a new persisted `manual-sell-pending-symbols` set keeps a
request queued across cycles until it reaches a TERMINAL outcome
(submitted/rejected/blocked/unknown-symbol/no-matching-position) —
`'pending'` (nobody answered yet) and `'no-price-data'` (a transient fetch
failure) both keep it queued instead of dropping it. Combined with the
20-minute confirmation expiry (above), a queued request now always resolves
eventually: either a real human decision, or an honest auto-expiry, never a
silent disappearance. New test exercises the actual bug end-to-end with the
real `TelegramConfirmationGate` (not a fake) across two simulated cycles —
proven to fail against the old code (asserts `/sendMessage` is never called
on the resumed cycle; the old, unstable id would have forced a re-send).

Also worth flagging for whoever builds the (not yet started) AUTOMATIC exit
wiring: `buildLiveExitIntent`'s caller must always pass a STABLE `exitId`
for the same reason — the function itself doesn't generate the id, so this
specific bug can't recur inside it, but a future caller could reintroduce
the same mistake by constructing one from wall-clock time again.

## Real-money go-live: expiry deadline shown + manual kill-switch (2026-09-02)
Two more follow-ups from David after the confirmation-expiry/manual-sell PR:
(1) show how much time is actually left to respond, in the message itself —
`telegramConfirmationGate.mts` now prints a fixed HH:MM deadline (Asia/
Jerusalem) plus the window length, computed once when the message is first
sent. A live countdown would be dishonest here: the bot only polls every
~30 minutes, so a "countdown" would jump in ~30-minute steps, not tick by
the second. (2) protection gap found while answering "what else needs
protecting": the kill switch could only ever engage automatically — David
had no way to halt everything himself. New `server/manualKillSwitchCommand.mts`:
`/pause`/`/resume` Telegram commands, same pattern as the manual-sell
override (own `getTelegramMessages` offset), audited either way, a no-op
(not an error) if already in the requested state. Both tested (10 + 9 new
tests), neither wired into any scheduled workflow yet.

## Real-money go-live: confirmation expiry + manual sell override (2026-09-02)
David gave the go-ahead to start wiring real-money execution: manual
approval on every trade (entries AND exits), starting capital 100€ (checked
Revolut X's public API docs — `min_order_size_quote` is $0.01, so 100€ is
nowhere near any exchange minimum; the earlier worry was unfounded). Two
follow-up questions before the actual entry/exit wiring: how long does he
have to approve, and can he sell whenever he wants (not just when the
algorithm proposes an exit)? Neither was true yet as built — fixed both:

- **Confirmation expiry** (`telegramConfirmationGate.mts`): a resumed
  confirmation now auto-expires (`approved: false`, audited) after 20
  minutes with no reply, instead of resuming to poll forever. The order is
  a LIMIT order at the price current when the message was sent — a much
  later tap would submit at a stale price with no relation to the market by
  then. Nothing auto-*approves*; this only ever produces a rejection.
- **Manual sell override** (`server/manualSellCommand.mts`, new file): a
  `/sell <SYMBOL>` Telegram command now works alongside the algorithm's own
  exit logic, not instead of it — a new `getTelegramMessages` (`telegram.mts`,
  separate offset from the button-tap polling, filtered to the configured
  chat id only) detects the command; `checkManualSellRequests` builds an
  exit intent at the current price for the matching tracked live position
  and runs it through the EXACT SAME `runLiveOrderFlow` chain as an
  automatic exit (kill-switch, symbol check, confirmation tap) — this only
  changes what TRIGGERS the exit, nothing bypasses the safety chain.

Both are tested (9 + 8 new tests) but, like the rest of Stage 6's execution
machinery, NOT called from any scheduled workflow yet — still building
toward the actual entry/exit wiring (translating live signals into real
orders sized for the 100€ account), which is the next piece.

## Real-money readiness: stocks trade-count/consistency no longer gate either (2026-09-02)
Follow-up, found while checking live state right after the stocks pivot
shipped: `assessRealMoneyReadiness`'s `trades`/`consistency` criteria read
`closedTrades`/`profitFactor` from the trade journal — both permanently
frozen at whatever they were the moment the account stopped closing
positions (11/20 trades, PF 1.17), since a passive buy-and-hold account
never has another closed trade to record. Same shape of bug as the BTC
benchmark case just above: a criterion designed for round-trip trading,
now structurally unmeetable for a strategy with no exits.

Added `gateOnTradeStats?: boolean` (default `true`) alongside
`gateOnBenchmark`, same mechanism: both criteria still computed and shown
(marked "informational") but excluded from `unmet`/`ready` when `false`.
`server/stocksRunner.mts`'s `recordEquity` now passes `gateOnTradeStats:
false`, and — since realized P&L is equally meaningless here (nothing is
ever realized) — swapped `realizedReturnPct` from the frozen
journal-derived `analytics.totalPnl` to the live mark-to-market
`portfolio.snapshot(...).equity` return, so "profitable" actually reflects
how the held basket is doing right now instead of a frozen pre-pivot
number.

Checked the live state after this: crypto's stored readiness (from before
this session's benchmark-gating fix took effect) already clears every
OTHER criterion (48/20 trades, 20/14 days, +4.18% after fees, 3.8%
drawdown, PF 1.42) — only the now-non-gating benchmark criterion was
unmet. The next scheduled autopilot cycle should be the first time crypto
reports READY.

## Real-money readiness: the "beat benchmark" bar no longer gates crypto (2026-09-02)
Follow-up to the structural BTC-gap finding below: `assessRealMoneyReadiness`
required `vsBenchmarkPct >= 0` to reach READY, with no way to distinguish
"not measured yet" from "structurally can't happen." For a strategy that
carries a stop-loss (crypto), that criterion was permanently unpassable
regardless of trading quality — likely the actual reason readiness has
stayed NOT READY for months even as other criteria improved.

Added `gateOnBenchmark?: boolean` (default `true`, so existing behavior is
unchanged unless a caller opts out) to `RealMoneyReadinessInput`. When
`false`, the benchmark comparison is still computed and shown (with an
"informational" note) but can no longer block `ready`/appear in `unmet`.
`server/autopilotRunner.mts` (crypto) now passes `gateOnBenchmark: false`,
citing the structural proof below. `server/stocksRunner.mts` keeps the
default (`true`): now that the real stocks account is passive buy-and-hold
(no stop-loss), its basket-vs-SPY comparison is a fair, achievable one, not
a structurally-blocked one — so it should keep gating there.

## Stocks: real account pivoted to passive buy-and-hold (2026-09-02)
Following the crypto structural argument below, David asked to fix the same
underlying problem for stocks: `sweepAutopilot.mts`/`measureStocks.mts` have
never found a signal-driven config that gets within an order of magnitude of
simply holding the curated basket (see "Stocks measured" 2026-07-29 and every
regime/trend-exit measurement since) — an ~8x gap, not a tuning problem.

Decided: stop researching a strategy that structurally can't win and make
the real stocks account BE the benchmark instead of chasing it. `runPassive
HoldCycle` (`server/stocksRunner.mts`) replaces `autopilot.runCycleOnce()`
for the real account: equal-weights whatever cash is on hand across the
curated symbols not yet held, buys once per symbol, never sells. No signal
evaluation, no stop-loss/take-profit (required by `OpenInput` but set to
inert sentinels — nothing here ever exits a position), no risk-per-trade
sizing. `main()` no longer constructs a `PaperAutoPilot` for the real
account at all. The isolated, zero-real-risk long-term shadow wallet
(`runStocksShadow`, daily bars + trend-exit) is untouched — still forward-
testing in case a genuinely different edge shows up later; nothing promotes
it to the real account automatically.

Equal-weight split is computed over ALL symbols still unheld (from the full
curated list), not just the ones with a price this cycle — a symbol missing
a price on one cycle (transient fetch gap) keeps its full share of cash
reserved for a later cycle instead of it being silently redirected to its
neighbors. Naturally idempotent: a symbol already held is skipped forever,
so a retried/overlapping cycle only tops up symbols still at zero position.
Verified the live account was flat (no open positions, $10,040.68 cash)
before this shipped — nothing to reconcile. Full gate green (tsc, 881
tests, build); new tests cover equal-weight buying, never-sell, kill-switch
respect, and the partial-fill catch-up case.

## Crypto: the BTC gap is structural, not a research gap — accepted (2026-09-02)
David asked which of two paths to take: (1) keep researching until some
config beats BTC buy-and-hold, or (2) accept the gap as a conscious
trade-off. Agreed to try (1) first and only fall back to (2) if truly stuck.

The answer turned out to be provable, not just "not found yet": **any
strategy that carries a stop-loss/exit cannot beat 100% buy-and-hold of the
same asset during a monotonic uptrend.** A stop-loss means some capital is,
by construction, not in the trade at every moment the asset is rising past
where the last stop was set (else it isn't a stop-loss at all) — a
risk-managed strategy's return over a pure uptrend is a probability-weighted
mix of "fully in" and "stopped out, sitting in cash while price keeps
climbing," which is mathematically bounded above by the buy-and-hold return
itself, not able to exceed it. The only ways to beat buy-and-hold in an
uptrend are leverage or 100%-concentrated no-stop holding — both directly
contradict this project's non-negotiable capital-protection rule (CLAUDE.md).
So path (1) was never a research gap to close with more data or a better
signal; it's a structural property of having risk management at all.

David accepted this and confirmed moving to (2): the BTC-gap is a conscious,
accepted trade-off of trading with capital protection, not a bug to keep
chasing. No code change follows from this by itself — the readiness gate
already reports `vsBenchmarkPct` honestly; what changes is that "beat BTC"
is no longer treated as a blocking bar for crypto real-money readiness. (The
`assessRealMoneyReadiness` criteria themselves have not been touched yet —
next actionable step if this needs to be reflected in the actual go/no-go
logic rather than just decided in principle.)

## Crypto: 2 real years of Kraken daily data unlocked, but doesn't resolve the BTC gap yet (2026-09-02)
David asked to look for the best way to close the crypto BTC-buy-and-hold
gap. Found (and verified directly against the live API) that Kraken's
public OHLC endpoint caps at ~720 bars PER CALL regardless of interval —
nothing about that cap is specific to the 1h/4h timeframes every crypto
measurement has used so far. Requesting `interval=1440` (daily) instead
returns **721 real daily bars — ~2 years of genuine BTC history**, for
free, no auth, right now. This is exactly the kind of long-horizon sample
Alpaca gives stocks; crypto measurement never had it because nobody had
requested that interval as an ENTRY timeframe before (`loadDaily()` in
`sweepAutopilot.mts` already used daily bars, but only for the regime
filter, at a 400-bar limit, never as the entries themselves).

Added a third entry-timeframe permutation to `scripts/sweepAutopilot.mts`
(`['1d', '1w', ...]`, alongside the existing 1h/4h pair) — reused the
entire existing sweep harness unchanged (it already generalizes over any
entry/confirm timeframe pair). Ran it for real against live Kraken data.

**Real result: inconclusive again, for a NEW reason.** Over 570 usable
daily bars (~1.9 years), almost every one of the 30 configs — including
every trend-exit variant — took only **1-2 trades total**. The existing
signal engine's entry criteria (RSI period, momentum thresholds, EMA
periods) are implicitly tuned for HOURLY noise; on smoothed daily bars the
same thresholds essentially never fire. This is the same "sample too thin
to trust" problem as the original 30-day measurement, but caused by
signal/timeframe mismatch rather than by data scarcity — the daily data
itself is real and plentiful now, but naively replaying the hourly-tuned
signal on it doesn't produce a usable trade count.

**Also surfaced, independent of the above**: over this real ~2-year window,
**BTC buy-and-hold itself returned -29.34%** — a real decline, not the
"strong bull run" framing the shorter recent window (used for the ~20%-gap
finding) suggested. The 2-year picture and the 30-day picture disagree on
what regime BTC has even been in. This matters for how the "beat BTC"
readiness criterion should be interpreted, but can't be acted on without a
signal that actually trades enough on this timeframe to measure honestly.

**Conclusion: the BTC gap is not closed tonight.** What IS real and
reusable: free access to ~2 years of genuine Kraken daily history for any
future crypto research, and a working sweep harness permutation to use it.
What's still needed before that data can answer anything about trend-exit
or the BTC-gap specifically: a signal properly recalibrated for daily-bar
behavior (different indicator periods, not the same hourly-tuned ones) —
a real research task, not something to guess at tonight. Nothing changed
in production; nothing promoted.

## Stocks: fixed a stale "LIVE defaults" label in measureStocks.mts (2026-09-02)
Found while investigating the crypto trend-exit precedent: `stocksRunner.
mts` has run `INTERIM_MIN_CONFIDENCE=40` AND `trendExit: {emaPeriod: 50}`
since 2026-08-31, but `measureStocks.mts`'s `'LIVE stocks (defaults)'`
candidate still used `minConfidence: 20` with no `trendExit` — stale since
that date. Every conclusion actually drawn (tonight's regime-filter
measurement, 2026-07-29's trend-exit result) already compared correctly
against a real `trend-exit EMA50` row, so nothing already reported was
wrong — but the labeled "LIVE" baseline itself was stale and would have
misled a future comparison. Renamed/fixed: `'LIVE stocks (current prod)'`
now carries both real settings; the old row kept as `'conf 20 (old
default, no trendExit)'` for historical continuity rather than deleted.

## Regime filter measured on real Alpaca data: does not help, not adopted (2026-09-02)
Ran the 3 new regime candidates (below) for real via `measure-stocks.yml` on
branch `claude/market-scan-integration-r9lck1` — 10 traded majors, 1251 1d
bars, 3 folds, live cost (0.10%/side):

| Candidate | f1 PF | f2 PF | f3 PF | folds | all PF | ret% | basket | trades |
|---|---|---|---|---|---|---|---|---|
| LIVE stocks (defaults) | 1.22 | 1.98 | 1.43 | 3/3 | 1.77 | 7.36 | 170.38 | 203 |
| regime EMA100 | 1.22 | 1.99 | 1.42 | 3/3 | 1.77 | 7.36 | 170.38 | 203 |
| regime EMA200 | 1.09 | 1.98 | 1.42 | **2/3** | 1.73 | 6.92 | 170.38 | 201 |
| regime EMA100 + trend-exit EMA50 | 1.89 | 3.42 | 1.91 | 3/3 | 2.68 | 8.49 | 170.38 | 110 |

**regime EMA100 is statistically identical to LIVE defaults** (same trade
count, same return to 2 decimals) — the daily-EMA(100) gate essentially
never engages for these 10 mega-caps over this window, because the basket
itself returned +170% (a dominant, sustained bull run): they are almost
always above their own 100-day EMA anyway. **regime EMA200 is slightly
worse** and drops a fold below the PF>1.2 bar (2/3, was 3/3). **Combined
with trend-exit EMA50, the regime gate makes that candidate marginally
WORSE** than trend-exit EMA50 alone (8.49% vs the already-measured 8.81%
from 2026-07-29), not better.

**Conclusion: entry-frequency/selectivity via a simple long-EMA regime gate
is not the missing lever either, and is not adopted.** This was the one
remaining untested idea named on 2026-07-29 ("the entries are still the
bottleneck... entry frequency/selectivity itself... has not been
measured") — now it has been, and it doesn't move the needle, for a
structural reason: a regime filter built to sit out downtrends can't help
when the underlying assets barely have one to sit out during the measured
window. The best performer across every stocks measurement this project
has run remains **trend-exit EMA50** (2026-07-29): PF 2.75, +8.81%, 3/3
folds — still only ~5% of the +170-174% basket, still failing "beats
buy-and-hold." Nothing is promoted; `CURATED_STOCK_INSTRUMENTS`'s live
config is unchanged.

**Where this leaves the stocks arm**: every lever this project has
measured — target width, RSI ceiling, confidence floor, trailing stop,
alternative signal families (mean-reversion, breakout), trend-following
exits, and now entry-side regime gating — has been tried on real Alpaca
history and none clears the bar. The honest read is that beating a
buy-and-hold basket of ten hyper-growth mega-caps during a historic bull
run with an active, risk-limited, long-only strategy may not be achievable
without either a fundamentally different edge (not yet identified) or
accepting materially more drawdown/volatility than this project's capital-
protection rules allow. Further tuning within the current strategy family
is very unlikely to close an ~8x gap.

## Stocks strategy: regime-filter candidates added to measureStocks.mts (2026-09-02)
David asked to sort out both gaps ("סדר את שניהם"); this is the stocks half
(live exits is the entry above). The 2026-07-29 trend-exit measurement
concluded "the entries are still the bottleneck, not the exits... the
remaining untested lever is entry frequency/selectivity itself" — this had
not been measured. `signal/regimeFilter.ts`'s `buildDailyRegimeFilter`
(daily-EMA entry gate, already live for crypto) was never applied to
stocks, and `src/core/backtest/livePipeline.ts`'s own `regimeFilter` option
(the integration point, not just the pure filter function) had ZERO test
coverage before this — a real gap, closed with 4 new tests in
`tests/backtest/livePipeline.test.ts` before trusting a real measurement
built on it.

Added 3 regime-gated candidates to `scripts/measureStocks.mts`'s
CANDIDATES: `regime EMA100`, `regime EMA200`, `regime EMA100 + trend-exit
EMA50` (combining both untested levers). Sanity-verified the script still
parses/imports correctly for both `1d` and `1h` invocation modes (fake
credentials — real measurement needs the real Alpaca secrets, only present
in `measure-stocks.yml`'s CI run).

**Red-team review before committing caught two real issues, both fixed**:
1. `buildDailyRegimeFilter` assumes genuinely ~24h-apart bars (gates on
   elapsed 86,400,000ms) — reusing the entry-timeframe slice as its input
   is only valid for TF='1d' runs. Fixed: `regime` candidates are now
   filtered out of the candidate list entirely for TF='1h' runs, rather
   than silently measuring a mislabeled 20/100/200-HOUR "regime".
2. A fold shorter than the configured EMA period makes
   `buildDailyRegimeFilter` fail OPEN (always allow, per its own designed
   convention) — correct behavior, but silent, so a short fold (plausible
   in `candidates` mode's 40 browsable symbols with as few as ~300 bars)
   could measure identically to the unfiltered baseline with no indication
   the gate was never actually exercised. Fixed: warns once per
   (candidate, symbol) when this happens, rather than silently no-op'ing.

**Run for real** the same night via `measure-stocks.yml` — see the entry
above this one for the actual result (does not help, not adopted).

Full gate green: tsc clean, 877 vitest (873 + 4 new), vite build ok.

## STAGE 6: live position exits built (2026-09-02)
David asked to sort out both remaining gaps ("סדר את שניהם", "מסודר"): live
exits, and the stocks strategy. This entry covers the first.

`src/core/autopilot/exitDecision.ts` extracts `decideExit` — the exact
stop-loss/trailing-stop/trend-exit/take-profit logic `paperAutoPilot.ts` had
inline — into shared, pure code. `paperAutoPilot.ts` now calls it instead of
duplicating the logic (its own 45 tests still pass unchanged — confirmed
behavior-preserving before touching anything downstream). This is what
"paper and live are the same pipeline" actually requires: one decision
function, not two that could quietly drift apart.

`server/liveExitFlow.mts`: `recordLiveEntryFill` persists a filled BUY's
real stop/target/fill-price — the broker's `fetchPositions()` has no idea
what WE consider a position's stop or target, only local state does (paper
trading gets this for free from its local `PortfolioEngine`).
`decideLiveExit` is a thin pass-through to the shared `decideExit`.
`buildLiveExitIntent` builds a SELL `OrderIntent` that goes through the
EXACT SAME `runLiveOrderFlow` safety chain as any entry (`liveOrchestrator.
mts` is fully side-agnostic — no changes needed there at all) — kill-switch,
mandatory symbol check, human confirmation, only then submit.

`server/telegramConfirmationGate.mts`'s confirmation message now branches
on `intent.side`: a sell shows which position, at what price, and the real
P&L, instead of the entry's risk%/reward-ratio numbers (which would be
actively misleading for a decision to close, not open, a position).

**Red-team review before committing caught two real issues, both fixed**:
1. The exit P&L was computed against the originally PROPOSED entry price
   (`assessment.entry`), not the real fill price — wrong whenever an entry
   fills with slippage. Fixed: `recordLiveEntryFill` overrides the tracked
   position's `entryAssessment.entry` to the real `avgFillPrice`.
2. `recordLiveEntryFill` never checked that the `OrderStatusReport` it was
   given actually belonged to the `OrderIntent` passed alongside it — a
   mismatched report would silently corrupt a position's tracked
   price/quantity. Fixed: refuses (returns `false`) on an intentId mismatch.

**Still NOT wired into any workflow** — same posture as the entry side from
earlier tonight: tested, reusable machinery, not a running feature.

Full gate green: tsc clean, 873 vitest (853 + 20 new), vite build ok.

## STAGE 6: ConfirmationGate → BrokerAdapter wiring built (2026-09-02)
David approved continuing Stage 6 overnight ("אני מאשר. תמשיך") after being
told the adapter existed but nothing wired it up. `server/liveOrchestrator.mts`
closes the last unchecked checklist item: `runLiveOrderFlow` chains
kill-switch check → mandatory symbol verification → `ConfirmationGate` →
`BrokerAdapter.submit`; `buildLiveOrderIntent` maps a risk-approved
`TradeRiskAssessment` to a live buy `OrderIntent`. Deliberately buy/entry
side only — live exits are a different, harder problem, not built.

**Red-team review before committing caught three real issues, all fixed**:
1. The symbol-verification check was optional and not tied to
   `brokerAdapter.mode`, so a live broker could silently skip it if a caller
   forgot to pass `verifySymbolExists`. Fixed: mandatory whenever
   `mode === 'live'`, refuses outright (`'missing-symbol-check'`) otherwise.
2. Two refusal paths (kill-switch-blocked, unknown-symbol) left no audit
   trail at all, unlike every other terminal state. Fixed: both are now
   audited.
3. `RevolutXBrokerAdapter.listTradablePairs()`'s pair-parsing accepted
   array-shaped/malformed responses as if they were real symbols, and threw
   uncaught on a network failure instead of returning `[]` like its sibling
   methods. Both fixed, with new tests (malformed response, thrown fetch).

**Explicitly NOT done, on purpose**: this is not wired into any GitHub
Actions workflow — no cron job feeds it real signals.

**UPDATE, same night**: review also surfaced that `verifySymbolExists`
cannot simply be `listTradablePairs()` as originally documented — Revolut
X's own pair symbols (`'BTC-USD'`) don't match this project's internal
asset codes (`'BTCEUR'`) without a translation layer. David said to keep
going ("2 ואז תמזג"), so that translation got built the same night — see
`toRevolutXSymbol` in the entry above this one. `buildLiveOrderIntent` now
requires the already-translated symbol as an explicit parameter, closing
this gap. What's still NOT resolved: whether Revolut X actually LISTS a
given asset's EUR pair at all (confirmed overnight: public Revolut X docs
are inconsistent/contradictory on this, and the authoritative check needs
the authenticated `/configuration/pairs` call this session has no
credentials to make) — but that's now purely `listTradablePairs()`'s job at
runtime, not a code gap.

Full gate green: tsc clean, 850 vitest (836 + 14 new), vite build ok.

## STAGE 6: real Revolut X broker adapter built (2026-09-02), still not wired
David created a Spot-trade-only Revolut X API key (Ed25519, withdraw
disabled) via the Revolut X web app (not available in the mobile app),
stored as `REVOLUT_X_API_KEY`/`REVOLUT_X_PRIVATE_KEY` GitHub secrets —
separate from the existing read-only market-data key.
`server/revolutXBrokerAdapter.mts` implements `BrokerAdapter` for real:
`mode: 'live'`, reuses the exact Ed25519 signing already built/tested for
read-only calls (`server/signing.mjs`) against `POST/DELETE/GET /orders` and
`GET /balances`. Refuses paper-mode intents and refuses everything when the
kill switch is engaged. `submit()` places the order then reads its status
back ONCE (no wait/poll loop — deferred wiring-layer work) and reports
honestly (`'submitted'`, never fabricated as `'filled'`) when not yet filled.
`cancel()` throws rather than silently no-op'ing when asked to cancel an
intent it never placed (looks up a persisted intentId→venueOrderId map).
`fetchPositions()` reports raw spot balances; Revolut X's balances endpoint
has no cost basis, so `avgCost` is always `0` — reconciliation must compare
quantity only. Added `server/signing.d.mts` (a hand-written declaration file
for the existing plain-JS `signing.mjs`) so a `.mts` file could import it
with real types; this made a pre-existing `@ts-expect-error` in
`tests/server/signing.test.ts` stale, removed.

**Red-team review before committing caught a real, would-have-shipped bug**:
the signing path was built as `` `/api${fullPath}` `` where `fullPath` was
already `/api/1.0/orders` — a doubled `/api` prefix. Revolut X signs over the
real path; every authenticated call would have failed signature verification
(likely HTTP 401) the moment this adapter touched the real API, despite all
11 unit tests passing, because the original tests only checked the signature
header was *present*, never that it *verified*. Fixed (`path: fullPath`) and
locked in with a new test helper that re-derives the exact signed payload
from the real request (method/path/body) and cryptographically verifies it
against a matching Ed25519 keypair — proven to actually catch the bug by
temporarily reintroducing it and watching 3 tests fail, before reverting.

**RESOLVED (2026-09-02, same night)**: `toRevolutXSymbol(internalSymbol,
instruments)` (`server/revolutXBrokerAdapter.mts`) translates this
project's internal instrument symbol (e.g. Kraken's `'XBTEUR'`) to Revolut
X's own pair format (e.g. `'BTC-EUR'`) — by looking up the SAME base/quote
breakdown the trading engine itself already uses (`Instrument.base`/`.quote`,
e.g. `CURATED_INSTRUMENTS` in `src/core/data/krakenPublic.ts`), never by
guessing where a concatenated symbol string splits. Returns `null` (never
guesses) when the internal symbol isn't found. `buildLiveOrderIntent`
(`server/liveOrchestrator.mts`) now takes the ALREADY-translated broker
symbol as an explicit 4th parameter rather than using `assessment.asset`
directly — a caller must call `toRevolutXSymbol` first. This still doesn't
GUARANTEE Revolut X lists that exact quote currency (e.g. it may not offer
EUR pairs for every asset) — that's still checked for real at runtime via
`listTradablePairs()`, exactly as designed.

Full gate green: tsc clean, 853 vitest (836 + 17 new), vite build ok.

## STAGE 6 STARTED (2026-08-27): real-money execution layer, still not connected
David asked what's needed to connect a real wallet, then explicitly asked to
start building it. See `docs/execution-architecture.md` for the full design
and current checklist. Summary:
- Checked the readiness gate live: crypto is 5/6 (blocked only on "beats
  buy-and-hold BTC", a known ~20% gap in a strong bull run, no free fix);
  stocks is 4/6 (needs more closed trades + a benchmark comparison not wired
  yet). Neither is ready, and readiness alone was never the whole gate anyway.
- The execution contracts (`src/core/execution/types.ts`) were "design only"
  — zero implementations existed. Two now do, both paper-only/no-real-money:
  `src/core/execution/paperBrokerAdapter.ts` (implements `BrokerAdapter`
  against the existing paper `PortfolioEngine`) and
  `server/telegramConfirmationGate.mts` (implements `ConfirmationGate`,
  sends real Telegram Approve/Reject buttons, no path to auto-approve).
  `tests/ui/architecture.test.ts` updated to whitelist exactly the one
  `BrokerAdapter` file and assert it stays network-free and paper-mode-only —
  every other file in `src` is still blocked from implementing it.
- Persistent audit log storage was already built (`PersistedAuditLog`) and
  needed no new work; both new pieces log through it.
- NOT done, and explicitly not started: a real Revolut X adapter (needs
  David to create separately-scoped, order-capable API credentials), and
  wiring the confirmation gate + broker adapter into an actual running
  orchestrator loop. Nothing currently built can place a real order or
  touch real money; `paperAutoPilot.ts`'s existing autonomous paper loop is
  untouched and still has no confirmation step, by design.
- Full gate green: tsc clean, 779 vitest (760 + 19 new), vite build ok.

## Strategy (measured on ~30d real Kraken data; SIMULATED)
- No-chase RSI ceiling `AUTOPILOT_MAX_RSI_FOR_LONG=65` (PF ~1.0→2.3).
- Trailing stop `AUTOPILOT_TRAILING=undefined` (OFF — measured 2026-08-27,
  see below). Conviction floor `AUTOPILOT_MIN_CONFIDENCE=40`.
- Shared pure helpers so live autopilot and harness stay identical.
- Portfolio drawdown circuit-breaker (`src/core/risk/drawdownBreaker.ts`,
  DD_BREAKER_PCT=8): pauses NEW entries when equity >8% below its peak; exits
  and stops keep running. Peak tracked in state (`equity-peak`); Hebrew
  Telegram alert once/day (`buildDrawdownHaltAlert`).

## RE-TUNED STRATEGY (2026-07-27): profit + risk fix, measured on live data
David reported the live paper account was losing badly and asked for a
measured profit/risk improvement pass. Live trade journal (23 closed trades,
11 days) confirmed it: win rate 21.7% (5W/18L, ~4x more losses than wins as
David suspected), profit factor 0.36, return -3.02%, -5.44% vs buy-and-hold
BTC. Two root causes found and fixed, both re-measured on REAL current Kraken
data (not the ~30-day-old numbers the old constants cited):
- **Trailing stop was no longer optimal.** `scripts/sweepStrategy.mts`
  already had an untested lead flagged ("PROD + trail 1.5/1.5... worth a
  dedicated look later"). Measured now (5 symbols, 720 1h candles, in-sample
  + OOS): `{activateR:1.5, trailR:1.5}` beat the old `{activateR:1, trailR:2}`
  on every metric (return 0.32→0.35%, maxDD 0.99→0.98%, win% 35.7→44.4%, PF
  1.35→1.42, OOS-PF 0.77→0.83). Shipped in `AUTOPILOT_TRAILING`.
- **Confidence floor was stale and non-discriminating.** In the live sample,
  avg confidence on winners (26.6) vs losers (27.7) was statistically
  identical — the 20-floor let in noise. A confidence sweep on the FULL
  10-symbol production universe (not the 5-symbol proxy set — that
  under-samples what's actually traded) at the new trailing setting showed a
  clean improvement raising the floor 20→40: return -0.35%→+0.03%, max
  drawdown 1.29%→0.34% (-73%), win% 35.1→41.7%, PF 0.71→1.15 (losing→
  profitable). 45+ starves the sample to single digits of trades (too sparse
  to trust) so 40 is the measured sweet spot, not a guess at the edge.
  Shipped in `AUTOPILOT_MIN_CONFIDENCE`.
- **Composed effect, verified together on the full 10-symbol universe**:
  OLD (trail 1.0/2.0, conf 20) → return -0.34%, maxDD 1.27%, PF 0.71 (net
  losing) vs NEW (trail 1.5/1.5, conf 40) → return +0.03%, maxDD 0.34%, PF
  1.15 (net profitable), OOS-PF tied at 0.45. Trade frequency drops (58→12
  in the measured window) — intentional: fewer, higher-quality entries.
- **Investigated and correctly NOT changed**: every altcoin in the live
  sample was a net loser (ADA/LTC/XRP/DOT/AVAX: 0 wins across 13 trades)
  while majors (BTC/ETH/DOGE) won — tempting to narrow the traded universe,
  but each symbol only had 1-4 trades, too thin to act on, and the
  correlated-cluster exposure cap already tested this exact idea (see below)
  and found it a genuine tradeoff, not a clear win. Left alone; the higher
  confidence floor already cuts weak entries across all symbols including
  alts.
- Full gate green (tsc · 490 vitest · vite build) both times; no test
  hardcoded either constant.

## WIN-RATE QUESTION (2026-08-27): trailing stop measured off; closer target re-confirmed as a trap
David asked for a much higher win rate ("traders who win 99% of trades"),
having seen both live paper accounts (crypto + stocks) give back some of a
recent winning streak. Answered honestly rather than chasing the number:

- **No real, liquid strategy sustains ~99% win rate.** Ran the up-to-date
  `scripts/sweepAutopilot.mts` (which replays the actual `PaperAutoPilot`,
  not `sweepStrategy.mts`'s per-symbol approximation) across ~30 configs on
  two real windows (1h entries/30d, 4h entries/120d). Every config that
  showed 90-100% win rate did so on 1-2 trades — noise, not edge. The
  ACTUAL current production config already ran ~92% win rate in the recent
  strongly-trending 30-day window (13 trades) but only 25% in the choppier
  120-day window (8 trades) — win rate is regime-dependent, not a fixed
  trait of the strategy, and a "99% win rate trader" claim on real volume is
  a red flag (inverted risk/reward, or a cherry-picked sample), not a goal
  to chase.
- **Trailing stop measured OFF** (`AUTOPILOT_TRAILING` now `undefined`):
  across both windows tested, dropping the `{activateR:1.5, trailR:1.5}`
  trail never did worse than keeping it, and did better in the 1h window
  (return 13.56%→14.15%, same 92.3% win rate). A small, real, no-downside
  win — see the dated comment on `AUTOPILOT_TRAILING` in `paperAutoPilot.ts`.
- **A closer take-profit target (raises win% but costs profit factor) was
  RE-TESTED and RE-REJECTED** — same conclusion as 2026-07-20 (see below),
  independently reproduced today on `sweepStrategy.mts` (atrTargetMultiple
  4→3: win% 54.8%→63.2%, but PF drops and the change was measured against
  that script's own stale "PROD baseline" row, which still hardcoded
  `minConfidence: 20` against the real production value of 40 — flagged as
  a tooling-hygiene gap, not fixed here since `sweepAutopilot.mts` is the
  script actually kept current). A higher win rate bought by a smaller,
  less robust edge is not the improvement it looks like.
- **Confidence-floor granularity between 40 and 50 checked and REJECTED
  too**: David pushed further on the win-rate question, so `floor 42/45/48
  no-trail` rows were added to `sweepAutopilot.mts` to see if any floor
  beats the current 40. In the 1h/30d window, win rate strictly *decreases*
  as the floor rises (92.3%→88.9%→83.3%→66.7% at 40/42/45/48) while trades
  collapse (13→9→6→3) — floor 40 is already the local peak, not an
  under-tuned value; a higher confidence score isn't more predictive of a
  win here (matches the 2026-07-27 finding that winner/loser confidence was
  statistically identical before the floor existed). This closes the
  confidence-floor lever entirely: there is no adjustment left in this
  family that legitimately buys a higher win rate.
- Full gate green (tsc · 760 vitest · vite build); no test hardcoded the
  removed trailing-stop value.

## TREND-EXIT WIRED INTO THE REAL AUTOPILOT (2026-08-31): stocks looks real, crypto inconclusive
David lost money on a stop-out and pushed back hard ("this must never happen
again") — explained the real, structural tradeoff (a fixed stop/target caps
both the loss AND the gain; no strategy maximizes upside capture while also
minimizing drawdown, they're in tension) and proposed the already-built
`trendExit` mechanism (hold through trend via a trailing EMA instead of a
fixed take-profit) as the measured lever to lean the tradeoff toward more
upside, not a promise to eliminate the tradeoff.

- **Gap found**: `trendExit` only existed in the backtest approximation
  (`livePipeline.ts`), never in the real `PaperAutoPilot` — so it could be
  backtested but never measured against the actual engine. Added
  `trendExit?: { emaPeriod }` to `PaperAutoPilot` itself, same placement and
  same rule as `trailing`: stop-loss is still checked FIRST every cycle,
  unconditionally — trendExit only replaces the fixed take-profit check,
  never the protective stop. Logged as the existing `'signal-exit'`
  `ExitReason` (a price-action rule closed it, not a fixed level), not a new
  enum value. 4 new tests (holds past where fixed-target would have closed
  it while the trend holds; closes via signal-exit on a trend break before
  ever reaching the stop; stop-loss still fires first even with trendExit
  configured; omitting the option leaves default behaviour unchanged).
- **Crypto measurement (`sweepAutopilot.mts`, now supports `trendExit`,
  real Kraken data): inconclusive, not adopted.** EMA20/EMA50 trend-exit
  showed 100% win rate in the recent 30-day trending window — but on only
  5-6 trades, the same small-sample illusion already flagged in the
  win-rate work above (2026-08-27) applies here just as much: not enough
  volume to trust. In the longer, choppier 120-day window, every trend-exit
  variant was STILL net-losing (0-4 trades each) — no clear win there
  either. Also surfaced that this file's non-trend-exit "PROD" rows still
  hardcode the OLD `trailing: 1.5/1.5` even though production trailing is
  now off (2026-08-27) — flagged, a `PROD live (no trail, current)` row
  added as the honest current baseline, older rows left as historical
  reference rather than rewritten.
- **Stocks pooled measurement (`measureStocks.mts` candidates mode, real
  Alpaca data, 41 symbols): more credible.** `trend-exit EMA50` beat the
  live default on every cost tier tested — e.g. at the live 0.10%/side cost,
  PF 1.62 vs 1.23, return 3.45% vs 2.31%, on 459 vs 778 trades pooled across
  41 symbols and 3 folds — an order of magnitude more trade volume than the
  crypto measurement above, so this reading carries real weight.
- **Adopted into production (2026-08-31)**: `stocksRunner.mts`'s `main()`
  now constructs its `PaperAutoPilot` with `trendExit: { emaPeriod: 50 }`.
  Correction to an earlier note here (and to David): stocks does **not**
  have its own separate exit-logic implementation — `runStocksCycle` just
  calls `.runCycleOnce()` on the same `PaperAutoPilot` class crypto uses, so
  this was a config change at the construction site, not new logic. Crypto's
  production config is intentionally left unchanged (measurement above is
  still inconclusive) — do not adopt there without new, larger-sample data.
- Full gate green: tsc clean, 792 vitest (788 + 4 new), vite build ok.

## LONG-TERM INVESTING WALLET — STOCKS (2026-08-31)
David asked for a genuinely separate "wallet" that holds positions for
weeks/months instead of the main runner's tight-stop trading (both for
crypto and stocks; built the stocks side first — crypto already has the
shadow infra and can get its own long-term candidate the same way later if
David asks). Confirmed first that nothing like this existed yet (stocks had
no `shadow:` keys at all).

- **Reused, not reinvented**: crypto's existing shadow-portfolio system
  (`shadowEvaluator.ts` — isolated forward-paper-testing, already the
  project's own answer to "can't honestly backtest this idea") is fully
  generic; it just needed two additions: `ShadowCandidate.trendExit` (wires
  through to `PaperAutoPilot`, same as the main runner) and
  `ShadowRunOptions.baseCurrency` (was hardcoded `'EUR'`; now optional,
  defaults to `'EUR'` so crypto is unaffected, stocks passes `'USD'`).
- **The "long-term" candidate** (`server/stocksRunner.mts`'s
  `STOCKS_SHADOW_CANDIDATES`, key `long-term`): same signal/risk engine as
  the main stocks account, but on **daily bars** (naturally weeks/months-wide
  ATR stops instead of hourly-wide ones) with `trendExit: { emaPeriod: 50 }`
  replacing the fixed take-profit — hold through a trend, exit only when the
  daily trend actually breaks. Runs once per stocks cycle via
  `runStocksShadow()`, fully isolated (own namespace, own kill switch, own
  portfolio) — cannot affect the real stocks account. Reported in the
  Telegram digest's stocks section (`🌱 ארנק השקעות לטווח ארוך`), gated by
  the same `SHADOW_MEANINGFUL_TRADES` bar as crypto's shadows so an early
  streak isn't oversold as proven edge.
- **Simulated money only, same as everywhere else** — this is a forward
  paper record to judge the IDEA, not a new path to real money. Nothing here
  changes the real-money-readiness gate.
- 8 new tests (shadowEvaluator: trendExit threads through, baseCurrency
  defaults to EUR / accepts USD; stocksRunner: shadow wallet runs alongside
  the main cycle; autopilotRunner: `readStocksSummary` folds in the shadow
  standing or reports null; telegram: digest renders the wallet's line both
  below and above the meaningful-trades bar). Full gate green: tsc clean,
  800 vitest, vite build ok.

## LONG-TERM WALLET UI (2026-08-31)
David couldn't see the long-term wallet anywhere in the app (Telegram-only)
and asked for it to be visible — a new screen, or inside Stocks, "whichever
is best, but must be perfect." Added a 5th sub-tab, **Long-Term**, to the
Stocks hub (next to Overview/History/Market/Profit) rather than a whole new
primary section — it's stocks-scoped and the hub's existing lazy-mount
sub-tab pattern already fits perfectly; a brand-new top-level view would have
meant a second nav destination for what is conceptually one asset class.

- `src/ui/cloudState.ts`: `CloudState` gained `shadowStandings` (parses the
  `'shadow-standings'` key `stocksRunner.mts` writes), same
  filter-then-default-to-empty convention as `marketSnapshot`.
- `src/ui/views/assetHubView.ts`: `AssetHubOptions` gained an **optional**
  `renderLongTerm` — omitted entirely (crypto today) the tab/panel don't
  exist in the DOM at all, so this cannot break or clutter Crypto's hub.
- `src/ui/views/stocksLongTermPanel.ts` (new): hero card (equity/return/
  trades/open) + a "Track record" block gated by the same meaningful-trades
  bar as the Telegram line — below it, an honest "still gathering data"
  message instead of a win-rate that would be noise. A distinct top-level
  "not started yet" empty state (own `.empty` block, hero hidden entirely)
  covers the real production case: the shadow cycle hasn't run for even one
  full cycle yet, so `shadow-standings` doesn't exist in the committed state
  file at all as of this writing.
- Reused every existing style class verbatim (`.hero`, `.tag-sim`, `.block`,
  `.stack-card`, `.row`, `.empty`) — no visual reinvention, so it matches the
  "$100k app" bar by construction rather than by eyeballing it.
- **Real bug caught by actually looking at it, not just the tests passing**:
  toggling `.hidden` on the loading-skeleton element did nothing visually —
  `.stack` sets `display: flex`, same CSS specificity as the `[hidden]` UA
  rule and declared later, so it won. Fixed with an explicit
  `style.display = 'none'/''` alongside the `.hidden` toggle. Caught by
  running the actual dev server under Playwright (`chromium` from the global
  npm install, `executablePath: '/opt/pw-browsers/chromium'`) and looking at
  screenshots of all three states (empty / gathering data / full track
  record) — this project's own rule that UI changes must be seen running,
  not just type-checked and unit-tested.
- 8 new tests (`cloudState`: shadow-standings parses/defaults;
  `assetHubView`: the tab is entirely absent without `renderLongTerm`, lazy-
  mounts exactly once with it; `stocksLongTermPanel`: not-started / below-
  threshold / above-threshold / wrong-candidate-key-ignored). Full gate
  green: tsc clean, 808 vitest, vite build ok.

## LONG-TERM WALLET — CRYPTO (2026-08-31)
David confirmed ("אם זה יהיה טוב לנו אז כן, תעשה") building the same
long-term wallet for crypto that stocks got earlier today. Same shape,
zero new mechanics: `shadowEvaluator.ts` already supports `trendExit`/
`baseCurrency` from the stocks build, so this was pure wiring.

- `server/autopilotRunner.mts`: new `LONGTERM_SHADOW_CANDIDATES` (one
  candidate, key `long-term`, `AUTOPILOT_MIN_CONFIDENCE`/`AUTOPILOT_MAX_RSI_FOR_LONG`,
  `trendExit: { emaPeriod: 50 }`) run once per cycle via `runLongTermShadow()`
  on **daily bars** (own `runShadowCycle` call, separate from the main
  9-candidate `runShadows()` batch which stays on `ENTRY_TF`/`1h` since it's
  shared across all 9). Stored under its own key
  (`shadow-longterm-standings`) so it can't collide with or be confused for
  the existing 9-candidate shadow board.
- Note this candidate is deliberately NOT validated by the earlier trend-exit
  measurement (`sweepAutopilot.mts`, inconclusive on the hourly timeframe) —
  it's a different timeframe entirely (daily), so that earlier inconclusive
  reading doesn't transfer either way. This is exactly the shadow system's
  own reason for existing: forward-test an idea instead of guessing from
  insufficient backtest evidence.
- Telegram digest: refactored the stocks section's long-term line into a
  shared `longTermShadowLines()` helper (byte-identical output, verified by
  the pre-existing stocks tests passing unchanged) and reused it for a new
  top-level crypto line (`🌱 ארנק השקעות לטווח ארוך:`, no leading spaces vs
  the stocks sub-section's indented one).
- No UI yet for crypto's long-term wallet (unlike stocks, which got a
  dedicated hub tab after David asked separately) — not requested this
  round; the stocks `stocksLongTermPanel.ts` pattern is ready to copy if he
  asks for it later.
- Same-day side investigation: David was alarmed by 5 days with zero new
  crypto trades. Investigated and found no bug — kill switch off, drawdown
  breaker at 3.1%/8%, daily-loss reset; ruled out the BTC market-regime gate
  specifically (shadow copies WITHOUT that gate are equally silent over the
  same window). The base signal at `minConfidence=40`/`RSI≤65` simply hasn't
  found a qualifying setup on any of the 10 traded majors — consistent with
  a documented 2026-08-21 sweep showing this exact config can produce a full
  120-day backtest window with 0 trades in non-trending conditions. Reported
  to David as expected selective behavior, not a defect; no code changed.
- **Red-team review caught a real inefficiency before merge**: `runLongTermShadow`
  was re-fetching daily candles and re-running a full daily-bar evaluation on
  every 5-minute internal loop cycle (up to `LOOP_CYCLES` times per trigger)
  even though daily bars only change once a day — needless Kraken request
  volume for zero new information. Fixed with a day-gate (`localDayAndHour` +
  a stored last-run-day key, same idiom already used elsewhere in this file
  for once-a-day alerts), not set on failure so a transient error retries
  next cycle rather than waiting a full day. Note: the stocks-side
  `runStocksShadow` (merged earlier today) has the same inefficiency,
  un-fixed — lower severity there (market-hours-gated, fewer loop cycles)
  but worth the same fix if David wants it.
- 3 new tests (`telegram`: crypto's top-level long-term line renders
  distinctly from the stocks-nested one, omitted entirely when absent;
  `autopilotRunner`: `maybeSendSummaries` actually folds a stored
  `shadow-longterm-standings` entry into the sent digest text — closing the
  gap the red-team review flagged, where only the pure `buildDailySummary`
  rendering had coverage before). Full gate green: tsc clean, 811 vitest,
  vite build ok.

## STOCKS WORKFLOW WATCHDOG (2026-08-31)
David asked for a "red team" check that everything was actually fine. It
mostly was (tsc/tests/build/architecture gate all green, crypto running
normally) — except one real, previously-undetected problem: GitHub's own
scheduler had silently stopped firing `stocks-autopilot.yml`'s cron for
**3 full days** (last run 2026-08-28, workflow still shown as "active" the
whole time) — not a bug in our code, a known, undocumented GitHub Actions
limitation. Confirmed by manually re-running it via `workflow_dispatch`:
every step succeeded immediately.

- **Fix**: `server/workflowWatchdog.mts` (new) — `checkAndNudgeStaleWorkflow()`
  reads a workflow's own run history via the GitHub REST API and re-triggers
  it via `workflow_dispatch` if the gap since its last run exceeds a
  threshold (90 min, generous relative to both workflows' own crons).
  Stocks' check is additionally gated by `isUsMarketOpen()` — staleness
  outside market hours is expected, not a problem, and must never trigger a
  pointless dispatch.
- Wired into `server/systemMonitorRunner.mts` (already the reliable ~2h
  heartbeat behind `system-monitor.yml` — verified this specific workflow
  had ~332 consecutive successful runs straight through the stocks outage,
  making it the right place to hang this on rather than adding a 4th,
  independently-crontab'd workflow file that could itself silently stall).
  Sends one Telegram line only when an actual nudge happens.
- **Red-team review before merging caught a real, would-have-shipped
  regression**: adding a `permissions:` block containing only `actions:
  write` to `system-monitor.yml` would have silently stripped the implicit
  `contents: read` `actions/checkout@v4` needs — the very next scheduled
  run would have failed at checkout, breaking the pre-existing, working
  crypto/stocks Telegram alerts this file already sends. Fixed by listing
  `contents: read` explicitly alongside `actions: write` (declaring ANY
  `permissions:` key replaces every default, not just adds to it). Also
  caught and fixed: an unwrapped network call that could throw and crash
  the whole monitor run instead of failing soft like everything else in
  this file already does; and two independent GitHub API checks awaited
  sequentially instead of via `Promise.all`.
- 7 new tests for `checkAndNudgeStaleWorkflow` (mocked fetch — within
  threshold, past threshold + dispatches, `shouldBeActive` gate skips before
  ever reading run history, run-history fetch failure, dispatch failure,
  no-runs-yet). Full gate green: tsc clean, 818 vitest, vite build ok, YAML
  validated with `yaml.safe_load`.

## STOCKS SPY BENCHMARK (2026-09-01), layer 1 of 2
David asked "what else can be improved to make it work better", then to
build both flagged gaps "in layers." The bigger one: stocks' real-money-
readiness gate could **never** reach "ready" on the benchmark criterion —
`vsBenchmarkPct` was hardcoded `null` forever, unlike crypto's real BTC
comparison. Fixed by mirroring crypto's own pattern exactly:

- `server/stocksRunner.mts`: new `computeStocksBenchmark()` — same anchor-
  once-then-compare-forever shape as crypto's `computeBenchmark`, using SPY
  (S&P 500 ETF) as "a market benchmark" (matches the label already used in
  the readiness criterion's text). `recordEquity()` gained a `source`
  parameter to fetch it.
- `server/telegram.mts`: extracted crypto's inline BTC-benchmark rendering
  into a shared `benchmarkLines()` helper (verified byte-identical output
  via the pre-existing crypto tests) and reused it for a new stocks-section
  SPY line.
- `server/autopilotRunner.mts`: `readStocksSummary()` folds in the stored
  benchmark result the same way it already does for the long-term shadow
  standing.
- **Red-team review before committing (established habit now) caught a
  real bug**: `recordEquity` was unconditionally overwriting the STORED
  benchmark with `null` on every transient SPY fetch failure, clobbering an
  already-anchored, real comparison the cross-process digest depends on —
  even though nothing about the underlying anchor was actually lost. Fixed:
  only overwrite the stored value on an actual successful fetch; the live
  readiness check for that one cycle still honestly reflects the momentary
  gap via the local (unstored) `benchmark` variable.
- 6 new tests (`stocksRunner`: benchmark computed as SPY not the old
  placeholder text, falls back to "not measured" on fetch failure, keeps
  the last known-good stored value on a later transient failure instead of
  clobbering it; `telegram`: stocks' SPY line renders indented alongside
  crypto's BTC one, omitted when not measured; `autopilotRunner`:
  `readStocksSummary` folds in a stored benchmark or reports null). Full
  gate green: tsc clean, 824 vitest, vite build ok.

## STOCKS SHADOW DAY-GATE (2026-09-01), layer 2 of 2
The other flagged gap, closing the loop from the crypto long-term wallet's
own red-team review: `runStocksShadow` in `stocksRunner.mts` had the exact
same inefficiency already fixed on the crypto side — re-fetching daily
candles and re-running the full 10-symbol shadow evaluation on every
5-minute internal cycle even though daily bars only change once a day.
Applied the identical fix (own UTC-day key — `new Date(now).toISOString().
slice(0, 10)`, the convention this same file already uses in
`updateMarketSnapshot`, kept local rather than importing crypto's
`localDayAndHour`/timezone helper to preserve the two runners' deliberate
isolation), not set on failure so a transient error retries next cycle.
1 new test proving a second call the same UTC day is skipped (the stored
`shadow-standings.at` timestamp stays unchanged) and a call on a new day
runs it again. Full gate green: tsc clean, 825 vitest, vite build ok.

## Pending Work (autonomous queue)
- TESTED AND REJECTED (2026-07-20): David asked whether a CLOSER take-profit
  target (easier to hit, so more trades close in profit instead of stopping
  out) would help, having noticed recent closes were mostly stop-losses.
  Measured with `scripts/sweepStrategy.mts` on real Kraken history (5
  symbols, 720 1h candles, production trailing stop 1.0/2.0 held fixed):
  lowering `atrTargetMultiple` from 4 (current, 2:1 reward/risk) to 3 (1.5:1,
  the `minRiskReward` floor) DOES raise win% (52.9%→61.3%) exactly as
  expected, but out-of-sample profit factor drops (2.10→1.60) — same pattern
  at 3.5 (OOS-PF 1.92) and even at a FARTHER target of 5/2.5R (OOS-PF 1.49).
  **The current 4/2R setting has the best OOS-PF of everything tested.**
  Conclusion: win rate and profitability aren't the same thing — a closer
  target wins more often but each win is smaller and the edge is less
  robust out-of-sample. Correctly NOT changed. (Noted in passing: the
  existing "PROD + trail 1.5/1.5" candidate scored OOS-PF 3.18, the best of
  the whole sweep — unrelated to this question, not investigated further
  yet, worth a dedicated look later.)
- TESTED AND REJECTED (2026-07-20): a daily-trend regime filter
  (`src/core/signal/regimeFilter.ts` — `buildDailyRegimeFilter`, EMA on 1d
  closes, wired as an optional `regimeFilter` hook in `livePipeline.ts` only,
  NOT wired into production) was the natural next hypothesis for the 8/8
  losing streak. Measured honestly on ~2 YEARS of independent daily context
  (not the same 30-day window): EMA200 gate → 0 trades at all (every symbol's
  daily close currently sits below its 200-EMA); EMA100 → 1 trade; EMA50 → 11
  trades but WORSE quality (win% 38.2→27.3, PF 1.11→0.54) than no filter.
  **Conclusion: a simple daily-trend gate does not help — it either shuts
  down trading almost entirely or actively hurts. Correctly NOT shipped.**
  The module + tests are kept (harness gained a tested, inert capability) as
  a documented negative result so this exact approach isn't retried blind.
  An adx30+conf35 tweak was ALSO tested and rejected earlier the same day
  (looked good in-sample, only 2 OOS trades — inconclusive).
- FINDING (2026-07-20): live track record hit 8/8 losing trades. Root cause
  confirmed with real data at BOTH the 1h (choppy, ~3% range, ~flat) AND the
  daily scale (broad daily downtrend across ALL 10 traded majors right now,
  per the regime-filter test above) — this is a genuinely difficult market
  period for a long-only strategy, not a fixable code defect. Wiring verified
  intact (minConfidence/maxRsiForLong/trailing/haltNewEntries all correctly
  applied). Drawdown breaker correctly has NOT engaged (~2.7% dd vs 8%
  threshold) — it is not supposed to yet. Sample is tiny (8 trades, 9 days);
  the readiness gate (needs 20 trades/14 days) exists exactly for this.
  Right call: keep running the already-validated strategy on paper and
  accumulate a real track record rather than force an unproven change.
- TESTED AND REJECTED (2026-07-20): a cross-asset correlated-cluster
  exposure cap, built to address the 2026-07-20 ADA+LINK+LTC correlated
  stop-out. Built as a fully additive, opt-in capability — `RiskLimits`
  gained optional `correlationThreshold`/`maxCorrelatedExposurePct`;
  `assessTrade` gained `AssessTradeOptions.correlationTo`; `PaperAutoPilot`
  gained `riskLimits`/`correlationBetween` (all `undefined` by default — zero
  behaviour change unless explicitly wired). A new pure `src/core/risk/
  correlation.ts` computes real return-correlation from candle history.
  Measured with `scripts/measureCorrelationLimit.mts`, which replays the
  ACTUAL production `PaperAutoPilot` (not a simplified proxy) over real
  Kraken history for the 10 majors, in-sample vs out-of-sample:
  - threshold 0.6 / cap 30%: in-sample maxDD 3.41%→2.18%, clustered
    stop-out cycles 3→2, but return -1.47%→-2.63% and PF 0.99→0.54 (worse).
    Out-of-sample: maxDD 2.19%→1.36%, clustered cycles 1→0, return
    -2.60%→-1.36% (better), PF 0.36→0.32 (flat/worse).
  - threshold 0.7 / cap 40% (milder, tested to check robustness): WORSE on
    every metric in both windows (in-sample return -1.47%→-4.92%, PF
    0.99→0.41; OOS PF 0.36→0.17) — not monotonic with the milder setting,
    i.e. the effect is parameter-sensitive rather than a stable improvement.
  **Conclusion: consistently reduces clustered stop-outs and (mostly) max
  drawdown, but does NOT consistently improve — and sometimes clearly
  hurts — overall return/profit factor, and the result is sensitive to the
  exact threshold/cap chosen. Real tradeoff, not a clear win. Correctly NOT
  wired into `autopilotRunner.mts`.** Kept as a tested, inert, documented
  capability (same treatment as the regime filter) — the code is real and
  correct, it's just not proven to net-improve results yet. Re-measure once
  there's more real trade history (current samples: 20-27 trades per
  window) before revisiting.
- FIXED (2026-07-21): `DailyLossTracker.record()` (`src/core/risk/
  dailyLoss.ts`) was never called anywhere — realized losses were never
  actually accumulated, so `dailyLossLimitPct` (3% of equity) could never
  trip; `getDailyLoss` always read back 0. A real dormant capital-protection
  gap (found while building the correlation-limit measurement harness).
  Fixed: `PaperAutoPilot` now computes each exit's realized P&L (mirroring
  `PortfolioEngine.exit`'s own math) and exposes it on `CycleResult.closed[].
  pnl`, plus an optional `onRealizedPnl(pnl, timestamp)` hook. Wired in both
  places that run a real exits loop — `server/autopilotRunner.mts` (the
  actual cloud agent) and `positionsView.ts` (the in-browser local
  autopilot) — to `dailyLossTracker.record(pnl, timestamp)`.
  `DailyLossTracker.record()` itself already ignores non-negative P&L, so
  wins never touch the loss counter. 2 new tests confirm the reported `pnl`
  matches the trade journal's `realizedPnl` exactly and that `onRealizedPnl`
  fires with the right amount/timestamp on a loss (and not is-a-loss on a
  win). The daily-loss limit now actually engages when it should.
- The agent's TRADED universe stays pinned to the 10 curated majors
  (`slice(0, 10)`, deliberately) — widening THAT requires a proper sweep +
  out-of-sample validation first (measure, don't guess), not a slice change.
  Not yet done.
- Later: Telegram approve/reject flow (prerequisite for real money).

## FIXED: Portfolio Value chart flattened to 1-2 candles (2026-07-20)
David reported the wallet-history chart still "isn't organized well at all."
Root-caused with the REAL live cloud state (fetched from the raw
githubusercontent state URL, not a guess): equity tracking is only ~5 days
old (588 samples). `valueView.ts`'s 'All'/'1Y' ranges used a FIXED weekly
(7-day) candle bucket — with only ~5 days of real history, that bucketed the
ENTIRE history into just 1-2 giant candles. Since 'All' is the default range,
this was the very first thing shown on opening the chart. Fixed with
`adaptiveBucketMs(spanMs, niceBucketMs)`: shrinks the bucket toward the
actual data span (targeting ~30 candles, floored at 5 min) when there isn't
enough history to fill the nice bucket width yet; once real history exceeds
`niceBucketMs × 30`, it returns the original nice width unchanged (1Y stays
weekly once a year has actually elapsed). 6 new tests (pure `adaptiveBucketMs`/
`bucketize` unit tests + a DOM-integration repro of the exact live scenario:
5 days of history on the default 'All' range). Verified visually in a real
Chromium browser (dev server + Playwright, mocked cloud-state fetch since
this sandbox can't reach raw.githubusercontent.com directly): before would
have shown ~1-2 candles, after shows 31 real candles with visible structure.

## App-wide bug sweep (2026-07-20)
David asked to go over the whole app in detail and fix what's found. Ran a
systematic review agent over every view file (`src/ui/views/*.ts`) plus the
shared UI utilities, looking specifically for concrete, reproducible defects
(not style). Found and fixed 3 more real bugs beyond the value-chart one above:
- **`marketsView.ts` — stale coin-detail fetch could overwrite a different
  coin.** The staleness guard (`paintSeq`) was scoped per-`openDetail()` call,
  not to the component instance. Repro: open BTC, switch its range (a slow
  fetch), back out and open ETH before that fetch resolves — BTC's response
  would land later and silently snap the screen back to BTC's chart/price/live
  ticker. Fixed with a component-level `detailGeneration` counter bumped on
  every `openDetail()`/`backToList()`, checked alongside `paintSeq` before any
  write to the shared `detailView`. Test reproduces the exact race (fails on
  the old code, passes fixed).
- **`marketsView.ts` — `resume()` silently reset the user's range/chart mode.**
  Pausing (switching tabs) then resuming a coin detail reopened the right coin
  but always reset to 1D/Candle, contradicting the pause/resume design intent.
  Fixed by threading `savedRangeKey`/`savedChartMode` through an
  `openDetail(index, { preserveRange })` option; a genuinely fresh tap from the
  list still starts at the defaults. Test confirms (fails old, passes fixed).
- **`homeView.ts` — "vs Bitcoin" banner never cleared once shown.** If a later
  refresh cycle failed to price BTC (one transient fetch failure), the stale
  comparison stayed on screen looking current, with no `else` branch to hide
  it. Fixed with `else { bench.hidden = true }`. Test confirms (fails old,
  passes fixed).
- **`monitoringView.ts` — alert messages always got a trailing "…"** even when
  not truncated (a 20-char message rendered as `"...text..."…`). Extracted a
  small `truncate(text, max)` helper (`src/ui/format.ts`) that only appends
  the ellipsis when actually cut; unit tested.
6 new tests total for this sweep (on top of the value-chart fix's 6).
The audit also covered `main.ts`, `dataSource.ts`, `markets.ts`, `charts.ts`,
`cloudState.ts`, `liveTicker.ts` — no further concrete (not stylistic) defects
found there.

## Broadened the BROWSABLE (display) universe (2026-07-20)
David asked for more coins beyond the old ~26 and to actually reflect the
full market in the app. `KrakenPublicSource.getInstruments()` now fetches
Kraken's live AssetPairs list and appends every online EUR pair beyond the
10 curated majors (measured live: 538 total today) instead of a fixed ~26
list; falls back to the previous static ~16-coin list if that call fails, so
browsing never regresses. The curated 10 majors always lead in their fixed,
load-bearing order — `autopilotRunner.mts`'s `slice(0, 10)` (what the agent
actually TRADES) is completely unaffected; this only broadens what's
BROWSABLE. Guarded against reintroducing the chart-freeze bug: the Markets
list's auto-refresh sweep (`fetchTopMarkets`) is now capped at 60 coins
(`MARKETS_LIST_CAP`) instead of unbounded — measured per-request latency
(~200-700ms) meant sweeping 500+ coins through the serialized queue would
take minutes, not seconds. 3 new tests cover the broadening, the failure
fallback, and the one-fetch cache. Verified live against the real API
(538 pairs, curated order intact, 324ms).

## UI/UX Overhaul Phase 1 & 2 (2026-07-27): Logo, Cards, Charts, Mobile
Delivered comprehensive visual + UX polish across the application:

**Phase 1: Core Styling**
- **New logo** (public/icon.svg): candlestick (bullish green) + AI accent
  (3 blue dots in ascending neural-net pattern). Replaces generic line chart.
- **Tool cards** (`src/ui/styles.css`): gradient background (light→dark),
  hover lift (+4px translateY, 1.02 scale), glow shadow (blue). 1-column
  mobile, 2-column tablet+.
- **Removed Paper Trading tool** (`src/ui/main.ts`, `index.html`): tool cards
  reordered by workflow (Scan → Backtest → Validation → Portfolio → Grid →
  Monitoring → Guide). 7 tools instead of 8 (Paper Trading overlaps Portfolio +
  Autopilot).
- **Button polish**: glow effects on hover/focus, smooth 150ms transitions,
  press animation (scale 0.98).
- **Input fields**: focus glow (blue), better placeholder visibility.
- **Topbar**: gradient background (darker→lighter), improved shadow, larger
  brand dot with glow.

**Phase 2: Charts & Mobile**
- **Sparkline gradients** (`src/ui/charts.ts`): linear gradient fill
  (0.25→0.02 opacity), smoother polylines (2.5px stroke).
- **Candlestick charts** (already implemented, enhanced styling): rounded bodies,
  opacity 0.85 (up)/0.75 (down), cleaner wicks (1.2px).
- **Grid overlay**: subtle dashed lines (2 2 pattern, 0.4 opacity) for
  readability without clutter.
- **Mobile responsive**: tools grid 1-column <480px, 2-column ≥860px; charts
  full-width no horizontal scroll; improved padding/gaps.

All 490 tests passing, TypeScript clean, 118KB production bundle.
Merged PR #5 (2026-07-27T02:04Z).

## Last Successful Tests
tsc clean · 490 vitest tests green · vite build OK (main).
Chart freeze root-fixed (two causes, both shipped):
1. KrakenPublicSource queue now supports `priority` so an opened chart jumps
   ahead of the background list sweep (measured 8092ms → 1746ms for the exact
   repro) while keeping the "never parallel" rate-limit guarantee intact.
2. Leaked view intervals (2026-07-20): `main.ts` mounted each primary view
   (Home/Value/Markets/History) exactly once and never paused its background
   polling when the user navigated away — all 7 `setInterval` loops across
   those views kept running forever, competing for the same Kraken queue even
   off-screen, undermining fix #1. Added a `ViewHandle` (`pause()`/`resume()`)
   pattern: each view returns one from its render function; `main.ts` calls
   `.pause()` on the outgoing primary view and `.resume()` on the incoming one
   (first visit still does a fresh mount). Markets view additionally tracks
   which coin's detail is open so resume reopens the detail (not the list).
   5 new DOM-integration tests assert pause clears every interval and resume
   restarts them (`tests/ui/viewLifecycle.integration.test.ts`).

## Architecture Notes
Strict layering (data→…→UI); UI presentation-only (architecture tests enforce
imports + no live-order path). Autopilot applies strategy tuning at the
capital-risking layer; the shared signal defaults stay permissive.

## UI/UX Overhaul Phase 3: Loading States (2026-07-27)
New utilities for better async feedback:
- **Loading overlay** (`showLoadingOverlay(message, timeout)`): centered spinner
  with optional message, auto-dismisses after timeout.
- **Toast notifications** (`showToast(message, type, options)`): 5s auto-dismiss,
  HTML-escaped for security, convenience methods (showSuccess/showError/showInfo/
  showWarning).
- **Skeleton loaders** (`createSkeletonLine()`, `createSkeletonTitle()`): shimmer
  animation placeholders for lazy-loaded content.
- **Empty states** (`showEmptyState(container, icon, title, text, actionLabel,
  callback)`): branded placeholders when data is unavailable.

All UI/UX improvements tested (490 vitest) and merged PR #5.

## UI/UX Overhaul Phase 4: Advanced Chart Features (2026-07-27)
Enhanced candlestick charts with professional indicators:
- **EMA indicators** (`calculateEMA(values, period)`): Exponential Moving Average
  for 20/50 periods, rendered as colored paths (light blue #6cb3ff for EMA20,
  darker blue #4c82f7 for EMA50).
- **Volume bars** (`pvol-bar`): scaled to chart height, green for up candles,
  red for down, 0.6 opacity at bottom of chart.
- **MACD histogram** (`calculateMACD(values)`): MACD line (EMA12-EMA26), signal
  line (EMA9 of MACD), histogram bars below volume, green for positive/red for
  negative, normalized across min/max range.
- **RSI level bands**: background zones (oversold red 0-30%, neutral white
  30-70%, overbought green 70-100%) for context without cluttering the chart.
- All rendered as SVG paths (not polylines) to avoid test confusion with
  line-chart detection. 

Integrated Phase 4 improvements after PR #7 merge. All 490 tests passing.
Merged PR #7 (2026-07-27T02:45Z).

## UI/UX Overhaul Phase 5: OHLC Price Labels (2026-07-27)
Quick price reference on candlestick charts:
- **OHLC labels** in top-left corner: displays Open, High, Low, Close values
  of the last candle with 7.5px font, closing price emphasized in bold.
- Positioned at (padL+4, padT+10) for clean corner placement without overlapping
  other chart elements.
- Enables quick price scanning without hovering or touching the chart.

PR #8 merged (2026-07-27T02:50Z). All 490 tests passing, tsc clean,
vite build successful.

## UI/UX Overhaul Phase 6: Support/Resistance Levels & Smooth Transitions (2026-07-27)
Enhanced chart context and polished interactions:
- **Support/Resistance levels**: `calculateSRLevels(candles, lookback=20)`
  computes support (min low) and resistance (max high) from last 20 candles,
  rendered as dashed lines (green for resistance, red for support, 0.3 opacity).
- **Smooth timeframe transitions**: range changes (1D/1W/1M/All) and chart mode
  toggles (candle↔line) now fade out (200ms), re-render, and fade in (300ms)
  for polished UX.
- CSS animations via `.detail-chart.fade-out` / `.fade-in` keyframes.
- Event handlers in `marketsView.ts` integrate animations with range/mode changes.

PR #9 created, waiting for CI. All 490 tests passing, tsc clean,
vite build successful locally.

## UI/UX Overhaul Phase 6: Mobile Optimization (2026-07-27)
Dark-mode-only mobile-first layout optimization:
- **Removed theme toggle**: Eliminated the theme-toggle button from the header 
  and removed all light-mode CSS variables. App now enforces dark mode only 
  (the original design intention).
- **Removed light mode CSS**: Deleted `:root[data-theme="light"]` block and 
  `.theme-toggle` button styles, simplifying the stylesheet and removing 
  dead code path.
- **Full-width mobile layout**: Updated responsive CSS to use 100% width on 
  phones and tablets (≤859px viewport) while preserving the 760px max-width 
  constraint for larger desktop screens, ensuring the app utilizes the full 
  available space on mobile devices.
- **Improved viewport coverage**: Changed min-height from 100vh to 100dvh 
  (dynamic viewport height) for better mobile browser support, preventing the 
  address bar from cutting off content.
- **Theme initialization**: Simplified `src/ui/main.ts` to always set dark mode 
  on app startup, removing localStorage theme persistence code.

PR #10 merged (2026-07-27T11:12Z). All 490 tests passing, tsc clean, vite build 
successful. Mobile layout verified to use full viewport width/height while 
maintaining the glassmorphic floating navigation bar design.

## UI/UX Overhaul Phase 7: Comprehensive Responsive Design (2026-07-27)
Complete responsive design optimization for all screen sizes:
- **4 optimized breakpoints**:
  - **Phone** (≤480px): Single-column tools grid, 180px charts, 0.75rem padding
  - **Tablet** (481-859px): 2-column tools grid, 200px charts, 1.25rem padding
  - **Desktop** (860-1399px): Sidebar nav (210px), 2-column tools, 240px charts, 1.5rem padding
  - **Large Desktop** (≥1400px): 3-column tools grid, 300px charts, 2rem padding, 1200px max-width
- **Responsive components**:
  - Tools grid: 1 col → 2 cols → 2 cols → 3 cols
  - Market rows: 2 cols (sparkline hidden) → 3 cols. Never 4 — rows render
    exactly three cells (`-id`, `-spark`, `-num`); the 4-track rule was the
    defect PR #12 removed
  - Price chart scales by `aspect-ratio` (380/240 → 480/260 → 600/300), NOT by
    `height`: `.detail-chart svg.pchart` sets `height:auto` and outranks any
    `.detail-chart svg { height }` rule, so height-based breakpoints are inert
  - Typography: fonts and spacing scale proportionally across all breakpoints
- **Consistent layout**: Single-column phone, sidebar nav on desktop, optimal content width on all sizes
- **Touch-optimized**: All interactive elements properly sized for touch and mouse input

PR #11 merged (2026-07-27T12:30Z). Vercel preview deployed successfully. 
All 490 tests passing, all CI checks green, bundle optimized.

## Risk-path bug audit (2026-07-27, PR #13)
Two defects in the capital-protection path, neither visible from the test
suite (the gate was green before and after):
1. **Equity was not marked to market when sizing entries.** The autopilot
   called `portfolio.snapshot({}, t)`, and `snapshot`/`unrealizedPnl` value any
   symbol missing from the price map at its ENTRY price. So the equity handed
   to the risk engine ignored unrealized P&L: a position 20% underwater sized
   the next entry identically to one at break-even. Every equity-derived limit
   (per-trade risk, max position, total exposure, daily-loss allowance) rode on
   that inflated number, precisely while trades were losing. The cycle already
   fetches each held symbol's latest close for exit checks, so those prices are
   now passed to `snapshot` — no extra fetches. Same call fixed in the manual
   Portfolio path and in `measureCorrelationLimit.mts`. The cloud runner was
   already correct via `latestPrices`; the autopilot was the outlier.
2. **The per-asset cap never bound a first position** — the sizing clamp was
   guarded by `assetExposure > 0`, so `maxExposurePerAssetPct` only constrained
   top-ups. No-op at current defaults (both 20%); closes the hole for any
   stricter setting.

A/B measured on real Kraken history (10 majors, 720 1h candles, in/out of
sample, both arms scored mark-to-market): **performance-neutral** — full window
-1.625% → -1.628% return, maxDD 1.669% → 1.672%, identical trade count and win
rate. The fix is correctness/safety, not alpha; its protection only bites in a
deeper drawdown than this window contains.

**Open finding (not addressed by PR #13):** that same replay shows the CURRENT
production strategy is net-losing on the last ~30 days — full window -1.63%,
PF 0.24, win rate 16.7% over 6 trades, and out-of-sample PF 0.00 (0/3 wins).
This does not match the numbers recorded in `paperAutoPilot.ts`'s tuning
comments (+0.03% return, PF 1.15) from earlier the same day. Paper money only,
so nothing is at risk, but the tuning needs re-measuring before real money is
ever considered. Sample is small (6 trades) — do not over-fit to it.

## Confidence-floor ordering — measured and settled (2026-07-27, PR #14)
`applyHigherTimeframeGate` grants +8 confidence when the 4h trend confirms, but
the autopilot applies `minConfidence` (40) INSIDE `evaluateScan`, before that
bonus. So the bonus can never rescue a setup — it only changes the reported
confidence in audit entries and Telegram messages. This reads like a bug.

It is not. A/B on real Kraken data (10 majors, 720 1h candles, in/out of
sample) moving the floor to AFTER the bonus:

| Window | floor first (current) | floor after (candidate) |
|---|---|---|
| In-sample | -0.44% · DD 0.66% · 3 trades | -2.35% · DD 3.24% · 13 trades |
| Out-of-sample | -1.20% · DD 1.02% · 3 trades | -1.62% · DD 1.60% · 7 trades |
| Full | -1.63% · DD 1.67% · 6 trades | **-3.93% · DD 4.44% · 20 trades** |

The candidate admits 14 extra trades that are net-losing and nearly triples
drawdown. Current ordering kept; the reasoning is now a comment at the call
site in `paperAutoPilot.ts` so it is not "fixed" by a later reader.

## The tuning was measured with the wrong instrument (2026-07-27)
Every production tuning constant (`AUTOPILOT_MIN_CONFIDENCE`,
`AUTOPILOT_MAX_RSI_FOR_LONG`, `AUTOPILOT_TRAILING`) was measured with
`sweepStrategy.mts` / `validateStrategy.mts`. **Both drive
`runLivePipelineBacktest`, not the `PaperAutoPilot` that actually trades.**

On identical inputs (5 majors, 720 1h candles, same parameters):

| Harness | Return | PF | Trades |
|---|---|---|---|
| livePipeline, per-symbol, averaged | -0.002% | 0.985 | 3 |
| PaperAutoPilot, one shared account | **-0.857%** | **0.019** | 3 |

Same three entries, opposite verdicts. The cause is **exit granularity, not
position sizing**: livePipeline checks exits intrabar (`low <= stop`,
`high >= target`); the autopilot only ever sees candle closes. On ADA the
backtest booked a take-profit at 0.1584 the agent never saw — it exited at a
close of 0.1529 on the trailed stop. With few trades one such flip moves the
profit factor fiftyfold.

Intrabar is correct for a system with resting exchange orders. This agent polls
and acts on a close, so intrabar overstates what it can capture, on winners
especially. Added `scripts/validateAutopilot.mts` — replays the real autopilot
over the real 10-symbol universe with the real risk limits. **Tune against that
one**; livePipeline remains the fast approximation for sweeps.

Honest current scoreboard (full 570-bar window, 10 majors):
return **-1.63%**, maxDD 1.67%, PF 0.24, 6 trades, win 16.7%; out-of-sample PF
0.00 (0/3). The recorded +0.03% / PF 1.15 was the other harness.

**Consequence: the current parameter values are unvalidated against production
behaviour and should be re-swept with the new script before they are trusted.**
Not done here — 6 trades is far too small a sample to re-tune on without
curve-fitting, and a longer window needs a timeframe change (Kraken caps 1h at
720 candles).

## Swept on the correct harness: no configuration has an edge (2026-07-28)
Ran `scripts/sweepAutopilot.mts` — 8 configurations × 2 entry timeframes,
replaying the REAL autopilot, in-sample and out-of-sample.

**1h entry / 30 days** (buy & hold over the same window: **-3.86%**)

| Config | Full return | PF | Trades | OOS return |
|---|---|---|---|---|
| PROD (40 / 65 / 1.5-1.5) | -1.63% | 0.24 | 6 | -1.20% |
| floor 20 | -7.01% | 0.38 | 41 | -1.30% |
| floor 30 | -6.39% | 0.33 | 31 | -2.25% |
| floor 50 | 0.00% | — | **0** | 0.00% |
| rsi 55 | 0.00% | — | **0** | 0.00% |
| rsi 75 | -7.45% | 0.06 | 21 | -4.08% |
| fixed stop | -1.63% | 0.24 | 6 | -1.20% |
| trail 1.0/2.0 | -1.28% | 0.31 | 6 | -0.95% |

**4h entry / 120 days** (buy & hold: **-22.23%**) — PROD -5.79% (13 trades),
floor 20 -3.04% but -9.27% out-of-sample, floor 50 +0.24% on **2 trades**
(meaningless), everything else negative.

Two conclusions, and both matter:

1. **No configuration produces a positive absolute return** on either window
   with a usable sample. Every profit factor is below 1. The only "positive"
   entries take zero or two trades — an off switch, not a strategy. **More
   trading means more loss** (floor 20: 41 trades, -7.0%), so the per-trade
   edge is negative, not merely small.
2. **But the current tuning beats buy-and-hold on both windows** — by 2.2
   points over 30 days and 16.4 points over 120 — essentially by staying in
   cash through a falling market. Configs that trade more *underperform* the
   benchmark. Capital preservation is real; demonstrated edge is not.

**Nothing was re-tuned.** Nothing won, and the current settings are already the
least-bad — the direction that helps is "trade less", whose limit is "do not
trade". This also explains the original tuning's apparent gain from raising the
floor 20 to 40: it cut exposure to a losing signal rather than improving it.

The readiness gate correctly blocks real money on this record (requires PF ≥
1.2 and a positive return; actual PF 0.24, negative). **The open question is no
longer parameters — it is whether the signal itself has an edge.**

## Shadow evaluation: forward-testing candidates for free (2026-07-28)
The sweep established that no parameter setting of the current signal has an
edge, and that hunting one across a 30-day window manufactures an illusion.
The honest alternative is FORWARD testing, so that is what now runs.

`src/core/autopilot/shadowEvaluator.ts` runs candidate strategies alongside the
real account on every cloud cycle. Each gets a full `PaperAutoPilot` cycle with
its **own** portfolio, positions, journal, audit log and kill switch, namespaced
inside the same state file via `PrefixedStore`. Candidates decide on live bars
as they arrive, building records they cannot have been fitted to.

Two primitives make it safe and free:
- **`PrefixedStore`** — namespaced view over a `KeyValueStore`. The engines all
  persist under fixed keys, so without it two instances silently overwrite each
  other. `keys()` returns unprefixed keys, so a candidate cannot reach a
  sibling's data.
- **`CachingSource`** — memoises `getCandles` for the duration of one cycle, so
  N candidates cost the requests of one. Failures are never cached (a transient
  error must not poison the cycle) and the cache is cleared per cycle, never
  time-based — serving a stale price to a strategy about to decide is exactly
  the bug this must not add.

Guarantees covered by tests: the real account's state, positions and kill
switch are provably untouched; a candidate with a blank or duplicate key is
rejected loudly rather than silently sharing a record; one failing candidate
never takes the run down.

Current candidates deliberately differ in IDEA, not in nearby values of one
knob (nearby values of a losing signal all lose): `live-mirror` (production
baseline, always present for like-for-like), `no-confirm` (what the 4h gate
contributes), `fixed-stop` (what trailing contributes), `high-conviction`
(whether selectivity alone helps).

Read the scoreboard with `npx tsx scripts/shadowStandings.mts`. It refuses to
rank until a candidate clears 20 trades, so an early lead cannot be mistaken
for a result. Verified end to end against live Kraken: 4 isolated namespaces,
real account untouched, state file ~4 KB.

## Mean reversion is the first idea with a real edge (2026-07-28)
Parameter space was exhausted (see above): every setting of the production
MOMENTUM signal loses, and more trading loses more. So the search moved to
IDEA space. `PaperAutoPilot` gained an optional `evaluate` hook; two new
families live in `src/core/signal/alternativeSignals.ts`. Everything downstream
(risk sizing, caps, exits, ATR stop/target geometry) is identical, so families
are judged purely on WHEN they enter.

**1h entry / 30 days** — buy & hold **-3.49%**

| Config | Return | PF | Trades | OOS return | OOS PF |
|---|---|---|---|---|---|
| **MEAN-REVERSION** | **+0.660%** | **1.578** | **24** | **+0.677%** | **2.012** |
| MEAN-REV fixed stop | -1.312% | 1.054 | 23 | +0.091% | 1.471 |
| PROD momentum | -1.628% | 0.244 | 6 | -1.198% | 0.000 |
| BREAKOUT | -6.980% | 0.222 | 31 | -0.474% | 1.159 |
| (every other momentum setting) | negative | <1 | — | negative | — |

**4h entry / 120 days** — buy & hold **-22.10%**. MEAN-REVERSION **-4.232%,
PF 0.222, only 8 trades** (OOS +1.089%); BREAKOUT -8.349%; all momentum negative.

Mean reversion is the **only** thing measured all session with a positive
absolute return, PF > 1, a usable sample, AND a positive out-of-sample half —
with OOS *better* than in-sample, which is the opposite of the overfit
signature. It beats buy-and-hold by 4.2 points on 1h and by 18 points on 4h.
Breakout is not interesting: negative on both windows.

**NOT shipped to production, deliberately.** The bar set before running was
"wins on both windows, out-of-sample". It does not — the 4h window is negative.
That result is arguably inconclusive rather than a refutation (8 trades, below
the 20-trade bar, because the setup is rarer on 4h bars), but "the disagreeing
evidence is probably noise" is exactly the reasoning that ships curve-fitted
strategies. One 30-day window is not a basis for risking money.

Instead it is now a **shadow candidate**, accumulating a forward record on live
bars it cannot have been fitted to. If that record holds up over the coming
weeks, it is the candidate to promote — and that decision will rest on
out-of-sample evidence rather than on a backtest.

## Fold robustness kills the mean-reversion edge (2026-07-29)
Goal for the session was "make it ready for real money". The survey started
from the live journal (24 closed trades, PF 0.34) rather than from a backtest,
and the diagnosis was arithmetic: **realized R:R is 1.16:1 while a 20.8% win
rate needs 3.80:1 just to break even.** Costs are **71% of the total loss**
(238 of 336 EUR over 24 trades). Two more journal facts:

- **The trailing stop is dead code in production.** It arms at 1.5R; the median
  stop distance is 1.72%, so it needs a **+2.58%** excursion. Exactly **1 of 24**
  trades ever got there.
- **Confidence is not predictive.** The two highest-confidence entries (40.1,
  39.8) both lost; the best trade scored 25. Raising the floor does not select
  winners, it only shrinks the sample (floor 35 → 17 trades, PF 0.01; floor 50 →
  0 trades).

**A retrospective counterfactual said arming the trail at 0.6R would remove 84%
of the loss and flip 8 losers. Measuring it refuted that.** Arithmetic on
recorded MFE assumes the trade still reaches an excursion that a tight trail
would have exited before. On 10 symbols × 720 1h bars:

| Config | Return | MaxDD | Trades | Win% | PF | OOS-PF |
|---|---|---|---|---|---|---|
| **target 3R** | **-0.54%** | **0.92%** | 35 | **37.1%** | **0.40** | **0.49** |
| PROD baseline (live) | -0.71% | 1.10% | 40 | 22.5% | 0.30 | 0.36 |
| PROD no trail (control) | -0.86% | 1.25% | 40 | 22.5% | 0.31 | 0.30 |
| trail 0.6/0.6 | -0.76% | 0.98% | 51 | 25.5% | 0.17 | 0.21 |
| trail 0.5/0.5 | -0.92% | 1.01% | 57 | 15.8% | 0.04 | 0.06 |
| target 6R / 8R | -1.11% / -1.22% | — | 38 | 10.5% / 7.9% | 0.18 / 0.13 | 0.28 / 0.08 |

Early trailing is **worse**, not better: trade count rises (40 → 57) and win
rate falls (22.5% → 15.8%) because the tight stop is whipsawed out before the
move happens. Wider targets are also worse — the target simply is not reached.
The only improvement was the **opposite** of the hypothesis: a *closer* target.
All 20 configs stayed negative while buy & hold returned **+4.57%**.

### The new gate: `scripts/foldRobustness.mts`
A single full-window PF is cheap to manufacture. This splits history into
consecutive non-overlapping folds (each with its own warm-up prefix, so a fold
cannot borrow bars it is meant to exclude) and reports pooled PF **per fold**.

| Candidate | fold1 | fold2 | fold3 | folds PF>1 | all PF |
|---|---|---|---|---|---|
| PROD (live today) | 0.00 | 0.49 | 0.27 | **0/3** | 0.30 |
| PROD target 3R | 0.14 | 0.45 | 0.40 | **0/3** | 0.40 |
| MEAN-REVERSION | 0.14 | 0.48 | 0.38 | **0/3** | 0.57 |
| MEAN-REV fixed stop | 0.20 | 0.48 | 0.35 | **0/3** | 0.53 |
| BREAKOUT | 0.00 | 0.78 | 0.35 | **0/3** | 0.45 |

**Nothing clears PF 1 in any fold.** The mean-reversion result recorded above
(PF 1.578, OOS-PF 2.012) does not survive: a single mid-point split can pass on
one lucky stretch, three folds cannot. The decision not to promote it was
right, and now rests on stronger evidence than the bar it was originally held
to. Keep it as a shadow candidate; do not promote on backtest evidence.

### Nothing shipped to the strategy, deliberately
`target 3R` is better than live on **every** measured axis including
out-of-sample — and was still **not** shipped, for two reasons. It fails the
fold gate above (0/3), and `atrTargetMultiple: 3` over `atrStopMultiple: 2`
gives rewardRisk of exactly **1.50**, sitting precisely on
`DEFAULT_RISK_LIMITS.minRewardRisk` (1.5). The check is `rewardRisk <
minRewardRisk`, so it passes today by zero margin: any later nudge to that limit
would silently mute the entire agent. Shipping a losing config onto a rejection
boundary is not capital protection.

**What shipped is measurement capability, not strategy:**
- `livePipeline` gained an optional `evaluate` hook, mirroring the one
  `PaperAutoPilot` already had, so the FAST backtest rig can compare signal
  families (previously only the slow autopilot rig could). Default path
  unchanged; covered by three tests including a default-equivalence test.
- `scripts/foldRobustness.mts` — the per-fold stability gate.
- `scripts/sweepStrategy.mts` widened from 5 to all **10** traded symbols, and
  its grid re-pointed at the exit side per the journal diagnosis.

### Honest state of real-money readiness
2 of 6 criteria met (`trades` 24/20, `drawdown` 5.2%/10%). Unmet: `days`
(13/14), `profitable` (-3.37%), `benchmark` (-4.24% vs BTC), `consistency` (PF
0.34, needs 1.2). **No configuration measured to date has a positive edge on
real data**, so the gap to real money is a strategy-discovery problem, not a
tuning or engineering one. The forward test is the only instrument that can
settle it, and at 1–2 trades per candidate per two days it needs roughly 40 days
to reach a 20-trade sample. Shadow records started **2026-07-28** (the main
journal starts 2026-07-14; the shadows are newer, not reset).

## There is no raw edge — fees are not the cause (2026-07-29)
Continuation of the fold-gate work above, extending the search along the two
axes it had not covered: exit GEOMETRY beyond what was swept, and TIMEFRAME.
Both were refuted, and then a third measurement made the first two moot.

**Trend-following geometry — refuted.** Every trail tested previously armed
EARLY (0.4–1.0R) and was whipsawed out, so the untested shape was the classic
opposite: ride far, protect only after the move is already large. Far target
(12R/20R) with a late trail (arm 2–3R, trail 1.5–2R) is the **worst** result
recorded: PF 0.04–0.11, 0/3 folds. Trade count barely moves (38–39 vs 40), which
locates the failure precisely — the entries are the same, only the exits differ,
and no exit arrangement rescues them. Combined with the earlier sweep this now
covers tight/wide stops, near/far targets, and early/late/absent trailing.

**Daily bars — refuted.** Motivated by cost-to-move ratio: cost is fixed per
round trip (~0.6%) while move size is not, so on 1h bars (~1.7% moves) cost eats
~35% of the risk unit while on 1d bars it is a far smaller drag. 720 daily bars
is also ~2 years across several regimes, which makes folds genuinely
independent rather than three views of one month. `foldRobustness.mts` gained
`ENTRY_TF`/`CONFIRM_TF` arguments for this. Result on 1d/1w: everything still
fails. BREAKOUT scored **1/3** (fold2 PF 1.40, but 0.21 and 0.13 either side) —
single-regime luck, exactly what the gate exists to catch.

### The decisive measurement: cost sensitivity
The remaining open question separated two very different worlds — is there a
real edge that fees consume, or no edge at all? Same candidates, three cost
levels, including **frictionless**:

| Candidate | PF @ 0.3%/side | PF @ 0.15%/side | PF @ **zero cost** | folds>1 @ zero |
|---|---|---|---|---|
| MEAN-REVERSION | 0.57 | 0.79 | **1.11** (ret +0.06%) | 1/3 |
| PROD (live) | 0.30 | 0.44 | **0.66** | 1/3 |
| BREAKOUT | 0.45 | 0.63 | **0.89** | 1/3 |
| PROD target 3R | 0.40 | 0.57 | **0.81** | 1/3 |
| TF far + late trail | 0.10 | 0.15 | **0.21** | 0/3 |

**At zero cost nothing clears the gate.** The best candidate returns +0.06% over
30 days — indistinguishable from flat — and is still unstable at 1/3 folds.

Halving cost lifts PF by roughly 50% (PROD 0.30 → 0.44 → 0.66), so the drag is
real and worth quantifying. But it starts from 0.30 and cannot reach 1.2:
**fees turn "no edge" into "clear loss"; they do not create the loss.** This
rules out the entire class of cost-reduction fixes — maker/limit orders, lower
frequency, a cheaper venue — as a *path to profitability*. They improve a losing
system; they cannot make it a winning one.

### Scope of what has now been refuted
3 timeframes (1h, 4h, 1d) × 3 entry families (momentum, mean-reversion,
breakout) × ~25 exit configurations, on the 10 traded majors, at 3 cost levels,
every result fold-validated. Plus, separately measured and rejected the same
week: 5 additional altcoins (BCH/ATOM/NEAR/UNI/ALGO — aggregate PF 0.31), and
confidence floors 20/30/35/40/50.

**Conclusion: the standard-TA signal vocabulary in `marketScanner` has no
exploitable predictive content on long-only crypto majors, independent of
execution cost.** Further tuning inside this framework is not a promising use of
effort, and that is a measured statement rather than a guess.

Directions that remain genuinely untested, in descending order of promise:
1. **Cross-sectional relative strength** — rank the 10 majors against each other
   and hold the strongest relative to the basket. Every signal tried so far is
   absolute and per-symbol; this is a portfolio-level signal, a different kind of
   input rather than a different threshold on the same input.
2. **US equities** — the isolated Alpaca arm is built and has never been
   measured. Momentum has a far better documented record on equities than on
   crypto majors, and the arm is already isolated so it risks nothing here.
3. **Long/short or market-neutral** — long-only is structurally handicapped in a
   flat-to-down market. Architecturally significant, and raises real-money risk.
4. **Accept buy & hold** — it beat every strategy tested, in every window. A
   disciplined hold with the existing drawdown breaker may be the best
   risk-adjusted option actually available.

## Cross-sectional reversion: the first measured edge, but a lead not a finding (2026-07-29)
Acting on the ranked list from the cost-sensitivity work above, direction #1.
Every signal measured before this is ABSOLUTE and per-symbol ("is BTC strong?",
answered from BTC's own bars). On ten highly-correlated majors that fires on all
of them at once whenever the market moves — not selection, but leverage on beta,
and precisely how ADA/LINK/LTC came to stop out together on 2026-07-20. A
cross-sectional signal ranks the basket instead and holds the top K, so it is
beta-neutral by construction and its return comes from dispersion.

New harness `scripts/crossSectional.mts`. It is NOT the per-symbol pipeline —
that evaluates one symbol at a time and cannot express a ranking — so this is a
portfolio-level simulator: bars aligned across symbols onto common timestamps
(so a ranking never compares a fresh bar against a stale one), holdings kept as
quantities so they drift with price between rebalances, cost charged on the
notional actually traded. The ranking window ends `skip` bars before the entry
bar and never reads bar `i`, so it cannot see the move it predicts.

**The benchmark is deliberately not profit factor.** PF suits discrete-trade
strategies; this holds continuously. Since equal-weight buy & hold beat every
strategy measured this session, the honest bar is **beat the equal-weight basket
in every fold**.

**On 1h bars: dead.** All 11 variants lose to the basket, by 3.45 to 22.86
points, none better than 1/3 folds. Expected in hindsight — classic
cross-sectional momentum is a months-long effect, and ranking on 24–168 *hours*
with daily rebalancing measures something structurally different.

**On 1d bars (~2 years): cross-sectional REVERSION works — buying the basket's
laggards, not its leaders.** Best setting `lookback 72d / top 2 / rebalance 24d`:

| | with cost (0.3%/side) | frictionless |
|---|---|---|
| return | **+10.07%** | **+20.44%** |
| equal-weight basket | -30.97% | -30.98% |
| **edge** | **+41.04 pts** | **+51.42 pts** |
| folds beating basket | 2/3 | **3/3** |

Every momentum variant got *worse* as the lookback lengthened (lb168 → -76%)
while reversion got better — a coherent, interpretable direction rather than a
lucky cell, and it is the first result all session with a positive absolute
return alongside a large benchmark-relative edge.

### Why it is NOT promoted
A plateau scan across three axes separates a real effect from a fitted one:

| lookback (top2) | 36 | 48 | 60 | **72** | **90** | 120 |
|---|---|---|---|---|---|---|
| edge vs basket | -5.6 | -16.3 | +7.3 | **+41.0** | **+39.5** | **-50.0** |

| breadth (lb72) | top1 | top2 | top3 | top4 | top5 |
|---|---|---|---|---|---|
| edge | +31.4 | +41.0 | +22.9 | +24.1 | +10.7 |

| rebalance (lb72/top2) | reb12 | reb24 | reb48 |
|---|---|---|---|
| edge | **-1.5** | +41.0 | +8.2 |

- **Breadth is a genuine plateau** — every value positive, degrading smoothly.
  That part looks like a real effect.
- **Lookback and rebalance are knife-edge.** 120 days gives **-50**, and
  rebalancing every 12 days gives **-1.5**. A 12-day change in lookback moves the
  edge 34 points. That is the overfit signature, on two of three axes.
- **Max drawdown is 61–83%** across every variant — **7× the 10% readiness
  limit**, and disqualifying on its own regardless of return.
- **Fold 3 is -42% to -62% for every variant** (basket -47.18%). The edge comes
  entirely from folds 1 and 2; in a crash it offers no protection at all, which
  is reversion's known failure mode — the laggards are falling knives.
- Absolute return is +10% over two years while carrying 70% drawdown: a poor
  risk-adjusted outcome even where the relative edge is real.

**Status: the first direction worth pursuing further, explicitly not a
shippable strategy.** What would raise or kill it: more history than 720 daily
bars (2 years is 3 folds — too few to trust two knife-edge axes), a crash-regime
filter to address fold 3, and volatility-scaled sizing to attack the drawdown.
None of that is worth building until the parameter sensitivity is understood,
because a 34-point swing per 12 days of lookback may simply mean the effect is
not there.

## Stocks measured: positive expectancy, but far worse than holding (2026-07-29)
First measurement of the stocks arm on real Alpaca history, closing the gap that
its constants were engine DEFAULTS. Pre-stated bar, fixed before any number was
seen: **PF > 1.2 in EVERY fold AND beat the equal-weight basket.**

A first run was **void**: it requested `adjustment=raw`, and the basket of ten
mega-caps returning only +16.55% over five years gave it away (AMZN/GOOGL 20-for-1
and TSLA 3-for-1 in 2022, NVDA 10-for-1 in 2024 — a 20-for-1 split is a ~95%
single-bar collapse on unadjusted prices). Fixed to `adjustment=all`; the basket
went **+16.55% -> +173.98%**, which is the measure of how badly splits corrupted
it. The live runner read the same series, so this was a production bug too.

Clean result — 1251 1d bars (~5y), 10 symbols, live cost 0.10%/side:

| Candidate | f1 PF | f2 PF | f3 PF | folds | all PF | ret% | basket | maxDD |
|---|---|---|---|---|---|---|---|---|
| **LIVE (trading today)** | 0.76 | 2.14 | 1.46 | **2/3** | **1.77** | **+7.33** | **+173.98** | 3.88 |
| target 6R | 0.62 | 2.33 | 1.56 | 2/3 | 1.91 | +8.59 | +173.98 | 4.36 |
| rsi ceiling 65 | 1.01 | 2.21 | 1.54 | 2/3 | 1.79 | +5.52 | +173.98 | 3.85 |
| conf 40 | 0.55 | 2.35 | 3.50 | 2/3 | 2.49 | +3.42 | +173.98 | 1.99 |
| MEAN-REVERSION | 0.97 | 3.59 | 2.47 | 2/3 | 2.02 | +2.93 | +173.98 | 2.32 |
| BREAKOUT | 0.98 | 3.12 | 1.66 | 2/3 | 1.99 | +7.76 | +173.98 | 3.83 |

Basket per fold: **-10.02%, +117.80%, +28.39%**.

**The new fact: momentum has positive expectancy on US equities.** PF 1.60-2.49
for every candidate, where nothing on crypto exceeded 0.57 — the first PF above
1.2 measured all session. The asset class difference is real.

**The hard fact: it fails the bar on both counts.**
1. Every candidate is **2/3 folds**, all failing fold 1 (PF 0.55-1.01). Fold 1 is
   where the basket lost 10% — so it fails in the down regime, exactly where
   protection would be the point.
2. **+7.33% against +173.98%.** The strategy captures ~4% of buy-and-hold on the
   same ten names. Risk-adjusted does not rescue it: return/maxDD is ~1.9 for the
   strategy against >=17 for the basket.

Selection bias must be stated: these ten are today's mega-caps, chosen with
hindsight, so +174% is inflated. But the same bias inflates the candidates' PF,
so it is not a reason to discount the gap.

**Conclusion: the arm as configured is strictly worse than holding the same ten
stocks, and is not a path to real money.** Nothing promoted. The structural
reason is visible in the numbers — ~200 trades and a 3.9% max drawdown against a
basket that tripled: the strategy is out of the market or capping winners
through most of a large uptrend. Anything worth trying next has to hold, not
trade: no fixed target, exit only on trend failure. Note that far targets were
already tested here (6R -> +8.59%) and on crypto (#31, worst result recorded), so
widening the target alone is not it.

## Trend-exit measured: the hypothesis was half right, and half wasn't (2026-07-29)
Acted on the diagnosis from the stocks measurement above: ~200 trades and a
3.9% drawdown against a basket that tripled reads as "sits out, or caps
winners, through most of the uptrend." The proposed fix was to hold through
trend instead of exiting at a fixed target — `livePipeline` gained an optional
`trendExit` (close < trailing EMA, protective stop-loss unchanged and still
checked intrabar first) and `measureStocks.mts` gained 5 candidates to test it.

**Result at live cost (0.10%/side), same 1251 1d bars / 10 symbols / 3 folds:**

| Candidate | f1 PF | f2 PF | f3 PF | folds | all PF | ret% | basket | maxDD | trades |
|---|---|---|---|---|---|---|---|---|---|
| LIVE (fixed target) | 0.76 | 2.14 | 1.45 | 2/3 | 1.76 | +7.31 | +174.03 | 3.88 | 203 |
| trend-exit EMA10 | 0.99 | 1.66 | 1.54 | 2/3 | 1.51 | +4.08 | +174.03 | 4.13 | 300 |
| trend-exit EMA20 | 1.04 | 2.55 | 1.49 | 2/3 | 1.94 | +6.47 | +174.03 | 4.27 | 170 |
| **trend-exit EMA50** | 1.10 | 4.00 | 2.08 | 2/3 | 2.72 | **+8.76** | +174.03 | 4.91 | 110 |
| trend-exit EMA20 rsi65 | 0.97 | 2.35 | 1.74 | 2/3 | 1.98 | +4.92 | +174.03 | 4.21 | 144 |
| trend-exit EMA20 conf40 | 0.88 | 2.28 | 2.26 | 2/3 | 2.27 | +2.24 | +174.03 | 2.37 | 57 |

**The hypothesis does not hold.** Even the best variant (EMA50) only reaches
+8.76% — captures ~5.0% of the basket, against LIVE's ~4.2%. A marginal gain,
not a fix. EMA10 is outright worse (+4.08%, 300 trades — the tight EMA is
whipsawed by ordinary pullbacks). Every variant still fails the fold gate on
both counts: 2/3 folds (all fail fold 1, same as everything measured this
session), and none within reach of the basket.

**Why holding longer once IN a trade did not unlock the run: the entries are
still the bottleneck, not the exits.** EMA20 still produces 170 trades over 5
years — nowhere near "buy once and hold." The entry criteria (RSI ceiling,
confidence floor, momentum signal) are still selective and still get exited on
ordinary pullbacks below the EMA, so the strategy is still in and out through
most of the run rather than continuously invested. Changing only the exit
mechanism cannot fix a problem that is upstream of it.

Drawdown also moved the wrong way for the best variant (3.88% -> 4.91%):
holding longer per trade means give-backs are individually larger even though
there are fewer of them, which is the expected trade-off and does not net out
favourably here.

**Conclusion: trend-exit is not the fix, and is not promoted.** The remaining
untested lever, if this is pursued further, is entry frequency/selectivity
itself — a mechanism that stays invested through ordinary pullbacks rather
than one that exits and re-enters on every EMA cross. That is a different
question from "when do we take profit" and has not been measured.

`src/core/backtest/livePipeline.ts` keeps the `trendExit` option (tested,
inert by default) as a capability for measuring that or related ideas later;
nothing in production reads it.

## Learning analysis is display-only (2026-07-28)
`confidenceCalibration`, `exitReasonBreakdown`, `efficiencyReport` and
`strategyBreakdown` exist in `src/core/feedback/performanceFeedback.ts` and are
consumed by exactly ONE caller: `positionsView.ts`, a UI panel. **Nothing feeds
back into any trading decision.** The agent analyses and displays; it does not
adapt. Wiring calibration into sizing or entry selection is the obvious next
step for the "learn and understand" goal, but it needs enough closed trades for
the buckets to be signal rather than noise — which is what the shadow records
are now generating.

## History gained a P&L chart; real chart bugs fixed (2026-07-28)
David asked for a profit/loss chart on the History view (it only listed trades
as text) and for the charts in general to be audited — "not 100% correct
across all dates and types." Extracted the range-selector + candle/line +
crosshair chart machinery out of `valueView.ts` into a shared
`src/ui/equityChartPanel.ts` so History and Portfolio value render from one
implementation. Screenshot-audited `src/ui/charts.ts` across candle counts
5/15/25/30/60/150 and both modes (real code + real CSS, headless Chromium),
which surfaced 3 concrete bugs beyond the earlier "no further defects found"
pass:
- `calculateEMA` fabricated a wrong average at an out-of-bounds index whenever
  `values.length < period` — silently rendered as an invisible single-point
  path. Hits the Portfolio/History chart almost always (its ~30-candle target
  bucket count is under EMA50's period=50). Now returns `undefined` until
  there's genuinely enough history.
- First x-axis date label was losing its leading character (confirmed:
  rendered "4/11" instead of "14/11") — centered text at the left padding
  edge extended past the viewBox's `x=0` and got clipped. Edge labels now
  anchor start/end instead of middle.
- Removed MACD histogram bars (a comment claimed "not rendered... due to
  space" while the code rendered them anyway, overlapping volume bars/labels)
  and fake "RSI level bands" (static 30/40/30 price-range slices, not derived
  from any real RSI value). 10 new tests in `tests/ui/charts.test.ts` (charts.ts
  had zero coverage before this).

## Cloud autopilot runner gained test coverage (2026-07-28)
`server/autopilotRunner.mts` — the headless script driving every real
(simulated-money) trade decision and Telegram alert — had zero tests. It ran
`await main()` unconditionally at module top level, so importing it would
kick off a live cycle. Both the daily-digest and weekly/monthly-report skip
bugs (fixed earlier) were only ever caught by manual review — exactly what
missing coverage lets back in. Guarded `main()` behind an entrypoint check
(no-op on import, runs exactly as before when invoked directly via `npx tsx
server/autopilotRunner.mts`, as the workflow does — verified by running it
end to end against a scratch state path: one real cycle + shadow evaluation
both completed normally). Exported `localDayAndHour`, `breakerEngaged`,
`maybeSendSummaries`, `maybeSendPeriodicReports`; 10 new tests cover the
digest/report "due" gating directly, including the exact coverage-gap
scenario the earlier bugs came from.

## UI bug sweep, round 2 (2026-07-28)
Extended the file-coverage audit to everything still untested: alertChannels,
toastNotifications, loadingStates, liveTicker, coinLogo(Manifest),
backtestView, portfolioView, gridView. Found and fixed 6 concrete bugs:
- `coinLogo.ts`'s `initialsFor` capped at 3 chars past length 4, so PENGU and
  PENDLE both collapsed to "PEN" — directly contradicting its own doc comment.
  Now takes up to 4 (PENG vs PEND).
- `loadingStates.ts`: `showLoadingOverlay`'s own cleanup called the shared
  `hideLoadingOverlay()` (removes every overlay in the document), so two
  overlapping callers would have one rip down the other's still-active
  overlay. Each cleanup now removes only its own element.
- `gridView.ts`: zero candles (`ok: true`, empty array) fed `Math.min(...[])`/
  `Math.max(...[])` — Infinity/-Infinity grid bounds instead of a message.
- `portfolioView.ts`: Buy/Sell stayed enabled mid-trade, so a rapid
  double-click fired two concurrent trades. Both now disable during the call.
- `backtestView.ts` + `gridView.ts`: win rate and max drawdown are plain
  0-100% magnitudes rendered through the signed-delta formatter — a spurious
  "+" on win rate and "-0.00%" for a near-zero drawdown (`(-0.004).toFixed(2)`
  really is `"-0.00"` in JS). Now plain unsigned percentages.
`alertChannels.ts`/`toastNotifications.ts`/`liveTicker.ts` reviewed, no
concrete defects found. 11 new tests lock in the fixes.

## US stocks — fully isolated paper autopilot (2026-07-28)
David asked whether the platform could extend to stocks. Decision: extend
this app rather than build a new one, with a completely isolated stocks arm
(own portfolio in USD, own state file `state/stocks-state.json`, own GitHub
Actions workflow `stocks-autopilot.yml`) — nothing here can touch the crypto
agent that already works. Chose **Alpaca** (official, documented, versioned
Market Data API) over a free keyless alternative (Yahoo Finance's unofficial
chart endpoint — verified reachable, but undocumented and could break/get
blocked without warning), since David wants this to eventually be able to
carry real capital, where long-term stability matters more than avoiding a
signup.

**Setup needed before this runs for real** (David, not yet done): create a
free Alpaca paper-trading account at alpaca.markets (no credit card), then
add two GitHub repo secrets (Settings → Secrets and variables → Actions):
`ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY`. Until then the workflow
runs on schedule, logs "Alpaca credentials not configured", and exits
cleanly — no error, no crash, nothing to fix.

Built: `AlpacaStockSource` (mirrors `krakenPublic.ts`'s retry/error style,
plugs into every existing engine unchanged since they were already
asset-agnostic), `isUsMarketOpen()` (NYSE hours gate, ignores holidays — a
known simplification, fails safe: a missed holiday just wastes one cycle,
never causes a wrong trade), `server/stocksRunner.mts` (entrypoint-guarded
from the start, unlike the crypto runner which needed that retrofitted),
a new "Stocks" tool tab (Tools → Stocks) reusing the same equity chart
component as History/Portfolio value (now takes a `currencySymbol` option,
default `€` unchanged, stocks passes `$`).

**Strategy constants are NOT measured** — the engine's permissive defaults,
explicitly documented as a placeholder. Unlike crypto's
`AUTOPILOT_MIN_CONFIDENCE`/`AUTOPILOT_MAX_RSI_FOR_LONG`/`AUTOPILOT_TRAILING`
(each backed by a real sweep on Kraken history), there is no real Alpaca
history yet to measure against. Once the key is live, running the
`sweepStrategy.mts` equivalent on real stock history is a prerequisite
before trusting any specific number here — measure, don't guess applies to
this asset class exactly as it does to crypto.

## Stocks promoted to a primary nav tab (2026-08-03, PR #40)
David reported he couldn't find the stocks agent in the app, even though it
was live and trading (confirmed via Telegram notifications and the committed
`state/stocks-state.json`). Root cause: pure discoverability, not a data bug
— Stocks was one tile among eight in the Tools grid, while crypto gets three
dedicated primary bottom-nav sections (Home, Markets, History). Moved Stocks
to the primary bottom nav (5th icon after History) for the same visibility
as crypto; removed the now-redundant Tools → Stocks tile/panel. Gave
`renderStocksView` the same pause/resume lifecycle as `renderHistoryView`
(stops its 60s poll when the tab isn't active) — it previously ran an
uncleared `setInterval` since it was never treated as a paused-when-inactive
primary view. Verified in a headless browser via `?demo=1` (this sandbox has
no outbound network to Kraken/GitHub raw content, so real-data navigation
couldn't be tested end-to-end directly — confirmed instead that ALL nav
items, including pre-existing ones like Markets, hang identically without
`?demo=1` here, isolating the blocker to this sandbox's network policy, not
the change).

## Stocks on Home + a Stocks Markets list (2026-08-03, PR #41)
David asked for stocks to have the same visibility and market-price coverage
crypto already has on Home — "really everything," including live prices for
all markets. One hard constraint shapes the answer: Alpaca requires a secret
key on every request (unlike Kraken's fully public API), so the browser can
never call it directly without exposing that key to every site visitor —
non-negotiable per this repo's own secrets rule. Asked David how to proceed;
he deferred to "whatever's best," so this went with the safe, no-new-infra
option over building a secret-holding proxy server.

`stocksRunner.mts` now records a per-symbol price snapshot for all 10 curated
stocks (not just symbols with open positions) into `state/stocks-state.json`
as `market-snapshot`, each cycle — day-over-day change computed against a
per-symbol UTC-day anchor, mirroring `PortfolioEngine`'s own `dayAnchor`
pattern. This stays entirely inside the existing "committed state file,
read-only, no keys" architecture already used for every other cloud-state
field — no new server endpoint, no new attack surface.

`cloudState.ts` parses the new field. Home gained a Stocks equity hero (cash +
positions valued at entry price — no live per-symbol feed on Home, see below)
and a Stocks markets strip, placed right after crypto's own Markets section.
The Stocks tab itself gained a Markets section listing all 10 symbols with
price + day change.

**Honestly not tick-by-tick real-time** like Kraken's public feed — it updates
on the agent's own cycle cadence (~15-30 min during US market hours only).
That is the safe ceiling without adding a secret-holding proxy; a real-time
option was offered and explicitly not chosen.

## Measured the 40 candidate stocks: none promoted to trading (2026-08-03)
David approved a two-part plan for stocks: (A) broaden the browsable list to
50 symbols for display (shipped, PR #42), (B) measure the 40 candidates
before adding any to the actually-traded list (PR #43 built the harness; this
entry records the real result from running it).

`npx tsx scripts/measureStocks.mts 1d candidates` ran in GitHub Actions
(where the Alpaca credentials live) against all 40 browsable-only symbols,
~5 years of daily bars each, the same 14 configs and fold-robustness gate
already used on the 10 traded majors. Full log: run 30849383535.

At live cost (0.10%/side): two configs clear the per-fold PF gate —
**MEAN-REVERSION (3/3 folds, PF 1.60)** and **BREAKOUT (3/3 folds, PF
1.32)**. Everything else fails on folds alone (1/3 or 2/3), same pattern as
the existing 10.

**Both fold-passing configs still fail the bar's second half.** The 40-stock
basket returned **+96.35%** buy-and-hold over the period; MEAN-REVERSION
captured **+2.42%** and BREAKOUT **+3.07%** — roughly 2-3% of what simply
holding the basket would have earned. This is the same shape already found
on the current 10 traded majors (PF can clear 1.2 while absolute return stays
a rounding error next to the benchmark) — not a new finding, a confirmation
that it generalizes to more symbols too.

**Conclusion: none of the 40 candidates are promoted.** `CURATED_STOCK_INSTRUMENTS`
(the traded list) is unchanged, still the original 10. This mirrors the
crypto side's own honest "no" from earlier (5 candidate altcoins, none
promoted) — expanding the traded universe is not where the edge (if any)
is going to come from; the underlying entry/exit framework is the
bottleneck, on both asset classes, at any breadth tried so far.

## Visual design elevated across the whole app (2026-08-03, PR #44)
David asked for a much more professional, higher-quality look everywhere.
Reworked the design system in `styles.css` only — every class name and DOM
structure is unchanged, so nothing here touches app behaviour or any test
selector. Added a proper design-token system (colour-tinted elevation scale,
radius scale, a named ease-out-expo easing curve) and applied it consistently
across every card/row/button (hero, market cards, tool cards, rows, toasts,
modals), which previously had visibly inconsistent shadow/radius treatments.
Richer dark palette, refined indigo-blue accent gradient (was a flat single
blue), tabular numerals on every price, subtle glass-panel top-highlight on
the hero card. `theme-color`/manifest updated to match. Verified visually
(headless browser, mocked state) across Home, Markets (list + detail chart),
History, Stocks, and Tools.

## Information architecture cleanup (2026-08-03)
David asked for the app's *structure* (not just its look) to be genuinely
organized rather than accreted ad hoc feature-by-feature. Audited the full
nav graph (`PRIMARY_VIEWS`/`TOOL_VIEWS` in `main.ts`, every view under
`src/ui/views/`) and found two concrete issues, both fixed:
- **Dead code removed**: `src/ui/views/positionsView.ts` (a full "Stage 5"
  position-tracking screen, 655 lines + its own 161-line integration test)
  was imported in `main.ts` but never wired to any route — superseded long
  ago by the Portfolio tool. Deleted both files and the stale import.
- **Tools menu regrouped**: the 7 tool cards were flat, same-weight buttons
  with no indication that several are the same concept split apart. Grouped
  into labeled sections in `index.html` (pure markup/CSS, same `data-tab`
  routing, zero behaviour change): **Scanning** (Market Scan, Monitoring),
  **Strategy testing** (Backtesting, Validation, Grid Sim), **Account**
  (Portfolio), **Help** (Guide).
- Checked for more orphaned modules repo-wide (import-graph sweep across
  `src`/`server`/`scripts`). Only other unwired module found is
  `src/core/signal/regimeFilter.ts` — that one is a deliberate pending
  feature (built to plug into `livePipeline`'s `regimeFilter` option, tied to
  the July 2026 stop-out investigation), not IA clutter, so left untouched.
- Crypto/stocks nav asymmetry (crypto has 3 primary tabs + a hidden
  equity-detail drill-in; stocks has one combined tab) was flagged to David
  and intentionally left as-is — stocks has less surface area, forcing
  parity would add clutter for no benefit unless he asks for it later.

## Safety audit: exposure caps were sized off stale entry-price notional (2026-08-04, PR #48)
David asked for a general safety/profitability/design pass. Profitability had
already been exhaustively measured (nothing new to add — see the shadow
standings below); design/IA had two PRs shipped days earlier (#44, #45). So
this pass was a targeted correctness audit of the risk/execution path —
exactly the kind of review that previously caught the DailyLossTracker-never-
called and equity-not-marked-to-market bugs.

Found a real one, same family as the equity fix but on the other side of the
ratio: `riskEngine.ts`'s `notionalOf()` valued every open position at its
`entryPrice` for the total/per-asset/correlated-cluster exposure caps, while
the caps' denominator (`portfolio.equity`) is already mark-to-market. As a
held position runs up, the caps kept reading its stale entry-price notional —
understating true concentration and permitting MORE capital in exactly when
a position is most concentrated. Concretely: a position sized to 50% of
equity at entry that then runs up 3x reads back as 25% exposure (looks like
headroom) when its real concentration is 75% (already over the default 60%
total-exposure cap). Confirmed exploitable via the always-on total-exposure
cap in the real `PaperAutoPilot` cycle (the per-asset cap can't currently
fire live — the autopilot never re-enters an already-held symbol — but the
fix covers it too, for correctness and for other callers).

Fixed by adding an optional `currentPrice` to `OpenPosition` (defaults to
`entryPrice`, so `marketScanView.ts`'s local demo path and the validation
harness are unaffected) and wiring `paperAutoPilot.ts`'s already-fresh
`marketPrices` map through to it. Verified red-without-the-fix,
green-with-it by temporarily reverting the source change and re-running the
new test. Gate: tsc clean, 683 vitest (680 + 3 new), vite build ok.

Shadow standings checked as part of the same pass (2026-08-04): none of the
candidates clear the promotion bar yet — mean-reversion (17 trades, PF 0.58)
and breakout (21 trades, PF 0.98) are both losing; live-mirror/no-confirm/
fixed-stop have only 4 trades each, too few to read. Nothing promoted.

## Exposure cap raised 60%→80%: measured, doesn't close the BTC gap (2026-08-21)

The real-money-readiness gate flipped 5/6 criteria green; the sole blocker is
the "benchmark" criterion — the live paper account trailing plain
buy-and-hold BTC by ~17%. David asked whether that gap has a free, measured
fix. It doesn't, but one small knob was worth adopting anyway.

Extended `scripts/sweepAutopilot.mts` with a BTC-only benchmark line (it
previously only printed a 10-asset basket mean — the wrong number to judge
this specific criterion against) and three new rows, each loosening exactly
one knob on top of the exact production config (regime EMA50 + confidence-
scaled risk): a wider RSI-for-long ceiling (65→75), a wider trailing stop
(1.5/1.5→2.5/2.5), and a higher total-exposure cap (60%→80%). Ran against
real Kraken history, both the 30-day (strong BTC uptrend, +17.84%
buy-and-hold) and 120-day (flat/down, BTC +0.25%) windows, in-sample +
out-of-sample.

Result: no free lever closes the gap. In the uptrend window, production was
+9.80% (zero losing trades); the best variant (exposure80) reached +10.70% —
+0.90pp, against an ~8pp gap. Widening RSI made it worse (+9.45%, and
introduced real losing trades for the first time). In the flat/down window,
production already BEATS BTC (+1.81% vs +0.25%); RSI-widening there is a
real loss (-2.39%), while trailing/exposure widening are exactly neutral
(never actually binding in that window). The gap is the accepted, structural
cost of a risk-managed strategy that isn't 100%-invested during a strong
trend — not a bug, and not something this sweep found a way around.

Adopted only the exposure-cap widening (`AUTOPILOT_RISK_LIMITS` in
`paperAutoPilot.ts`, wired into `server/autopilotRunner.mts`): no downside
in either window, a small upside in one, and per-position/open-position
caps are unchanged so no single trade can size up any further than before.
Explicitly NOT sold as fixing the benchmark criterion — it doesn't, and
closing that gap for real would mean giving up meaningfully more of the
downside protection this design was built for, a tradeoff not yet made.
While fixing this also caught and fixed a real display bug in the sweep
script itself: `tradeAnalytics`'s `profitFactor` is `null` (not 0) when a
run had zero losing trades, but the script printed that as `0.000` —
reading as the worst possible score when it's actually the best. Several
production-baseline rows hit exactly that case and would have been misread.
Now renders as `∞`.

## Important Decisions
- Autonomous improvement loop (CronCreate ~every 5h) resumes after usage resets;
  David pre-approved changes — no approval prompts.
- Real money remains OFF until the readiness gate is green AND an approval flow
  exists. Measure-don't-guess for every strategy change.
- Crypto/stocks nav asymmetry (crypto: 3 primary tabs + hidden value drill-in;
  stocks: 1 combined tab) is intentional, not IA debt — David asked to equalize
  it (2026-08-03), evaluated and declined: forcing parity means either 2 more
  bottom-nav slots (worse phone UX, 5→7 items) or per-symbol historical charts
  for stocks, which needs either bloating the committed state file with candle
  history for 50 symbols each cycle (more Alpaca calls, more rate-limit risk)
  or a new secret-holding proxy — the exact infra the snapshot design was
  built to avoid. David agreed to leave it. Revisit only if the traded stock
  list itself grows enough (via measurement) to justify the split.
- Alpaca's secret key must never reach the browser — the stocks side only
  ever exposes what the server already wrote to the committed state file.

## maxOpenPositions widening: measured, inconclusive — not adopted (2026-08-21)

Same day as the exposure-cap widening above, David asked whether raising
`maxOpenPositions` (5) could help too — motivated by a real, same-day audit-
log observation: SOL and ETH (both showing HOT on the live Market Scan) were
refused not on signal quality but purely on "maximum open positions reached
(5/5)". Extended `scripts/sweepAutopilot.mts` with a `PROD live +
maxOpenPositions 8` row layered on the exact current production config
(regime EMA50 + confRisk + BTC market regime + the 80% exposure cap).

Result: identical numbers to the unmodified production row in BOTH windows
(30-day: 8.08%/6 trades; 120-day: 0.00%/0 trades) — the cap was never
actually binding in either historical replay. This is a different, weaker
result than the exposure-cap measurement: that one showed a small measured
upside with no downside. This one shows **no measured effect at all**,
positive or negative — the historical sample just never generated enough
simultaneous qualifying setups to exercise the lever, so "safe" can't
honestly be claimed from this data the way it could for the exposure cap.
The real SOL/ETH refusal from earlier today is a genuine live data point
that this particular backtest window doesn't corroborate either way.

Decided: leave it at 5, not adopted. Given the choice between (a) leave it
since the measured evidence is silent rather than supportive, (b) adopt it
anyway as an unmeasured bet, or (c) wait for more live evidence — (a) is the
only one consistent with this project's own "measure, don't guess; keep
only measured improvements" rule. Absence of a measured downside is not the
same bar as the exposure-cap change cleared (a measured, if small, upside
with no downside) — it's simply "not exercised by this data." There's also
a real, non-backtested reason for caution the sweep can't see either way:
more concurrent positions means less diversification benefit per trade and
more assets exposed simultaneously in a correlated crypto-wide selloff, even
though per-position/per-asset caps are unchanged. Capital protection over
raw profit (CLAUDE.md's priority order) tips this the same direction as the
measurement: stay at 5 until there's an actual measured case for more.

## Stocks reliability gap fixed: no internal loop (2026-08-21)

Investigating a "stocks seems to be weakening" report surfaced two separate
things. The performance dip itself (equity peak 2026-08-10 → -1.8% since)
is 3 losing trades after 3 winning ones on an 8-trade sample — ~24% odds by
chance alone on this arm's own measured 37.5% win rate. Read as noise, not
a new trend; the stocks arm's already-measured structural ceiling (positive
expectancy, PF 1.6-2.5, but only ~2-7% of simple buy-and-hold — see
"Stocks measured" 2026-07-29 above) is unchanged and not new information.

The second thing was real and fixable: `stocksRunner.mts`'s `main()` ran
exactly one cycle and exited, with no equivalent of the crypto side's
`autopilot.yml` internal-loop fix (2026-08-17, `LOOP_CYCLES`/
`STATE_COMMIT_EVERY`, same root cause: GitHub's scheduler is unreliable at
high cron frequency). Measured: despite `stocks-autopilot.yml`'s nominal
*/15-minute cron, actual gaps between recorded equity-history points during
market hours were mostly 60-110 minutes — roughly 1/4 to 1/7 of the
intended cycles were actually running. Fixed the same way as crypto: added
an internal loop (`STOCKS_LOOP_CYCLES`, `STOCKS_LOOP_INTERVAL_MS`,
`STOCKS_STATE_COMMIT_EVERY` env vars, workflow sets 24 cycles × 5 min = 120
min of coverage per trigger, comfortably past the worst gap measured) with
per-cycle mid-run git persistence, mirroring `autopilotRunner.mts`'s
`persistStateToGit` (duplicated rather than shared, per this file's own
"fully isolated" design). `isUsMarketOpen()` is now checked every cycle
inside the loop rather than once before it, so a run spanning market close
degrades to cheap no-ops instead of exiting early. This does not fix the
structural performance ceiling — it fixes how often the (unchanged)
strategy actually gets to run.
