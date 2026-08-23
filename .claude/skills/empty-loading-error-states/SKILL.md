---
name: empty-loading-error-states
description: Use whenever building or reviewing any screen, list, or form that loads data from an API or database — task lists, note lists, transaction history, dashboards, any CRUD view. Also trigger on "loading," "spinner," "empty state," "no data," "error message," "what if it fails," or when a screen only shows the happy path (data present, request succeeds). Checks and builds the three states every data-driven screen needs — loading, empty, and error — instead of only the one that shows up in normal testing.
---

# Loading / Empty / Error States

Every screen that shows data from an API or database actually has (at least)
four states — loading, has-data, empty, and error — but normal use and normal
testing almost always only exercises "has-data." The other three are where
users silently hit a broken-feeling app. Check for all four whenever this
fires, and build whichever are missing.

## The four states, and what "missing" looks like

- **Loading**: the screen between "requested" and "got a response." Missing
  looks like a blank screen or last-frame flash before content pops in.
  Needs a visible loading indicator for anything not near-instant, and the
  submit/refresh action that triggered it should be disabled or clearly
  pending — not clickable again mid-request (see also: double-submit, below).
- **Empty**: the request succeeded and returned zero items. Missing looks
  like a blank list with no explanation, which a user reads as broken rather
  than as "you have no tasks yet." Needs a specific, situation-appropriate
  message and — where it makes sense — a direct action to fix the emptiness
  (e.g. "no tasks yet" + an add-task button right there, not just text).
- **Error**: the request failed — network down, server error, bad response.
  Missing looks like a silently empty or frozen screen with no distinction
  from "empty" or "still loading," which is the most user-hostile of the
  three because there's no way to tell it's broken versus just quiet. Needs
  a message distinct from the empty state, and — where retrying makes sense
  — a retry action rather than requiring a full page reload.
- **Has-data (partial)**: does pagination/infinite scroll have its own
  loading indicator for "fetching more" distinct from the initial load?
  Does a partial failure (some data loaded, then a later fetch failed) show
  what did load rather than discarding it?

## Related failure modes worth checking at the same time

- **Double-submit**: a submit/save/delete button clickable again before the
  first request resolves, causing a duplicate task/note/transaction. Disable
  or debounce it for the duration of the request.
- **Silent catch blocks**: an error caught and swallowed (`catch {}`, a
  promise with no `.catch`/no error boundary) so the failure never reaches
  the error state at all — it just looks like nothing happened. Every catch
  should either surface something to the user or explicitly justify why not
  (e.g. a background sync that fails and correctly stays silent).
- **Stale data on error**: if a background refresh fails, does the screen
  keep showing the last good data (usually correct) or does it clear to
  empty/blank (usually wrong, and easy to do by accident if the error path
  clears state before checking whether there's existing data to keep)?

## Process when this skill fires
1. Identify what data source(s) the screen depends on.
2. For each: confirm loading, empty, and error are each implemented and
   visually distinct from one another — not, e.g., empty and error both
   rendering as the same blank div.
3. Check double-submit protection on any action that mutates data.
4. Check silent catches — trace what actually happens to a thrown error,
   don't assume a try/catch means it's handled.
5. If a state can't be triggered/tested in this environment (e.g. no way to
   simulate a network failure here), say so rather than reporting it as
   verified.
