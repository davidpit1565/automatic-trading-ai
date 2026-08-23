---
name: rtl-hebrew-correctness
description: Use whenever building or editing any UI that displays Hebrew text, numbers, currency, dates, or forms — every screen in a Hebrew-first app. Also trigger on "RTL," "עברית," "מספרים," "תאריך," "מטבע," "טופס," "mixed direction," "bidi," or when text/numbers look reversed, misaligned, or wrong only in the Hebrew UI (not in an English reference). Applies the specific correctness checks that generic RTL support misses — numbers, dates, currency, mixed Hebrew/English strings, tables, form inputs — and fixes what's found rather than only flipping `dir="rtl"` and calling it done.
---

# RTL & Hebrew Correctness

Setting `dir="rtl"` flips the layout but does not make an app correct in
Hebrew — most of the real bugs live in the details `dir="rtl"` doesn't touch.
Check these specifically; don't stop at "the page mirrors."

## Numbers, currency, and dates — these must stay LTR inside RTL text

- **Numerals themselves are always left-to-right**, even mid-Hebrew-sentence.
  `"יש לך 120 ₪"` must render with "120" reading left-to-right, not
  digit-reversed. This breaks specifically when a number is built by string
  concatenation instead of proper interpolation, or when a font/library
  applies blanket bidi mirroring to a whole line including its digits.
- **Currency symbol placement**: ₪ conventionally follows the number in
  Hebrew (`120 ₪`), not precedes it the way `$120` does — verify this project
  places it the way its own users actually expect, and be consistent site-wide
  rather than mixing conventions between screens.
- **Multi-part numbers** — phone numbers, IDs (ת״ז), dates written as
  DD/MM/YYYY — must not have their segment order flipped by RTL mirroring.
  A phone number or date is a fixed left-to-right token; wrap it (e.g. a
  `dir="ltr"` span or `unicode-bidi: isolate`) so the surrounding RTL
  paragraph direction can't reorder its parts.
- **Date format**: Israeli convention is DD/MM/YYYY — confirm the app isn't
  silently using MM/DD/YYYY from an unlocalized date library default, which
  reads as a plausible-but-wrong date for any day ≤12.

## Mixed Hebrew/English strings

- **A Hebrew sentence containing an English word/brand name/email address**
  is exactly where bidi bugs surface — the English token can end up
  displayed in the wrong position relative to the Hebrew words around it.
  Test the actual mixed string, not just pure-Hebrew or pure-English
  versions of it.
- **Punctuation next to mixed-direction text** (parentheses, colons, a
  trailing "%") can visually attach to the wrong side. Check it renders next
  to the character it's supposed to modify, not mirrored to the other side.

## Forms and inputs

- **Numeric/phone/date inputs should still type left-to-right** even inside
  an RTL page — a numeric field that inherits `dir="rtl"` from its container
  can make digits appear to type in reverse order as the user types.
- **Placeholder and label text align correctly** for RTL (right-aligned,
  not just mirrored padding), and validation/error messages appear on the
  correct side without overlapping the input.
- **Autocomplete/dropdown lists** open and align from the correct edge —
  a dropdown positioned by an LTR assumption (e.g. `left: 0`) can render
  off-screen or over other content in an RTL layout.

## Tables and lists

- **Column order**: in RTL, the "first" column is visually on the right.
  A table built with LTR column order and only `dir="rtl"` applied can end
  up with headers not lining up with their data column, especially if any
  column contains an LTR-forced number/date.
- **Sort/pagination controls and their icons** (chevrons, arrows) need to
  point the direction that's actually correct for RTL — a ">"-shaped
  "next" arrow that isn't flipped now points backward.

## Icons and directional UI

- Any icon that encodes direction — back/forward arrows, chevrons,
  play/rewind, a drawer that slides from an edge — must be mirrored for
  RTL. An icon that's purely symbolic (a trash can, a checkmark) should
  *not* be flipped; flipping it looks broken. Check each icon individually
  rather than blanket-mirroring or blanket-preserving all of them.

## Process when this skill fires
1. Test with real mixed content, not lorem-ipsum-in-Hebrew or pure Hebrew —
   include at least one number, one date, one English word/brand name in
   whatever's being checked.
2. Check numbers/dates/currency render left-to-right and in the right
   position relative to the surrounding Hebrew text.
3. Check every directional icon on the screen individually — mirrored where
   it should be, untouched where it shouldn't.
4. If the project has both Hebrew and English surfaces (e.g. this account's
   video content vs. its Hebrew studio/apps), confirm direction is scoped to
   the right container and doesn't leak across — an English page must never
   inherit a right-to-left scrollbar or number order from a Hebrew parent.
