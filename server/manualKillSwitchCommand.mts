/**
 * Manual kill-switch override via Telegram (David asked for this
 * 2026-09-02): `/pause` immediately halts every live order this project can
 * place — new entries AND exits alike, since `runLiveOrderFlow` checks
 * `killSwitch.isEngaged()` before anything else regardless of side — and
 * `/resume` lifts it. Independent of the algorithm's own automatic safety
 * triggers (drawdown breaker etc.): a human can engage or lift this
 * regardless of what those currently think, at any time.
 *
 * Tested, reusable machinery — like the rest of this session's manual
 * overrides, nothing calls it from any scheduled workflow yet.
 */

import type { KeyValueStore } from '../src/core/data/storage';
import type { AuditLog, KillSwitch } from '../src/core/execution/types';
import {
  pollAllTelegramUpdates,
  stashUnclaimedTelegramUpdates,
  type TelegramConfig,
  type TelegramTextMessage,
} from './telegram.mts';

export type ManualKillSwitchCommand = 'pause' | 'resume';

/** Parses `/pause` or `/resume` (case-insensitive, surrounding whitespace
 * tolerated). Anything else — including a typo'd or partial command — is
 * null, never guessed at. */
export function parseKillSwitchCommand(text: string): ManualKillSwitchCommand | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '/pause') return 'pause';
  if (trimmed === '/resume') return 'resume';
  return null;
}

export interface ManualKillSwitchOutcome {
  readonly command: ManualKillSwitchCommand;
  /** false when the switch was already in the requested state — a no-op,
   * not an error (e.g. `/pause` while already paused). */
  readonly applied: boolean;
}

/**
 * Polls for new `/pause`/`/resume` commands since the last check and
 * applies each in order. `decidedBy` is the audit trail's record of WHO —
 * same contract as `ConfirmationDecision.decidedBy` elsewhere in this
 * project — pass the configured Telegram chat id (the only chat this ever
 * accepts a command from, per `pollAllTelegramUpdates`).
 */
export async function checkManualKillSwitchCommands(
  store: KeyValueStore,
  telegram: TelegramConfig,
  killSwitch: KillSwitch,
  audit: AuditLog,
  decidedBy: string,
  now: number,
): Promise<readonly ManualKillSwitchOutcome[]> {
  // Shared poller (telegram.mts) — never poll Telegram directly here with a
  // private offset (a real bug, fixed 2026-09-02: see PROJECT_STATE.md).
  // Anything this function doesn't recognise (every callback_query, plus
  // any message that isn't /pause or /resume) is stashed back immediately
  // so other consumers can still find it.
  const polled = await pollAllTelegramUpdates(store, telegram);
  const unclaimedMessages: TelegramTextMessage[] = [];
  const outcomes: ManualKillSwitchOutcome[] = [];
  for (const message of polled.messages) {
    const command = parseKillSwitchCommand(message.text);
    if (!command) {
      unclaimedMessages.push(message);
      continue;
    }

    if (command === 'pause') {
      const applied = !killSwitch.isEngaged();
      if (applied) {
        killSwitch.engage(`manual /pause via Telegram (${decidedBy})`);
        audit.append({
          timestamp: now,
          intentId: 'manual-kill-switch',
          event: 'kill-switch-engaged',
          mode: 'live',
          detail: `kill switch engaged manually by ${decidedBy}`,
        });
      }
      outcomes.push({ command, applied });
    } else {
      const applied = killSwitch.isEngaged();
      if (applied) {
        killSwitch.disengage(decidedBy);
        audit.append({
          timestamp: now,
          intentId: 'manual-kill-switch',
          event: 'kill-switch-disengaged',
          mode: 'live',
          detail: `kill switch disengaged manually by ${decidedBy}`,
        });
      }
      outcomes.push({ command, applied });
    }
  }
  stashUnclaimedTelegramUpdates(store, { messages: unclaimedMessages, callbacks: polled.callbacks });
  return outcomes;
}
