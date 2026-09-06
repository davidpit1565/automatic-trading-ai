# PROJECT_STATE

## Revolut X comparison pass — Market Scan, Monitoring, Portfolio (2026-09-06)
Part of a 200-improvement push (split across parallel agents by screen area,
David's request); this agent's share was Market Scan/Monitoring/Portfolio
only. Did NOT re-propose anything already shipped by "Design-system
consistency pass" (2026-09-03) or "Creative upgrade pass #4" (2026-09-04,
PR #189) — table-scroll wrappers, the score fill bar, Monitoring's
stat-tiles, Portfolio's hero/stack-card rows were all left as-is except
where noted below. Verified with real Playwright screenshots at 390×844,
`?demo=1`, `vite preview`, including mid-scan/mid-monitoring states, plus
precise `getBoundingClientRect()`/computed-style checks where a screenshot
alone couldn't confirm exact pixel geometry (score-bar centering, Buy/Sell
row width). 28 confirmed, individually-verified items (one of which, #25,
turned out to already be fixed upstream by a parallel agent by the time
this branch rebased onto `main` — left in the list since it was
independently found and verified here too, with a note on where it landed):

1. **Portfolio: zero return shown as bright green, not neutral.** A fresh
   (unmoved) 10,000 portfolio's "0.00% all time" rendered `up`/green — the
   hero's manual `totalReturnPct >= 0 ? 'up' : 'down'` ternary (and its
   twin for `heroEl`'s own ambient ".hero.up" ambient glow) had no neutral
   branch, unlike this app's own `signClass` helper (already used by
   Market Scan/Monitoring) which returns no colour at exactly zero.
2. **Portfolio: zero realized/unrealized P&L, also shown green.** Same
   root cause, same `renderHero` function, two more spans.
3. **Portfolio: a position with 0.00% unrealized P&L, also shown green.**
   Same root cause, `renderPositions`.
4. **Portfolio: a round-trip trade's 0.00 realized P&L, also shown
   green.** Same root cause, `renderTrades`. All four fixed with one new
   local `pnlClass()` helper (neutral below 0.005 — real zero or float
   dust — else up/down), replacing every ad hoc `>= 0 ? up : down`.
5. **Market Scan: no empty state before the first scan.** `#scan-results`
   was simply blank until "Run scan" was clicked — every sibling screen
   (Monitoring, Portfolio) already shows an `.empty` card for its own
   "nothing yet" state; Market Scan's own "not yet run" moment never got
   one. Added the same `.empty` convention.
6. **Market Scan: no loading state while a scan is in flight.** The gap
   between clicking Run and results appearing was also blank. Now shows
   `skeletonRowsHtml(4)` (the same row-shaped skeleton Portfolio's own
   first paint already uses).
7. **Score bar was a magnitude-only fill, never a direction.** The -100..
   +100 score's fill bar (shipped in PR #189) always grew from the bar's
   left edge regardless of sign — a -80 and a +80 rendered as the
   identical shape, colour aside. Redid it as a centre-anchored diverging
   bar (bullish grows right from centre, bearish grows left), the same
   idea as the order book's own bid/ask depth bars. Verified the exact
   fill geometry via `getBoundingClientRect()` (fill's left/right edge
   lands exactly on the bar's centre pixel in both directions), not just a
   screenshot.
8. **Score bar: a score of exactly 0 was shown with a green fill.** The
   fill's up/down class used a raw `score >= 0` check while the adjacent
   number already used `signClass` (neutral at 0) — same row, same value,
   contradicting colours. Fixed as part of the bar redesign above (no
   up/down class, zero width, at score === 0).
9. **Monitoring: Watchlist's Status column was flat text.** `qualified`/
   `watch`/`none` map directly onto this app's own hot/neutral/dim
   language (used everywhere else) but were never coloured here.
10. **Monitoring: the "Last scan outcome" tile's 3 numbers were flat
    white text.** Kept as one tile (three related counts from a single
    scan reads fine together) but coloured each number (qualified=green,
    failed=red only if >0, watch=neutral) — preserved the exact substrings
    `scripts/e2e.mjs`/the integration test assert on ('qualified', etc.).
11. **Market Scan: signal/risk level values had no tabular-nums**
    (Entry/Stop/Take-profit/R-R/Size/Value/Risk%/exposure) — added to
    `.signal-levels`.
12. **Market Scan: the per-row technical-stats line had no tabular-nums**
    either (ATR/Bollinger/±DI/Stoch — six numbers in one dense line).
    Added a new scoped `.scan-detail-stats` class (not the shared
    `.status-line`, which four other screens also use).
13. **Market Scan: expandable rows had zero visual "click to expand"
    affordance** beyond a cursor-style change. Added the same down-chevron
    icon Markets' own pair-switcher already uses, rotating 180° when
    expanded.
14. **Market Scan: expandable rows were mouse-only** — a `<tr>` with a
    click handler, no `tabindex`, no `role`, no keydown handler, so a
    keyboard-only user could never open one. Added `tabindex="0"`,
    `role="button"`, and an Enter/Space handler; the parallel "Shared
    design-token pass" (below) had already listed `.scan-row:focus-visible`
    in its own shared focus-ring rule, so the ring was dead CSS until this
    row could actually receive keyboard focus at all — the two changes
    together are what makes it work end to end.
15. **Monitoring: Start/Stop buttons stayed enabled regardless of the
    engine's actual state** — clicking Start while already RUNNING (or
    Stop while already stopped) silently did nothing. Now `startButton.
    disabled = running` / `stopButton.disabled = !running`, refreshed
    every status update.
16. **Monitoring: "Scan now" never disabled itself during an in-flight
    scan** — Market Scan's own "Run scan" already does this; Monitoring's
    near-identical manual-scan button never did, so a second click could
    fire a second overlapping scan.
17. **Monitoring: watchlist row action buttons (Favourite/Remove) used
    full page-level button padding**, doubled up two-per-cell, visibly
    inflating those rows' height versus every sibling row in the same
    table. Added a compact `.table-action` modifier.
18. **Monitoring: Validation verdict text was flat grey in the Current
    Opportunities table**, despite this app already having a robust/
    caution/overfitted/insufficient-data colour taxonomy (`.verdict-panel`,
    used by Backtest/Validation) that Monitoring simply never applied.
19. **Same gap in the Opportunity History table's own Validation column.**
    Both fixed with new `.verdict-text-*` classes (text-colour variants of
    the existing tint language, since a dense table cell needs a coloured
    word, not a whole panel's background tint).
20. **Monitoring: Opportunity History's RSI/ADX used a different
    precision (0dp, raw `.toFixed(0)`) than Market Scan's own RSI/ADX
    columns (1dp, via the shared `formatNumber` helper)** for the
    identical metric. Aligned to `formatNumber`.
21. **Portfolio: Buy/Sell/Reset never actually laid out as documented.**
    The code comment already said Buy/Sell should read as a paired
    control with Reset "set apart", but all three sat in one plain flex
    row — at phone width the two ~166px pills don't fit side by side, so
    flex-wrap stacked all three vertically (confirmed via
    `getBoundingClientRect()`, not just a screenshot). Split into
    `.trade-actions` (Buy/Sell, `flex: 1` each — an actual paired
    control) plus a separate row for Reset, matching the comment's intent.
22. **Monitoring: Confidence columns were uncoloured in 3 of 4 tables.**
    Alerts already applies `signClass` to its own Confidence column;
    Current Opportunities, Opportunity History, and Watchlist's "Best
    confidence" never did, for the identical metric. Made all four
    consistent.
23. **Monitoring: the watchlist's favourite marker was a bare "★" Unicode
    glyph** — the one place in the app spelling "favourited" without its
    one existing star icon (Markets' `.star-btn`, an SVG polygon path).
    Replaced with the same icon, filled with the same `--warn` colour
    `.star-btn.active` already uses.
24. **Market Scan: a component contribution near zero could render as
    "-0.0 pts" — a signed negative zero.** `toFixed` keeps the ORIGINAL
    value's sign even once its magnitude rounds away (e.g. -0.03 → "-0.0"),
    so a genuinely tiny negative contribution displayed as a red,
    nonsensical negative zero. Snapped anything under 0.05 to a real zero
    before formatting.
25. **Shared `formatPct()`/`formatNumber()` had the identical negative-zero
    bug** (e.g. `formatPct(-0.001)` → "-0.00%") as the Market Scan bug in
    item 24 — independently found here too, but already fixed upstream by
    a parallel agent's own "Shared design-token pass" (merged to `main`
    before this branch rebased onto it: `fixedNoNegativeZero()` in
    `format.ts`), so no duplicate fix needed here. Also closes the same
    failure mode for Portfolio's own return% (item 1) for free.
26. **Monitoring: "Enable browser notifications" gave zero feedback.**
    The click handler called `requestNotificationPermission()` and
    discarded the result, even though it resolves with exactly what
    happened (granted/denied/unsupported). Wired to the app's own
    (previously unused anywhere) toast system.
27. **Market Scan + Portfolio: a double-parenthesized source name.**
    `data.source.name` is itself `"Demo data (synthetic)"`; two status
    messages additionally wrapped it in parens — Market Scan's own
    "Scanning…" line and Portfolio's post-trade confirmation — producing
    "(Demo data (synthetic))". Aligned both to the "· source: X" phrasing
    Market Scan's own post-scan message already used correctly.
28. **Portfolio: the € currency symbol was missing everywhere.** Home's
    hero always leads with a `.hero-value-currency` € span (CSS already
    had the exact styling rule for it, just unused here); Portfolio's own
    hero equity, Cash/Realized/Unrealized, Positions, Trade journal, the
    Buy/Sell confirmation message, and the Reset confirm dialog all showed
    bare numbers with no currency at all. Added a local `euro()` helper
    (mirroring Home's own, but sign-aware: "-€12.34" not "€-12.34" for a
    loss) and applied it at every EUR-denominated call site in the file.

**Flagged but NOT fixed here (out of this pass's file scope)**:
`riskEngine.ts`'s own warning string doubles the word "capped" (`size
capped: size capped by the N% ... limit`) — a genuine, minor wording bug,
but in core risk logic, not a UI file this pass touches.

Tests: updated `monitoringView.integration.test.ts`'s favourite-icon
assertion (checks for `.watch-fav-icon`, not a literal "★", matching item
23) plus 9 new tests across `monitoringView.integration.test.ts` (2:
Start/Stop disabled state, Scan-now disabled during an in-flight scan, plus
2 new assertions inside the existing manual-scan test for items 18/19/22),
`portfolioView.integration.test.ts` (3: € on the hero, neutral 0.00%
colour, € on positions/trades), and `marketScanView.integration.test.ts`
(2: bar never exceeds 50% width, keyboard Enter/Space expand +
chevron/role/tabindex). No `format.test.ts` changes needed here — item 25
was already covered by the parallel agent's own upstream tests.

Rebased onto `main` after the parallel "Shared design-token pass" merged
(PR #198) — its `format.ts`/`styles.css` changes overlapped with items 8,
14 and 25 above (both independently found the same negative-zero bug in
`formatPct`, and it separately added a shared `:focus-visible` rule that
already covers `.scan-row`): kept its versions, dropped this pass's
now-redundant duplicates, re-ran the full gate on the merged result.

Gate: `tsc --noEmit` clean, `npx vitest run` 1185 passed (net +14 over the
`main` this branched from, none weakened), `npm run build` clean. Diff
confined to `src/ui/views/{marketScanView,monitoringView,portfolioView}.ts`,
`src/ui/styles.css`, and three test files (`monitoringView`/`portfolioView`/
`marketScanView` `.integration.test.ts`) — nothing under `server/**`,
`state/**`, `src/ui/format.ts`, or trading/signal/risk logic touched.

## Markets/coin-detail design pass: 17 real, screenshot-verified improvements (2026-09-06)

David's ask: compare the app against Revolut X and ship 200 serious
improvements across the whole app, split across parallel agents by screen
area. This agent's scope: `marketsView.ts`/`markets.ts`/`charts.ts` and the
Markets-specific parts of `styles.css` only. Per this file's own prior
entries ("Creative upgrade pass #3", "Deep design pass #1/#2/#3", "True-black
Revolut X theme landed", "Design-system consistency pass"), the two-tier
pricing, sparklines, depth bars, true-black palette, hairline-grouped list,
and press states were already shipped — this pass hunted for what those
missed, not a re-proposal of any of it.

**Method**: loaded `fintech-dashboard-polish` and `apple-design`. Built
`dist/`, ran `vite preview`, and used real Playwright screenshots at 390×844
— `?demo=1` for the Markets list (all 5 category tabs, search, sort,
watchlist), and a `page.route` handler mocking Kraken's public
AssetPairs/Ticker/OHLC/Depth/Trades endpoints (same technique as this repo's
own `scripts/e2e.mjs`) for the coin-detail screen, since `?demo=1`'s
synthetic source has no order book/trades capability to show Table/Depth/
Trades/Trade with. Covered both an up coin (BTC) and a down coin (ETH,
`open > price`), all 5 view-tabs, both chart types, and all 7 ranges.
Several findings came from `getBoundingClientRect()`/computed-style
measurement on the real rendered DOM, not just looking at pixels — that's how
the scroll-position bug (#1) and the badge-crowding bug (#4) were actually
confirmed rather than guessed at.

1. **Switching coins (Prev/Next pager, or the pair-switcher menu) left the
   viewport at its old scroll position — the new coin's own header/price
   could render entirely off-screen, overlapping the fixed topbar.**
   Confirmed by measurement: open BTC, scroll down 400px (to where the pager
   actually sits after a normal chart), tap Next — `getBoundingClientRect()`
   showed `.detail-head` at `top: -45px`, and the screenshot showed a giant
   ghosted price number bleeding into the fixed topbar with no header/back
   button/star visible at all. Real Revolut X (and this app's own
   `main.ts`) always opens a new "page" at the top. Fixed: `window.scrollTo({
   top: 0 })` on a fresh detail open and on every coin switch (prev/next/
   pair-menu select), `marketsView.ts`. Verified: scripted the exact
   scroll-then-next repro after the fix — `.detail-head`'s top is now a
   normal positive on-screen value, screenshot shows a clean header.
2. **The pair-switcher dropdown (`#mk-pair-menu`) was a static block in
   normal flow, not a floating overlay** — opening it pushed the ENTIRE rest
   of the detail page (hero price, stat tiles, chart) down by its own height
   (up to 320px), confirmed on a real screenshot: the price/stats looked like
   they'd vanished, not like a dropdown had opened. The code's own comment
   says this was modelled on "Revolut X's Trade page" selector, which is a
   true floating dropdown. Fixed: `.pair-menu` is now `position: absolute`
   anchored to (and nested inside, so `top: 100%` resolves correctly) the
   now-`position: relative` `.detail-head`, with a small materialize-in
   animation, plus outside-click and Escape to dismiss (a real overlay needs
   both, which the old in-flow block never did). Verified: real screenshot
   shows the menu floating over the (unmoved) price/chart below it, and a
   `getBoundingClientRect()` check that the price row's position is
   unchanged before/after opening it; DOM test covers the nesting + both
   dismiss paths.
3. **"All 1 markets shown" — wrong plural** when a search or category
   narrows the list to exactly one result. Verified on a real screenshot
   (searching "bit" against the demo universe). Fixed: singular/plural based
   on count. Test added.
4. **The "TRADED" badge, moved to the row's secondary line by an earlier
   pass specifically to stop it truncating the coin NAME, turned out to
   crowd that secondary line (the freshness clock + symbol) down to ~6px of
   rendered width — effectively invisible, not just truncated.** Measured via
   `getBoundingClientRect()` on a real 390px row: the badge alone rendered at
   63.67px against ~87px total available for the whole line. Fixed by
   tightening the badge's own padding/letter-spacing FOR THIS PLACEMENT ONLY
   (`.market-row-id .row-sub .tag-traded`, not the shared `.tag-traded` class
   Stocks' Market panel also uses) — recovers the text to ~14.6px rendered
   width. Honest note: this is a real, measured improvement (badge
   56.06px vs 63.67px before), not a full resolution — the line is still
   tight for every TRADED coin at 390px; a bigger fix (e.g. dropping the
   redundant symbol text, or reworking the row grid) would be a larger
   change than this pass's smallest-correct-diff mandate covers.
5. **The search field had no leading search icon**, while the sort control
   right next to it has its own chevron icon — an icon-less search box next
   to an icon-bearing control is the inconsistency `fintech-dashboard-polish`
   and the task's own "icon consistency" callout both flag. Fixed: same
   inline-SVG-as-background-image technique the sort chevron already uses,
   no new DOM. Verified on a real screenshot (`.mk-search`, shared with
   Stocks' identical search field — a bonus, not a regression, there).
6. **The chart-type toggle's "Candles" button, forced-disabled on a long
   range (1Y/5Y/10Y/All), had zero visual difference from a normal,
   clickable, unselected button** — no opacity dip, no cursor change, unlike
   this same file's own `.pager:disabled` rule. Confirmed via
   `getComputedStyle` before/after: `opacity` was `1`/`cursor: pointer`
   before, `0.4`/`cursor: default` after — matches `.pager`'s established
   treatment. Verified on a real 1Y-range screenshot (Candles now visibly
   dimmed).
7. **The category tab strip (`.mk-tabs`) had no signal that it scrolls** —
   a mid-word cut ("Volu…" for "Volume") was the only hint, with no fade or
   affordance. Per `apple-design`'s "scroll edge effects, not hard dividers"
   guidance: added a `mask-image` fade at whichever edge still has
   off-screen tabs, toggled by a real scroll listener (`at-start`/`at-end`
   classes) so it's correct at both ends, not a permanent static fade.
8. **Order-book rows had no hover feedback** (every other dense row/list
   item in the app does). Added `.orderbook-row:hover`. Verified via
   screenshot: a hovered row visibly lightens against its neighbours,
   without disturbing the depth bars behind the text (which establish their
   own stacking context, per the existing z-index comment).
9. **Trades-tape rows had no hover feedback either.** Used `filter:
   brightness()` rather than swapping `background` (every row already has
   its own buy/sell gradient wash — a plain `background` override on hover
   would have replaced that tint outright, not lightened it; confirmed this
   would have been a real regression before switching approach). Verified on
   a real screenshot: a hovered row is visibly brighter, tint intact.
10. **The watchlist star had press feedback (already shipped) but no
    "it worked" moment** — favouriting a market only swapped its colour,
    with no motion distinguishing "I tapped it" from "it's now saved". Added
    a small overshoot-and-settle bounce (`.pop`, on the icon only, so it
    composes cleanly with the list star's existing `translateY(-50%)` base
    transform) on the newly-favourited transition only, both list (`.mk-star`)
    and detail (`.star-btn`), respecting `prefers-reduced-motion`. Test
    confirms the class lands on the fresh (re-rendered) button when starring
    on, and is absent when un-starring.
11. **Pull-to-refresh's "are we at the top?" guard read `.content`'s own
    `scrollTop` — always `0`, because `.content` has no `overflow` rule of
    its own and never scrolls internally; the page scrolls via the document/
    window instead.** Confirmed by `getBoundingClientRect()`: `.content`'s
    own `scrollTop` stayed `0` even after the page visibly scrolled 400px+.
    That silently defeated the guard's whole purpose (per its own doc
    comment: "never competes with normal scrolling") — a downward touch-drag
    anywhere in a long, already-scrolled list could arm the refresh
    indicator. Fixed: check `window.scrollY` instead.
12. **The coin-detail view-mode tabs (Chart/Order book/Depth/Trades/Trade)
    had no ARIA tab semantics**, unlike the category tab strip on the SAME
    file's list view, which already correctly uses `role="tablist"`/`"tab"`/
    `aria-selected`. Added the identical pattern here. Test confirms the
    roles and that `aria-selected` flips on switch.
13. **The Trade tab's Buy/Sell toggle (now genuinely functional per
    "Creative upgrade pass #3") exposed no state to assistive tech** — a
    screen-reader user gets no indication of which side is selected. Added
    `aria-pressed`, flipped on click. Test confirms both the initial state
    and the flip.
14. **Icon stroke-width crept from the established 1.8-2 family** (`.mk-star`,
    `.icon-btn`, `.view-tab`, `.star-btn`) up to 2.2 (`.pair-chevron`) and 2.4
    (`.pager` prev/next chevrons) — measured by stroke-to-size RATIO (not
    just the raw number, since these icons are smaller than the rest): 14.7%
    and 17.1% respectively, against ~9.5-10.6% everywhere else. Tightened
    both to 1.8, matching the rest of the icon family used across this exact
    screen.
15. **Switching a view-tab (Order book/Depth/Trades/Trade) gave no
    feedback while its fetch was in flight — the PREVIOUS tab's content
    stayed fully on screen, mismatched against the now-active tab icon, for
    however long the network took.** Confirmed on a real screenshot with an
    artificially delayed `/Depth` response: 800ms after tapping "Order book"
    (tab icon already showing active), the candlestick chart from the
    PREVIOUS (Chart) tab was still the only thing rendered. Fixed with the
    same fade-out/fade-in pattern this file's own range-btn/ctoggle-btn
    switches already use, generalized to whichever of `.detail-chart`/
    `.detail-nonchart` is currently on screen.
16. **The coin-detail header's own logo had no broken-image fallback** —
    `attachCoinLogoFallback` was wired for the list (`list`) but never for
    `detailView`, so a failed logo load on the detail screen showed the
    browser's bare broken-image glyph, exactly what `coinLogoHtml`'s own doc
    comment says this fallback exists to prevent. Confirmed by forcing every
    `coins/*.svg` request to fail: the list correctly fell back to letter
    tiles everywhere, the detail header's `<img>` stayed visibly broken.
    Fixed with one more `attachCoinLogoFallback(detailView)` call. Test
    dispatches a synthetic `error` event on the image and confirms the swap.

**Looked at, no defect found**: order-book/depth/trades empty states (forced
empty Kraken responses — render a clean, pre-existing `.empty` message, no
bug); a long coin name ("Ethereum Classic", 17 chars) in the detail header
(measured — no overflow, no overlap with the star button); category-tab
auto-scroll-into-view on selection (native browser focus-scroll already
handles it, confirmed via measurement — no gap worth a custom fix);
two-tier/tiered pricing on the 24h High/Low/Volume stat tiles and the Trade
tab's Amount/Price fields (deliberately flat per `fintech-dashboard-polish`'s
own reference pattern — two-tier is for the ONE hero price, not secondary
stat-tile numbers; the reference's own example markup uses a flat
`<div class="stat-value">` for exactly this).

Full gate: `tsc --noEmit` clean, `npx vitest run` 1185/1185 (1178 pre-existing
on `origin/main` + 7 new — 2 in `marketsList.integration.test.ts`, 5 in
`marketsDetail.integration.test.ts`), `npm run build` clean. Diff is exactly
`src/ui/views/marketsView.ts` + `src/ui/styles.css` + the two markets test
files (4 files) — nothing under `server/**`, `state/**`, or `src/core/**`
touched.

## Revolut X comparison pass, Stocks screens only: 10 verified fixes (2026-09-06)

One of several parallel agents on David's "compare Revolut X, ship 200 serious
improvements" round, scoped to Stocks only (`stocksOverviewPanel.ts`,
`stocksMarketPanel.ts`, `stocksLongTermPanel.ts`, plus the Stocks-specific
parts of `styles.css`) — Crypto/Home/Markets/Tools were other agents' shares.
Loaded `fintech-dashboard-polish` + `apple-design`. No Revolut X screen
recording was on disk this round (checked `/root/.claude/uploads/*/Screen
Recording*.mp4` — none present), so comparisons leaned on the distilled
skill plus cross-referencing crypto's own already-polished Markets/Home
screens (the same reference points "Creative upgrade pass #4" and "Deep
design pass #1-3" below already used for Stocks).

**Method**: `npm run build`, `vite preview` on port 4290, real Playwright
screenshots (`chromium.launch({ executablePath: '/opt/pw-browsers/chromium'
})`) at 390×844, `page.route` mocking a realistic `stocks-state.json` shape
(positions, market-snapshot, shadow-standings, benchmark-result). Screenshot
ed all 5 Stocks tabs (Overview/History/Market/Profit/Long-Term), the Market
list's category tabs + search + zero-result state, and a real mouse-hover
check via `getComputedStyle` (not just reading CSS) for item 8. One planned
fix (a loading skeleton for the Market list) was caught by its own new test
as dead code — a pre-existing synchronous `render()` call already overwrites
the loading placeholder before the browser ever paints it, so neither the
old "Loading…" text nor a new skeleton is ever actually visible; reverted
before commit rather than shipping an invisible "fix". Honest count below:
10, not the ~28-30 hoped for — three prior exhaustive, screenshot-verified
design passes already covered this exact surface (see "Creative upgrade
pass #4" and "Deep design pass #1/#2/#3" further down), so the remaining
real gaps were narrower than a first pass would find.

1. **Overview hero had no click-to-History affordance.** Home's identical
   dominant-balance hero (`homeView.ts`) is `tappable` with a "history ›"
   label and jumps to its own Value view on tap; the Stocks Overview hero
   was a static, non-interactive copy of the same component. Added
   `tappable` + the same "history ›" wording, wired to activate this hub's
   own History sub-tab (`.hub-tab[data-hub="history"]`, found via
   `container.parentElement` rather than a global query, which would hit
   Crypto's identical tab instead since both hubs' DOM persist at once).
   Verified: screenshot before/after + a DOM test asserting the click fires
   the tab's own click handler.
2. **"Open positions" heading was missing its SIMULATED tag.** Home's
   identical heading reads `Open positions <span class="tag-sim">SIMULATED
   </span>`; Stocks Overview's copy had no tag at all. Added it. Verified:
   screenshot + DOM test.
3. **A real "vs S&P 500" benchmark was computed server-side and silently
   dropped.** `server/stocksRunner.mts` already writes a `benchmark-result`
   key (`{label: "S&P 500 (SPY)", portfolioPct, assetPct}`, already
   percentage-scaled — confirmed from the server's own `((equityNow -
   anchor.equity) / anchor.equity) * 100`) to the real committed
   `stocks-state.json`, but `cloudState.ts`'s `benchmark` field only reads
   the crypto-shaped `benchmark-anchor.btc`; Stocks' anchor is keyed `spy`,
   so `state.benchmark` was always `null` for Stocks and the number had
   nowhere to render. Added `CloudBenchmarkResult`/`benchmarkResult`
   (purely additive — crypto's raw state has no `benchmark-result` key, so
   this is `null` there exactly as before) and a `hero-bench` line on
   Overview mirroring Home's own "vs Bitcoin" wording exactly (`vs S&P 500 —
   agent +0.63% · SPY +0.90% · leading`). Touches the shared `cloudState.ts`
   — deliberately, since it's additive-only and doesn't change any existing
   Crypto-facing field or behavior. Verified: unit tests for the parser
   (well-formed + malformed/absent) and a DOM test for the rendered line.
4. **Market list rows said the static word "live" instead of a real
   timestamp.** Crypto's identical row (`marketsView.ts`) shows `formatClock
   (updatedAt) · SYMBOL`; Stocks showed a hardcoded "live"/"no data yet"
   string with no actual freshness info despite already having an
   `updatedAt` on every snapshot. Switched to `formatClock(snap.updatedAt)`,
   wrapped in the same `.row-sub-text` span crypto uses (for consistent
   ellipsis/overflow handling). Verified: screenshot (shows "01:19" instead
   of "live").
5. **Market list rows never flashed on a price change.** Crypto's list
   flashes green/red (`.flash-up`/`.flash-down`, reusing existing CSS) on a
   symbol whose price actually moved since the last render; Stocks re-
   rendered every 60s poll with zero visual cue anything had changed. Added
   the same `shownPrices` tracking crypto's `rowHtml` uses. Verified: a DOM
   test that changes the mocked price between two `resume()` cycles and
   asserts the `flash-up` class appears only on the second render.
6. **The empty/no-results message was one generic string for every case.**
   Crypto's list echoes the actual search text or category name back
   ("No markets match "aa"." / "No markets in Gainers right now.");
   Stocks showed "No matching stocks." unconditionally, so a user got no
   confirmation of what actually came up empty. Matched the exact pattern.
   Verified: DOM test for the query-echo case.
7. **No status/freshness line under the Market list at all.** Crypto's
   list shows "Live · N markets · updated HH:MM" below the rows; Stocks had
   no equivalent. Added "Live · N/M stocks priced · updated HH:MM".
   Verified: screenshot + DOM test.
8. **Market rows carried a misleading hover highlight.** Stocks' rows are
   deliberately a plain non-interactive `<div>` (no per-symbol detail view
   — see the file's own header comment), unlike crypto's real `<button>`
   rows, but both shared `.market-row:hover`'s fill, so hovering a Stocks
   row still glowed as if it were tappable. Added a narrowly-scoped
   `#stocks-market-list .market-row:hover { background: transparent; }`
   override rather than touching the shared rule crypto still needs.
   Verified with a real `pointer.hover()` + `getComputedStyle` check
   (background stayed `rgba(0,0,0,0)` before and after hover), not just
   read from the CSS.
9. **Long-Term's "Track record" used the wrong list component.** Win
   rate/Profit factor were rendered as generic `.row` list rows (the
   component meant for an actual scrollable list of trades/positions);
   every other "at-a-glance summary of a few related numbers" in the app
   (Grid's equity/return, Validation's fold summary, Backtest's comparison
   summary) already uses the `.stat-row`/`.stat-tile` "big number + small
   label" component. Converted the two stats to match, removed the now-
   dead `row()` helper. Verified: screenshot + existing text-assertion
   tests (unchanged, still pass against the new markup).
10. **Empty-positions copy was flatter than Home's.** Home's identical
    empty state reads "Holding cash and waiting for a good setup."; Stocks
    read "Holding cash — no open positions." — a small, safe copy-parity
    fix, no test depended on the old string.

**Rejected after investigation, not fixed:** a loading skeleton for the
Market list (dead code — see Method above); `.hero.up`/`.down` classes on
every bare hero (`heroEl.classList.toggle`) are genuinely inert wherever
`.hero-bare` is used, including Home's own crypto hero — pre-existing,
shared, and invisible either way, not a Stocks-specific regression to
carry alone; a per-row Stocks watchlist star (crypto has one) — a real
feature addition, not a polish fix, out of this pass's scope.

Full gate: `tsc --noEmit` clean, `vitest run` 1180/1180 (was 1149 at the
start of this pass — 31 new/updated tests, none weakened), `npm run build`
clean. Diff: `src/ui/views/stocks{Overview,Market,LongTerm}Panel.ts`,
`src/ui/cloudState.ts` (additive only), `src/ui/styles.css` (one new
Stocks-scoped rule), plus `tests/ui/stocksOverviewPanel.test.ts` (new),
`tests/ui/{stocksMarketPanel,cloudState,assetHubView}.test.ts` (extended).
Nothing under `server/**`, `state/**`, `homeView.ts`, `marketsView.ts`,
`main.ts`, or any Tools view touched.

## Creative upgrade pass #5: Grid/Backtest/Validation, 20 screenshot-verified fixes (2026-09-06)
Part of David's cross-screen "compare against Revolut X, ship 200 real
improvements, split across parallel agents" ask; this agent's scope was
strictly Grid Simulation / Backtesting Lab / Validation (`gridView.ts` /
`backtestView.ts` / `validationView.ts` + the `.stat-*`/`.data-table`/verdict
CSS specific to them) — Market Scan/Monitoring/Portfolio owned by a parallel
agent, everything else untouched. These three are analytical/scientific tool
screens, not "your money" screens, so the comparison here means the same
underlying design discipline (typography scale, tabular-nums, restrained
color, card treatment, press/loading states) the rest of the app already
borrows from Revolut X — not a literal screen-for-screen match.

Per the task's own instruction, loaded `fintech-dashboard-polish` and
`apple-design` first. Built `dist/`, `vite preview`, real Playwright
screenshots at 390×844 and 1280px desktop with `?demo=1`, covering every
screen's setup form and result view — before touching anything, and again
after each fix to confirm it actually changed the pixels. Two prior same-day
entries ("Creative upgrade pass #4" and three "Deep design pass" entries
below) already did exhaustive work on these exact three screens (equity
curve + stat-row hierarchy on Grid, `.stat-tile` unification, table-scroll
wrappers, border removal on verdict/risk tags) — none of that re-proposed
here; every item below is something those passes verifiably left standing.

**Real, screenshot-verified issues found and fixed (20):**

1. **Native number-input spin buttons broke the pill shape on hover** — a
   stark white square with grey arrows, invisible at rest and only appearing
   once the pointer is actually over the field (confirmed via a real
   `page.hover()` screenshot, not just reading the CSS — a static screenshot
   alone would have missed it). Suppressed via `::-webkit-inner/outer-spin-
   button` + `-moz-appearance: textfield`, scoped to exactly the 8 number-
   input ids these three screens own (`#grid-levels/#grid-amount/#grid-cash`,
   `#bt-cash/#bt-fee`, `#val-fee/#val-spread/#val-slippage`) — the shared
   `.control input` rule itself untouched, since Market Scan/Monitoring/
   Portfolio reuse it and are a parallel agent's scope this round.
2. **Backtest's Buy & Hold/DCA/Trend checkboxes rendered bright OS-default
   blue** — the one color on the screen outside the app's restrained black/
   white/green/red system. Fixed with `accent-color: var(--text)` on
   `.control-checkboxes input[type="checkbox"]` (exclusive to this screen).
3. **Backtest's "Best strategy" name tile was hardcoded green (`up`)
   regardless of the actual return's sign**, while the adjacent "Best return"
   tile in the same row correctly switches to red when negative — a
   strategy that's merely the least-bad of an all-losing bunch would still
   show its name in green. Both tiles now share the identical
   `bestReturn >= 0 ? 'up' : 'down'` expression.
4. **Grid had no "Configure"/"Results" section structure** — Backtest
   already organizes its form and output under `.block`/`.block-head`
   headings; Grid jumped straight from the subtitle into a bare `.controls`
   div and a bare results div. Wrapped both in the same section/heading
   pattern Backtest established, for parity across the three sibling tools.
5. **Grid's results container started completely empty** before the first
   run — Backtest already shows an `.empty` "Configure a backtest above…"
   placeholder in this state; Grid just showed nothing at all between the
   button and the bottom nav. Added the matching placeholder.
6. **Validation had the same missing "Configure" section heading** as Grid
   (item 4) — added it. (Its results area already gets its own internal
   headings once populated — "Out-of-sample equity", "Training vs unseen
   data", "Per-fold results" — so no separate outer "Results" wrapper was
   added there, unlike Grid.)
7. **Validation's results container also started completely empty** before
   the first run (same gap as item 5) — added the matching `.empty`
   placeholder ("Configure the walk-forward above and press Run to see
   results.").
8. **Grid's "Loading X history…" status was plain text**, while Backtest's
   equivalent already uses the shared `.loading-inline`/`.spinner sm`
   treatment. Grid now matches.
9. **Validation's candle-fetch loading message was plain text** — same fix
   as item 8, applied to Validation's first loading stage.
10. **Validation's "Running walk-forward…" message was also plain text** —
    same fix, applied to its second loading stage.
11. **Validation's "Sharpe (unseen)" stat-tile was never color-coded**,
    unlike the return tiles right beside it — screenshotted at -1.97
    (clearly bad) and still rendered in plain white. Sharpe is a standard
    signed risk-adjusted-return metric (negative is unambiguously bad), so
    it now reuses the same `signClass()` the return tiles already use.
12. **Validation's "Degradation" stat-tile was never color-coded either** —
    but unlike every neighbouring tile, a naive `signClass()` here would be
    wrong: reading `walkForward.ts`'s own computation,
    `degradationPct = (1 - avgTestReturnPct / avgTrainReturnPct) * 100`, a
    bigger POSITIVE number means a strategy performed WORSE out-of-sample
    (return didn't survive), not better — screenshotted at "+107%", which a
    plain green/positive convention would have shown as a good sign right
    next to the ⚠ curve-fitting warning explaining why it's the opposite.
    Colored with inverted logic (`> 0` → red/negative, `< 0` → green/
    positive) grounded in the actual formula, not guessed.
13. **Per-fold table's "Profit factor" column was never color-coded** — a
    screenshotted 0.11 and 0.00 (both catastrophic — a profitable strategy
    needs profit factor > 1) sat in plain white next to correctly-colored
    return columns. Colored green when ≥ 1 (the standard breakeven
    threshold for this metric), red otherwise; profit factor is always ≥ 0,
    so `signClass()` itself doesn't apply here (it would show 0.11 green).
14. **Per-fold table's "Expectancy" column was never color-coded** — a
    screenshotted -409.30 sat in plain white. Expectancy is a plain signed
    per-trade average (confirmed by reading `performance.ts`), so it now
    reuses `signClass()` directly.
15. **Per-fold "Expectancy" values were flat, un-tiered money strings** —
    every other money figure in Backtest (Final equity, Fees paid) already
    gets the two-tier `tieredPriceHtml` decimal treatment; Expectancy,
    typically well under 1000 and so *actually carrying* a decimal (e.g.
    "-409.30"), was the one money value in these three screens still shown
    as one flat string. Now wrapped the same way.
16. **Grid's "Final equity" stat-tile was also a flat, un-tiered money
    string** — same gap as item 15, one level up. At the default 10,000
    starting cash this is invisible (no decimals above 1,000), so verified
    concretely with a small starting cash (80 → "81.97") to confirm the tier
    actually renders once there's a decimal to split.
17. **Backtest's strategy-comparison table had no signal that it scrolls
    further right** — the existing `.table-scroll` wrapper (shared with
    Market Scan/Monitoring, out of this pass's scope) correctly contains the
    scroll, but nothing hinted a phone viewer that "Fees paid" was still off
    the visible edge. Added a `.table-scroll-fade` wrapper (new class, only
    used by this screen and #18) with a right-edge gradient that fades out
    once actually scrolled to the end, toggled by real `scrollWidth`/
    `scrollLeft` checks — confirmed via `page.evaluate` that `is-scrollable`
    correctly sets at 390px (853px content in a 318px viewport).
18. **Validation's per-fold table had the identical missing scroll-fade
    affordance** — same fix as item 17, applied to its own table (10 columns
    wide, the widest of the three screens).
19. **Validation's post-run status line was one continuous "·"-joined
    run-on sentence** packing symbol, fold shape, three cost percentages,
    and data source onto a single logical line — screenshotted wrapping
    across 3 full lines on a 390px phone and splitting the delay clause
    apart mid-phrase across the line break. The same anti-pattern
    Monitoring's status line had (fixed in Creative upgrade pass #4, PR
    #189). Split into two lines (summary · source on one, the cost
    breakdown on the next); all substrings existing tests/e2e assert on
    ('spread', etc.) still land inside `#val-status`.
20. **(Investigated, deliberately NOT changed)** Backtest Lab's number
    inputs were flagged in an earlier same-day pass as "read slightly flat
    against the dark theme" but left alone; this round confirmed via
    screenshot that the *default* `.control input`/`.control select`
    background (`--surface`, barely lighter than the page) is genuinely
    subtle, but fixing it means editing the shared `.control` rule itself —
    used identically by Market Scan/Monitoring/Portfolio, a parallel agent's
    scope this round. Left untouched rather than risk a cross-scope CSS
    collision; the concretely-scoped sub-issues that WERE safe to isolate
    (the spinner button, item 1) were fixed instead.

**Categories checked with no real defect found** (to avoid padding the
count): icon consistency (neither Grid nor Backtest nor Validation render
any icon of their own; the `⚠` used in Validation's warning list is the
same convention Market Scan's `.scan-warnings` already established, not a
new inconsistency); button hierarchy (Simulate/Run backtest/Run walk-forward
already read as the clear primary action via the shared white-pill
treatment); alternating row tint/sticky header (existing row-hover already
covers scannability at these screens' row counts — at most ~6 fold rows or
3 strategy rows visible at once, not enough to need a sticky header); Grid's
and Backtest's own status lines (shorter, 3-4 clauses, wrap cleanly across 2
lines on a real 390px screenshot — only Validation's was the genuine
run-on).

Verified with real screenshots throughout (Playwright core,
`/opt/pw-browsers/chromium`, 390×844 and 1280px, `?demo=1`): every item above
has a real before/after pair, including one deliberate hover-state capture
(item 1) that a static screenshot alone would have missed.

Added 11 new tests across the three integration suites (Configure/Results
structure + empty state, loading spinner, tiered-price on Final equity,
Best-strategy tile sign parity, table-scroll-fade class toggling via
simulated `scrollWidth`/`scrollLeft`, status-line line split, Sharpe/
Degradation/Profit-factor/Expectancy color-by-actual-value assertions that
don't hardcode fragile demo-data magic numbers). Full gate: `tsc --noEmit`
clean, `vitest run` 1189/1189 (net +11 from this pass over this branch's
`origin/main` base, none weakened), `npm run build` clean. Diff confined to `src/ui/views/
{gridView,backtestView,validationView}.ts`, the additive block of
`src/ui/styles.css` this entry describes, and the three matching
`tests/ui/*.integration.test.ts` files — nothing under `server/**`,
`state/**`, or `src/core/**` touched.

## Adversarial review of `liveManualTradeSync.mts` (PR #192) — 2 real bugs found and fixed (2026-09-05)
PR #192 added `syncManualTradesFromBroker` (detects a real trade David makes
directly in the Revolut X app) and wired it into `runLiveMirror`, written and
tested by the same session. Per this project's own practice (see the
"Adversarial review of the live-money wiring" and "Full-system safety audit"
entries below), that gets a genuinely skeptical second pass hunting for edge
cases the original tests didn't cover — not a rubber-stamp. Two confirmed:

1. **Stale `dailyLossSoFar` snapshot — a same-cycle external-sell loss could
   not block a same-cycle new entry** (`autopilotRunner.mts`'s
   `runLiveMirror`). `dailyLossSoFar` used to be read from
   `DailyLossTracker.lossToday(now)` BEFORE `syncManualTradesFromBroker` ran,
   then reused unchanged for every entry sized later in the same cycle
   (manual `/buy` and the paper-mirrored auto-entries) — the exact
   stale-snapshot bug class already fixed once for equity/openPositions in
   `mirrorApprovedEntries` (PRs #107-#110, 2026-09-03), reintroduced here for
   the daily-loss figure specifically by this call's insertion point. Concrete
   failing scenario (proven with a debug harness before writing the fix,
   using a real Ed25519-signed `RevolutXBrokerAdapter` call against a stubbed
   `fetch`): live equity €100 (3%-of-equity daily-loss allowance ≈ €3), a
   tracked XBTEUR position (qty 0.002, entry €90,000) that Revolut X now
   shows as fully sold externally. `syncManualTradesFromBroker` closes it and
   records a realized loss of (50,000 − 90,000) × 0.002 = **€80** — 26× the
   daily allowance — but with the stale snapshot, a NEW same-cycle
   auto-mirrored entry was still sized and sent to the human for confirmation
   (`assessTrade` never saw the €80 loss). Fixed: `dailyLossSoFar` is now
   read AFTER `syncManualTradesFromBroker` returns, immediately before
   building `liveEntryOptions`. Verified both directions by hand: reverting
   just this ordering reproduces the wrongly-approved confirmation prompt;
   with the fix, the entry is rejected at `assessTrade` and no confirmation
   is ever sent.
2. **Missing immediate persist after `syncManualTradesFromBroker`'s own
   writes** (`autopilotRunner.mts`). Every OTHER real-money action in this
   same cycle (manual sell/buy submitted, mirrored entries submitted,
   automatic exits submitted) gets an immediate `persistStateToGit` call on a
   genuine outcome — this one had none. A crash between `recordLiveEntryFill`/
   `forgetLivePosition` (plus the Telegram message already sent claiming the
   position is "now automatically monitored, stop-loss X / take-profit Y") and
   the next unrelated persist (which might not fire for many cycles, or not at
   all if the run is killed first) would silently revert an already
   Telegram-announced protection back to untracked — the same
   crash-loses-real-bookkeeping incident class `persistStateToGit`'s own doc
   comment already describes for manual `/buy`, just never closed for this
   new call site. Fixed: `syncManualTradesFromBroker` now returns whether it
   actually reconciled anything (false on a pure no-op, or when a buy's price
   fetch failed and nothing was recorded), and `runLiveMirror` persists
   immediately when it did.

**Checked and ruled out** (real hypotheses, not constructible as concrete
bugs):
- **Double-processing on a retried/re-run cycle** — with state actually
  persisted between calls, `tracked`/`brokerQty` converge to `diff ≈ 0` and
  the loop skips; not idempotent only in the crash-loses-persist gap above,
  which bug #2 now closes.
- **Race with this cycle's OWN entry/exit logic using a stale
  `openPositions`/equity snapshot** — traced through: `mirrorApprovedEntries`
  already re-reads `openLivePositions`/`liveEquity` FRESH on every loop
  iteration (the PR #107-#110 fix), and it runs AFTER
  `syncManualTradesFromBroker` in the same tick, so it always sees this
  function's own writes. No staleness here — `dailyLossSoFar` (bug #1) was
  the only stale value in this path.
- **FIFO ordering wrong when multiple tracked lots exist for one symbol** —
  `reconcileExternalSell` iterates `openLivePositions`'s `Object.values()`
  order. Positions are keyed by intent id and only ever added (never
  reordered on overwrite), and JS/JSON preserve non-numeric string-key
  insertion order — so array order is genuinely chronological entry order,
  not merely incidental. FIFO-by-time holds.
- **Broker balance including something other than this bot's own symbol
  (dust, a duplicate representation)** — `RevolutXBrokerAdapter.fetchPositions()`
  maps one row per `currency` from a real balances endpoint; no mechanism for
  a duplicate-symbol row exists in this code. Real fee-dust exceeding
  `DUST_QTY` (1e-6) being misread as a manual buy is plausible in principle
  but not verifiable against Revolut X's actual fee structure from here — a
  hypothesis, not a confirmed bug, left alone.
- **Fees/slippage bias from using the current price as both entry and exit**
  — already an explicitly documented, deliberate approximation in the file's
  own doc comment (Revolut X reports no cost basis); not a new finding.

Tests: 5 new regression tests — 4 in `liveManualTradeSync.test.ts` covering
`syncManualTradesFromBroker`'s new return value (false on no-op/failed-price,
true on an actual buy or sell), 1 in `autopilotRunner.test.ts` reproducing
the same-cycle stale-`dailyLossSoFar` scenario end-to-end through
`runLiveMirror` (a real Ed25519 keypair generated in-test so the broker
adapter's signing succeeds and its `fetch` call is genuinely exercised via
`vi.stubGlobal`, since every other test in that file relies on an
intentionally-invalid PEM to short-circuit before any network call).

Gate: tsc clean, 1171 vitest passed (was 1166; 5 new), vite build ok.

## Creative upgrade pass #4: full passes on the remaining tool screens (2026-09-04, PRs #188/#189/#190)
Continuation of pass #3 (below) — same mandate, this time the eight screens
David explicitly listed as "not yet done at all": `stocksMarketPanel.ts`,
`cryptoView.ts`, `stocksView.ts`, `gridView.ts`, `backtestView.ts`,
`validationView.ts`, `marketScanView.ts`, `monitoringView.ts`. Rebased onto
`main` before and between each batch to pick up PR #186/#187 and each
subsequent merge.

**cryptoView.ts / stocksView.ts**: reviewed, no changes — both are thin
composition wrappers with no markup of their own (`renderCryptoView` just
calls `renderAssetHub` with `renderHomeView`/`renderMarketsView` as panel
renderers; `renderStocksView` the same with the stocks panels). Everything
they render is covered by this pass or an earlier one.

**Grid Simulation + Validation (PR #188)**: Grid was the only backtest-style
tool in the app with NO visual result at all — five equal `.stat-card`
boxes and nothing else, despite running a full time-series simulation to
produce them. Added an equity curve (the same `lineChartSvg` validationView
already uses) and restructured the five numbers into a real hierarchy:
Final equity + Return lead as their own hero-ish `.stat-row` (the two
numbers the simulation was actually run to answer), the curve that
produced them follows, the supporting metrics (drawdown/trades/win rate)
come after as a secondary row. Validation's own `.result-cards`/`.stat-card`
tiles were swapped for the `.stat-row`/`.stat-tile` pattern backtestView's
comparison summary already established as the shared "big number + small
label" component — same data, verdict panel, equity chart and per-fold
table untouched, just the card chrome unified. `.result-cards`/`.stat-card`
removed from styles.css afterward — grepped, no remaining consumer anywhere.

**Market Scan + Monitoring + Backtest (PR #189)**: two shared infrastructure
gaps found across every `.data-table` screen (Backtest/Validation/Market
Scan/Monitoring): (1) every table is 7-9 columns wide and was `width: 100%`
with no scroll container — on a 390-430px phone that either crushed every
column illegibly or forced the whole PAGE to scroll sideways. Added a
`.table-scroll` wrapper (`overflow-x: auto`; table gets `width: max-content;
min-width: 100%`) at all four call sites — confirmed by actually scrolling
a live table via Playwright (`element.scrollLeft`), not just reading the
CSS. (2) `.signal-opportunity`/`.risk-approved`/`.risk-refused`/`.verdict-*`
were the one surface left drawing a coloured RGBA border around their own
tint fill, contradicting the true-black pass's own "fill difference only,
never a stroke" rule already applied to `.badge-hot`/`.dstat`/etc. — removed
the six leftover borders. Market Scan's own gap: the -100..+100 score was a
bare number; added a small filled bar (green/red, sized to |score|) beside
it, same idea as marketsView's order-book depth bars from PR #186 applied
to a different "how strong is this" number. Monitoring's own gap: the
status line was one run-on "· "-joined sentence carrying four unrelated
facts (running?, last scan, next scan, last outcome) — split into
`.stat-tile`s, preserving every exact substring `scripts/e2e.mjs` and the
existing integration test assert on ('stopped', 'RUNNING', the interval
string, 'Last scan', 'qualified').

**Stocks Market (PR #190)**: already inherited the crypto Markets list's
polished row styling wholesale (logo, freshness dot, category tabs,
search+sort) — the one real gap was that it carries the identical curated
(actually-traded) vs browsable (display-only) split as crypto
(`CURATED_STOCK_INSTRUMENTS` vs `BROWSABLE_STOCK_INSTRUMENTS`) but never
surfaced it. Added the same `.tag-traded` TRADED badge marketsView.ts
already shows for its own curated majors.

Verified with real screenshots throughout: built `dist/`, `vite preview` on
port 4177 (checked `lsof` first — 4173/4174 were bound by other worktrees),
Playwright at 400px, `?demo=1` for the five tool screens (no live-network
mocking needed, same convention `scripts/e2e.mjs` already uses).

Full gate green after every batch (never re-verified stale): tsc --noEmit
clean throughout, vitest 1146 → 1148 → 1149 (net +4 new tests across the
three PRs, none weakened), `npm run build` clean throughout. Pure `src/ui/`
+ `tests/ui/` (+ `scripts/e2e.mjs` selector updates for one CSS class
rename) diff across all three PRs — nothing under `server/**`, `state/**`,
or trading/signal/risk logic touched.

Left for a future round: `backtestView.ts`'s per-strategy comparison could
in principle get its own small equity-curve-per-row treatment (Grid and
Validation both got one this round); not attempted here since overlaying
several strategies' curves legibly in one small area is a materially
different, harder design problem than a single curve, and backtestView
already had the best structure of the five tool screens going in (stat-row
summary + BEST badge + data-table) — the genuine, low-risk gap there was
just the shared table-scroll fix, which is done.

## Creative upgrade pass #3: finished marketsView's coin-detail tabs — order book, depth, trades, trade form, pager (2026-09-04, PR #186)
Continuation of pass #1/#2 (below) — rebased onto `main` first to pick up
PR #184/#185. David's ask named exactly what was left uncovered: only ~600
of `marketsView.ts`'s 1112 lines got real design attention in the prior
round (header/list/pull-to-refresh/chart); the Table/Depth/Trades/Trade
view-tabs and the prev/next pager were still bare fetch-and-dump markup.

- **Order book (Table)**: each row now carries a cumulative-depth bar behind
  its own number (bid bars grow from the right, ask bars from the left,
  both toward the shared centre) — the standard exchange read where a wall
  of liquidity several rows down is visible at a glance. Added a spread
  readout below the ladder. Two real CSS bugs found and fixed while
  building this (verified via `getComputedStyle` + real screenshots, not
  assumed): (1) the bar's `width: var(--bar)%` was relative to each cell's
  own text-length-dependent box (a flex item with no `flex:1`), so bars
  weren't comparable across rows — fixed by giving `.ob-bid`/`.ob-ask`
  `flex: 1` so both fill their half of the row; (2) the bar's `z-index: -1`
  had no LOCAL stacking context to sit inside (`position: relative` alone
  doesn't create one — it needs an explicit `z-index` too), so it escaped
  to the page's root stacking context and rendered behind the entire app
  rather than just behind its own cell's text. Both were invisible in a
  static code read; only showed up once actually screenshotted.
- **Depth chart**: added a Best bid / Mid / Best ask stats row under the
  step chart, which previously had no numeric anchor at all.
- **Trades tape**: added a labelled Price/Amount/Time header and a per-row
  colour wash by side, so a fast-scrolling tape of otherwise-identical rows
  still reads at a glance.
- **Trade tab**: the Buy/Sell segmented control now actually toggles (still
  no submit — real orders stay behind the Telegram `/buy`/`/sell` safety
  path, per the existing doc comment). It previously looked like a
  two-state switch but silently ignored every tap on its Sell half.
- **Prev/next pager**: names the neighbouring coin (e.g. "ETH ›") instead of
  a bare "Next ›" — the reference's own swipe-through pickers always do
  this. Also de-duplicated: one shared `pagerHtml` helper replaces markup
  that was copy-pasted between the chart and non-chart render paths.

Verified with real screenshots: built `dist/`, `vite preview` on port 4177
(4173/4174 were already bound by other worktrees — checked with `lsof`
first), one `page.route` handler mocking Kraken's public
AssetPairs/Ticker/OHLC/Depth/Trades endpoints (everything else aborted so
the app takes its own fail-soft path), Playwright at 400px, before/after
for every view mode. Added `tests/ui/marketsDetail.integration.test.ts` (5
new tests) covering the depth bar/spread, the depth-chart stats, the trades
tape header/tint, the Buy/Sell toggle actually toggling, and the pager
naming the neighbour — this detail view previously had NO integration
tests at all (only the list did).

Full gate green: `tsc --noEmit` clean, 1145/1145 tests (5 new), `npm run
build` clean. Pure `src/ui/` + `tests/ui/` diff (3 files) — nothing under
`server/**`, `state/**`, or trading/signal/risk logic touched.

## Creative upgrade pass #2: assetHubView's Profit-tab "Real money" card had the glow but not the number, plus a hero-token audit (2026-09-04)
Continuation of pass #1 (below), same mandate — genuine upgrades, not a bug
hunt. Rebased this worktree onto `main` first to pick up PR #184
(`be337777`).

**Real gap found in `assetHubView.ts`'s Profit-tab "Real money" secondary
card** (`#hub-real-money`): pass #1 gave Home's live hero an up/down glow
*and* a "X% since tracking began" line backing it up. This card already had
the glow (`.up`/`.down` toggled off the same first-recorded-sample baseline)
but never surfaced the number — a viewer could see the card tint green/red
with no text anywhere explaining by how much. Verified with a real
before/after screenshot (built `dist/`, `vite preview`, mocked
`autopilot-state.json` with its real committed live-account content —
David's actual €115.32 balance, +14.51% since tracking began — network
aborted for everything else) at 400px: before, the card jumped straight from
"€115.32" to the cash breakdown with no percentage at all; after, "▲ 14.51%
since tracking began" sits between them, exact same wording and baseline as
`homeView.ts`'s `#hv-live-change`. Also fixed the cash/BTC breakdown line
being `hidden` entirely whenever there's no untracked BTC holding — Home's
identical line always shows "Cash €X" regardless; this card now matches.
Added test coverage: both the new "since tracking began" text/class and the
always-visible cash line, for both the has-BTC and no-BTC cases.

**Hero-token audit** (the other half of David's ask — "are there other
screens that should use hero-bare for their own single most important
number"): checked every view under `src/ui/views/`. `homeView.ts`,
`portfolioView.ts`, `stocksOverviewPanel.ts`, `stocksLongTermPanel.ts`, and
`valueView.ts` (via `equityChartPanel.ts`'s own built-in `hero-bare`) already
use it correctly and consistently — each is exactly one account's own
balance, alone on its screen, exactly where the pattern is for. Deliberately
did NOT extend it to `marketsView.ts`'s coin-detail price (`.detail-price-row
.row-title.big`, 2.4rem): that number lives in a header row with a back
button, pair-switcher and star button around it — `hero-bare`'s whole
premise is a lone centered figure with nothing else competing for the same
visual weight, and it's a market quote for whatever coin you're browsing,
not "your money" (no page-wide sentiment wash makes sense for it either).
Forcing the pattern there would fight the layout for a number that isn't the
personal-stakes kind hero-bare exists for. `monitoringView.ts`,
`backtestView.ts`, `validationView.ts`, `marketScanView.ts`, `gridView.ts`
are scan/tool screens with no single dominant balance — also correctly left
alone.

Full gate green: `tsc --noEmit` clean, 1140/1140 tests (same count — 2 new
assertions added to existing cases, no new cases), `npm run build` clean.
Pure `src/ui/views/assetHubView.ts` + `tests/ui/assetHubView.test.ts` diff (2
files) — nothing under `server/**`, `state/**`, or trading/signal/risk logic
touched.

## Creative upgrade pass #1: Home's real-money hero was the wrong shape for what it now is (2026-09-04)
David asked for genuine UPGRADES, not a bug hunt ("אני לא מחפש פגמים... מחפש
שידרוגים"). Verified with real before/after screenshots (built `dist/`,
served locally, mocked `autopilot-state.json`/`stocks-state.json` with the
real committed content, network aborted so the app takes its own fail-soft
path) at a 400px phone width.

**Structural finding**: `.hero-bare` (the giant, centered, sparkline-bearing
"ONE dominant hero" treatment) exists specifically so the screen's single
most important number gets the visual weight a boxed secondary card can't
give it. Home already does this correctly for the SIMULATED balance — but
the moment a live ledger actually exists, that sim hero is hidden entirely
(correct — it's no longer primary) and NOTHING takes over the dominant
role: the real balance, now the only balance on the page, stayed a small
boxed "Real money" card literally sized for a widget among several. On
David's own live account (currently real money IS on, €100.99) this was
visibly wrong — the screen's one number that matters most looked the
smallest.

Fixed in `homeView.ts`: once `state.live` exists, the real-money hero gets
`hero-bare` (giant centered figure, same scale the sim balance used when
it was primary), its own equity sparkline (`live.equityHistory`, real
recorded samples — nothing fabricated), an up/down glow + "X% since
tracking began" line (using the first recorded sample as baseline, the
same method `assetHubView.ts`'s Profit-tab real-money card already uses —
deliberately NOT "all time", since the live ledger has no `initialCash`
field and that word would overclaim what the number measures), and a
"profit ›" deep link into the Profit tab's own real equity chart (reuses
the existing chart rather than pointing at `valueView.ts`, which is
hardcoded to the SIMULATED curve only). The page-wide ambient sentiment
wash (`document.body.dataset.sentiment`) now also tracks the real
account's own direction once it's dominant, instead of a hidden
simulated account's.

**Consistency finding, same root cause**: a 2026-09-04 comment already on
this file said the SIMULATED "Open positions" table is confusing clutter
once real money is live — but the code only ever hid the sim hero and the
readiness card, never that table. Finished it: `posWrap.hidden =
Boolean(live)` now matches the other two. Nothing lost — the Profit tab
still shows both real and simulated side by side, unchanged, exactly as
the original comment already said it would.

**Real (pre-existing) bug surfaced while wiring the new "profit ›" link**:
`assetHubView.ts`'s tab-click handler matched the active tab by object
identity (`b === btn`) instead of by tab value. Any deep-link button
elsewhere on the page that carries `data-hub` but isn't itself one of the
`.hub-tab` pills — this already included Home's "Recent activity → See
all" (`data-hub="history"`) before today — correctly switched the panel
content (that part compares the STRING value) but could never actually
highlight any tab pill, since no `.hub-tab` element is ever `=== btn`. So
tapping "See all" already silently left the tab bar showing no active tab
at all, for months, on the History deep-link, and would have repeated the
same silent glitch on the new one. Fixed by matching `b.dataset.hub ===
tab` instead. Verified with a real click in a running instance (not just
inference from source): the Profit pill now correctly lights up.

Added test coverage for both: `homeView.integration.test.ts` now asserts
`#home-positions-wrap` hides with live active (and stays visible without
it) and that the live hero gets `hero-bare`; `assetHubView.test.ts` adds a
dedicated case for a deep-link button that isn't a `.hub-tab` pill.

Full gate green: `tsc --noEmit` clean, 1140/1140 tests (1 new), `npm run
build` clean. Pure `src/ui/` + `tests/ui/` diff (4 files) — nothing under
`server/**`, `state/**`, or trading/signal/risk logic touched.

## Real duplicate Telegram digests, caused by tonight's own ENOBUFS firefighting (2026-09-04)
David: "אני ממשיך לקבל את הסיכום היומי הרבה פעמים, סיכמנו פעם ביום" (I keep
getting the daily summary many times, we agreed on once a day). Root cause:
`maybeSendSummaries` (and the same-shaped `sendPeriodReport`/
`maybeSendAllClear`/`maybeSendEducationTip`) only recorded "already sent
today/this period" in the in-memory store — that fact became durable only
via the routine per-cycle git commit at the end of that same cycle. Every
time this session cancelled a stuck run tonight (fighting the ENOBUFS
incidents above) before its own persist landed, that "sent" fact was lost;
the next freshly-dispatched run re-checked against the last COMMITTED
state, still saw the digest as unsent, and sent it again — a real, visible
duplicate, not a one-off glitch. This session's own repeated cancel+
redispatch cycles tonight are exactly what triggered it repeatedly.

Fixed: all four "send once, remember it" functions now call
`persistStateToGit` immediately right after a successful send (matching
the same immediate-persist pattern already used for a real order
submission) — each fires at most once a day (digest), once an interval
(all-clear), or once a week/month (periodic reports)/two days (tip), so
persisting immediately on the rare cycle it actually happens costs
nothing and can't reintroduce the ENOBUFS-triggering high-frequency
pattern from earlier tonight. `maybeSendEducationTip` (telegram.mts) now
returns whether it sent (was `Promise<void>`) so its caller in
autopilotRunner.mts — the only place `persistStateToGit` is defined — can
persist on that signal. Full gate green (tsc, 1139 tests, build).

## Two real bugs found while scoping "add more coins" (2026-09-04)
A coin-expansion agent correctly stopped short of adding anything after
finding `server/autopilotRunner.mts` traded exactly
`instruments.value.slice(0, 20)` — a hardcoded count, not
`CURATED_INSTRUMENTS.length`. Appending symbols would have left them
silently untraded while the UI's "TRADED" badge (same source array) kept
claiming they trade. Fixed: the slice now derives from
`CURATED_INSTRUMENTS.length` directly, so it can never drift out of sync
with the array again.

While fixing that, found a second, independent, pre-existing gap:
`CoinbasePublicSource` (the fallback source used when Kraken's own probe
fails) had its own hardcoded 10-symbol instrument list, never updated
when `CURATED_INSTRUMENTS` grew to 20 on 2026-09-03 — a Kraken outage
would have silently traded a smaller, stale universe with no error.
Verified live which of the 10 newer curated symbols are actually listed
on Coinbase (`GET /products/<SYM>-EUR`): UNI/FIL/AAVE/ATOM/XLM/ALGO are
(200), HNT/VELO/AERO/ENA are not (404) — added the 6 real ones; the other
4 stay a genuine, permanent Kraken-only gap for this fallback, not an
oversight.

Full gate green (tsc, 1133 tests, build). Neither fix adds or changes
which coins actually trade — both are pure correctness fixes to keep the
live and fallback trading universes in sync with `CURATED_INSTRUMENTS`
going forward.

**Update (2026-09-04, later same night):** the 13 candidates now have that
missing forward-test record being built — see "New-candidate forward test
wired up" below. Still NOT added to `CURATED_INSTRUMENTS` or real trading;
that decision waits for weeks of real forward data, per David's own
"תריץ קודם ואז תוסיף אחרי ההרצה" (run it first, then add after the run).

## ENOBUFS, take 4 — the real cause: piping a 1MB+ file through Node (2026-09-04)
Neither of the previous two fixes (stdio 'ignore' for unread output, then a
backoff between retry attempts) stopped this from recurring — confirmed
under a real conflict: the backoff delays measurably happened (~3s then
~6s between attempts, exactly as coded), and it still failed all 3
attempts with the identical `spawnSync ENOBUFS`.

The one thing every single failure had in common, that neither previous
fix touched: `git show origin/main:${STATE_PATH}` piping the state file's
FULL content (over 1MB now) through `execSync`'s own captured stdout —
the only call in this whole retry path that ever moves a meaningful
amount of data through a Node-managed pipe, rather than a git subprocess
talking directly to disk or network. Fixed by redirecting it straight to
a file via the shell (`git show ... > path.origin-tmp`) and reading that
file back with `readFileSync` instead — nothing pipes real data through
Node anymore anywhere in this function. `run()` no longer captures stdout
at all (nothing read it once `git show` stopped needing to); stderr stays
piped since it's always small and keeps failure messages readable. Same
fix in both `autopilotRunner.mts` and `stocksRunner.mts`. Kept the backoff
from the previous attempt too — harmless, still matches the YAML step's
own never-failed retry loop. Full gate green (tsc, 1133 tests, build).

Learned the hard way across four attempts tonight: guess-and-check on an
intermittent infra failure wastes real capital-protection time. The thing
that actually found this was comparing exact failure timestamps against
what each fix changed, not re-theorizing from first principles.

## Full safety re-audit: /pause and /resume gave zero Telegram feedback (2026-09-04)
David asked for a full re-check of correctness/safety after tonight's earlier
fixes. Verified as genuinely fine (not just "looks fine"): the mid-cycle
persist backoff fix has held for 10+ hours straight with no ENOBUFS and a
steady ~5-5.5min cadence; `brokerAdapter.submit` has exactly ONE call site in
the whole codebase (`liveOrchestrator.mts`'s `runLiveOrderFlow`), gated on
`killSwitch.isEngaged()` first — every buy/sell path (manual and automatic)
goes through it, so the kill switch cannot be bypassed by any current path;
the confirmation gate's 20-minute auto-expiry correctly resolves to
`approved: false` with no order ever submitted and the shared exit-pending
queue correctly cleared; the /buy, /sell, and synthetic-price fixes from
earlier tonight are all still intact in the current code.

**Found and fixed — same bug class as tonight's /buy and /sell fix, this
time on the emergency stop itself**: `/pause` and `/resume` (typed, or via
the always-visible persistent keyboard button, which sends the identical
text) correctly engaged/disengaged the kill switch and correctly audited it
— `checkManualKillSwitchCommands` itself was never the problem. But
`runLiveMirror` (`autopilotRunner.mts`) called it and discarded the return
value, so David got no Telegram confirmation his tap did anything — an
unconfirmed emergency-stop tap is indistinguishable from a bot that's stopped
responding. Fixed by sending a short Hebrew confirmation for every outcome
(including the already-in-that-state no-op case, so a repeated tap doesn't
read as ignored either). Regression test added
(`tests/server/autopilotRunner.test.ts`). Full gate green (tsc, 1133 tests,
build).

**Left for a human decision, not touched**: at the time of this audit there
is a live, real stop-loss exit for the open ADAEUR position awaiting
David's Telegram tap (confirmation sent ~12:44 UTC, auto-expires ~20 minutes
later if unanswered — safe either way per the verified expiry behavior
above, but flagging it since it's a real pending decision, not a hypothetical
one).

## Momentum alert can flag a coin Revolut X doesn't even list (2026-09-04)
Real incident: the momentum-spike alert flagged USELESS (+27% on Kraken)
with a ready `/buy USELESSEUR` line claiming (per the script's own old doc
comment) that it's "genuinely actionable right now." David tried it —
correctly rejected by the broker-symbol check ("'USELESS/EUR' not found
among 382 tradable pairs from revolut-x"). No money at risk (the safety
check did exactly its job), but a misleading promise: the scan reads
Kraken's full public instrument list, a much larger universe than Revolut
X's own ~382 tradable pairs, so a real Kraken spike can exist for a coin
Revolut X never lists at all.

Not fixed by checking tradability at scan time — that needs real Revolut
X credentials this Telegram-only script deliberately doesn't have
(`momentum-spike-alert.yml` injects only the Telegram secrets). Fixed by
being honest instead: the alert message now says a `/buy` might get
safely rejected if Revolut X doesn't list that coin, rather than
promising every row is actionable. `detectMomentumSpikes.mts`'s doc
comment corrected to match.

## ENOBUFS, take 3: the stdio-piping fix wasn't it — missing backoff was (2026-09-04)
The previous entry's fix (stdio 'ignore' instead of piping every
subprocess's output) shipped, ran clean for ~6 hours (64 cycles, no
conflicts ever arose to test it), then a LATER run hit a real push
conflict and failed with the identical `spawnSync ENOBUFS` anyway —
proof the stdio theory was wrong, or at least incomplete. Told David
plainly rather than re-asserting the earlier "confirmed fix" claim.

The real difference, found by comparing against the ONE retry loop in
this codebase that has never once failed this way: `autopilot.yml`'s own
end-of-run "Commit updated state" YAML step has always backed off between
push retries (`sleep $((attempt * 3))`). `persistStateToGit`'s in-process
retry loop fired all 3 attempts back to back with zero delay between
them. Added the same backoff (`sleepSyncMs`, a blocking `Atomics.wait` —
no subprocess spawned, unlike shelling out to `sleep`) before each retry
attempt in both `autopilotRunner.mts` and `stocksRunner.mts`. Redispatched
a fresh run afterward to verify. Full gate green (tsc, 1132 tests, build).

## Bare /buy and /sell (no symbol) silently did nothing — real incident, David's own screenshot (2026-09-04)
David tapped the "לקנייה: /buy <SYMBOL>" line inside a momentum-spike alert
(`detectMomentumSpikes.mts`) and only the bare text `/buy` was sent — no
symbol, no bot reply, nothing. Root cause is a Telegram platform behavior,
not fixable in the message text: tapping a `bot_command` entity always
inserts just the command token into the compose box, never any text after
it on the same line, so `/buy <SYMBOL>` as plain text can never be tapped
as one unit. `parseBuyCommand`/`parseSellCommand` already correctly
rejected the bare command (return `null`), but the caller silently stashed
it as an "unclaimed message" with zero feedback — indistinguishable from
the bot being broken or ignoring the human.

Fixed in both `manualBuyCommand.mts` and `manualSellCommand.mts`: a
message that starts with `/buy`/`/sell` but doesn't match the full
`<command> <SYMBOL>` pattern now gets an immediate Telegram reply
("❌ /buy צריך סימבול, למשל: /buy USELESSEUR") instead of vanishing.
Doesn't change `parseBuyCommand`/`parseSellCommand` themselves or any
trade-execution path — purely adds feedback for input that already did
nothing. Regression tests added for both. Full gate green (tsc, 1132
tests, build).

## ENOBUFS recurred a SECOND time same night — real trigger was pipe buffers, not hours of accumulation (2026-09-04)
The earlier fix (gate mid-cycle persists on `hasSubmittedOrder`, retries
5→3) reduced how OFTEN the conflict-retry path runs, but didn't stop it
from breaking on the FIRST conflict it hits. Confirmed twice tonight, on
two different fresh runner VMs: cancelling+redispatching the stalled
autopilot run, a brand-new job hit `spawnSync ENOBUFS` on literally its
first git-push conflict (cycle 1, ~3 minutes in) — not after 90 minutes of
accumulation as originally diagnosed — and then failed identically on
every subsequent cycle for the rest of that run too. Both times the
trigger was this session's own direct push to `main` landing at the same
moment as the routine per-cycle persist.

Real root cause: `persistStateToGit`'s `run()` helper piped stdout+stderr
(`stdio: ['ignore','pipe','pipe']`) for EVERY subprocess call, even the
ones whose output nothing reads (`git config`, `git add`, `git commit`,
`git push`, `git fetch`, `git reset --hard`) — only `git show` needs the
captured string. A single retry attempt fires ~5 of these back to back
with no yield; allocating pipe buffers for all of them was apparently
enough to exhaust something on this runner immediately, not gradually.
Fixed in both `server/autopilotRunner.mts` and `server/stocksRunner.mts`
(same duplicated vulnerable shape): `stdio: 'ignore'` by default, piped
output only for the one call that actually reads it. Also brought
`stocksRunner.mts`'s retry loop down from 5 to 3 attempts (it had never
received that half of the earlier fix). No real trades were at risk
either time — every stalled cycle logged `opened 0, closed 0`, so only
observability data (equity history, shadow standings) was briefly delayed,
never a live order's own bookkeeping. Full gate green (tsc, 1130 tests,
build).

## Real money-display bug: demo-fallback price fed into a real position's P&L (2026-09-04)
Found while personally verifying (via the same Playwright-screenshot method
used for the design passes below) whether a requested design overhaul was
actually needed — it wasn't (see the entry below this one), but the
screenshot surfaced something worse: Home's "Real open positions" table
showed the live ADAEUR position (76.0429 ADA, real value ~€14.46) as worth
**€7,452 with a +51428.19% unrealized gain** — a wildly wrong number, not a
cosmetic one.

Root cause: `homeView.ts`'s `livePrices()` asks `data.source.getCandles(symbol, ...)`
for each open position's own symbol to get its current price. When live
market data is unavailable (Kraken/Coinbase both failing — shown by the
"DEMO data" banner, a real, recurring situation, not a test-only edge case),
`data.source` falls back to `SyntheticDataSource`. Its `getCandles` used to
default ANY symbol not in its 8-pair demo whitelist (`DEMO_START_PRICE`,
all `*/USD` pairs) to a hardcoded `startPrice: 100` — and a real position's
symbol (`ADAEUR`) is never in that whitelist. That fake ~€100 anchor price
then got multiplied into the position's Value/Unrealised P&L exactly like a
real price would, with no visual distinction from a genuine live figure.

Fixed: `SyntheticDataSource.getCandles` now returns an error result for any
symbol outside its demo whitelist instead of fabricating a price
(`src/core/data/synthetic.ts`) — `homeView.ts`'s existing
`prices[symbol] ?? entryPrice` fallback then correctly shows a flat,
sane 0%-change figure instead. Regression test added
(`tests/data/synthetic.test.ts`). Full gate green (tsc, 1129→1130 tests,
build); verified visually before/after via the established
build+preview+Playwright screenshot method. Other callers of
`getCandles` (markets scanner, backtest/grid/validation views, live
ticker) were checked — all already handle a non-ok result, so this is
strictly safer everywhere, not just on Home.

## Deep design pass #2: cross-screen price-formatting bugs found via real screenshots (2026-09-04, PR #176)
Continuation of the entry directly below (same day, same complaint — David
still wasn't seeing real improvement after that pass). Same method: built
`dist/`, served it locally, mocked `autopilot-state.json`/`stocks-state.json`
with the real committed files, screenshotted every screen (Home, Crypto
Overview/History/Market/Profit, Markets list + coin detail, Stocks
Overview/Market/Long-Term/Profit, all Tools panels) before AND after each
change, and looked at the images rather than reasoning from CSS.

**Found and fixed — all four are the same root cause: a value type (a
market price, an "open positions" table) rendered differently depending on
which screen you're looking at it from, because each screen had its own
copy-pasted formatting instead of sharing one:**
- **Home's "Markets" preview cards**: the `TRADED` badge shared the
  coin-name line inside a 178px card with no room for it — it visually
  overlapped the %-change text (confirmed by a cropped screenshot: "Bitcoin"
  and "+5.41%" touching with zero gap). Deleting the badge alone just traded
  the overlap for truncating "Bitcoin" to "Bitc…" (same 178px squeeze).
  Fixed properly by moving price+change onto their own row below the name
  (`homeView.ts`), the same restructuring PR #172 already did for the badge
  colliding with the name on the full Markets list.
- **Coin-detail page** (hero price, 24h High/Low, order form, past trades,
  order book, live ticks) used `formatPrice`, which drops to 0 decimals
  above €1,000 — so tapping Bitcoin from the Markets list (which correctly
  shows "€69,274.80") landed on a detail page showing the flat "€65,478".
  Switched every price on `marketsView.ts`'s detail page to
  `formatMarketPrice` (what the list row itself already uses), so the
  number and its two-tier typography are identical between list and detail.
- **Stocks "Market" list** (`stocksMarketPanel.ts`): prices were flat
  strings (`$328.46`) despite the row using the exact same `.row-price` CSS
  class as the crypto Markets list, which is two-tier (`$328`.`46`).
  Wrapped in `tieredPriceHtml` + switched to `formatMarketPrice`.
- **Stocks "Overview" open positions** (`stocksOverviewPanel.ts`) showed
  only entry price + share count — no Value or Unrealised P&L column at
  all, unlike the identical "open positions" concept on Home (Crypto),
  which has a full Cash/Total/Price/Value/Allocation/P&L table. Rather than
  writing a second copy of that table logic, generalized `homeView.ts`'s
  `buildHoldingsRows`/`holdingsTableHtml` (now exported; takes a `money`
  formatter + cash icon code instead of a hardcoded euro symbol) and reused
  them here against the stocks market-snapshot prices this panel already
  fetches — both Overview screens now render the identical table shape.

**Covered per the process but found nothing further to fix**: crypto
History/Profit tabs, Stocks Long-Term and Profit tabs, and every Tools
panel (Scan/Backtest/Validation/Portfolio/Grid/Monitoring) — all already
consistent with the established two-tier/tabular-nums/restrained-palette
conventions, or legitimately empty states in this offline sandbox (external
Kraken/Coinbase/Alpaca calls fail soft, same as the prior entry).
Deliberately left alone: the History feed's raw `MANUAL RECONCILIATION`
audit notes read as verbose developer text in a consumer feed, but they're
real audit-trail content from the committed state, not something the view
fabricates — truncating them trades transparency for tidiness on a
live-money screen, not a trade worth making unasked.

Full gate green: `tsc --noEmit` clean, 1129/1129 tests (all pre-existing,
none needed changes), `npm run build` clean. Pure `src/ui/` diff (5 files),
no behavior or data-model changes.

## Visual audit against REAL rendered screenshots, after "I don't see the 30 changes" (2026-09-04)
David said he genuinely couldn't see the previous design-pass PR's claimed
improvements, and separately flagged the hub tab bar as "uncomfortable,
unclear" and numbers as disproportionate. Rather than reading CSS and
guessing, built and served `dist/` locally, mocked the app's own state
fetches with the REAL committed `state/autopilot-state.json` /
`state/stocks-state.json` (Kraken/Coinbase calls aborted → the app's own
fail-soft DEMO-data banner, expected), and screenshotted every real screen
with Playwright before touching anything.

**Confirmed already fixed** (previous session): the Profit tab's duplicate
giant €95.14 (`equityChartPanel.ts`'s `showHero`) — only one hero renders now.

**Found and fixed, each verified with a before/after screenshot:**
- **`formatPrice` (`format.ts`) emitted scientific notation for near-zero
  floating-point dust** — the Stocks Overview hero showed `Cash $-1.137e-12`
  literally on screen, and Portfolio/Stocks showed `0.000` (three decimals)
  for exact zero. `toPrecision(4)` falls back to exponential below 1e-6 and
  renders 0 as "0.000" — same class of bug `formatMarketPrice` already had a
  guard for, now mirrored here. Values below 1e-8 now render as `0.00`.
- **Market list truncated coin names that had plenty of room** — "Bitcoin"
  rendered as "Bitc…", "Dogecoin" as "Doge…", on every curated row, because
  the "TRADED" badge shared the name's line and claimed a fixed ~64px from
  its flexible width (measured: 127px column − 64px badge − gap left only
  57px for a 63px-wide "Bitcoin"). Moved the badge to the secondary
  (clock/symbol) line in `marketsView.ts`, which now truncates instead —
  losing far less than the asset's own name.
- **The hub tab bar** (`.hub-tabs` in `styles.css`) had no container — a row
  of equal-width flex labels with no shared background reads as several
  disconnected floating buttons rather than one control, and gaps looked
  arbitrary because word lengths differ ("Overview" vs "Market"). Added a
  visible rounded track (`var(--surface)`) the whole row sits inside, with
  the active pill one step lighter (`--surface-hover`, not
  `--surface-raised`) so it actually separates from the track.
- **Real vs. simulated positions were visually identical** — Home's "Real
  open positions" and "Open positions" (simulated) tables sat back-to-back
  with no REAL/SIMULATED tag, unlike every other real-vs-sim pairing in the
  app (Profit tab's heroes, History's "Real activity"). Added the same
  `tag-live`/`tag-sim` badges used everywhere else — this is a genuine
  clarity/safety concern given the app also mirrors real money.

**Looked at, decided NOT to change:** the Backtest Lab's number inputs
(read as slightly flat against the dark theme but not actually broken);
Portfolio's Cash/Realized/Unrealized showing no currency symbol (the paper
portfolio trades multiple pairs — EUR and USD markets — so a single
hardcoded symbol would be actively wrong, not just inconsistent); the
Bitcoin coin-detail page's price differing from the Markets-list price for
the same symbol (both are independently-generated DEMO fallback data since
Kraken/Coinbase are unreachable here — a data-source artifact of this
environment, not a UI bug); the full-page-screenshot bottom-nav "ghosting"
artifact (confirmed via CSS: `position: fixed; bottom: 20px` with matching
`.content` padding — Chromium's `fullPage` capture re-lays-out fixed
elements against its synthetic full-height viewport; not a real bug in
normal scrolled use).

Full gate green: `tsc --noEmit` clean, 1128/1128 tests (all pre-existing,
none needed changes — markup edits were additive), `npm run build` clean.
Pure `src/ui/` visual/markup/CSS diff, no behavior or data-model changes.

## CRITICAL self-inflicted incident: the state-merge fix itself reverted PR #152 out of main, restored (2026-09-03)
While shipping the low-priority-findings batch below, routine verification
caught that `main` no longer had PR #152's code — `proposeLiveExit`
(the exit-side double-order-race fix) and `ignorePortfolioCapacityCaps`
(the buy-override feature) had both silently disappeared, along with
their tests and the PROJECT_STATE.md entry documenting them.

Root cause: the `persistStateToGit` fix shipped a few hours earlier
(2026-09-03, "Overlapping autopilot runs...") replaced a whole-file
`git rebase -X theirs` with a JSON-key-level merge, but on a push-conflict
it did `git reset --soft origin/main` before re-committing. `--soft` moves
HEAD but leaves the index/working tree untouched — so every file OTHER
than the state JSON stayed frozen at whatever THIS process's own (possibly
stale) checkout had. A stocks-autopilot workflow run that had been
executing continuously since BEFORE PR #152 merged (checked out at PR
#151's commit) hit exactly this path repeatedly as it and the crypto
runner both pushed to the same `main`, and each time it "resolved" the
conflict, it silently reverted every source file — including PR #152's
safety fix — back to what it had checked out at start, while still
correctly merging the state JSON itself. The revert was invisible in the
state file (which merged correctly) and only visible by diffing source
files against what should have been there.

**Impact**: for roughly the two hours between the stocks run's first
conflict and this catch, `main` — and therefore the live-money crypto
autopilot actually running in production — was missing the exit-side
double-order-race fix. No exit race is known to have actually occurred in
that window (the audit log shows no automatic-exit/manual-sell collision),
but the protection was absent.

**Fixed the root cause**: `persistStateToGit` (both the crypto and stocks
copies) now does `git reset --hard origin/main` before re-applying the
merged state file — this fully syncs every OTHER tracked file to origin's
real current content first, so only the state file itself is deliberately
overwritten afterward. No more silent reversion of anything else.

**Restored `main`**: reconstructed the correct tree — PR #152's code (and
everything shipped after it) from this session's own working copy, origin's
legitimate `state/stocks-state.json` progress (cycles 20-22, genuine
simulated trading, not corrupted) kept intact, and `state/autopilot-state.json`
restored from the last known-complete real snapshot (a crypto cycle commit
made right after PR #152 merged, before the corruption began) rather than
the reverted (stale, ~2-hours-old) version main had regressed to — this
recovers real progress, doesn't just avoid losing it. Done as a merge
commit (both branches as real parents), not a force-push — full history
preserved, nothing destructive.

Full gate green (tsc, 1057 tests, build) on the restored tree. Both
workflows were cancelled mid-run and redispatched fresh once main was
fixed, to close the window as fast as possible.

**Lesson for future git-conflict-recovery code in this repo**: `git reset
--soft <ref>` only moves HEAD — it is NEVER sufficient on its own to
resolve a conflict against a fresher remote when the working tree/index
might be stale; always follow it with (or replace it with) `--hard` (or an
explicit `git checkout <ref> -- .`) to actually sync the working tree
before layering any manual file changes back on top.

## Fixed the remaining low-priority findings from the bug audit, on request (2026-09-03)
David explicitly asked to also fix everything documented-but-deferred from
the audit above. Shipped all of it:

- **`DailyLossTracker.isPaused`**: `dailyLossLimitPct: 0` now means DISABLED
  (never pauses), matching `assessTrade`'s own convention — it used to treat
  0 as an allowance of exactly €0, pausing all trading from the first call
  of the day even with zero losses recorded. (Currently unused in
  production — no call site exists yet — but now correct for whenever one
  is added.)
- **`positionMonitor.ts`'s `assessOpenPosition`**: now accepts the same
  `trailing` config the exit engine actually runs with, and computes
  `distanceToStopPct`/`currentRisk`/its warnings against the REAL,
  currently-effective stop (via `trailingStopPrice`, the same function
  `decideExit` uses) instead of the stale original `stopLoss` once a
  trailing stop has ratcheted up. (Also currently unused in production —
  nothing calls `assessOpenPosition` yet.)
- **UI — dead "← Home" back button** (`valueView.ts`): pointed at
  `data-nav="home"`, a view that no longer exists (renamed to "Crypto") —
  landed on a fully blank screen with no active tab. Now points at
  `data-nav="crypto"`, the view that actually opens this screen.
- **UI — wrong "leading vs Bitcoin" label** (`assetHubView.ts`'s Profit
  tab): showed "leading" whenever the agent was merely profitable
  (`bot >= 0`), not whenever it actually beat Bitcoin's own return over the
  same window — unlike the identical, correct check already on Home. Now
  computes BTC's own return from the current price vs. the benchmark
  anchor and shows both figures, exactly like Home does.
- **UI — asset-hub tabs stuck on "Loading…" forever**: a persistent fetch
  failure left every panel on its own initial skeleton indefinitely, with
  no way to tell "still loading" from "the cloud agent is unreachable."
  Now shows an explicit retry message after the first failed fetch, mirroring
  `valueView.ts`'s own fallback.
- **Stocks — no way to actually engage its kill switch**: `runPassiveHoldCycle`
  already checked `killSwitch.isEngaged()`, but nothing ever called
  `.engage()` for the stocks side — unlike crypto's real-money `/pause`,
  there was no way to pause the (simulated) stocks bot at all. Stocks now
  also polls for `/pause`/`/resume` each cycle (`checkManualKillSwitchCommands`,
  reused as-is) — the same Telegram bot/chat as crypto, but each side keeps
  its own independently-tracked update offset in its own (fully isolated)
  state file, so one human command pauses whichever side(s) are listening,
  with no shared state between the two runners. (Side effect, accepted:
  stocks' poller will now also see and stash crypto-only messages/callbacks
  it doesn't recognize into its own bounded unclaimed-updates list, where
  they're simply never claimed — harmless, capped, not a correctness issue.)

Tests added for every fix above; full gate green (tsc, 1057 tests, build).
UI changes verified via DOM-level integration tests (happy-dom) — NOT
manually checked in a live browser, given the scope of tonight's session;
flagging that limitation rather than claiming full visual verification.

## Full-codebase bug audit (6 parallel domains) + a real exit-side double-order race, fixed (2026-09-03)
David asked for a thorough, domain-by-domain audit (design, code, buy/sell,
stocks, every detail) using parallel agents, plus a specific feature: when
he types `/buy` for a symbol the risk engine would normally refuse, show
him WHY but still let him buy anyway if he decides to. Ran 6 parallel
read-only audits (UI/RTL, core risk/signal/position engine, live-money
execution, stocks pipeline, Telegram/notifications/state, tests/CI/build).
Fixed everything CRITICAL/HIGH found; documented but deliberately deferred
the rest (see below) — this codebase will never be "zero findings," and
claiming otherwise would be dishonest.

**CRITICAL, fixed — a real double-order race on the EXIT side:**
`liveExitMirror.mts`'s automatic stop/target checker and `manualSellCommand.mts`'s
`/sell` each built their OWN intent id (`${id}:auto-exit` vs
`${id}:manual-sell`) for the SAME position, so a still-pending automatic
exit and a human's `/sell` could each reach their own Telegram confirmation
and, if both got approved, both reach the broker — two real sell orders for
one position. Fixed by sharing ONE queue (`proposeLiveExit`, new in
`liveExitMirror.mts`): whoever proposes an exit for a position first queues
it under one stable id; a later trigger (automatic or manual, same cycle or
later) resumes that SAME attempt instead of starting a second one. This also
fixed two related bugs for free: (a) a rejected/cancelled exit no longer
marks the position "outstanding" forever (mirrors the identical fix already
shipped on the entry side) — a real position could otherwise become
permanently unsellable through the app; (b) a human's tap on an automatic
exit's confirmation is no longer droppable just because the exit signal
stopped firing before the tap (the queue is now resumed every cycle
regardless of the signal, like entries already were).

**HIGH, fixed — no per-item error isolation:** one symbol/position's
transient failure (a network blip, an unexpected broker response) used to
abort checking every OTHER pending symbol/position that same cycle, in both
`mirrorApprovedEntries` (entries) and `checkAutomaticExits` (exits) — a real
stop-loss on a different symbol could go unchecked because an unrelated one
threw. Both now wrap each item in try/catch and keep going.

**LOW, fixed defensively:** `RevolutXBrokerAdapter.cancel()` had no
kill-switch check (unlike `submit()`) — currently dead code (nothing calls
it yet), closed anyway so a future caller can't issue a real cancel while
paused.

**Feature, shipped — manual "buy anyway" override:** `/buy` used to be a
hard refuse-or-approve gate with no way to override. `assessTrade`
(riskEngine.ts) gained `ignorePortfolioCapacityCaps` — skips ONLY the
portfolio-capacity caps (max open positions, per-asset/correlated-cluster/
total exposure; the single-position size ceiling still applies) — NEVER the
fundamental checks (invalid stop, reward:risk bounds, the daily-loss circuit
breaker, non-positive equity), which stay hard-refused always. Every manual
`/buy` (never an autonomous entry) now retries with this flag when first
refused; if that approves it, the Telegram confirmation shows the ORIGINAL
refusal as a visible "⚠️ שים לב" warning (added to `buildConfirmationMessage`,
which previously never showed `assessment.warnings` at all) so the human
sees exactly what they're overriding before tapping אשר. Separately
confirmed and answered: automatic exit monitoring for a live position
already exists and already goes through the same human-confirmation gate
(`liveExitMirror.mts`'s `checkAutomaticExits`, pre-existing) — no live
position can be silently sold without a Telegram tap either way.

**Telegram/notification fixes:** (1) `driverHe` didn't know about
`applyHigherTimeframeGate`'s 4th confidence-component label — a real buy
alert could read "...· Higher timeframe confirmation (4h), מגמה חזקה",
raw English mid-Hebrew-sentence in the single most frequent notification;
now translated. (2) The move-alert bucket tracker recorded a new price
extreme unconditionally, even when the Telegram send itself failed —
unlike every OTHER alert in this file, a transient failure right at a new
extreme permanently lost that one alert (never retried, since the tracker
already looked "up to date"); now only advances on a confirmed send.
(3) `FileStore`'s corrupt-file recovery was completely silent — now logs
what happened, since combined with the dirty-key merge fix (above,
2026-09-03) a silent corrupt read plus a push race could overwrite origin's
fuller history for a key with zero visibility.

**Deliberately NOT fixed tonight (documented, not silently dropped):**
- `tsconfig.json` excludes `server/` — looked like a real CI gap, but
  verified empirically (a deliberate syntax error injected into
  `liveExitMirror.mts` was caught by plain `tsc --noEmit`): every server
  file touched tonight IS transitively type-checked via `tests/**` imports.
  The `exclude` entry is still misleading and worth removing for clarity in
  a dedicated follow-up, but it is not the silent gap it first appeared to be.
- No workflow runs the full gate on a pull request before merge (CI only
  confirms `main` itself still builds, post-merge) — a real process gap,
  worth a dedicated CI workflow, not something to add as a side effect of
  a bug-fix PR.
- Stocks side has no operational kill-switch trigger (nothing ever calls
  `.engage()` on its `PersistedKillSwitch` — currently dead-code protection,
  same class of gap as the crypto side's `/pause` before that was wired up).
- Systemic: every OTHER "send-once-a-day" gate (digest, weekly/monthly
  report, drawdown/risk-halt alerts, all-clear, education tip) shares the
  same underlying "two overlapping runs could both send" shape the close-
  trade alert had — the state-loss part is now fixed (dirty-key merge), but
  a rare double-SEND during an actual run overlap is still structurally
  possible everywhere, not just where already found.
- UI: a dead `data-nav="home"` back button (Value view) lands on a blank
  screen (Home was renamed to Crypto); a wrong "leading vs Bitcoin" label
  on the Profit tab (checks profit ≥ 0, not vs. BTC's own return, unlike the
  identical check on Home); asset-hub tabs can get stuck on "Loading…"
  forever on a persistent fetch failure with no error surfaced.
- Core engine: `DailyLossTracker.isPaused` treats `dailyLossLimitPct: 0` as
  "always paused" instead of "disabled", inconsistent with `assessTrade`'s
  own convention (0 = off); `positionMonitor.ts`'s risk display uses the
  stale, un-trailed stop once a trailing stop has ratcheted up (currently
  latent — production trailing is off); `positionEngine.ts`'s full-vs-
  partial-exit epsilon (1e-12) is an absolute tolerance that could in theory
  leave dust on a very large-quantity position (small crypto sizes today
  make this a non-issue).
- Stocks: no retry for a network-exception (vs. HTTP-status) transient
  failure in `alpacaStocks.ts` (same pre-existing gap in `krakenPublic.ts`
  too — not new); half-day market closes (Christmas Eve etc.) aren't
  modeled in `isUsMarketOpen` (documented, fails safe — wastes a cycle, no
  wrong trade).

Full gate green throughout (tsc, 1048 tests, build).

## Same push-race fix applied to the stocks runner (2026-09-03)
`server/stocksRunner.mts` deliberately duplicates the crypto runner's
`persistStateToGit` (full isolation by design — see this file's header),
so it carried the exact same `git rebase -X theirs origin/main`
whole-file-discard bug just fixed for crypto (see the entry below).
Applied the identical fix: `FileStore.dirtyKeys()` overlaid onto
origin's latest file on a push race, instead of a git-level rebase that
can silently drop this run's own changes. Full gate green (tsc, 1032
tests, build) — no new tests needed here specifically (the underlying
`FileStore.dirtyKeys()` behavior is already covered; this runner's
`persistStateToGit`, like crypto's, shells out to git and isn't unit-
tested directly).

## Overlapping autopilot runs could silently discard each other's state on a push race (2026-09-03)
David flagged a screenshot showing the SAME paper trade close ("מכירה
ADAEUR... הגיע ליעד הרווח") alerted TWICE in Telegram, 60 seconds apart —
asked me to root-cause it and find anything else needing a fix. Confirmed
via `trade-journal`: the trade genuinely closed ONCE (one journal entry,
15:01:59 UTC) — the duplicate was purely a notification, not a double
sell. But a 60s gap doesn't fit ONE process's own loop (`LOOP_INTERVAL_MS`
defaults to 5 minutes) — it fits TWO overlapping `autopilot.yml` runs,
each on its own ~1-min-offset cycle.

Root cause, traced through `persistStateToGit` (`autopilotRunner.mts`):
on a push race (this session's own `cancel_workflow_run` +
immediate `run_workflow` redispatch pattern, used 4x tonight, can leave
the "cancelled" run still executing for a few seconds/minutes while its
replacement already started — GitHub's own `concurrency: group: autopilot`
prevents true scheduling overlap, but not this narrow tail-end race), the
losing run did `git rebase -X theirs origin/main` — a WHOLE-FILE conflict
resolution that, for the single monolithic `state/autopilot-state.json`
every cycle rewrites, silently discarded ALL of that run's changes to
every key it touched (not just the alerted-id dedup) in favor of the
other run's version. That's how the alert-dedup (`alerted-trade-ids`,
already designed to prevent exactly "a position re-processed") got
reverted right along with everything else, letting the same close get
redetected against stale state next cycle. The SAME mechanism could, in a
worse case, have discarded a live-money key (`live:*` lives in the same
file) — this was a real capital-safety-adjacent gap, not just a cosmetic
notification bug.

Fixed by replacing the git-level whole-file merge with a JSON KEY-level
one: `FileStore` now tracks which keys THIS instance actually
set/removed (`dirtyKeys()`); on a push race, `persistStateToGit` fetches
origin's latest file as the base and overlays only this run's own dirty
keys on top, instead of discarding them. Real loss now only if two
overlapping runs touch the exact SAME key in the same race window — not
the whole file. (Going forward: when redispatching the autopilot
workflow after a merge, poll for the cancelled run to reach a genuinely
terminal state before firing the replacement, rather than firing them
back-to-back.)

Tests: new `FileStore.dirtyKeys()` cases. Full gate green (tsc, 1032
tests, build). `persistStateToGit` itself shells out to git and isn't
unit-tested directly (same as before this change).

## External BTC double-counted the bot's own tracked position once it actually filled (2026-09-03)
Found during a scheduled live-money health check-in, right after the first
real live BTC entry filled (14:40 UTC, PR #146's fix — confirmed working
end-to-end). `syncLiveExternalBtc` (`liveLedger.mts`) sets the "untracked
personal BTC" figure to the ENTIRE broker-reported BTC balance
(`fetchPositions` → Revolut X's `/balances`, which has no notion of
"bot's vs. personal" — it's just the wallet total). Once the bot itself
held a live BTC position, that balance already included it, so the
figure silently absorbed the bot's own position — and `recordLiveEquity`
then double-counted its value in the real-account equity chart: once via
`liveEquity()`'s own tracked-position sum, again via this "untracked"
figure added on top. Purely a reporting/chart bug — never touched
`liveEquity()`'s own trade-sizing path, real cash, or order execution.

Fixed by subtracting the bot's own currently-tracked BTC quantity (summed
from `openLivePositions`, matched by base currency) from the broker's raw
balance before storing it, floored at zero.

Tests: two new cases in `liveLedger.test.ts` — broker balance minus a
tracked position leaves the correct personal remainder, and a momentary
broker/tracked mismatch never reports negative. Full gate green (tsc,
1031 tests, build).

## Bug audit ("תבדוק שאין עוד באגים"): live-entry sizing vs. actual free cash (2026-09-03)
David asked for a general bug check on the live-money code. Ran the
`code-review` skill over the live-money server files at high effort; one
finding was worth fixing: `mirrorApprovedEntries` (`liveEntryMirror.mts`)
sent a Telegram confirmation for any `assessTrade`-approved entry without
checking whether `assessment.positionValue` actually fits in real free
cash (`liveLedger.mts`'s `liveCash`). Under `DEFAULT_RISK_LIMITS` this is
structurally hard to hit (`maxTotalExposurePct` at 60% keeps the
exposure-headroom cap below free cash), but a future/misconfigured
`riskLimits` override (e.g. `maxTotalExposurePct` at or above 100%) or a
cash/position desync could still let a human approve a trade the account
can't actually pay for — wasting an approval that would only bounce at
the broker.

Added a guard right after the existing "not approved" branch: if
`assessment.positionValue > liveCash(store)`, the entry is refused
(`not-approved`, with the specific euro figures in the reason) before
ever reaching the broker or a Telegram confirmation — same shape as the
existing not-approved path, no new `LiveEntryOutcome` variant needed.

Tests: a new case using a deliberately permissive `riskLimits` override
(200% total exposure) to size a 200€ position against 100€ equity/cash,
confirming it's now refused and never reaches the broker. Full gate green
(tsc, 1029 tests, build).

## Confirmation message: show real free-cash before/after, not just the wallet % (2026-09-03)
David asked: with an existing open position already tying up part of the
wallet, does the confirmation message's percentage reflect his TOTAL
wallet, or just what's currently free — and if it can't be made clearly
one or the other, show both. Checked `assessTrade` (`riskEngine.ts`):
`portfolioExposure` was ALREADY `(currentExposure + thisTrade) /
totalEquity` — the entire wallet (cash + every open position's current
value), not just free cash — so the % shown was already correct even with
other positions open. The stale doc comment claiming this "only works
because there are no other open positions right now" was wrong and has
been corrected.

Added the free-cash figures anyway, exactly as he offered ("or show me
both"): the buy confirmation now shows real current free EUR cash
(`liveLedger.mts`'s `liveCash`) before and after the trade, alongside the
already-correct total-wallet %, and the wallet-% lines now say explicitly
"including other open positions, not just the free cash."

Separately answered (not a bug, no code change): he asked why `/buy
XBTEUR` buys Bitcoin — XBT is the ISO-4217-style ticker Kraken/Revolut X
use for Bitcoin (the "X" prefix marks a non-national currency, same
convention as XAU for gold); XBTEUR literally means "Bitcoin priced in
EUR," so this was working as intended.

Tests: a new case confirming the free-cash-before/after line renders with
the right values and the "including other positions" wording. Full gate
green (tsc, 1028 tests, build).

## A genuinely new /buy was rejected as a duplicate order (2026-09-03)
David sent `/buy XBTEUR` again, approved it, and Revolut X rejected it:
`"An order with the client_order_id '...' has already been placed."` —
a real, repeatable bug that would block every future /buy for a symbol
once it had ever been attempted before.

Root cause: `deterministicClientOrderId` (revolutXBrokerAdapter.mts) derives
the client_order_id purely from `intent.id` — deliberately deterministic so
a RETRY of one attempt reuses the same id (idempotency-safety). But
`intent.id` was built as `live-entry:${symbol}` (`liveEntryMirror.mts`) —
identical for every /buy ever made on that symbol, not just retries of the
same attempt. Revolut X remembers client_order_ids it has seen and rejects
reuse, so a second, entirely separate /buy for a symbol that had ever been
attempted before would always collide with the first.

Fixed by embedding the pending entry's own `queuedAt` into `intent.id`
(`live-entry:${symbol}:${queuedAt}`) — `queuedAt` is set once when an
attempt is first queued and stays fixed across retries of that SAME
attempt (until it resolves and is deleted from the pending queue), but a
genuinely later, separate attempt gets a fresh `queuedAt` and therefore a
different client_order_id. Preserves the original idempotency property
(retry-safe) while fixing the duplicate-rejection bug.

Tests: a new regression in `liveEntryMirror.test.ts` capturing the actual
submitted intents across two separate attempts (different ids) plus the
already-existing "resumes a pending entry on a later call" test (same id
across a retry of ONE attempt). Updated the fake broker fixtures in both
`liveEntryMirror.test.ts` and `manualBuyCommand.test.ts` to mirror the
real `RevolutXBrokerAdapter`'s behavior (`report.intentId` always reflects
the submitted `intent.id`, never a caller-fabricated value) instead of
hardcoding the now-outdated plain `live-entry:SYMBOL` format. Full gate
green (tsc, 1027 tests, build).

## Correction to the "production frozen since PR #115" entry: the real limit is Vercel's 100-deploys/day cap, not just cancellation (2026-09-03)
The `autoJobCancelation: false` fix (PR #140) was real and worth keeping,
but it wasn't the whole story — GitHub started posting `vercel[bot]`
comments on PRs #138–#142: `"Resource is limited - try again in 24 hours
(more than 100, code: api-deployments-free-per-day)"`. Checked Vercel's own
docs directly: Hobby plan = 100 real deployments/day, **account-wide**
(scope `owner`, shared across every Vercel project under this account, not
just this one) — but a build SKIPPED via the Ignored Build Step falls under
a separate "skipped deployments per minute" bucket, not this one. So the
autopilot's frequent state-only commits were never the drain on this quota
(they're correctly ignored, confirmed via each one's `buildingAt`→`ready`
gap of ~1.5s and its `errorLink` pointing at the Ignored Build Step docs).
The quota was exhausted by the sheer volume of REAL deployments tonight's
own work created — every PR's branch push (a preview deploy) plus every
merge to main (a production deploy), and this session merged 30+ PRs.

**Practical consequence**: no further production deployment — for anything,
including tonight's already-merged UI work — can succeed until the 24h
window resets. This is a plan limit, not a bug; there is no code fix for
it. Two real options if it recurs: wait for the reset, or upgrade to
Vercel Pro (6,000/day) if this pace of shipping continues.

**Important distinction to keep straight**: this only affects the
Vercel-hosted FRONTEND (the website David opens in a browser). Every
server-side fix from tonight (venue_order_id parsing, BTC tracking, the
digest, the plain-language confirmation message) runs via GitHub Actions
directly against the state file and Telegram — completely unaffected by
Vercel's quota, and confirmed already live in production (the redispatched
autopilot run). Only the visual site is stuck until the quota resets.

## The live confirmation message left David unsure what to approve (2026-09-03)
He sent `/buy XBTEUR`, got the confirmation prompt, and asked me mid-decision
what it meant and whether to approve — he has near-zero trading background
and the message ("כמות: 0.0001185722175581053", "סיכון: 0.30%", "יחס
סיכוי/סיכון 2.0:1") gave him raw numbers with no explanation of what they
mean in practice. Asked for the message itself to explain automatically
going forward, not have to ask each time.

Two real things fixed in `telegramConfirmationGate.mts`'s message builders
(buy and sell/exit):
1. **Every figure now carries a short plain-language gloss** — "מוכר
   אוטומטית אם המחיר יורד לכאן, כדי לעצור הפסד" next to the stop-loss,
   "הכי הרבה שאפשר להפסיד בעסקה הזו" next to the risk amount, "אם זה
   מצליח, הרווח הפוטנציאלי גדול פי X מהסיכון" next to the reward/risk
   ratio, etc. — without dropping any of the original numbers.
2. **A real quantity-formatting bug**: `intent.quantity` was interpolated
   raw into the message — exactly the "raw 15-decimal float" class of bug
   `tidyNoteNumbers` already exists to prevent elsewhere, just never
   applied here. Exported `telegram.mts`'s existing `formatQty` and used
   it in both messages instead.

The sell/exit message also got the same treatment: the P&L line now reads
"+€20.00 (ברווח ✅)" instead of a bare signed number.

Tests: both messages' plain-language phrases are present; the raw
15-decimal quantity never appears verbatim, `formatQty`'s rounded form
does; the exit message's P&L format updated to match (`+€20.00`, was
`+20.00`). Full gate green (tsc, 1026 tests, build).

## Chart crosshair tooltip ran off-screen near either edge (2026-09-03)
Continuing the chart-polish pass (follow-up to #139/#141). `src/ui/charts.ts`
+ `src/ui/equityChartPanel.ts` + `src/ui/views/marketsView.ts` only.

Both places that wire a crosshair (`equityChartPanel.ts`'s `wireCrosshair`,
`marketsView.ts`'s coin-detail `wireChart` — duplicated logic) positioned
`.pchart-tip` with `left: X%` and the CSS default `transform: translate(-50%,
...)`, centering it on the crosshair point. That overflows the phone
viewport for any point within roughly the tooltip's own half-width of either
edge — measured directly on a real 390px viewport: inspecting the first
candle put the tooltip's bounding box at `x: -92`, i.e. ~90px of it rendered
past the left edge and unreadable; the last candle overflowed the right edge
by ~41px the same way. Exactly the "crosshair/tooltip polish" gap next to a
real trading app.

Added `positionChartTip(tip, wrap, leftFrac, topFrac)` to `charts.ts` (the
module both views already import from) — same vertical placement as before,
but horizontal position is computed in the wrapper's actual pixel width and
clamped to a 4px margin on each side, falling back to the old centered
percentage only if the tooltip isn't measurable yet (just unhidden, no
layout pass done). Both call sites now use it instead of inlining the same
percentage math.

Verified directly: re-measured the same left/right-edge hover on the History
chart — bounding box now `x: 30` (left) and `x: 123, width: 237` → right
edge 360, both fully inside the 390px viewport where before they were -92
and 431. Screenshot confirms the tooltip renders fully on-screen.

Full gate green: `tsc --noEmit`, `vitest run` (1014 tests, none touched),
`npm run build`.

## The daily Telegram digest never mentioned the real Revolut X account at all (2026-09-03)
David: "זה צריך להתעדכן לגמרי כי הוא ממש ממש לא מעודכן במיוחד עם הארנק החדש והכסף האמיתי" —
pasted the actual daily digest he receives, and it's entirely about the two
SIMULATED accounts (paper crypto + paper stocks); nothing about the real
wallet's cash, the untracked BTC holding, real open positions, or whether
the kill switch is engaged. The heading even said "(כסף מדומה)" outright.

Added a new "💶 חשבון אמיתי (Revolut X)" section to `buildDailySummary`
(`telegram.mts`) — total equity (cash + bot-tracked positions + the
untracked BTC holding, same total the app's Profit tab shows), the
cash/BTC breakdown, any bot-tracked open positions, and the kill-switch
state. Built from a new `readLiveSummary` (`autopilotRunner.mts`), reusing
`liveLedger.mts`'s existing helpers (`liveCash`, `liveExternalBtcQuantity`,
a new `hasLiveAccount` to distinguish "real money never enabled" from a
genuine €0 balance — mirrors the UI's own `parseLiveAccountState`
convention) plus `openLivePositions` and `PersistedKillSwitch`. Also
dropped the now-inaccurate "(כסף מדומה)" from the digest's own heading,
since it's no longer purely about simulated money.

Deliberately reporting-only: nothing here touches `liveEquity()` (used to
SIZE a live entry's risk) — the real account's digest section is built
entirely separately, so a text summary can never accidentally change how
much the bot risks on a trade.

Tests: `readLiveSummary` (null with no live account; cash-only; adds the
external BTC value without affecting the live-position figure; a
bot-tracked position marked to price; kill-switch state and reason) and
`buildDailySummary`'s new section (additive to the crypto/stocks sections,
omitted entirely with no live data, shows the external-BTC line only when
there is one). Full gate green (tsc, 1024 tests, build).

## Chart range/mode switches hard-snapped instead of fading (2026-09-03)
Continuing David's chart-polish request. `src/ui/equityChartPanel.ts` +
`src/ui/views/marketsView.ts` only.

The coin-detail market chart already fades out/in on a range or Candles/Line
switch (`.detail-chart.fade-out`/`.fade-in`, wired in `marketsView.ts`) — but
two real gaps meant "animation smoothness on data updates" wasn't actually
delivered anywhere it mattered most:

1. **The fade-in never fired, even on the market chart.** Both handlers
   queried `.detail-chart` once, added `fade-out`, then after the repaint
   (`paint()` replaces `detailView.innerHTML`) reused that SAME element
   reference to add `fade-in` — but the repaint had already detached it from
   the document. The class landed on an orphaned node with zero visible
   effect, so every range/mode switch actually just faded OUT then hard-
   snapped back in, never faded in. Fixed by re-querying `.detail-chart`
   from `detailView` after `paint()` resolves, before adding `fade-in`.
   Confirmed via `getComputedStyle` sampling over the transition window:
   opacity now climbs 0 → 0.46 → 0.85 → 0.97 → 1 instead of jumping straight
   to 1 the instant the repaint lands.
2. **The equity chart (History/Profit/the new Real-money card — all
   `equityChartPanel.ts`) had no transition at all.** Its range-bar and
   Candles/Line toggle just called `paint()` directly, an instant hard cut on
   every tap — on the exact screens David actually opens most. Added a
   `repaintWithFade()` wrapper (same 200ms fade-out / 300ms fade-in timing as
   the market chart, and the same re-query-after-repaint fix from above) and
   wired it to both button groups; the very first render (`setHistory`'s
   initial `paint()`) is untouched, so there's no needless fade on first
   load.

Verified: `getComputedStyle` sampling of `.detail-chart` opacity across a
range switch shows the fade curve above, not a snap. Full gate green: `tsc`,
`vitest run` (1014 tests, including the existing `waitFor`-based
marketsView range/mode-switch tests, all passing unchanged since they
already awaited the repaint), `npm run build`.

## The production site had been frozen for ~11 hours — every real PR since #115 never actually deployed (2026-09-03)
David's screenshots showed the "Real money" card missing the BTC breakdown and equity chart just shipped in a previous entry — checked whether it was a UI bug (it wasn't) before checking Vercel directly. Found: the live production alias (`automatic-trading-ai-dp1565-project.vercel.app`) was still serving the build from **PR #115** (merged 02:38 UTC) — confirmed by fetching the alias's actual deployment record AND by curling its served JS/CSS bundle hashes, which matched neither a fresh local build nor anything since. Every `target: production` deployment since then — dozens, spanning PR #116 through tonight's redesign and bugfix PRs — shows as `CANCELED` in the Vercel API.

Root cause: `vercel.json`'s `ignoreCommand` (added earlier to skip building on the autopilot's own frequent `Autopilot state (mid-run cycle N/70)` commits, so its ~5-minute state-only pushes wouldn't burn a deploy each time) is logically correct on its own, but Vercel's default GitHub behavior cancels an in-progress/queued deployment the instant a NEWER push lands for the same branch — and since those state commits land roughly every 5 minutes, a real PR's merge-to-main deployment gets raced out before it ever reaches the point of running its own build (or even its own ignoreCommand check): the next state commit's push pre-empts it first. PR #115 apparently just got lucky with a wide-enough gap; nothing since has.

Fixed: added `"github": {"autoJobCancelation": false}` to `vercel.json` — Vercel now builds every push in sequence instead of cancelling one for the next to arrive. Combined with the existing `ignoreCommand`, autopilot-state pushes still skip near-instantly (no real backlog), but a genuine code push finally gets to run its own check and build instead of being perpetually raced out by the next commit.

Consequence checked: this explains a real chunk of tonight's "why doesn't the site reflect what you did" confusion — it wasn't (only) the tab-visibility bug fixed earlier; the whole redesign, the real-money UI, and both fixes in the previous entries had never reached the live site at all. This same commit (once merged) is the first real test of the fix — it should be the first production deployment to actually go READY since 02:38, verified after merge via the Vercel API and by re-curling the live site's bundle hash.

## Chart polish: leftover pre-true-black pill glow, and a misleading EMA line on the equity chart (2026-09-03)
Continuing David's "keep improving the charts" request, scoped to `charts.ts`
+ `equityChartPanel.ts` + `styles.css` only. Two real, concrete defects found
by screenshotting the built chart (Playwright, `?demo=1`, 390×844, with
`page.route()` intercepting the state-fetch URL with a synthetic multi-week
equity-history fixture so the History/Profit charts actually render):

1. **Leftover pre-true-black gradient + white glow on the range/toggle
   pills.** The true-black pass (#133) flattened every active-pill background
   and explicitly removed white outer glows app-wide (`.mk-tab.active`,
   `.hub-tab.active` → flat `var(--surface-raised)`, no shadow) — but missed
   the chart's own controls, which live in the shared chart panel rather than
   a Home/Markets tab bar: `.range-btn.active` still carried the old two-tone
   `linear-gradient(155deg, var(--accent), var(--accent-2))` **plus**
   `box-shadow: 0 3px 10px rgba(255,255,255,.3)` (the exact glow #133's own
   entry says was removed elsewhere), and `.ctoggle-btn.active` /
   `.view-tab.active` (coin-detail's Candles/Line toggle and Chart/Stats/
   Orders tabs) kept the same stale gradient without the glow. All three now
   match `.mk-tab.active`'s flat fill, so every segmented-pill control in the
   app is visually consistent.

2. **EMA20/EMA50 + support/resistance lines on the portfolio EQUITY chart.**
   `candleChartSvg` (shared by market/coin-detail charts AND the equity/
   History/Profit chart via `equityChartPanel.ts`) draws these as
   technical-analysis overlays for a tradable asset's *price*. On an equity
   curve there's no asset to read a trend signal off — and visually it was
   worse than just pointless: EMA20 needs 20 candles to warm up, so on any
   range with 20-49 bucketed candles (very common — the 'All' range only
   reaches ~30 target candles) the line rendered as a single straight
   diagonal segment starting abruptly mid-chart with a hard corner, reading
   as a rendering bug next to the candles' real zigzag. Same "misleading
   overlay" reasoning as the RSI-bands/MACD-bars removal already on record
   in `charts.test.ts` ("candleChartSvg misleading overlays removed") — this
   is a continuation of that fix, not a new opinion. Added an `indicators`
   option to `candleChartSvg` (default `true`, so every market-chart call
   site is byte-for-byte unaffected) and set `indicators: false` only from
   `equityChartPanel.ts`; also skips the always-zero-height volume bars the
   equity chart's bucketized samples produce (no real trade volume exists
   for an equity point), which were harmless but dead SVG. Verified
   before/after: the stray diagonal line and "S" label are gone from the
   History chart's candle view; `charts.test.ts`'s existing EMA-rendering
   assertions (default-on behaviour) still pass unchanged since they exercise
   the un-flagged call path.

Full gate green: `tsc --noEmit`, `vitest run` (1012 tests, none touched —
the new option defaults to the prior behaviour), `npm run build`.

## A real FILLED order was reported to David as rejected (2026-09-03)
He ran `/buy XBTEUR` from Telegram, approved it, and Revolut X actually
FILLED it (confirmed directly in the Revolut X app: Limit Buy BTC-EUR,
+0.00014803 BTC, €10.01, status Filled) — but the bot's own message said
"❌ הבורסה דחתה את ההזמנה — Revolut X response missing venue_order_id".
Root cause: `readVenueOrderId` (`revolutXBrokerAdapter.mts`) only ever
accepted Revolut X's documented placement-response shape
(`{data: [{venue_order_id, ...}]}`, verified against their own docs this
session) — whatever the real response body was for this fill didn't parse
against that shape, and the code discarded the raw body before reporting
the failure, so there's no way to know exactly what shape it actually was.

Fixed two things: `readVenueOrderId` now also accepts `data` as a bare
object (the same single-resource convention `readOrderDetail` already uses
for the sibling GET-order-detail endpoint) as a defensive fallback,
without weakening the documented array case, which is still tried first;
and the failure path now includes the raw response body in the audit
detail (matching the sibling `!placed.ok` branch, which already did this)
so a repeat is diagnosable instead of silently discarded.

Real-world consequence checked: `live-cash-eur` self-corrected anyway on
the next cycle (it always reconciles against the broker's real balance,
regardless of what this order was reported as), but `live-open-positions`
never recorded this fill, so the bot had no stop-loss/take-profit tracking
on it — the exact position-level risk-management gap capital protection
exists to prevent. Flagged to David directly rather than guessing whether
to auto-backfill it with a fabricated stop-loss.

Tests: a bare-object `data` response now still resolves to 'filled'; an
unparseable response's rejection detail contains the raw JSON. Full gate
green (tsc, 1014 tests, build).

## Track the untracked BTC holding + chart it; fix the bottom-nav jitter (2026-09-03)
Two separate David reports:

1. He moved money into Revolut X by converting EUR→BTC directly, then sold
   about half back to EUR for the bot to trade with, keeping the rest
   (~0.00075 BTC) as a personal holding the bot never opened. He asked for
   it to be tracked and charted anyway, not left invisible.
2. The bottom nav "still jumps and isn't stuck where it should be" on his
   phone — a known WebKit/mobile-Chrome issue: a `position: fixed` element
   offset from the viewport edge (`bottom: 20px`, not `0`) gets relaid-out
   as the address bar collapses/expands on scroll, visibly snapping to a
   new spot. Fixed with the standard remedy: forcing `.bottom-nav` onto its
   own GPU-composited layer (`translateZ(0)` + `backface-visibility: hidden`
   + `will-change: transform`) so the browser tracks it as a stable
   composited layer instead of relaying it out on every toolbar-animation
   frame. Could not verify the jitter itself is gone — that's real
   mobile-Safari/Chrome toolbar-collapse behavior no headless browser
   reproduces — so this needs a check on an actual phone.

For (1): kept `liveEquity()` (used to SIZE live trades) completely
untouched — the BTC isn't cash the bot can spend, so it must never affect
position sizing. Added a separate reporting-only path instead:
`syncLiveExternalBtc` (liveLedger.mts) reconciles the real BTC balance from
Revolut X's own `/balances` response each cycle (same no-op-on-failure
safety as the existing EUR cash sync), and `recordLiveEquity` appends a
point to a new `live-equity-history` series — cash + tracked positions +
this BTC valued at the current XBTEUR price — every cycle, mirroring how
the simulated portfolio already charts itself
(`autopilotRunner.mts`'s `recordEquity`/`EQUITY_HISTORY_KEY`).

UI: the Profit tab's "Real money" card now shows a Cash/BTC-holding
breakdown and its own equity chart (reused `mountEquityChartPanel`, which
previously hardcoded a "SIMULATED" tag on its built-in "Now" hero — added
a `live` option so this real chart correctly says "REAL" instead). Home's
Overview real-money line got the same breakdown for consistency between
tabs (the exact kind of cross-tab mismatch flagged in the entry below).

Tests: `syncLiveExternalBtc`/`recordLiveEquity` (liveLedger.test.ts) —
records the broker's BTC balance, no-ops on a fetch failure, and proves
`recordLiveEquity` never changes what `liveEquity` returns (the sizing
function). UI tests cover the breakdown text and that the server-recorded
equity wins over the local cash-only fallback. Full gate green (tsc,
1012 tests, build) — visually verified both tabs render correctly with a
mocked live-account state (real network to the committed state file isn't
reachable from this sandbox), screenshots at 390×844.

## Real money was invisible on the History and Profit tabs (2026-09-03)
David reported the real wallet "still isn't reflected everywhere and still
shows the demo money" — but nothing was stale. The real-money card had only
ever been added to the Overview sub-tab (`homeView.ts`). History and Profit
are rendered by the shared generic shell (`assetHubView.ts`, used by both
Crypto's and Stocks' hubs), which only ever knew about the SIMULATED
`CloudState` fields (`equityHistory`, `history`, `initialCash`) — it had no
real-money awareness at all, so those two tabs kept showing only simulated
figures with nothing beside them to say so.

Fixed in `assetHubView.ts`: added a "Real activity" section to History
(shows `state.live.recentEvents` as FILLED/REJECTED rows) and a "Real
money" section to Profit (shows `live.cash + Σ(position qty × entryPrice)`
as real equity). Both are hidden entirely when `state.live` is null (e.g.
Stocks, which has no live account), matching the convention Overview
already uses. Also labelled Profit's existing "Total return" hero
`SIMULATED` for symmetry with the new real card, so the two are never
mistaken for each other.

Tests: hides both sections when `state.live` is null; shows real activity
content and correct real-equity math (50 cash + 0.001×95000 = 145) once a
live account exists. Full gate green (tsc app, 1005 tests, build).

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
starved his separate Bet-El siddur app of deploys for two days). That was
then replaced with `ignoreCommand` (skip the build for `Autopilot state`/
`Stocks autopilot state` commit messages) on the assumption that a skipped
build doesn't count against the quota.

**That assumption was wrong (found 2026-09-03 while account-wide deploys were
being exhausted again).** Per Vercel's own docs, `ignoreCommand` only skips
the *build* — the deployment record is still created (as `CANCELED`) and
still counts toward the 100/day quota. Live data confirmed it: of the most
recent ~60 deployments on this project, ~78% were `CANCELED` autopilot/stocks
state pushes, still eating the shared account quota exactly as before.

Fixed properly now: `vercel.json` uses the per-branch form of
`git.deploymentEnabled` to disable deployments for `main` specifically
(`{"main": false}`), while every other branch (PR previews) is unaffected —
branches not listed default to `true`. This means **zero** deployment records
are created from `main` at all, whether from the bot's state commits or from
a real PR merge. That's safe here because GitHub Pages
(davidpit1565.github.io/automatic-trading-ai) is the actual primary,
continuously-updated live dashboard (see README.md) — Vercel's `main`
deployment was only ever a secondary mirror, never load-bearing. PR-branch
preview deployments on Vercel (used for visually reviewing UI work before
merge) keep working exactly as before.

No runner/workflow changes were made — `persistStateToGit` in
`autopilotRunner.mts`/`stocksRunner.mts` still pushes state to `main` exactly
as before (real money went live 2026-09-03; that git-persistence path is not
something to touch without a strong reason). This fix is Vercel-config-only.

**Follow-up, same day**: after merging, verified live via the Vercel API that
`main` pushes (bot and real merges alike) correctly stopped creating
deployments — but `deploy-pages.yml` force-pushes `dist/` to `gh-pages` on
every push to `main`, and that branch wasn't covered by the `main`-only
exclusion, so it kept creating its own (CANCELED) Vercel deployment each time
it settled (throttled somewhat by that workflow's own `cancel-in-progress`
concurrency group, but still non-zero). Added `"gh-pages": false` alongside
`"main": false` in `deploymentEnabled` — GitHub Pages serves `gh-pages`
directly, so Vercel building that branch was always redundant, not just for
the bot's commits.

**Second follow-up, same day**: also found a small residual leak — `gh-pages`
still produced an occasional `CANCELED` Vercel deployment despite the
exclusion above, likely because `deploy-pages.yml` force-pushes a brand-new
orphan history to `gh-pages` every run rather than an incremental update,
which may confuse Vercel's per-branch matching. Added `ignoreCommand` in
`vercel.json` as an independent second check (reads `$VERCEL_GIT_COMMIT_REF`
at build time) so the build itself is always skipped for `main`/`gh-pages`
even on a `deploymentEnabled` miss — stops wasted build compute, though the
CANCELED record can still tick the quota on that rare miss. Then found the
actual dominant residual source: `deploy-pages.yml` ran (and force-pushed a
fresh `gh-pages`) on *every* push to `main`, including the bots' own
state-only commits (dozens/day) — added `paths-ignore: [state/**]` there so
it only runs for real code changes, cutting `gh-pages` pushes from "every
few minutes" to "a few times a day" (normal PR-merge cadence).

**Known accepted trade-off**: disabling `main` in `deploymentEnabled` was the
only way to stop the autopilot bots' frequent `main`-branch state commits
(they push directly to `main`, not through any workflow this repo can path-
filter) from exhausting the account-wide Vercel quota — but it means Vercel's
own production URLs (`automatic-trading-ai.vercel.app` and the `git-main`
alias) now **never update again**, real code changes included, since Vercel
can't distinguish a bot commit from a real one at the branch level. Confirmed
2026-09-04: those URLs still serve the build from just before this fix
(`index-4LQ5VYXt.js`) while GitHub Pages is fully current
(`index-q0Drm1xS.js` and later). This is an accepted trade-off, not a bug —
GitHub Pages is the actual primary, continuously-updated site either way.
`deploy-pages.yml` had an optional "Refresh Vercel mirror" step (a Vercel
Deploy Hook, ref `main`) meant to fix this — David created the hook via the
Vercel dashboard and added its URL as the `VERCEL_DEPLOY_HOOK_URL` repo
secret. **Tested 2026-09-04 and confirmed not to work**: the hook call
itself succeeded (`{"job":{"state":"PENDING",...}}`), but `list_deployments`
showed **zero** new deployment records were ever created from it, even
minutes later — `git.deploymentEnabled: {"main": false}` turns out to block
Deploy-Hook-triggered builds for that ref too, not just git-push-triggered
ones (unlike `ignoreCommand`, which still creates a `CANCELED` record; this
blocked the deployment from being created at all). So a Deploy Hook against
a disabled branch can never work as a workaround.

**Real fix, same day**: removed the Deploy Hook entirely and dropped
`"gh-pages": false` from `deploymentEnabled` (and the matching
`ignoreCommand` clause) in `vercel.json` — now only `main` is disabled.
This is safe now (wasn't, when `gh-pages` was first excluded) because
`paths-ignore: [state/**]` in `deploy-pages.yml` already made every
`gh-pages` push real-code-only; there is no longer any bot noise on that
branch to guard against, so every `gh-pages` push is exactly one Vercel
should build. Vercel's own git integration now deploys `gh-pages` normally
on every real code change — no hook, no secret, no manual dashboard step.
`main` stays disabled (the autopilot bots still push state there directly,
dozens of times a day) so the account-wide quota risk this whole effort
started from remains fixed.

**Verified via Vercel API, same day**: pulled every deployment on this
project and confirmed the `main`-branch fix has held perfectly since PR
#165 merged (2026-09-03T22:45:05Z) — every single `CANCELED` deployment
with `githubCommitRef: "main"` (autopilot/stocks-autopilot state pushes,
several per hour) has a timestamp strictly *before* that merge; zero after
it. So the original root cause (bot noise on `main` burning the quota) has
been fully stopped, not just theoretically fixed.

**However**, opening PR #174 (the gh-pages/Deploy-Hook fix above) hit a new
symptom: its own PR-preview build immediately failed with Vercel status
`"Deployment rate limited — retry in 24 hours."` This is the account-wide
100/day quota, still exhausted right now from the pre-fix burn earlier
today (dozens of CANCELED `main` + `gh-pages` deployments accumulated
before #165/#167/#169/#170 fully landed) — not a new leak, and not
something any further config change can clear immediately. It's a hard
daily cap that resets on Vercel's own rolling window as those old
deployments age out. No further leak source has been found — the fix is
already in place, the account just needs the clock to catch up.

**Final resolution, same day**: the rate-limit theory above turned out moot
— the Deploy Hook itself was confirmed not to work at all (see PR #174:
`git.deploymentEnabled: {"main": false}` blocks Deploy-Hook-triggered
builds for that ref too, producing zero deployment records despite the
hook call succeeding). Fixed by dropping `gh-pages` from `deploymentEnabled`
instead — but by the time PR #174 merged and its own gh-pages push should
have tested the fix, the Vercel project for `automatic-trading-ai` was
found to no longer exist at all: gone from `list_projects`, and both
`automatic-trading-ai.vercel.app` and the `git-main` alias return
`DEPLOYMENT_NOT_FOUND`. **David confirmed he deleted the Vercel project
himself** — "it didn't need to be there." This closes out the entire
multi-day Vercel-quota saga (#165/#167/#169/#170/#173/#174): there is no
Vercel project for this repo anymore, so there is no quota risk and no
mirror to keep in sync. GitHub Pages remains the sole, actual production
site, exactly as it always effectively was. `vercel.json` was deleted from
the repo as dead config (nothing reads it anymore).

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

## Full-system safety audit + two live untracked positions (2026-09-03)

David reported `/sell XBTEUR` and a Telegram confirm-tap getting zero
response for hours. Root-caused (and fixed, in order): (1) three external
fetches with no timeout (telegram.mts, okxPositioning.ts,
autopilotRunner.mts's callGemini/callClaude) — any could cause a
multi-hour cycle hang; (2) a dual-Telegram-offset bug — manual command
handlers and TelegramConfirmationGate polled through the `live:`-prefixed
store while every other handler used the shared unprefixed one, so a
command captured by the wrong side vanished forever; (3) confirmation
callback_data embedded `${sentAt}:${intent.id}` directly — an exit
intent's id (original entry id + its own `:exit:<ts>` suffix) can exceed
Telegram's 64-byte callback_data limit, silently failing the ENTIRE
sendMessage call (an exit confirmation for a real open position never
reached Telegram at all). Fixed with a short hash-based
`confirmationToken` (telegramConfirmationGate.mts).

David then asked for a full audit, "0 mistakes." Four parallel review
passes found and fixed: two more missing-timeout fetches
(blackoutCalendar.mts, workflowWatchdog.mts); the crypto/stocks runners'
FINAL loop cycle skipped the safe git dirty-key merge, relying on the
workflow YAML's weaker whole-file `git rebase -X theirs` fallback — now
every cycle including the last uses the same safe merge; a raw float
quantity/price was sent to Revolut X (`String(intent.quantity)`) instead
of a rounded value close to what the human actually approved in the
Telegram confirmation — added `safeDecimalString`
(revolutXBrokerAdapter.mts).

**The most serious finding was live, not hypothetical.** A real ADAEUR
buy (~42 ADA, confirmed filled directly in the Revolut X app) went
completely untracked internally — no stop-loss/target, invisible to
`/sell`, its outstanding-entry guard never recorded either — because the
follow-up order-status read failed right after a successful placement,
and `submit()` reported `state:'submitted', filledQuantity:0`,
indistinguishable from a genuinely-read "nothing filled yet" resting
order. Fixed: both this case AND a "duplicate client_order_id" rejection
(strong evidence an earlier attempt already went through — Revolut X has
no order lookup by client_order_id to confirm either way) now
auto-engage the kill switch and force manual verification, instead of
silently treating an unknown outcome as safe.

**This exact gap then bit a SECOND time within the hour** — this time
because cancelling a stuck/slow workflow run (to deploy the fixes above)
killed the process mid-cycle, after a manual `/buy ADAEUR` retry had
already placed a real order and notified Telegram, but before
`runCycle`'s end-of-loop git persist ever ran. Root cause: per-cycle
persistence only helps once a WHOLE cycle completes, and `runLiveMirror`
can place several real orders (sell, manual buy, auto-entry, automatic
exit) inside one cycle. Fixed: `persistStateToGit` now runs immediately
after each of those four action points inside `runLiveMirror`, not only
once at the very end (autopilotRunner.mts).

**Still owed, not yet done**: manual reconciliation of (at least) two
real Revolut X positions this gap left untracked tonight — an ADAEUR buy
from the first incident (~42 ADA, exact fill price/quantity not
independently confirmed) and a second ADAEUR order (venue id
`8bcdef64-8727-4c50-be06-ac5b47078a8b`, last known status `new`/resting)
from the second incident. Neither was hand-added to
`live-open-positions` — deliberately, rather than guessing exact
numbers into a real-money state file without a source of truth to check
against (this project has no Revolut X credentials available outside
GitHub Actions secrets). Whoever picks this up next: check the real
Revolut X app for the account's actual current ADAEUR holding and cost
basis, then reconcile `state/autopilot-state.json`'s
`live:live-open-positions` (and `live:live-entry-outstanding-symbols`,
which likely still needs `ADAEUR` added/cleared correctly) to match
reality before further ADAEUR activity.

Also learned operationally: cancelling a live GitHub Actions run to
deploy a fix is not free — if a cycle is mid-flight past its own real
action but before persistence, cancelling can itself cause the exact
"real fill, lost bookkeeping" bug this session spent hours fixing. Now
mitigated by the fix above (persist after every action point, not just
per-cycle), but still worth checking a run isn't mid-cycle-with-recent-
Telegram-activity before cancelling it, not just "it looks stuck."

## 2026-09-04: the mid-cycle-persist fix caused its own regression (ENOBUFS), then a follow-up gap

The "persist after every action point" fix above (2026-09-03) turned out
to spawn far more git subprocesses per cycle than expected — routine
Telegram-offset polling dirties the store almost every cycle, so with
constant external pushes racing it, all 4 new call sites hit their full
retry path nearly every cycle for hours. After ~90 minutes this
exhausted the runner's process/pipe resources: every persist attempt
started failing silently with `spawnSync ENOBUFS` for the rest of that
run (found by fetching the cancelled run's job logs directly). Fixed by
gating all 4 mid-cycle persists behind a new `hasSubmittedOrder(outcomes)`
check — only persist immediately when a real broker order actually
submitted (`outcome === 'submitted'`), not on every dirtying poll — and
reducing the retry loop from 5 to 3 attempts (autopilotRunner.mts).

A full-system audit (requested explicitly: "check there's no bug, 0
mistakes") then found one narrower related gap: `proposeLiveExit`
(liveExitMirror.mts) ran its post-fill bookkeeping (`markExitSubmitted`,
`creditLiveCash`, etc.) BEFORE `return result`, with no internal
try/catch — if bookkeeping threw, the exception escaped before the
caller ever got a `result` to push, so the caller's own outer catch
substituted a misleading non-`'submitted'` outcome, hiding from
`hasSubmittedOrder` that a real order had already reached the broker.
Confirmed the entry-side equivalent (`mirrorApprovedEntries`) does NOT
have this bug (pushes its outcome before running bookkeeping). Fixed by
wrapping the bookkeeping block in its own try/catch so `return result`
always runs regardless; added a regression test
(`tests/server/liveExitMirror.test.ts`) with a throwing `onRealizedPnl`
that asserts the outcome still comes back `'submitted'`.

Also cleaned up orphaned bookkeeping left over from the 2026-09-03
manual reconciliation: a queued exit for the already-removed XBTEUR
position (`live:live-exit-pending`), two stale confirmation-gate entries
for superseded ADAEUR/XBTEUR intents (`live:confirmation-gate-pending`),
and 6 stale Telegram button-tap callbacks referencing those same
intents (`telegram-unclaimed-callbacks` and its `live:`-prefixed
counterpart) — none of it referenced the current real position
(`live-entry:ADAEUR:manual-reconcile-20260904`); logged as one audit-log
entry rather than silently edited.

## Profits/market-scan pass: baseline re-measured on the widened universe, BREAKOUT lead investigated and correctly rejected on live evidence (2026-09-04)

David asked for a general profits + market-scan improvement pass (a separate
session handled safety). Per this file's history, parameter space (confidence
floor, RSI ceiling, trailing/target geometry, timeframe, cost sensitivity) was
already exhaustively swept and closed out on the OLD 10-symbol universe
(2026-07-27 through 2026-08-31) — nothing there was reopened without new
information. The one thing that had actually changed since the last honest
scoreboard run is the traded universe itself: `CURATED_INSTRUMENTS` grew
10→20 symbols on 2026-09-03, but `sweepAutopilot.mts` and `foldRobustness.mts`
(the harnesses that replay the REAL shared-account autopilot / pool real
per-symbol trades into folds) still hardcoded `slice(0, 10)` — silently
measuring only half of what production actually trades. Widened both to
`slice(0, 20)` (measurement-only change, zero effect on trading behaviour;
`discoverCryptoCandidates.mts`/`validateStrategy.mts` were unaffected since
they already used the real curated list or explicit candidate lists).

**Re-measured current baseline, real Kraken data, all 20 traded symbols**
(`sweepAutopilot.mts`, `PROD live (no trail, current)` = the exact config
running today — regime EMA50 + confRisk .5-1% + BTC market-regime EMA50 +
80% exposure cap, no trailing):

| Window | buy&hold BTC | buy&hold basket(20) | PROD live | trades | OOS ret | OOS PF |
|---|---|---|---|---|---|---|
| 1h entry / 30d | +24.52% | +37.57% | **+17.95%**, PF 4.08, win 70.4% | 27 | +1.06% | 1.51 |
| 4h entry / 120d | +11.28% | +10.82% | **+0.75%**, PF 1.53, win 40.0% | 10 | +1.49% | 1.78 |
| 1d entry / ~2y | -27.28% | -54.08% | **-3.44%**, PF 0.00 (0 wins) | 5 | -1.28% | 0.00 |

Same pattern already documented on the old 10-symbol universe, now confirmed
on the current 20: production is profitable with a real, fold-plausible
sample when the market is flat-to-trending, defends capital hard in a crash
(beats both benchmarks by 24-51 points in the 2-year down window by trading
almost nothing), and structurally lags a strong bull run (this window's ~7-20pt
BTC/basket gap) — the same accepted, already-explained tradeoff from
2026-08-21, not a regression from widening the universe.

**A real lead surfaced, then was correctly killed by live evidence — exactly
the workflow this file's methodology exists for.** On the widened universe,
BREAKOUT (already a shadow candidate, never production) looked meaningfully
better than every prior measurement of it: `sweepAutopilot.mts`'s 4h/120d
window showed +42.74% return, PF 2.51, 86 trades, OOS PF 3.25; `foldRobustness.mts`
(pooled per-symbol folds, real Kraken) cleared **2/3 folds on all three
timeframes tested** (1h: PF 1.08/233 trades; 4h: PF 1.29/187 trades; 1d: PF
1.04/148 trades) — every other family/geometry tested this session (PROD,
target-3R, mean-reversion, three trend-following geometries) still failed
0/3 or 1/3, matching this file's entire prior history. This is the most
consistent backtest result for a non-momentum family this project has ever
measured, and it is directly explainable: the 10 coins added 2026-09-03 are
smaller, more volatile alts (HNT/VELO/AERO/ENA etc.) with real breakout moves
the original 10 majors rarely produce.

**Checked against the one thing that outranks any backtest: `breakout`'s own
live forward record** (`shadowStandings.mts`, reads real cycle-by-cycle data
the candidate could not have been fitted to). Over 37.9 days and **147 real
trades** — comfortably past this file's own 20-trade trust bar —
`breakout` has actually returned **-2.05%, PF 1.18, 40% win rate**, while the
production-mirror shadow candidates sit at **+6.48%, PF 2.14, 62% win** on the
same real bars over the same window. The backtest and live reality disagree,
and reality wins: **not promoted.** (One extra data point in the same
standings, not actionable yet: `whale-flow` leads everything at +7.63%/PF 2.90
but only 17 trades, 3 short of the trust bar — worth reading again once it
clears 20, not before.)

**Also deliberately not chased**: "TF far target late trail" (far ATR target
+ late trail, same momentum family) cleared 3/3 folds on the 1h/30d window
(PF 2.29, 116 trades) — but failed on 4h/120d (0/3, PF 0.54) and 1d/2y (1/3,
PF 0.35), the exact knife-edge-across-timeframes signature this file has
flagged as overfitting before (2026-07-29's lookback/rebalance sensitivity).
A result that only survives on one timeframe is noise dressed as a lead, not
a candidate to backtest further or shadow.

**Not re-run**: `discoverCryptoCandidates.mts`'s weekly market-scan already
ran 2026-09-03 (yesterday) and is what produced the 10-symbol expansion above
— re-running it 24 hours later against the same market was judged very
unlikely to surface anything the previous run didn't already see, and skipped
per this file's own "never re-read/redo unchanged work" discipline rather
than spending the API calls to confirm the obvious.

**Nothing shipped to strategy, sizing, confidence, or the curated universe.**
The only kept change is the two-line measurement-tooling widening above
(`sweepAutopilot.mts`, `foldRobustness.mts`), verified with the full gate:
tsc clean, 1132 vitest passed, vite build ok.

## Coin discovery re-run wider: nothing added, real blocker found (2026-09-04)

David asked to "add more coins, no bugs this time." Read
`scripts/discoverCryptoCandidates.mts` and its shared engine
(`src/core/validation/candidateScan.ts`) fully first. Finding: the pool was
NOT a fixed list — `scanCandidates` already ranks by real 24h volume from
Kraken's live `AssetPairs`/`Ticker` (520 online EUR pairs total, 20 already
curated), so genuinely all of Kraken's EUR market is reachable already; the
only narrow thing was `DEFAULT_TOP_N` capping the weekly scan at the top 40
non-curated pairs by volume.

Ran `npx tsx scripts/discoverCryptoCandidates.mts 80` for real against
Kraken (real ~720 1h + 720 4h candles/symbol, live decision pipeline,
production criteria — same methodology as every prior addition). Sample
size: 80 symbols, ranks 21-100 by 24h volume. 33 passed the scan's loose
bar (net-positive, PF>1, >5 trades) — but most of those 33 sit on the
`MIN_TRADES_TO_TRUST` floor (6-9 trades over one 30-day window), the exact
small-sample pattern this project's own history (ARB, FORTH, BCH/TRX) has
repeatedly rejected as "too thin to call." Applying the stricter bar
actually used for every past addition (≥10 trades, clearly-positive PF, not
a coin-flip) narrows it to ~14 candidates with real signal in this single
window: USELESS, PUMP, XMR, SPX, CRV, DASH, ZRO, BONK, OP, SYRUP, MINA, TIA,
CHIP, PENDLE (trades 10-17, PF 1.24-3.78). Re-confirmed BCH (-0.40%, PF
0.82) and NEAR (-0.99%, PF 0.79) still fail, consistent with the existing
"left out" record in `krakenPublic.ts` — not new news either way.

**Nothing was added to `CURATED_INSTRUMENTS`, even from that narrowed list,
because of a real architectural blocker the "no bugs" checklist explicitly
asked to check for and found:** `server/autopilotRunner.mts` trades exactly
`instruments.value.slice(0, 20)` — a hardcoded count matching today's 20
curated entries, not `CURATED_INSTRUMENTS.length`. Appending any new symbol
to the array would NOT make the live agent trade it (silently excluded by
the slice) while `CURATED_BASES` (derived from the same array, drives the
UI's "TRADED" badge) would still claim it as traded — a real, user-visible
lie, exactly the class of silent bug this session was asked to avoid. Fixing
that slice lives in `server/autopilotRunner.mts`, which is the live
real-money path this task was explicitly scoped OUT of touching — so this
is reported, not fixed, per that instruction. **Whoever adds coins next:
the slice bound in `autopilotRunner.mts` must move in the same reviewed
change as any `CURATED_INSTRUMENTS` addition, never after it.** The 14
candidates above are a reasonable starting shortlist once that's true, but
should be re-measured fresh at that time rather than trusted from tonight's
single window — one 30-day window per symbol is exactly the "single lucky
window" this project's own rigor bar warns against, several of the 14 are
recently-listed/meme-adjacent tokens (USELESS, PUMP, SPX) worth extra
scrutiny beyond the raw numbers, and there is no live shadow forward-test
record for any of them (they've never been traded) to cross-check the
backtest against, unlike the BREAKOUT rejection earlier tonight.

**Shipped instead, small and safe:** widened the weekly scan's own search
breadth, `DEFAULT_TOP_N` in `candidateScan.ts` (40 → 80) and the matching
workflow default in `discover-crypto-candidates.yml` — this is the
discovery scan's measurement breadth, not a trading/strategy/sizing
parameter, and it changes nothing about what actually trades (read-only,
side-effect-free, same as before). Justified qualitatively rather than by
backtest: at 80, real still-liquid candidates (PENDLE, TIA, CHIP, down to
~45-50K EUR 24h volume) were surfacing that 40 would have missed weekly;
going much wider than 80 starts measuring illiquid dust that a real-money
bot shouldn't trade regardless of backtest PF. Gate: tsc clean, 1133 vitest
(all passing, no new/changed tests needed), vite build ok. No file under
`server/**` touched.

## Bull-run gap re-investigated: trend-exit's crash-window sample finally measured, still not adopted (2026-09-04)

David saw the Telegram digest's "agent +2.53% vs BTC +21.21% since tracking
started" line during a sharp BTC run and asked whether the gap can be
honestly narrowed without giving up crash protection. This is the same,
already-accepted structural tradeoff re-measured above (production lags a
strong BTC trend, beats both benchmarks by 24-51pt in the 2-year crash
window) — not a bug. The one genuinely open question left by this file's own
history was `trendExit` (hold through trend via a trailing EMA instead of a
fixed take-profit, `exitDecision.ts`): 2026-08-31 called it "inconclusive" on
crypto specifically because the only window available then (30-day) gave it
just 5-6 trades, and the choppy 120-day window had no clear long-horizon
crash data to check the OTHER side of the tradeoff. Today's `sweepAutopilot.mts`
widening (above) added exactly that missing window — a real 2-year daily
crash sample — so this re-runs the same three EMA periods (10/20/50) against
all three windows, closing the gap in the evidence rather than the strategy.

**Real Kraken data, current production config (regime EMA50 + confRisk
.5-1% + BTC market-regime EMA50 + 80% exposure cap) as the baseline, in vs.
out-of-sample:**

| Window | config | full ret | full PF | trades | OOS ret | OOS PF |
|---|---|---|---|---|---|---|
| 1h/30d (BTC bull, bh +24.01%) | PROD live (no trail) | +18.26% | 4.08 | 27 | **+1.33%** | 1.51 |
| | trend-exit EMA10 | +16.85% | 6.49 | 24 | -0.12% | 1.33 |
| | trend-exit EMA20 | +23.18% | 48.99 | 7 | -1.19% | 0.52 |
| | trend-exit EMA50 | +21.27% | 9.07 | 12 | -0.96% | 0.31 |
| 4h/120d (flat, bh +11.21%) | PROD live (no trail) | +0.86% | 1.53 | 10 | **+1.60%** | 1.78 |
| | trend-exit EMA10 | -0.19% | 1.14 | 17 | +0.21% | 1.29 |
| | trend-exit EMA20 | +1.11% | 0.59 | 14 | +1.52% | 0.63 |
| | trend-exit EMA50 | -1.22% | 0.32 | 12 | -0.61% | 0.36 |
| 2yr daily (crash, bh -27.42%) | PROD live (no trail) | -3.44% | 0.00 | 5 | **-1.28%** | 0.00 |
| | trend-exit EMA10 | -0.96% | 0.19 | 6 | -0.37% | 0.39 |
| | trend-exit EMA20 | -0.56% | 0.53 | 5 | -0.44% | 0.32 |
| | trend-exit EMA50 | -2.12% | 0.00 | 5 | -0.77% | 0.00 |

**Bull-run side: overfit, not a real edge.** In-sample, EMA20/EMA50 beat PROD
(+23.18%/+21.27% vs +18.26%) — the number David would want to see. But
every trend-exit variant's OOS return is **negative** (-0.12% to -1.19%)
while PROD's OOS is **positive** (+1.33%) — the classic in-sample-good/
OOS-bad signature this file has flagged repeatedly (2026-07-29's lookback
sensitivity, today's "TF far target late trail" rejection above). Trade
counts (7-24) never clear this file's own trust bar either. The apparent
gain is noise from a handful of trades, not a real improvement.

**Crash side: no clean win either.** Nominal losses are smaller
(-0.56% to -2.12% vs PROD's -3.44%), but on only 5-6 trades each — the exact
small-sample illusion flagged for this same lever on 2026-08-31 — and profit
factor is at or near the worst possible value (0.00-0.53) for every variant,
PROD included: this window just doesn't generate enough qualifying setups to
say anything with confidence, in either direction.

**Conclusion: trend-exit is not promoted on crypto.** The missing long-horizon
sample this file flagged on 2026-08-31 has now been measured — it does not
rescue the lead; if anything it confirms the bull-run gain was overfitting.
Stocks keeps `trendExit: { emaPeriod: 50 }` (2026-08-31, real edge on 459-778
pooled trades across 41 symbols); crypto's production config is unchanged.

**Confirms non-participation, not a bad exit, is the actual mechanism.**
PROD's own trade counts in the bull window (27 full-sample, fewer in either
half) against a 20-symbol universe over 30 days show the strategy selective
and often out of the market during the run — matching the diagnosis already
reached for stocks (2026-07-29: "the entries are still the bottleneck, not
the exits") and for crypto's exposure-cap test (2026-08-21: "structural cost
of a risk-managed strategy that isn't 100%-invested during a strong trend").
No exit-side change measured here or before (trailing width, trend-exit)
closes that gap without an OOS or crash-window cost — the selectivity itself
is what protects capital in the 2-year window, so loosening it is the
tradeoff, not a free fix.

Nothing shipped to strategy or config; this is a documentation-only close-out
of the 2026-08-31 "inconclusive" finding, using the long-horizon window added
earlier in this same pass. Full gate: tsc clean, 1133 vitest passed, vite
build ok (no source changes).

## New-candidate forward test wired up — nothing added to real trading (2026-09-04)

David's instruction on the 13 backtest-measured candidates above (PUMP, XMR,
SPX, CRV, DASH, ZRO, BONK, OP, SYRUP, MINA, TIA, CHIP, PENDLE — USELESS
excluded, confirmed not tradable on Revolut X): "תריץ קודם ואז תוסיף אחרי
ההרצה" (run it first, then add after the run). This session built and wired
up the tracking mechanism only — it does NOT add anything to real trading,
and nothing will be added automatically; that stays David's own call once a
real forward record exists.

**What was built:**
- `CANDIDATE_INSTRUMENTS` (`src/core/data/krakenPublic.ts`) — the 13 symbols
  as their own exported list, deliberately separate from `CURATED_INSTRUMENTS`
  and never merged into it or into `getInstruments()`'s browsable universe.
  Each symbol verified `online` against Kraken's live `AssetPairs` the same
  night; altname is base+EUR for all 13, no alias mapping needed.
- `CANDIDATE_WATCH_CANDIDATES` / `runCandidateWatch` (`server/autopilotRunner.mts`)
  — a second, fully independent `runShadowCycle` call (the existing
  `SHADOW_CANDIDATES` mechanism, already proven to isolate a candidate's
  portfolio/positions/journal/kill-switch into its own storage namespace and
  cost nothing extra in requests beyond the symbols it's given). One
  candidate, key `candidate-watch`, running production's OWN default
  parameters (`AUTOPILOT_MIN_CONFIDENCE`/`AUTOPILOT_MAX_RSI_FOR_LONG`/
  `AUTOPILOT_TRAILING`/4h confirmation — no alternate `evaluate`) against the
  13 candidate symbols instead of the curated 20. This answers "would these
  have done well trading exactly like the real bot does," not "does a new
  strategy idea work." Runs every cycle (same cadence as `SHADOW_CANDIDATES`,
  on `ENTRY_TF`), reading through its own `CachingSource` wrapping the same
  throttled `KrakenPublicSource` queue as everything else — bounded extra
  cost (~13 symbols × 2 timeframes of candle fetches per cycle), no new fetch
  pattern. Standings persisted at `candidate-watch-standings`.
- Digest: the daily Telegram summary and `/status` now show a
  `🧭 מעקב 13 מטבעות מועמדים (לא במסחר האמיתי, כסף מדומה בלבד)` line once
  `candidate-watch-standings` has data — explicitly labeled not-real, same
  "still gathering data" bar (`SHADOW_MEANINGFUL_TRADES` = 20 closed trades)
  as every other shadow candidate before it's trusted.
- Tests added: `CANDIDATE_INSTRUMENTS` shape/no-overlap
  (`tests/data/krakenPublic.test.ts`), the new digest line's two states —
  gathering data / real return shown (`tests/server/telegram.test.ts`), and
  the digest fold from the new storage key (`tests/server/autopilotRunner.test.ts`,
  mirroring the existing `shadow-longterm-standings` test exactly). No new
  test needed for `runShadowCycle`'s own isolation/no-extra-cost guarantees —
  already covered generically and reused as-is.

**What was explicitly NOT touched:** `CURATED_INSTRUMENTS`, the
`instruments.value.slice(0, CURATED_INSTRUMENTS.length)` real-trading symbol
list, `SHADOW_CANDIDATES`/`SHADOW_STANDINGS_KEY` (the existing
strategy-comparison scoreboard — different storage key, never collides), and
every live-order code path. Real money and the primary paper autopilot trade
exactly the same 20 curated symbols as before this change.

**How long before this is worth deciding from:** the BREAKOUT lead earlier
this same night is the trust bar this project now holds itself to — its
backtest (+6.48%) was wrong, and only a real 37.9-day / 147-trade live
forward record caught it (-2.05% real). Expect a comparable order of
magnitude here: WEEKS of real cycles, not a check tomorrow. `SHADOW_MEANINGFUL_TRADES`
(20 closed trades) is the absolute floor before any single candidate's number
means anything at all, and even that is a thin sample — treat it the way
every other shadow candidate's early record has been treated in this file
(informative, not decisive) until it is comfortably past that floor with a
consistent sign over real time.

Gate: tsc clean, 1139 vitest passed (152/152 in the touched files — 6 new),
vite build ok.

## Deep design pass #3: comprehensive real-screenshot audit against 2 prior passes, one real cross-screen fix found (2026-09-04)

David asked for a third, much more thorough design pass ("more than 100... even
200 or 300 things"), comparing against real trading apps, loading the
account's other design-taste skills in addition to `fintech-dashboard-polish`.
Loaded `apple-design` and `design-taste-frontend` for general principles
(the latter's own scope note says it targets landing pages/portfolios, not
dashboards — used only for the universal typography/spacing/motion sections,
not its landing-page-specific rules). Read all of `styles.css` (2051 lines)
end to end before touching anything, per this file's own two prior entries
above (Deep design pass #1 and #2, same day) — both already did exhaustive,
screenshot-verified work: two-tier tabular-nums pricing unified across every
screen, sparklines, order-book depth bars, the true-black palette with
tokenised type/spacing/motion scales, badge-overlap fixes, the hub-tabs
track, real/sim tags, scientific-notation dust-price bug, and more.

**Method**: `npm run build` + `vite preview` + the established
Playwright-core + single-route-handler + real committed
`state/autopilot-state.json`/`state/stocks-state.json` screenshot method,
390×844 (iPhone-width) viewport, `waitUntil:'load'` + 3.5s settle. Screenshotted
all 10 primary screens (Home, Markets list, Stocks, Tools menu, Scan,
Backtest, Validation, Portfolio, Grid, Monitoring) plus coin-detail, Crypto
Profit tab, Stocks Long-Term tab, and Crypto History/Market tabs — 16 real
screenshots reviewed as images, not reasoned about from CSS.

**Found and fixed — one real, cross-screen issue, confirmed by looking at
the actual pixels, not by reading the markup:** the "Live data unavailable —
showing DEMO data" banner (`showBanner()` in `main.ts`) inlined its full
diagnostics — three raw failed-fetch URLs and error strings — directly in
the banner text. That made the banner ~180px tall, and since it renders
above `<main>` on literally every one of the 10+ screens, roughly a fifth of
a real phone viewport was technical stack-trace-like text on every single
screen in the app, pushing all real content down by the same amount (visibly
confirmed: the Tools menu showed only 3 of 8 tool cards above the fold
before the fix, 5 after). Fixed by collapsing the diagnostics behind a
native `<details>`/`<summary>` disclosure ("Why? ▾") — the short one-line
message is what shows by default everywhere, the raw URLs are one tap away
for anyone actually debugging a data-source outage, and `<details>` needs no
JS. The two other banner branches (`revolut`/`public`, already short) are
untouched. New CSS is additive only (`.data-source-banner-details` and
`-reasons`), no existing rule changed.

**Investigated, deliberately reverted after catching a mistake against a
newer decision:** `homeView.ts`'s own comment (from an earlier PR, #117) says
the intent was "ONE dominant bare hero (the sim balance)... with the
real-money card boxed" — and the DOM order (`liveHero` before `hero`)
appeared to contradict that, so a fix was drafted and briefly applied
(reordering to put the sim hero first). A second screenshot caught the
regression before committing: a LATER, same-day, more specific comment a few
dozen lines down (`renderLiveAccount`, "David asked 2026-09-04") explicitly
hides the sim hero (`hero.hidden = Boolean(live)`) once real money is live,
specifically so the real-money card leads on this screen — the exact
opposite of what the earlier comment implied out of context. The reorder was
reverted in full before the gate/commit; screenshotted again to confirm the
live-money Home screen still shows Real money → Real open positions first,
matching David's actual later instruction. Lesson for next time: a design
comment that looks like unclaimed intent can be superseded by a later one
further down the same file — check the whole file's history of decisions on
a component before trusting the first comment found, and always re-screenshot
before committing a "fix" driven by a code comment rather than a pixel.

**Covered by screenshot, no defect found**: Markets list/detail, Stocks
Overview/Market, Crypto History/Market/Profit, coin-detail (candlestick
chart, stat tiles, range bar), Stocks Long-Term. `toastNotifications.ts` and
`loadingStates.ts`'s empty-state/toast icon set were checked for an
emoji-vs-SVG icon-language inconsistency (a real category of issue worth
checking per the task) — both turn out to be dead code with zero call sites
in any view file, so nothing on screen is actually affected; not worth
"fixing" code nothing renders.

**Honest calibration, not a shortfall being hidden**: this file's own history
shows two already-exhaustive, screenshot-verified passes earlier the same
day covering almost every item on the standard fintech-dashboard checklist
(typography hierarchy, tabular-nums, sparklines, depth bars, spacing/motion
tokens, corner-radius consistency, hover/press states, empty states, badge
placement). Given that starting point, a genuinely-warranted, non-manufactured
third pass surfaces one real cross-screen fix, not another 100+ — inflating
the count with cosmetic non-issues (e.g. re-tokenising a value already
correct, or "fixing" unused dead code) was avoided on purpose per this task's
own explicit instruction not to pad the number.

Full gate: tsc clean, 1139/1139 vitest (all pre-existing, no test changes
needed — the change is additive markup/CSS, covered by existing DOM tests),
`npm run build` clean. Pure `src/ui/main.ts` + `src/ui/styles.css` diff (43
lines). No file under `server/**`, `state/**`, or `src/core/**` touched.

## Manual Revolut X trades (outside the bot) now auto-reconciled (2026-09-04)

David: "sometimes I also buy or sell directly through Revolut, so it needs
to know and update automatically." Before this, a fill made directly in the
Revolut X app was completely invisible to the bot — no stop-loss, no
take-profit, no P&L tracking — until a human noticed and hand-fixed the
state file, which had already happened twice this account (see the
2026-09-03/09-04 manual-reconciliation notes earlier in this file).

**What was built:** `server/liveManualTradeSync.mts`,
`syncManualTradesFromBroker(store, brokerAdapter, source, telegram, now, onRealizedPnl?)`,
called once per cycle in `autopilotRunner.mts`'s `main()` right after
`recordLiveRealizedPnl` is constructed — before `runLiveMirror`'s own
entry/exit checks that same cycle, so a fill from between cycles is caught
before this cycle's own logic runs against a stale baseline. For every
`CURATED_INSTRUMENTS` symbol, compares `BrokerAdapter.fetchPositions()`'s
real balance against what this bot currently tracks:
- broker qty > tracked qty → a manual BUY: opens a tracked position for the
  excess at the CURRENT market price (Revolut X's balance endpoint reports
  no cost basis, so the true fill price is unknowable — a documented
  approximation, not a bug), with the same fixed manual-override stop/target
  (`-1.5%` / `+3%`) a manual `/buy` uses, so it gets the same automatic exit
  protection going forward.
- broker qty < tracked qty → a manual SELL (or this bot's own resting exit
  order quietly filling between cycles, before its own bookkeeping noticed —
  same code path, same fix): reduces/closes the tracked position for the
  difference and feeds `recordLiveRealizedPnl` at the current market price
  as an estimated exit, so the daily-loss circuit breaker isn't blind to a
  loss David causes by selling manually. Never touches the cash ledger
  directly — `syncLiveCashFromBroker` (pre-existing) already keeps cash
  correct from this same broker balance read.
- A network failure or a symbol the current-price fetch can't reach is a
  no-op that retries next cycle — never guesses a price. A diff within
  `1e-6` is treated as float noise, not a trade.
- Sends one Telegram message (Hebrew) whenever it reconciles anything, so
  this is never a silent change to the account, explicitly noting the
  reported price may not be the real fill/sale price.

**Scope, deliberately:** `CURATED_INSTRUMENTS` only — the same limitation
`syncLiveExternalBtc`'s BTC-only special case already had, just generalized
to every curated symbol instead of just BTC. A manual trade in a coin
outside the curated 20 stays as invisible as it always was.

Tests added: `tests/server/liveManualTradeSync.test.ts` (9 new) — new-position
open, top-up on an existing tracked position, full close + P&L, partial
reduce + proportional P&L, no-price no-op (buy and sell), dust-quantity
tolerance, broker-fetch-failure no-op, multi-symbol independence.

Gate: tsc clean, 1158 vitest passed (9 new), vite build ok.

## Fixed: a bare /buy or /sell repeated its "usage hint" reply every cycle forever (2026-09-05)

Real bug, caught from David's own Telegram screenshot: tapping a bare `/buy`
(a bot-command mention with no symbol — Telegram never sends the argument
when you tap one, only the bare token) got the correct "❌ /buy צריך סימבול"
reply once, then the SAME reply kept arriving again every cycle (~every 5-6
minutes) for hours, with nothing new sent from his side.

**Root cause**: `checkManualBuyRequests`/`checkManualSellRequests`
(`manualBuyCommand.mts`/`manualSellCommand.mts`) push every message that
isn't a valid `/buy <SYMBOL>`/`/sell <SYMBOL>` into `unclaimedMessages` and
stash it back via `stashUnclaimedTelegramUpdates` — correct for a message
some OTHER handler might still claim (`/pause`, a confirmation tap, etc.).
But the bare-command usage-hint branch replied to the message AND STILL let
it fall through to that same unconditional push. Since nothing else claims
a bare `/buy`/`/sell` either, it just sat in the shared unclaimed queue
forever, and every future cycle's `pollAllTelegramUpdates` call (which
returns unclaimed + fresh messages) handed it right back to the same
bare-command branch — reply, re-stash, repeat, indefinitely.

**Fix**: once the usage-hint reply is sent, `continue` before the generic
unclaimed-push — a bare `/buy`/`/sell` is fully handled the moment it's
answered, there is nothing left for `/sell`/`/help`/`/status`/`/discover`
to do with it. `manualKillSwitchCommand.mts` and `manualDiscoverCommand.mts`
were checked and already use `else` (push only when NOT claimed) — they
never had this bug.

Tests added: one regression test per file (`manualBuyCommand.test.ts`,
`manualSellCommand.test.ts`) — calls the handler twice against a fake
Telegram that only delivers the bare command once (respecting the offset
parameter, like real Telegram), asserting the usage-hint reply is sent
exactly once and the unclaimed-messages store key ends up empty.

Gate: tsc clean, 1160 vitest passed (2 new), vite build ok.

## Fixed: the topbar BTC chip (and Home's markets strip) showed a 48h change mislabeled as 24h (2026-09-05)

Real bug, caught from David's own side-by-side screenshot: Revolut X's real
BTC ticker showed `-0.15%`, ours showed `-2.04%` for the same moment — not
stale data, a genuinely different number.

**Root cause**: `fetchSnapshot` (`src/ui/markets.ts`) fetches 48 hourly
candles (`count = 48`, for a smoother sparkline) and computed `changePct`
from the OLDEST of those 48 — a 48-hour window — while every other "chg"
pill in the app (and the real exchange convention it's visually identical
to) means a 24-hour change. `fetchMarketRows`'s ticker-based rows already
got this right (uses Kraken's own 24h `open`); `fetchSnapshot` — used by the
topbar BTC chip and Home's markets-strip cards — did not.

**Fix**: anchor `changePct` 24 candles back from the latest close
(`closes.length - 25`) instead of the oldest of the 48, falling back to the
oldest available close if fewer than 25 candles come back (a network
hiccup). The 48-candle fetch itself is untouched — still feeds the
sparkline its full resolution, only the % anchor moved.

Tests added: `tests/ui/markets.test.ts` (new file, 2 tests) — asserts the
24h-back anchor against a synthetic 49-candle series (and that it actually
differs from the old 48h-window number), plus a fallback case with only 3
candles available.

Gate: tsc clean, 1162 vitest passed (2 new), vite build ok.

## The simulated ("not real money") wallet is now hidden everywhere once real money is live (2026-09-05)

David: "אני רוצה שכל מה שקשור לארנק הישן של המסחר בכסף הלא אמיתי שימחק
לגמרי מכל האתר בכל דף" (I want everything related to the old not-real-money
wallet removed from the whole site, every page). Clarified via a follow-up
question: he means the DISPLAY of the simulated money, not the underlying
paper-trading engine — correctly so, since real-money entries are literally
mirrored from the paper autopilot's own approved signals
(`runLiveMirror`/`mirrorApprovedEntries`); deleting that engine would have
disabled real trading entirely, not just hidden a legacy UI element. Nothing
under `server/**`/`src/core/**` touched — this is a pure `src/ui/` display
change, the paper engine keeps running underneath exactly as before.

Home's Overview tab already had this exact pattern (`hero.hidden =
Boolean(live)`, added 2026-09-04) — the sim hero, readiness card and sim
"Open positions" table all already hide once real money exists. Two places
were deliberately left showing both sides at the time ("Left untouched on
the Profit tab... which deliberately shows real and simulated side by
side") — David's ask reverses that decision:

- **Profit tab** (`assetHubView.ts`): `#hub-real-money` was a boxed
  secondary card with the SIMULATED "Total return" hero-bare and dominant
  above it. Now `#hub-real-money` is hero-bare itself (matching Home's
  `#home-live-hero`) and `#hub-sim-hero` + the readiness card hide entirely
  once `state.live` exists.
- **History tab**: the simulated equity chart + trade list (now wrapped in
  `#hub-sim-history`) hide entirely once `state.live` exists, leaving only
  the "Real activity" section that already existed there.

Both stay fully visible exactly as before for Stocks (no live account
there — `state.live` is always null) and for Crypto before real money ever
goes live. Two stale comments in `styles.css` claiming "the real-money card
... stays boxed" were also corrected — no hero stays boxed anymore, real or
simulated, once it's the one dominant figure on its screen.

Verified with real screenshots: built `dist/`, `vite preview` on port 4177,
mocked `autopilot-state.json` with the real committed live-account content.
Overview (already correct, unchanged) → Profit → History, in order:
confirmed only "Real money"/"Real activity" show, no simulated hero or
simulated trade list anywhere on either tab.

Tests added: `tests/ui/assetHubView.test.ts` (2 new) — hides
`#hub-sim-hero`/`#hub-sim-history`/`#hub-readiness` and promotes
`#hub-real-money` to `hero-bare` once live; keeps both simulated sections
visible when there's no live account (Stocks today).

Gate: tsc clean, 1164 vitest passed (2 new), vite build ok.

## Diagnosed: the bare-/buy repeat-reply fix (PR #193) appeared not to work — it was a stale long-running job, not a fix failure (2026-09-05)

David reported the exact same "❌ /buy צריך סימבול" repeat-reply bug
STILL happening well after PR #193 (the actual code fix) was merged and
confirmed green. Investigated by reading the real committed
`state/autopilot-state.json`: `telegram-unclaimed-messages` had 3 bare
`/buy` updates stuck UNCHANGED across multiple committed cycles, all timestamped
after the fix's merge — meaning the fix's own code was correct (nothing
kept re-adding to the queue) but was never actually running.

**Root cause**: `autopilot.yml`'s "Cloud Paper Autopilot" job is a
long-running process — one GitHub Actions run loops internally through up
to 70 cycles (~5-6 min apart) over roughly 2+ hours, checking out the repo
ONCE at job start. The run active at the time (`run_id` 33986617820)
started at 19:16 UTC — 54 minutes BEFORE PR #193 merged (20:10 UTC) — so it
kept executing the old, pre-fix code for its entire remaining multi-hour
duration, regardless of what had since merged to `main`. The scheduler
(`cron: '*/30 * * * *'`) also can't be relied on to start a fresh run
promptly — its own comment already documents GitHub's scheduler firing
"only every 5-7h" under load.

**Fix applied, not a code change**: cancelled the stale run
(`cancel_workflow_run`) and immediately redispatched a fresh one
(`run_workflow` on `main`) rather than waiting for the next uncertain cron
tick — confirmed the new run (`run_number` 811) checked out the latest
commit (includes both PR #193 and #194). The three stuck unclaimed
messages will each get exactly one final reply on the new run's first
cycle, then stop — no further action needed from David, and this needs no
code fix since the underlying bug was already correctly fixed.

**Lesson for next time a fix "doesn't seem to work" here**: check whether
the currently-running `autopilot.yml`/`stocks-autopilot.yml` job's
`head_sha` (via `list_workflow_runs`) predates the fix's merge commit
before assuming the fix itself is wrong — this long-running-job
architecture means a merged, verified-green fix can take up to ~2 hours to
actually reach production if the in-flight run isn't cancelled and
redispatched.

## Fixed: the History tab's own "All time" equity return silently disagreed with the Overview/Profit tab's — a truncated `history[0]` baseline (2026-09-05)

Follow-up pass after the 48h/24h and repeat-reply bugs, per David's "make
sure it's genuinely good, keep improving" — hunted for more bugs in the
exact same class (a %/window computed inconsistently between two screens
showing "the same" number), this time by hand-checking the real committed
state files' numbers, not just screenshots.

**Found**: `state/autopilot-state.json`'s `equity-history` array has 5,000
entries — exactly `EQUITY_HISTORY_CAP` (`autopilotRunner.mts`,
mirrored in `stocksRunner.mts`/`liveLedger.mts`), meaning the crypto paper
account is AT its cap right now and the array is being truncated from the
front every cycle. Hand-computing both numbers from the real file:
`(last - initialCash) / initialCash` (what the Overview/Profit hero shows)
= **2.22%**, but `(last - history[0].equity) / history[0].equity`
(what `mountEquityChartPanel`'s "All" range used) = **6.83%** — nearly 3x
off, because `history[0]` is no longer the account's actual starting
sample once the array has been truncated, just whichever sample happens to
still be oldest. Same real discrepancy reproduced on the Stocks account too
(smaller here since its history hasn't drifted as far past its own
starting point yet): Profit tab "+1.04% all time" vs History tab "+1.06% ·
All" — confirmed live with a real screenshot (`vite preview`, real
committed state mocked) before and after the fix.

**Root cause**: `mountEquityChartPanel`'s "All" range (shared by Crypto's
History tab, Crypto's standalone Portfolio-value page, and Stocks' History
tab) used `pts[0].equity` as its return%'s baseline for every range,
including "All" — correct for 1D/1W/1M/1Y (a window's own start IS
`pts[0]` after filtering), wrong for "All", which is supposed to mean
"since tracking began" but silently degrades to "since whatever the
front-truncation cap left oldest" once an account outlives the 5,000-
sample cap. This will keep getting worse over an account's lifetime as
more old samples age out — not a one-time error like the 48h/24h bug, but
one that drifts further from the truth the longer an account runs.

**Fix**: `EquityChartPanelHandle.setHistory` takes an optional second
argument, the account's true starting equity. When supplied and the "All"
range is selected, it anchors the return% there instead of `history[0]`;
every other range is untouched. Threaded through from the one place that
actually has this number — `state.initialCash` (`assetHubView.ts`'s
SIMULATED history chart, `valueView.ts`'s standalone Portfolio-value page).
The REAL-money chart (`assetHubView.ts`'s `realEquityChart`) has no
`initialCash` equivalent and is left exactly as it was — it already uses
the honest "since tracking began" wording rather than claiming "all time",
so there's no label/number mismatch there today (though the same
truncation will eventually reach it too, once the real account's own
history array hits its cap — flagged for awareness, not fixed here, since
real money only started tracking 2026-09-03 and is nowhere near 5,000
samples yet). The "since {date}" caption under the chart's own hero also
switches to "since tracking began" when the override is used, since the
truncated sample's own date would otherwise no longer match what the %
is actually measured from — matching the wording already used by the
real-money hero for the identical situation.

Verified with real screenshots: built `dist/`, `vite preview` on port 4178,
mocked `autopilot-state.json`/`stocks-state.json` with the real committed
content. Stocks History tab before: "+1.06% · All / since 29/07/2026",
Overview/Profit: "+1.04% all time" — mismatched. After: History tab reads
"+1.04% · All / since tracking began", matching Profit exactly.

Tests added: `tests/ui/equityChartPanel.test.ts` (2 new) — one with a
synthetic truncated history (shaped like the real committed crypto state:
`initialCash` 10,000, `history[0].equity` 9,568.52, last 10,222.32) asserts
the "All" return uses the true 2.22% and never the truncated-baseline
6.83%, plus the "since tracking began" caption; one confirms the existing
`history[0]`-baseline behavior is unchanged when no true start is supplied
(the REAL-money chart's own case).

**Also checked, found correct, not touched**: Kraken's ticker `o` field
(used by `fetchMarketRows` for the full Markets list and Home's Top
Movers) is genuinely "today's opening price since UTC midnight" per
Kraken's real API (confirmed with a live request), not a rolling 24h open
— a real, measurable difference from `fetchSnapshot`'s true rolling-24h
(used by the topbar chip and Home's Markets-strip cards), most visible
right after UTC midnight. This is flagged for awareness rather than fixed:
Kraken's batch ticker has no rolling-24h-ago price field at all, so
matching the two exactly would mean abandoning the single-batch-request
design that makes a 500+-market list possible at all (an explicitly
measured, rejected tradeoff already documented in `markets.ts` for the
per-symbol fallback) — a genuinely ambiguous tradeoff, not a clear-cut
formula error like the two bugs above, so left alone per "not a
fix-first-ask-later pass on anything ambiguous."

Gate: tsc clean, 1166 vitest passed (2 new), vite build ok.

## Shared-layer design pass: cross-cutting tokens/components, run in parallel with 6 per-screen agents (2026-09-06)

David asked for ~200 serious Revolut-X-vs-our-app improvements, split across
7 parallel agents by screen area; this pass's slice was explicitly the
SHARED/cross-cutting layer only — `src/ui/styles.css` `:root` tokens and
truly shared classes, `format.ts`, `coinLogo.ts`, `charts.ts` — never a
`src/ui/views/*.ts` file (six sibling agents own those). Loaded
`fintech-dashboard-polish` and `apple-design` fresh (no screen recording
found on disk to re-extract frames from — proceeded on the distilled skill
text alone). Read all of `styles.css`, `format.ts`, `coinLogo.ts`,
`charts.ts` end to end first, per this file's own prior "Deep design pass"
entries' method. **9 genuine, individually-verified fixes** (not padded to
hit a number — see the honest-count precedent in "Deep design pass #3"
above):

1. **`formatPct`/`formatNumber` (`format.ts`) showed a spurious "-0.00%"/
   "-0.0" for a negative value that rounds to zero at its display
   precision** (e.g. `formatPct(-0.001)` → `"-0.00%"`) — confirmed with
   `node -e` against real JS `toFixed` behaviour before touching anything,
   the same float-formatting bug class as the already-fixed BTC-chip/equity-
   chart bugs. Both functions are called from 12+ view files (Home, Markets,
   Crypto, Stocks, Market Scan, Validation, Portfolio, the equity chart
   panel). Fixed via a new shared `fixedNoNegativeZero` helper that strips
   the sign only when the rounded result is genuinely zero; unaffected for
   any value that actually rounds non-zero. 4 new tests.
2. **`formatPriceSplit` (`format.ts`) had no dust guard, unlike `formatPrice`
   right above it** — `formatPrice`'s own comment documents the exact bug
   (cash computed as equity minus positions, landing at e.g. `-1.137e-12`
   instead of exactly zero) and guards against it, but `formatPriceSplit`
   — which feeds the HERO BALANCE on Home (both heroes), the Profit tab,
   Portfolio, Stocks Overview and Stocks Long-Term (6 call sites, 5 view
   files) — had no equivalent guard, so that same dust rendered the hero
   balance as major `"-0"` / minor `"00"`. Fixed with the same
   rounds-to-zero-strips-sign approach as #1. 3 new tests.
3. **`.coin-logo-tile`'s generated fallback (used for any of the hundreds of
   long-tail assets with no bundled logo — appears on Markets, coin-detail,
   trade rows, portfolio positions) failed WCAG AA contrast for roughly a
   third of all asset codes** — computed the actual contrast ratio (white
   text on `hsl(hue, 55%, 42%)`) across the full hue wheel: yellow/green/
   cyan hues (~45-195deg) measured 2.6-3.2:1 against the white initials,
   below the 4.5:1 floor for text this small (~10px), while red/blue/violet
   hues were fine. Lowered lightness 42%→30% (worst-case hue now 4.72:1,
   confirmed by rendering real `.coin-logo-tile` elements in a live page and
   reading `getComputedStyle` back, not just computed in isolation).
4. **`.pchart .psr` (support/resistance dashed lines, `charts.ts`'s shared
   `candleChartSvg`, used by 5 view files: gridView, homeView, marketsView,
   stocksOverviewPanel, validationView) hardcoded `transition: ... 300ms
   ease`** instead of the app's own `--dur-base`/`--ease` tokens — the one
   transition in the whole file that didn't use them. Token-substituted;
   zero visual change (220ms ≈ 300ms, same curve family).
5. **`body`'s theme-transition used bare `ease` instead of `var(--ease)`**
   — this is the one transition rule that runs on literally every page in
   the app (background/color cross-fade). Token-substituted.
6. **No `:focus-visible` state existed on any of the app's shared
   interactive base classes** — `.nav-btn` (bottom nav, every screen),
   `.tool-card` (Tools), `.tappable`, `.tab-button`, `.scan-row`, `.mk-star`,
   and `button.primary/.secondary/.btn-buy/.btn-sell` all relied on the
   unstyled browser default outline; only `.control input/select` and
   `.mk-search` had ever styled their own ring. Added one shared rule
   (`outline: 2px solid var(--accent-text); outline-offset: 2px`), keyed off
   `:focus-visible` so mouse/touch taps never show it (matching the existing
   `.control`/`.mk-search` convention). Verified with real keyboard Tab
   navigation (not `.focus()`, which Chromium's `:focus-visible` heuristic
   correctly ignores) via Playwright on both the bottom nav and a Tools
   card, screenshotted — a clean, unclipped ring on both, no visual
   regression.
7. **The view-enter transition that fires on every single tab/nav switch
   across the whole app had no `prefers-reduced-motion` handling** — the
   four existing reduced-motion rules in this file each covered one
   already-noticed animation (row-clock pulse, tappable press, pchart-now
   pulse, skeleton/flash), but missed `.view.active`/`.content
   section.active` (the primary nav transition — the latter wins on
   selector specificity, `.content section.active` has one more type
   selector than `.view.active` at equal class count, so its `fadeInUp` is
   what actually plays; disabling both is correct either way), plus
   `.hub-panel.active` (Tools sub-tabs) and `.detail-chart.fade-in`/
   `.fade-in-up` (chart swaps). Added to the existing media query.
   Confirmed via Playwright with `reducedMotion: 'reduce'` emulated:
   `getComputedStyle(#view-tools).animationName` reads `"none"`.
8. **No `prefers-reduced-transparency` fallback anywhere**, despite three
   genuinely translucent `backdrop-filter` surfaces present on every single
   screen (`.topbar`, `.topbar-btc`, `.bottom-nav`) — apple-design's own
   guidance for this setting is "frostier/solid," not "turn transparency
   off entirely elsewhere." Added a media query making exactly those three
   solid with the blur removed, layout/radius/colour otherwise identical.
   Verified via Chrome DevTools Protocol media-feature emulation
   (`Emulation.setEmulatedMedia`) + screenshot: topbar/nav render solid,
   nothing else changes.
9. **No `prefers-contrast: more` support anywhere** — `--border`/
   `--border-strong` (used by dozens of card/divider rules app-wide) are
   deliberately near-invisible per the `:root` comment. Added a `:root`
   override under this media feature raising both, verified the same way
   (CDP emulation + reading the computed custom property back = the new
   value).

**Investigated, correctly left alone (no fix, no filler):**
`loadingStates.ts`/`toastNotifications.ts` — re-verified this file's own
"Deep design pass #3" finding: `showToast`/`showSuccess`/`showError`/
`showInfo`/`showWarning` and `showLoadingOverlay`/`hideLoadingOverlay`/
`createLoadingSpinner`/`addLoadingState`/`removeLoadingState`/
`createSkeletonLine`/`createSkeletonTitle`/`showEmptyState` are still never
called by any view file — only exposed on `window.toast`/`window.loading`
for manual/console use. Nuance the prior entry didn't have: `skeletonRowsHtml`
(loadingStates.ts) IS genuinely live (imported directly by homeView,
portfolioView, stocksOverviewPanel, stocksLongTermPanel), and `.spinner`/
`.loading-inline` are used directly by name in `backtestView.ts` — so the
module isn't uniformly dead, only those specific exported helpers are.
Wiring them in for real would mean editing `main.ts` or a view file, both
out of this pass's scope — left untouched rather than inventing a use.
`.pill.profit`/`.pill.loss` CSS exists but no view file ever applies those
classes (only `.pill.buy`/`.pill.sell` are used, and only for the words
BUY/SELL/FILLED/REJECTED, never a number) — dead CSS, not a rendering bug,
left alone. The per-value-precision mismatch between `signClass` (colours
red/green off the raw, unrounded value) and `formatPct`/`formatNumber`
(now correctly zero out near-zero values at their OWN rounding precision)
means a value like `-0.001` at 2dp now renders `"0.00%"` in red — text and
colour briefly disagree. Fixing this properly needs the digit precision
threaded into `signClass` at each call site, which lives in `src/ui/views/
*.ts` — flagged here as a suggestion for whichever agent next touches the
view file(s) where this is visible, not fixed in this pass.

**Colour count**: grepped every hex literal in `styles.css` — the only
values outside the current token system are three explicitly-historical
ones inside a `:root` comment documenting what the palette used to be
(`#07090d`/`#12161e`/`#232a38`/`#21d789`/`#f2495f`), never live in an actual
declaration. The active palette (5 near-black surfaces, 3 text greys, 6
neutral-graphite accent shades, 4 semantic hot/cold/neutral/warn pairs) was
already disciplined by the prior true-black pass — nothing to trim here.

Method: `npx tsc --noEmit`, `npm run build`, `vite preview` on port 4183,
Playwright (`playwright-core` + the repo's cached Chromium binary) at
390×844 loading `?demo=1` (the app's own deterministic-demo query flag —
this sandbox has no route to Kraken/Revolut/GitHub raw content, so plain
network screenshots rendered an empty `<main>`; `?demo=1` skips straight to
`SyntheticDataSource` and renders fully) across Home, Tools, and Markets;
real keyboard Tab traversal for focus-visible; `page.emulateMedia` for
reduced-motion; CDP `Emulation.setEmulatedMedia` for reduced-transparency
and prefers-contrast (both confirmed working in this Chromium build).

Gate: tsc clean, 1178 vitest passed (7 new: 4 for `formatPct`/`formatNumber`,
3 for `formatPriceSplit`), `npm run build` clean. Diff touches only
`src/ui/format.ts`, `src/ui/styles.css`, `tests/ui/format.test.ts` — no
`src/ui/views/*.ts` file touched, per this pass's scope.

## Crypto asset-hub design pass: 10 verified fixes, one a real functional bug missed by 3 prior design passes (2026-09-06)

Part of David's "compare Revolut X, ship 200 serious improvements" ask,
split across parallel agents by screen area — this agent's scope was the
Crypto asset-hub shell (Overview/History/Market/Profit tabs in
`assetHubView.ts`), the shared `equityChartPanel.ts`, and `valueView.ts`.
Given three prior "Deep design pass" entries and four "Creative upgrade
pass" entries already covered this exact area extensively (screenshot-
verified, see above), a genuinely-warranted pass here surfaces far fewer
new items than a first pass would — 10 confirmed, individually-verifiable
fixes, not a padded 28-30. Per this task's own explicit instruction, no
filler was manufactured to hit a target count.

**Method**: `npm run build` + `vite preview` + Playwright-core
(`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`),
390×844 viewport, real screenshots of Overview/History/Market/Profit for
BOTH the real committed `state/autopilot-state.json` (real money live,
~€102.84 equity, one BTC position, routed in via `page.route` so the real
committed file is what's actually rendered) AND a synthetic no-live-money
state (the same file with every `live:`-prefixed key stripped, to check
the pre-real-money path still renders correctly). Also hovered the actual
rendered chart at multiple x-fractions (0.5 through 1.0) to catch
interaction bugs invisible from a static screenshot.

1. **Crosshair/tooltip crashed silently across most of the chart's width
   in Line mode (the default) — a real functional bug, not cosmetic.**
   `equityChartPanel.ts`'s `paint()` built `geo` (and `geo.indexAtFraction`)
   from the RAW, unbucketed points array in line mode, but fed the
   crosshair the bucketed `candles` array (bucketize() aims for ~30
   entries regardless of how many raw samples exist) — a length mismatch.
   Any account with more samples than ~30 (every real account, in
   practice — the real crypto account has 411) hit `candles[idx] ===
   undefined` past roughly the first 30 candles' worth of x-position,
   throwing inside the pointermove handler and killing the crosshair for
   the rest of the chart. Reproduced live: hovering the real Profit-tab
   chart at x-fractions 0.5-0.995 threw `Cannot read properties of
   undefined (reading 'close')` every time, confirmed via
   `page.on('pageerror', ...)`. Fixed by building a synthetic
   one-sample-per-point `Candle[]` (open=high=low=close=the value) for
   line mode's crosshair, matching `geo`'s own length — `wireCrosshair`'s
   signature is unchanged. Affects all three shared callers: History tab,
   Profit tab's real-money chart, and `valueView.ts`. Screenshot-confirmed
   fixed (tooltip now shows correctly at every fraction including the
   right edge). New test: `equityChartPanel.test.ts` — 200 raw samples,
   hover near the right edge, assert the tooltip still shows.

2. **The Profit tab's real-money chart duplicated its own parent hero's
   percentage on first load.** With `showHero: false` (used only for the
   "Real money" hero's chart), the default `rangeKey === 'All'` computes
   its return% from `history[0]` with no `trueStartEquity` override
   (real accounts have none) — mathematically identical to the hero's own
   "since tracking began" figure computed the same way from the same
   array. Screenshot showed "▲2.11% since tracking began" then, a few
   lines down, "▲+2.11% · All" — the same number twice. Every OTHER range
   genuinely differs (a shorter window's own return, confirmed distinct on
   the real account: 1D showed -11.65%, correctly red), so only the `All`
   case — the one range provably guaranteed to match, not merely
   coincidentally similar for a young account — is now suppressed.
   Screenshot-confirmed fixed. New tests for both branches.

3. **History tab's own list started on a bare "Loading…" pill instead of
   the app's established skeleton-row shimmer.** Screenshot showed a
   single floating pill over an otherwise-blank viewport — exactly the
   "collapses the layout" failure mode `loadingStates.ts`'s own doc
   comment for `skeletonRowsHtml` warns about, and precedent already
   exists: Home's own equivalent list (`homeView.ts`'s recent-activity
   list) uses this exact skeleton for the SAME kind of first-paint gap,
   while `valueView.ts`/`marketsView.ts` do too — `hub-history-list` had
   simply never wired it up. (Checked first whether the hero-value "—"
   placeholders and the empty `#hub-readiness` block were the same kind of
   gap — they're not: Home's identical hero and readiness section use the
   exact same bare "—"/empty-until-loaded convention, so those are
   deliberate house style, not a defect, and were left untouched.)

4. **Real activity rows (History tab) showed a bare status pill with no
   coin identity** — unlike every SIMULATED trade row in the app, which
   shows a coin logo. The real audit log's `intentId` (e.g.
   `"live-entry:DOTEUR:..."`) carries the symbol, but `cloudState.ts`
   discarded it when parsing `recentEvents`. Added an additive optional
   `symbol` field (parsed via a regex on `intentId`, `null` when not
   parseable — a pre-trade verification failure or the kill switch
   correctly fall back with no icon) and reused the exact same
   `completedLogoHtml`/`baseCodeFromSymbol` treatment the simulated
   history rows already use. Verified `recentEvents` has no other consumer
   in the codebase before touching its shape. Screenshot-confirmed: real
   rows now show a coin icon + "DOTEUR"/"ADAEUR" next to the REJECTED
   pill, matching the rest of the app.

5. **Real-money-safety fix: an untracked BTC holding could render a
   confidently-wrong "€0.00" instead of an honest "price unavailable."**
   Checked the actual real committed crypto state file: it carries no
   `market-snapshot` field at all (that only exists for Stocks), so the
   BTC price lookup always fell back to `?? 0` for Crypto — not
   reproducible against today's real state screenshot (external BTC
   quantity is 0 right now), but the code path is real and has fired
   before (David converted EUR→BTC manually, 2026-09-03). Now shows the
   raw BTC quantity with "(untracked, price unavailable)" instead of
   pricing a real position at zero. New test constructs the exact
   real-shape scenario (empty `marketSnapshot`, nonzero
   `externalBtcQuantity`) and asserts no "€0.00" ever renders.

6. **The Candles toggle was tappable but silently inert for a brand-new
   account.** With fewer than 2 bucketable candles (an account's first
   ~10-15 minutes), `paint()` already force-overrides the chart to line
   mode — but the Candles button stayed enabled, so tapping it reverted
   the highlighted button back to "Line" with zero feedback about why.
   Now `disabled` (new `.ctoggle-btn:disabled` rule, mirroring
   `.pager:disabled`'s existing treatment) whenever `candles.length < 2`.
   New test simulates a 2-sample history and asserts the button is
   disabled.

7. **Tapping an already-active range or chart-mode button still faded the
   chart out and back in** — a ~200ms flash with no informational change,
   violating the "kill any latency that isn't earning its keep" principle.
   Both click handlers now no-op when the tapped value matches the current
   one. New test.

8. **Missing `aria-pressed` on the range bar and Line/Candles toggle.**
   `.hub-tabs` (assetHubView.ts) already carries `role="tab"`/
   `aria-selected` for its own single-select segmented group, but this
   chart panel's two identical-shaped segmented groups carried no ARIA
   state at all — a screen-reader user had no way to tell which range or
   chart mode was active. Added `aria-pressed`, updated on every repaint.
   New test.

9. **`font-variant-numeric: tabular-nums` added to `.hero-bench`** (the
   Cash/vs-Bitcoin line under the Profit-tab heroes) — it shows money
   figures that refresh every 60s poll; without it, a digit-count change
   jitters the pill's width between refreshes.

10. **`font-variant-numeric: tabular-nums` added to `.readiness-list li`**
   (the real-money-readiness criteria, e.g. "50 / 20 closed trades") — same
   jitter-on-refresh reasoning as #9. Both are pure CSS additions to shared
   classes also used by Home/Portfolio/Stocks (noted below), safe by
   construction (no visual effect on non-numeric text).

**Shared-file touches for the parallel Stocks agent to check for
conflicts**: `assetHubView.ts` changes are all in the GENERIC
History/Profit code paths (shared verbatim by Stocks) — the skeleton-row
loading state, the real-activity icon, and the BTC-price-unavailable fix
all apply equally to Stocks' own asset-hub tabs (though Stocks has no live
account today, so items 4/5 are currently Crypto-only in practice).
`cloudState.ts`'s `recentEvents.symbol` field is additive/optional and
verified to have exactly one consumer in the codebase (`assetHubView.ts`)
before being touched. `styles.css`'s `.hero-bench`/`.readiness-list li`/
`.ctoggle-btn:disabled` rules are shared, generic classes also rendered by
`homeView.ts`, `portfolioView.ts`, `stocksLongTermPanel.ts`, and
`stocksOverviewPanel.ts` — all pure additions (new properties on existing
selectors), no existing rule changed, verified safe for every consumer.

Not touched: `homeView.ts`, `main.ts`, `marketsView.ts`, any `stocks*.ts`
file, any Tools view, `server/**`, `src/core/**` — per this agent's scope.

Full gate (after rebasing onto the sibling shared-layer pass above): tsc
clean, 1187/1187 vitest (9 new here across `assetHubView.test.ts`/
`cloudState.test.ts`/`equityChartPanel.test.ts`), `npm run build` clean.

## Design pass, Home + global nav chrome slice: 12 verified fixes (2026-09-06)

Part of David's "compare against Revolut X, ship 200 serious improvements"
round, split across parallel agents by screen area. This agent's slice:
`src/ui/views/homeView.ts`, `src/ui/main.ts` (bottom nav, topbar BTC chip,
data-source banner, tool-grid nav), and the Home/global-nav-specific parts
of `src/ui/styles.css` only — Markets/Stocks/Tools view-specific CSS is
other agents' scope, untouched here.

Loaded `fintech-dashboard-polish` and `apple-design` first. Read the prior
"Creative upgrade pass #1-#4", "Deep design pass #1-#3", "True-black Revolut
X theme landed", and "Design-system consistency pass" entries above in full
before starting, specifically to avoid re-proposing anything they already
shipped (two-tier pricing, sparklines, depth bars, hairline lists,
hero-bare, press states, table-scroll wrappers, badge fixes). Built `dist/`,
ran `vite preview`, and took real Playwright screenshots (`playwright-core`,
`/opt/pw-browsers/chromium`, 390×844, `?demo=1` + the real committed
`state/autopilot-state.json` mocked via `page.route`) of Home across every
primary tab and at 1280×900 desktop, before touching any code — a genuine
before/after screenshot (or a DOM/computed-style check where a screenshot
couldn't catch the exact timing) backs every item below. Did not re-extract
frames from the on-disk Revolut X screen recording — the skill's existing
notes already answered every question this slice raised.

Went in expecting ~28-30 items (this agent's share of 200 across several
parallel agents); found 13 real, independently-verifiable ones on its own
merge base. At rebase time onto `origin/main` (needed since a parallel
"shared-layer" agent had already merged PR #198 while this work was in
progress), one of those 13 — a `prefers-reduced-motion` fade for
primary/hub-tab switches — turned out to already be shipped there, as a
broader fix covering more selectors than this one did. Dropped it rather
than re-landing a duplicate; kept everything else, including one distinct,
unconflicted fix (item 10 below) that its own reduced-motion work never
addressed. Net: 12 real, independently-verifiable, non-duplicate ones —
stopped there rather than padding the count; three prior exhaustive passes
already covered most of the standard checklist for this exact screen.

1. **Topbar BTC chip was dead UI.** The single most prominent live number in
   the whole header (visible on every screen, not just Home) did nothing
   when tapped — no cursor, no press state, no destination. Gave it
   `data-nav="markets"` (picked up by the existing delegated `[data-nav]`
   click listener in `main.ts`, no new wiring needed) plus `cursor:pointer`,
   a hover tint, and a real `:active` scale press state (with a
   `prefers-reduced-motion` fallback). Verified: a real Playwright click on
   `#topbar-btc` now switches the active view to `view-markets` and lights
   up the Markets nav button; new test in `tests/ui/mainNav.test.ts` (a new
   file — main.ts had zero prior test coverage).
2. **Top movers row prices were flat strings next to two-tier prices two
   rows above.** The Markets strip cards directly above "Top movers" on the
   same screen already render `€160.93` with the `.93` dimmed/smaller
   (`tieredPriceHtml`); the movers list a few pixels below rendered
   `€160.93` as one flat string. Wrapped in the same `tieredPriceHtml` call
   already used everywhere else. Verified via screenshot: Litecoin
   `€85.74`, Solana `€160.93`, Dogecoin `€0.1227` all now show the dimmed
   decimal in the movers list, matching the cards above.
   (Considered the identical fix for the topbar BTC price too — reverted it
   after the screenshot showed BTC's price is always ≥ €1,000, and
   `formatPrice` drops decimals entirely above that threshold, so the wrap
   would be a genuine no-op for the one symbol this chip ever shows. Kept
   the diff to what actually changed a pixel.)
3. **The "Markets" strip was the one async section on Home with no loading
   state at all.** Top movers, Open positions, and Recent activity each
   already show a real shimmering skeleton before their data loads
   (`skeletonRowsHtml`); the Markets strip a few lines above them rendered
   nothing — a blank gap — for that same moment. Added
   `skeletonMarketCardsHtml` (`loadingStates.ts`) — a placeholder shaped
   like `.market-card` (icon, big price bar, sparkline-shaped bar) built
   from the same `.skeleton-dot`/`.skeleton-bar` shimmer primitives, kept
   off the real `.market-card` class per this file's own established
   convention ("a placeholder must never be picked up by code selecting
   real cards"). The demo data source resolves too fast to catch the exact
   race on a screenshot, so verified two ways: a real screenshot of the
   skeleton's shape (icon + bars, correctly shimmer-styled, two cards side
   by side) via direct DOM injection, and a new DOM test asserting
   `#home-markets .skeleton-market-card` exists synchronously on mount,
   before any fetch resolves.
4. **The hero balance's first paint was a bare giant "—" glyph, not a real
   loading state.** Every other async section on Home got a real skeleton;
   the single most prominent element on the whole screen (the giant
   `hero-bare` balance) rendered a stark, unstyled em-dash at full 2.7rem+
   scale with no shimmer for that same moment. Replaced with a
   `.hero-value-skeleton` shimmer bar for both the SIMULATED and REAL hero.
   Also handled the genuine-offline case so this can't repeat the "shimmers
   forever" bug this same function already guards against for Open
   positions/Recent activity: if the cloud state fetch never resolves, the
   skeleton is swapped for the honest static "—" instead of shimmering
   indefinitely. Verified via a screenshot with an artificially delayed
   (but still successful) state fetch, showing the real shimmer bar
   mid-load, and a new test asserting the offline fallback actually fires.
5. **Kill-switch "paused" banner used a bare "⏸" emoji** — the one place on
   Home that broke the app's single outlined-SVG icon language (readiness
   checks, tool-grid icons, and nav icons all use it; nowhere else in this
   file uses an emoji). Replaced with an inline SVG pause icon sized/stroked
   to match. Verified: existing kill-switch test still passes, plus a new
   assertion that `#hv-kill-switch` now contains an `<svg>` and no longer
   contains "⏸".
6. **Desktop sidebar nav overlapped and cut off the data-source banner's
   text.** A prior pass (PR referenced above) fixed the sidebar drawing over
   the *topbar* by pinning it to `top: 5rem` — but the amber "Live data
   unavailable" banner is a separate element between the topbar and
   `<main>`, never given the same `210px` clearance `.content`/`.topbar`
   already reserve for the sidebar. Confirmed on a real 1280×900 screenshot
   in demo/offline mode: the banner's own text was genuinely cut off behind
   the floating nav card. Added the same `margin-inline-start: 210px` in the
   existing desktop breakpoint. Verified with a before/after screenshot —
   the full banner text is now readable, clear of the sidebar.
7. **`viewport-fit=cover` was missing from the viewport meta tag.** This app
   already opts into edge-to-edge content
   (`apple-mobile-web-app-status-bar-style: black-translucent`) and the CSS
   already uses `env(safe-area-inset-bottom)` for the bottom-nav's content
   clearance — but per spec, `env(safe-area-inset-*)` only resolves to a
   real, non-zero value when the page declares `viewport-fit=cover`; without
   it, every safe-area calc in this file was silently computing against 0
   on a real notched/Dynamic-Island device, even though it reads as correct
   in the source. Added the meta tag — the actual precondition for items 8
   and 9 below to do anything on a real device.
8. **Topbar had no safe-area-inset-top padding at all**, in any of its four
   width breakpoints — on an installed iOS PWA (which this app's own meta
   tags request), the brand wordmark and BTC chip would render partly under
   the status bar/notch. Added `max(<existing value>, env(safe-area-inset-top))`
   to all four `.topbar` padding rules (base + 3 responsive breakpoints) so
   the existing value is preserved everywhere with no inset, and real
   clearance is added only where one exists.
9. **Bottom-nav's fixed `bottom: 20px` never accounted for the home-indicator
   gesture strip (~34px on a notched iPhone)** — it only ever read as
   "enough" because `env(safe-area-inset-bottom)` was silently 0 without
   item 7's fix. Fixing item 7 without also fixing this would have been a
   regression: the nav pill would newly sit right at (or under) the
   swipe-up gesture zone on a real device once the inset became real.
   Changed to `calc(20px + env(safe-area-inset-bottom))`.
10. **`.view.active`'s own page-transition rule was dead code, silently
    shadowed since it was written.** Found via `getComputedStyle` while
    verifying primary-tab transition behavior: `.view.active`'s declared
    `animation: viewfade ...` never actually plays — every `.view.active`
    element is a `<section>` inside `.content`, and a more specific rule
    (`.content section.active { animation: fadeInUp ... }`, three sections
    away) always wins on specificity regardless of source order. Two
    competing, only-one-of-which-works transition systems existed for the
    literal same elements — including in the shared-layer pass's own
    reduced-motion fix above, whose comment explicitly neutralizes BOTH
    `.view.active` and `.content section.active` "regardless of which one
    currently cascades," precisely because the dead one was never cleaned
    up. Removed the dead declaration here and pointed a comment at the one
    that actually runs, so there's exactly one source of truth left. Zero
    visible change (confirmed: `fadeInUp` played before and after, in both
    normal and reduced motion) — pure dead-code correctness, and it makes
    that other pass's own defensive "regardless of which one" caveat moot
    going forward.
11. **`.link-btn` ("See all" on Markets/Top movers/Recent activity) was
    hover-only** — no `:active` state, unlike every other tappable element
    on this screen (`.tappable`, `.mk-tab`, `.nav-btn` all have one). A
    phone has no `:hover` to fall back on, so all three "See all" links gave
    zero tap feedback. Added a real `:active` (opacity + scale) with a
    reduced-motion fallback. `.link-btn` is used only in `homeView.ts`, so
    this is zero-risk for the other parallel agents' screens.
12. **Markets strip cards had no scroll-snap** — a swipe left a card resting
    mid-width, cut in half by the strip's own trailing fade mask, instead of
    landing cleanly on a card boundary the way Revolut X's own horizontal
    card carousels do. Added `scroll-snap-type: x proximity` to
    `.markets-strip` and `scroll-snap-align: start` to `.market-card`
    (`proximity`, not `mandatory`, so a fast flick isn't fought).

**Not counted, considered and rejected**: retokenizing every raw
`rem`/`px` spacing value in Home-adjacent CSS onto the `--sp-*` scale —
most of the values in scope (`.markets-strip` gap, `.hub-tabs` padding,
etc.) are fine-grained micro-adjustments that don't map cleanly onto the
7-step scale, and several of the classes involved (`.hero`, `.hub-tabs`,
`.mk-tab`) are shared with other agents' in-flight screens — not worth the
merge-conflict risk for a cosmetic, sub-pixel-scale win.

Tests: 5 new (`tests/ui/mainNav.test.ts` — new file, main.ts's first-ever
test coverage; 4 added to `tests/ui/homeView.integration.test.ts`; 2 static
assertions added to `tests/ui/dashboard.test.ts`). Rebased onto
`origin/main` after the shared-layer pass above merged first (real conflicts
in `src/ui/styles.css`'s reduced-motion block and `PROJECT_STATE.md`'s tail,
both resolved by hand as described). Full gate green on the final, rebased
tree: `tsc --noEmit` clean, 1183/1183 vitest (1178 from the merged
shared-layer baseline + 5 new here, none broken), `npm run build` clean.
Diff: `index.html`, `src/ui/loadingStates.ts`, `src/ui/main.ts`,
`src/ui/styles.css`, `src/ui/views/homeView.ts` + the 3 test files above —
nothing under `server/**`, `state/**`, or `src/core/**`, and no view file
owned by another parallel agent (`marketsView.ts`, `assetHubView.ts`, any
`stocks*.ts`, any Tools view) touched.

## Round-2 deep dive: real-money readiness / kill-switch / live-vs-simulated UX audit — 6 verified fixes, 2 flagged capital-protection (2026-09-06)

Part of David's "compare against Revolut X, ship 200 serious improvements"
round 2 — this agent's slice, unlike round 1's per-SCREEN split, was the
app's most safety-critical SURFACE wherever it appears: the real-money
readiness checklist, the kill switch, and any live-vs-simulated confirmation/
status UI. Read this file's own prior "The simulated wallet is now hidden
everywhere once real money is live" entry (2026-09-05) first, specifically so
nothing here re-breaks that intentional hide — confirmed nothing does.

Before proposing anything, read the actual kill-switch code, not just its
UI text: `PersistedKillSwitch` (`src/core/autopilot/killSwitch.ts`),
`runLiveOrderFlow` (`server/liveOrchestrator.mts`), and
`manualKillSwitchCommand.mts`'s own doc comment, which states plainly that
`/pause` "halts every live order this project can place — new entries AND
exits alike." Cross-checked against `PaperAutoPilot.runCycleOnce`
(`src/core/autopilot/paperAutoPilot.ts`): the kill-switch check sits before
exits and entries both, skipping the whole cycle. Confirmed: engaging the
kill switch does not itself close any position — an open real-money position
sits exactly as it is, with no automatic exit possible, until a human
resumes.

**Flagged first, per this task's own instruction — capital-protection-relevant,
verified extra carefully:**

1. **The kill-switch "paused" banner never said what pausing actually does,
   and a reasonable reading of it is wrong.** Home's `#hv-kill-switch`
   (`homeView.ts`) read only "Real-money trading paused — {reason}". A
   reader could easily assume "paused" means only new trades stop while an
   open position is still being watched and can still be closed for them —
   checked against the code above, neither is true. Reworded to state the
   actual behavior plainly: "Real-money trading paused — no new trades or
   exits can execute; open positions stay open, unmonitored, until
   resumed{reason}". This is the single highest-priority finding of this
   pass — the whole point of a kill-switch banner is to accurately describe
   what safety net does and doesn't exist right now, and the old wording
   didn't.
2. **The kill-switch banner existed on Home but was entirely absent from
   the Crypto/Stocks hub's own "Real money" card (Profit tab)** — the exact
   same hero, shown a second time on the app's own asset-hub screen
   (`assetHubView.ts`). Anyone landing directly on Crypto → Profit without
   passing through Home first saw the real-money balance with zero
   indication that trading might currently be paused. Added the identical
   banner (`#hub-kill-switch`), same wording, same icon, driven by the same
   `state.live.killSwitchEngaged`/`killSwitchReason` fields already fetched
   there.

**Other verified fixes:**

3. **Crypto's own subtitle hardcoded "SIMULATED money" even after real
   money went live 2026-09-03** (`cryptoView.ts`: "The real cloud agent —
   SIMULATED money, matches the Telegram alerts.") — this exact text
   renders on every sub-tab of the Crypto hub, including Overview and
   Profit, which is where the REAL-money hero has lived since real money
   went live. "SIMULATED money" directly under a real-money balance is
   exactly the real-vs-simulated confusion this audit was asked to hunt
   for. Added `AssetHubOptions.liveSubtitle`, swapped in once
   `state.live` exists: "The real cloud agent — REAL money is live here.
   The simulated paper agent keeps running underneath but is no longer the
   primary account shown." Stocks (never goes live) passes no
   `liveSubtitle` and is untouched.
4. **The readiness checklist rendered a purely-informational unmet
   criterion identically to one that actually blocks readiness** — same
   amber warning icon, same "no" styling, in both `homeView.ts`'s and
   `assetHubView.ts`'s copies of the list. `assessRealMoneyReadiness`
   already marks some criteria non-gating (`gateOnBenchmark`/
   `gateOnTradeStats` — e.g. Stocks' trades/consistency, never gating for a
   hold-only strategy) and already appends "(informational — ...)" to their
   `detail` text, but the list never used that distinction visually.
   Verified live against the real committed `state/stocks-state.json`:
   Stocks currently reads "NOT READY" for exactly one real reason
   (benchmark, -0.27% vs SPY), yet the list showed THREE amber warning
   icons (trades, benchmark, consistency) with no way to tell at a glance
   that two of them don't count — a user reading top-to-bottom would
   reasonably conclude all three are why it's not ready. Fixed by adding
   `unmet: readonly string[]` to `CloudReadiness` (was parsed out of the
   raw state entirely until now) and a third neutral "info" li state,
   keyed off `r.unmet.includes(c.key)` rather than parsing the detail
   string. Defensive fallback: if `unmet` itself is absent from the raw
   state (old/malformed data), every `!ok` criterion is treated as
   blocking — the pre-fix behavior — rather than defaulting to "nothing
   blocks."
5. **Grid Simulation / Backtesting Lab / Validation's results carried no
   SIMULATED tag anywhere**, unlike every account screen in the app (Home,
   Crypto, Stocks, Portfolio all tag simulated data explicitly). All three
   are pure historical-backtest tools with no live money behind them at
   all — added the same `tag-sim` "SIMULATED" badge to each one's main
   results heading, matching the existing convention exactly
   (`<h2>Results <span class="tag-sim">SIMULATED</span></h2>`, same pattern
   `homeView.ts`'s "Open positions" heading already uses).

**Checked, found already correct, not touched:** the SIMULATED-wallet-hide
logic from 2026-09-05 (`#hub-sim-hero`/`#hub-sim-history`/`#hub-readiness`
hiding once `state.live` exists) — re-verified with a real screenshot of the
real committed live state, still correct, nothing here re-broke it. History
tab's real-vs-simulated sections are mutually exclusive
(`realActivityWrap.hidden = !live`, `simHistoryWrap.hidden = Boolean(live)`),
so no missing-tag ambiguity is actually reachable there. The Telegram-side
kill-switch messaging (`buildKillSwitchKeyboardIntro`, "עוצר את כל המסחר
בכסף אמיתי מיידית") was already reasonably accurate ("stops ALL trading"),
unlike the web banner — left alone.

Method: `fintech-dashboard-polish`/`apple-design` loaded first. Read the
kill-switch/readiness code paths (`killSwitch.ts`, `liveOrchestrator.mts`,
`manualKillSwitchCommand.mts`, `realMoneyReadiness.ts`) before writing a word
of UI copy — required by this task, since the whole point was catching UI
text that doesn't match actual behavior. Built `dist/`, ran `vite preview`,
real Playwright (`playwright-core`, `/opt/pw-browsers/chromium`, 390×844,
`?demo=1`) with `page.route` mocking BOTH the real committed
`state/autopilot-state.json` (real money live, kill switch forced engaged to
verify the banner) and `state/stocks-state.json` (pre-live, informational
vs blocking readiness criteria) — every fix above is backed by a real
before/after screenshot, not a code-only assertion.

Tests: 3 new in `cloudState.test.ts` (`unmet` parsing, empty-criteria
default, fallback-to-all-blocking when `unmet` itself is absent), 7 new in
`assetHubView.test.ts` (kill-switch banner shown/hidden with reason,
`liveSubtitle` swap in both directions and when omitted, readiness
info-vs-no distinction), 1 new in `homeView.integration.test.ts`
(info-vs-no distinction) plus wording assertions added to its existing
kill-switch test, 1 new in `backtestView.integration.test.ts` (SIMULATED
tag), assertions added to existing tests in `gridView.integration.test.ts`
and `validationView.integration.test.ts` (SIMULATED tag).

Gate: `tsc --noEmit` clean, 1214/1214 vitest passed (up from 1210 baseline),
`npm run build` clean. Diff: `src/ui/cloudState.ts`, `src/ui/styles.css`,
`src/ui/views/assetHubView.ts`, `src/ui/views/backtestView.ts`,
`src/ui/views/cryptoView.ts`, `src/ui/views/gridView.ts`,
`src/ui/views/homeView.ts`, `src/ui/views/validationView.ts` + 6 test files
— nothing under `server/**`, `state/**`, or `src/core/**`.
