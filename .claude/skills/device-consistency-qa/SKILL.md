---
name: device-consistency-qa
description: Use whenever building or editing a navbar/header, navigation menu, responsive layout, or any page structure in a website or app — and whenever building or editing on-screen text, captions, or subtitle timing in a video. Also trigger on "navbar," "menu," "hamburger," "responsive," "mobile view," "it breaks on phone," "looks broken on iPhone/Android," "text is out of sync," "captions overlap," "cut off on screen," "safe area," "RTL," "on all devices," or any request to check something works "on every device" or "on all screens." Runs the checklist and fixes what's wrong automatically — the point is not to explain the bug class, but to find and fix the specific instance and confirm it holds at every breakpoint/device this project's audience actually uses.
---

# Device & Layout Consistency QA

This is the list of bugs that keep recurring across navbars, responsive
layouts, and video text — the ones worth checking every single time rather
than waiting to be told about. When this skill fires: find whichever of these
apply to the thing being built, fix them, and verify at real breakpoints
before calling it done — don't just describe the risk.

**Ground truth over assumption.** "Looks fine on my screen" proves nothing —
the whole point is that the failure only shows up at sizes/scenarios the
current view isn't. Actually resize the viewport, actually check the RTL
direction, actually seek the video timeline — don't reason about it in the
abstract when checking is available.

## Website / app navbar & layout

**Breakpoints to actually check, not just design for:**
- 360–390px (small/standard phones, e.g. iPhone SE, common Android)
- 393–430px (modern phones, e.g. iPhone 14–16 Pro Max width)
- 768px (tablet portrait)
- 1024px+ (tablet landscape / small laptop)
- 1440px+ (desktop)
A layout that only gets checked at one size is unverified at every other one.

**Recurring bugs to check for:**
- **Nav items wrap or overflow at narrow widths**, forcing horizontal scroll
  or a squished, overlapping row. If it doesn't fit at 360px, it needs a
  collapse pattern (hamburger/drawer), not smaller font as the fix.
- **A hamburger/mobile menu exists but the toggle button itself is a touch
  target under ~44×44px**, or sits close enough to another tappable element
  that a thumb can't reliably hit the right one.
- **Dropdown/hover submenus that only open on `:hover`** — dead on touch
  devices with no mouse. Needs a tap/click handler as well.
- **Sticky/fixed navbar overlapping the content below it** — the page's top
  content is hidden behind the bar because nothing reserves that space
  (missing `padding-top`/`margin-top` equal to the navbar's actual height,
  which can change between breakpoints).
- **RTL layouts (Hebrew) where the nav didn't actually mirror** — items still
  in LTR reading order, a hamburger icon or chevron still pointing the LTR
  way, or a drawer that opens from the wrong edge. Check `dir="rtl"` is set
  where it should be and that icons with inherent direction are flipped, not
  just the text.
- **No active/current-page state**, or the active indicator breaks at a
  breakpoint where the nav collapses into a different pattern (e.g. it's a
  bottom border on desktop but the mobile drawer doesn't show one at all).
- **The safe-area at the top/bottom of the screen on notched phones** —
  content or the navbar itself sitting under the notch/home-indicator area
  because `env(safe-area-inset-*)` isn't respected. Especially relevant for
  a bottom tab bar.
- **Long labels/names truncate badly or push layout** — a real user's data
  (a long name, a long menu label, Hebrew text which often runs longer than
  the English equivalent) breaks a layout sized to the placeholder/demo text.
- **Z-index conflicts** — a menu, modal, or dropdown rendering behind another
  fixed element instead of on top of it.

**Process:** open the page/component, resize through each breakpoint above
(and toggle RTL if the project has both directions), fix what breaks, then
re-check the breakpoints you just touched — a fix at one width has caused
regressions at another more than once.

## Video on-screen text / captions

- **Reading order must match speaking order.** If a line has mixed Hebrew/English
  or the on-screen text is reordered from the narration for emphasis, confirm
  a viewer's eye actually lands on words in the order they're spoken — mixed
  direction text is exactly where this silently flips.
- **Sync drift** — on-screen text appearing before or after the word is
  actually said. Re-check after any edit to narration timing, pacing, or a
  retime pass; a timing fix for one line can shift everything after it.
- **Two text elements on screen at once landing on top of each other**, or a
  caption appearing while a scene's own headline text is still on screen.
- **Text outside the platform's safe area** — for 9:16 vertical video, keep
  clear of the top ~14% and bottom ~35% of frame (where the platform draws
  username/caption/buttons) and roughly 6% on each side; check this project's
  own documented safe-area numbers if they differ from that default, and
  re-verify after any layout or timing change, not just once at design time.
- **Caption chunks too long to read in the time they're on screen**, or a
  single full sentence dumped at the bottom of frame instead of short,
  word-synced chunks — the most common captioning mistake, and it reads as
  low-effort even when the content is good.
- **Text cut off at the frame edge** on a device/aspect ratio the content
  wasn't checked against (e.g. content built for 9:16 also needs to not break
  if it's ever cropped square or 16:9).

**Process:** after generating or editing narration, captions, or on-screen
text, seek through the actual rendered timeline (not just read the script) —
sync and overlap bugs practically never show up by reading text off the page.
If this project already has an automated safe-area/timing checker, run it;
if it doesn't and the checks above are being done by eye repeatedly, that's a
sign one is worth building.

## Before calling it done
1. State which of the checks above actually applied to what was built/changed
   — don't run through the whole list narrating each irrelevant item.
2. Show it actually holds at the breakpoints/timeline points that matter for
   this specific change, not just at the one size/moment it was built at.
3. If something can't be verified in this environment (e.g. no real device,
   no way to render video here), say so plainly rather than reporting it as
   checked.
