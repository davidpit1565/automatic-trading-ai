---
name: money-number-correctness
description: Use whenever writing or reviewing code that stores, calculates, converts, or displays money, prices, balances, quantities, or trading figures — anything where the number has to be exactly right rather than approximately right. Also trigger on "balance," "amount," "price," "total," "rounding," "currency conversion," "P&L," "position size," or "off by a cent/point." Checks for the specific numeric-correctness bugs that pass casual testing and only show up at scale or on specific values — floating-point money math, rounding direction, timezone-dependent date math, off-by-one ranges.
---

# Money & Number Correctness

These bugs are dangerous specifically because they pass normal testing —
a handful of manually-checked values look right, and the bug only shows up
on values or dates the tester didn't happen to pick. Check the categories
below explicitly rather than trusting that "the numbers looked fine when I
tried it."

## Floating-point money math

- **Never do money arithmetic in raw `float`/`double`.** `0.1 + 0.2` is not
  `0.3` in IEEE 754 — small, silent rounding errors accumulate especially
  across many transactions or repeated calculations (compounding, running
  balances). Store and compute money as integer cents/agorot, or with a
  proper decimal library, and only format to a display string at the edge.
- **Rounding direction and point matter, and should be a stated decision**,
  not whatever the language's default happens to do. Banker's rounding vs.
  round-half-up vs. always-round-down-in-the-house's-favor can each be
  correct depending on context — check this project picked one on purpose
  for each place money is rounded (fees, splits, converted currency), not
  that three different rounding behaviors crept in from three different
  code paths.
- **Currency conversion**: confirm which direction a rate is applied
  (multiply vs. divide can look like the same magnitude of error until you
  check specific numbers), and whether the rate used is fresh enough for
  what it's used for.

## Trading/position-specific (automatic-trading-ai)

- **Position sizing and P&L math**: verify against real historical data
  (this repo's own rule — `sweepStrategy.mts`/`validateStrategy.mts`), not
  synthetic round numbers that happen to divide evenly.
- **Timestamp alignment**: confirm timestamps from the exchange (Kraken) and
  any local scheduling are compared in the same timezone/epoch convention —
  a UTC-vs-local mismatch silently shifts which candle/period a calculation
  actually uses, and won't show up as a crash.
- **Simulated-vs-real boundary**: this account's non-negotiable rule is
  simulated money only in core, real money gated behind an explicit
  readiness check. When touching anything money-related here, confirm which
  side of that boundary the code is on — don't let a "just for testing"
  path accidentally reach the real-money gate.

## Dates and ranges

- **Off-by-one in date ranges**: "this month" or "last 30 days" boundaries
  are a classic place to be one day short or one day long — check both
  endpoints (inclusive/exclusive) against an actual calendar, not just that
  the query runs without error.
- **Timezone-dependent date math**: a date comparison done in UTC when the
  user's data is timestamped in local time (or vice versa) can put a
  transaction in the wrong day/month, especially near midnight or near a
  daylight-saving transition. Confirm which timezone convention is used
  consistently for storage, calculation, and display.
- **DST transitions**: a scheduled job or reminder set for a specific local
  time can fire an hour off on the days clocks change, if the scheduling
  logic used a fixed UTC offset instead of the actual timezone rule.

## Process when this skill fires
1. Identify every place a monetary or quantity value is stored, calculated,
   or converted in what's being built/reviewed.
2. Confirm the arithmetic type (integer cents / decimal, not raw float).
3. Check rounding is a deliberate, stated choice at each rounding point.
4. For date/time-dependent money logic, check the timezone convention is
   explicit and consistent, and test at least one boundary value (month
   edge, midnight, a DST-transition date) rather than only a mid-range one.
5. State what was checked and what (if anything) was fixed — don't just
   assert "looks correct" without naming the specific values or boundaries
   checked.
