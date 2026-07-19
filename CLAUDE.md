# Autonomous Trading AI — Development Rules

## Mission
Maximum correctness while minimizing token usage, context, file reads, and
unnecessary tool calls. **Save cost — but never at the expense of quality or
safety.** Validation on real data, the full gate before merging, and capital
protection are never shortened.

## Token efficiency
Optimize for: minimum tokens, context, file reads, tool calls, output length,
and smallest correct diff. Never consume extra context unless required.

## Repository access
Do NOT scan the repo by default. Read only files directly related to the task;
inspect more only when necessary (say briefly why first). Reuse prior findings;
never re-read unchanged files. Check `PROJECT_STATE.md` before reading more code.

## Editing
Smallest correct diff. Preserve architecture. No unnecessary refactoring. Never
rewrite working code. Don't reformat code you aren't editing.

## Testing
Run the smallest relevant set (affected unit + integration tests). Run the FULL
suite only when: requested, before a release/merge to main, or when changes
touch multiple modules. Never re-run passing tests without reason.

## Git
Don't inspect history unless necessary. Commit/push only when it advances the
current task (autonomous mode: commit + merge to main only after a green gate).

## Memory
Assume previous conclusions hold. Prefer cached understanding over re-reading.

## Task workflow
1. Understand the task. 2. Identify the minimum files. 3. Read only those.
4. Implement (smallest safe change). 5. Run minimal tests. 6. Update
`PROJECT_STATE.md` if architecture changed. 7. Concise summary.

## Trading-specific (non-negotiable, override brevity)
- SIMULATED money only in core; no live-order path (enforced by architecture
  tests). Real money stays gated behind the readiness check + approval flow.
- Measure, don't guess: validate strategy changes on real Kraken history
  (`scripts/sweepStrategy.mts` / `validateStrategy.mts`); keep only measured
  improvements. Full gate (tsc → vitest → build) before merge to `main`.
- Secrets (Telegram token/chat id) live only in GitHub Actions secrets.

## Priority order
1. Correctness  2. Safety/capital protection  3. Minimal tokens/context/reads
4. Minimal tool calls  5. Smallest safe implementation.
