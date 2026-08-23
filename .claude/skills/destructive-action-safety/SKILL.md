---
name: destructive-action-safety
description: Use whenever building or reviewing any delete, remove, clear, reset, or overwrite action on user data — tasks, notes, transactions, settings, files. Also trigger on "delete," "remove," "clear all," "reset," "are you sure," "undo," or "I lost my data." Checks that a destructive action can't happen by accident and, where it can't be trivially prevented, that it can be undone.
---

# Destructive Action Safety

The apps in this account hold real personal data — tasks, notes, financial
records — that the user can't regenerate if it's gone. A destructive action
that's one accidental tap away from firing, with no way back, is a real cost
to trust even if it happens rarely; check for it every time, not just when
asked.

## The checks

- **Confirmation before anything irreversible.** A delete/clear/reset action
  needs a distinct confirmation step (a dialog, a hold-to-confirm, a
  type-to-confirm for something big like "delete all data") — not just being
  one tap/click away from the rest of the UI. The bar scales with the blast
  radius: deleting one item can have a lighter confirmation than clearing an
  entire list or account.
- **An undo window beats a confirmation dialog where it's feasible.** A
  "deleted — undo" toast that actually reverses the action for a few seconds
  is more forgiving than a confirmation dialog a user reflexively accepts
  without reading. Prefer soft-delete (mark hidden, actually remove later)
  over hard-delete where the data model allows it.
- **Cascading deletes must be intentional and visible.** Deleting a parent
  record (a project, a category, an account) that silently takes dependent
  records with it needs to say so before it happens — "this will also delete
  12 tasks" — not discover it after the fact. Check what actually cascades
  in the data layer, not just what the UI implies.
- **Bulk/"select all" actions need a higher bar than single-item actions** —
  confirm the count of what's about to be affected is shown, and that a
  bulk delete can't be triggered by the same tap that would delete a single
  item (no shared button between "delete this" and "delete everything").
- **Overwrite is a form of destruction too**: an edit/save action that
  replaces existing data (not just an explicit delete) should not be able to
  wipe a field to empty/null by accident — e.g. a failed form submission
  that saves partial/empty data over what was there.
- **Recovery path for real mistakes**: for data that matters (financial
  records, more than a few days old), is there any backup/export a user
  could fall back on if something did go wrong outside the app's own undo
  window — or is the live database the only copy that ever existed?

## Process when this skill fires
1. Identify what data the action destroys and whether it cascades to
   anything else.
2. Check there's a confirmation step sized to the blast radius, and prefer
   undo/soft-delete over a bare "are you sure" where the data model allows.
3. For bulk actions, confirm the affected count is shown and the trigger is
   distinct from the single-item action.
4. State what safety net exists for this specific action — don't just say
   "added a delete button," say what stops it from firing by accident and
   what happens if it does.
