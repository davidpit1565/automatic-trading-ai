---
name: action-firewall
description: Use before executing, or writing code that will execute, any action with a real-world consequence — sending money, moving/deleting data, posting publicly, calling a paid or rate-limited external API, pushing/merging code, changing production config, or granting access. Also trigger on "delete," "send," "post," "pay," "charge," "merge," "deploy," "push to main," "grant access," or any moment right before a tool call that isn't purely read-only. This is the gate that decides whether an action proceeds, gets logged and proceeds, or stops for confirmation — it doesn't replace the detailed skills for each risk category (idempotency-safety, destructive-action-safety, access-control-gating, secrets-hygiene, third-party-api-resilience), it decides when to apply them and enforces the stop.
---

# Action Firewall

Researched and written after finding that no framework checked — Agently
included, in its own architecture and its own skills catalog — has a layer
that sits between "the agent decided to do something" and "the thing
actually happened." Agently's Action Runtime executes; its Observability
records what already happened. Nothing sits in between and asks whether it
should happen. This skill is that layer, for this session.

**This is a gate, not a rulebook.** It doesn't re-explain every risk
category in depth — `idempotency-safety`, `destructive-action-safety`,
`access-control-gating`, `secrets-hygiene`, and `third-party-api-resilience`
already do that. This skill's job is narrower and non-optional: catch the
moment right before a consequential action, classify it, and enforce what
happens next — so those other skills' checks actually get *applied* at the
right moment instead of being knowledge that sits unused.

## The gate, in order

**1. Classify the action.** Before it happens, name what it actually is:
- **Read-only** (fetch, list, search, view) → proceed, no gate needed.
- **Reversible write** (create a draft, save a local file, add a row that
  can be deleted) → proceed, but log what was done.
- **Irreversible or externally-visible** (send money, delete data with no
  undo, post publicly, send an email/message to a real person, push to a
  shared branch, merge a PR, deploy, grant/revoke access, call a metered
  API that costs real money per call) → do not proceed automatically. Go
  to step 2.

If the classification is genuinely ambiguous, treat it as irreversible —
the cost of an unnecessary pause is small; the cost of a wrong guess on
this step is not.

**2. For anything irreversible or externally-visible, check in this order:**

- **Already authorized in this conversation?** Did the user already ask
  for this specific action, explicitly, in this session (not implied, not
  "probably wants it")? If yes → proceed to step 3. If no → stop and ask,
  in plain terms, exactly what's about to happen and why it needs
  confirmation. Don't do it "to save a round-trip."
- **Safe to repeat?** (`idempotency-safety`) If this exact action ran
  before — a retry, a re-run, a duplicate trigger — would it double-charge,
  double-post, double-send? If there's no mechanism preventing that, say so
  before proceeding, don't assume it's fine because it hasn't happened yet.
- **Actually in scope?** (`access-control-gating`) Is this action within
  what the user authorized, or does it reach further — a different
  account, a different repo, a broader audience than asked for?
- **No secret about to leak?** (`secrets-hygiene`) Does this action write,
  log, or transmit anything that looks like a credential? If yes, stop
  regardless of anything else.
- **External dependency healthy?** (`third-party-api-resilience`) If this
  action depends on a third-party service, does a failure mid-action leave
  things in a half-done, undetectable state?

**3. Log it before it happens, not just after.** State plainly, in one
line, what is about to be done and why — "deleting 12 rows matching X
because the user asked to clear test data" — before the tool call, not as
an after-the-fact summary. If it fails partway, the log already shows what
was attempted.

**4. After it happens, confirm the actual outcome**, not the intended one —
check the result, don't assume success because no exception was thrown.

## What "stop and ask" looks like in practice

Not a wall of caveats — one clear sentence naming the action and its
consequence, then the question. "This will permanently delete the
`old-backups` table — 40,000 rows, no undo. Confirm?" beats a paragraph of
hedging. If the user already answered this exact question for this exact
action earlier in the conversation, don't ask again — re-asking after
already being told is its own failure mode.

## What this skill does not do

- It does not add confirmation prompts to read-only or trivially-reversible
  actions — that's noise, and noise is what makes people stop reading
  confirmations at all.
- It does not override an explicit, specific instruction the user already
  gave for this exact action — asking again after being told is not extra
  safety, it's friction that trains the user to stop reading the question.
- It is not a substitute for testing — passing this gate means "this is
  the right moment to check and the right things got checked," not "this
  code is correct."
