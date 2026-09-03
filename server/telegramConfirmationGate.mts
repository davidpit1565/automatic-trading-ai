/**
 * Telegram-based human confirmation gate — implements the `ConfirmationGate`
 * contract from the execution architecture (docs/execution-architecture.md).
 *
 * Lives here in server/, not in src/core/execution, because it does real
 * network I/O (Telegram HTTP calls) — src/core/execution/types.ts stays a
 * pure contract with no I/O, exactly like every other real implementation of
 * those contracts (PersistedKillSwitch, PersistedAuditLog live in
 * src/core/autopilot for the same reason: those two need no network, only
 * storage, so they could stay pure; this one genuinely can't).
 *
 * `requestConfirmation` is a documented, deliberate adaptation of "blocks
 * until an explicit decision" to this project's actual runtime: a single
 * GitHub Actions job has its own wall-clock budget, so a literal indefinite
 * await isn't available. Instead this sends the Telegram message once (never
 * twice for the same intent — the pending record makes this idempotent
 * across separate runs), then short-polls for a bounded window. If nothing
 * arrives in that window it throws `ConfirmationPendingError` rather than
 * returning any decision: the interface's real requirement — no auto-approve,
 * no default answer, a human genuinely has to answer — still holds. The
 * caller's job is to call `requestConfirmation` again with the SAME intent
 * on the next scheduled run, which resumes polling instead of re-sending.
 */

import type { AuditLog } from '../src/core/execution/types';
import type { ConfirmationDecision, ConfirmationGate, OrderIntent } from '../src/core/execution/types';
import type { KeyValueStore } from '../src/core/data/storage';
import { liveCash } from './liveLedger.mts';
import {
  answerCallbackQuery,
  editTelegramMessage,
  formatQty,
  getSummaryTimezone,
  pollAllTelegramUpdates,
  sendTelegramMessage,
  stashUnclaimedTelegramUpdates,
  type TelegramConfig,
} from './telegram.mts';

const STORAGE_KEY = 'confirmation-gate-pending';
const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 3000;
/**
 * How long a sent confirmation stays awaiting a reply before it auto-expires
 * (David asked for this 2026-09-02): the order is a LIMIT order at the price
 * that was current when the message was sent (see the broker adapter) — the
 * crypto autopilot cron fires roughly every 30 minutes, so a much later tap
 * would submit at a price with no relation to the market by then. Expiring
 * instead of submitting stale is the safe default; nothing auto-approves.
 */
const MAX_PENDING_MS = 20 * 60 * 1000;

const APPROVE_PREFIX = 'confirm:approve:';
const REJECT_PREFIX = 'confirm:reject:';

export class ConfirmationPendingError extends Error {
  constructor(public readonly intentId: string) {
    super(
      `still waiting for a human decision on order ${intentId} — call requestConfirmation again next run`,
    );
    this.name = 'ConfirmationPendingError';
  }
}

interface PendingRecord {
  readonly sentAt: number;
  /** Undefined only if the send succeeded before this field existed, or
   * Telegram's response genuinely omitted it — editing is then skipped
   * rather than guessing a message to edit. */
  readonly messageId?: number;
  /** Undefined only for a record persisted before this field existed —
   * `requestConfirmation` then falls back to reconstructing the legacy
   * `${sentAt}:${intent.id}` token so an already-in-flight confirmation from
   * before this fix can still be matched. See `confirmationToken`'s doc
   * comment for why every NEW record gets a short token instead. */
  readonly token?: string;
}

/**
 * A short, deterministic per-request token embedded in a confirmation's
 * inline-keyboard callback_data. Telegram enforces a strict 64-byte limit on
 * callback_data — `intent.id` can be arbitrarily long (an exit intent embeds
 * the ORIGINAL entry's own id plus its own timestamp, e.g.
 * 'live-entry:XBTEUR:1788446384199:exit:1788476199224', 52 chars), so
 * embedding it directly (as this code used to, as `${sentAt}:${intent.id}`)
 * silently made the confirmation's own `sendMessage` call fail with HTTP 400
 * for exactly this shape of intent — a real incident, 2026-09-03: David
 * never even SAW the exit confirmation for a real open position, because it
 * was never actually delivered to Telegram at all.
 *
 * `sentAt` alone already guarantees uniqueness per confirmation INSTANCE
 * (the callback_data-must-be-unique-per-instance fix from earlier the same
 * day); folding in a short hash of `intent.id` additionally guards against
 * the astronomically-unlikely case of two different intents being sent in
 * the exact same millisecond.
 */
export function confirmationToken(sentAt: number, intentId: string): string {
  let hash = 0;
  for (let i = 0; i < intentId.length; i++) {
    hash = (Math.imul(hash, 31) + intentId.charCodeAt(i)) | 0;
  }
  return `${sentAt.toString(36)}.${(hash >>> 0).toString(36)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** HH:MM in `getSummaryTimezone()` — the SAME shared timezone the daily
 * digests use (telegram.mts), not a second independent clock. Real bug,
 * found 2026-09-03: this used to hardcode 'Asia/Jerusalem' directly, so
 * while David was travelling (digests already correctly on Europe/Brussels
 * via SUMMARY_TIMEZONE) this deadline alone stayed an hour off. An absolute
 * clock time, not a relative countdown: Telegram already timestamps the
 * message itself, and a bot can't tick a live countdown down between polls
 * anyway (runs are ~30 minutes apart), so a fixed deadline is the honest
 * thing to show. */
function formatDeadline(deadlineMs: number): string {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: getSummaryTimezone(),
    hour: '2-digit',
    minute: '2-digit',
  }).format(deadlineMs);
}

function expiryLine(deadlineMs: number): string {
  const minutes = Math.round(MAX_PENDING_MS / 60000);
  return `⏱ בתוקף עד ${formatDeadline(deadlineMs)} (${minutes} דקות) — אחרי זה מתבטל אוטומטית.`;
}

/**
 * Rewritten 2026-09-03: David has near-zero trading background and asked,
 * mid-confirmation, for the message itself to explain the numbers in plain
 * language rather than having to ask each time what "risk 0.30%" or
 * "reward/risk 2:1" actually means for HIM. Every figure below now carries
 * a short parenthetical of what it means in practice, not just the raw
 * number, without dropping any of the original figures.
 *
 * `cashBefore` (the real, current free EUR cash — `liveLedger.mts`'s
 * `liveCash`) was added the same day after he asked specifically: with an
 * existing open position already tying up some of the wallet, he wanted to
 * see the free-cash before/after alongside the overall wallet %, not just
 * one or the other. `a.portfolioExposure` was ALREADY computed against
 * total equity (cash + every open position's current value, not just what's
 * currently free — see `assessTrade` in `riskEngine.ts`), so the wallet %
 * shown here was correct even with other positions open; this only adds the
 * free-cash figures for full transparency, exactly as he asked for "both."
 */
function buildConfirmationMessage(intent: OrderIntent, deadlineMs: number, cashBefore: number): string {
  if (intent.side === 'sell') return buildExitConfirmationMessage(intent, deadlineMs);
  const a = intent.assessment;
  const cashAfter = cashBefore - a.positionValue;
  // Shown whenever the risk engine has something non-fatal to flag — most
  // notably David's "buy anyway despite the warning" manual override
  // (`liveEntryMirror.mts`'s `allowCapacityOverrideFor`, 2026-09-03): the
  // human must actually SEE why this trade was normally refused before
  // approving it, not just get a plain buy confirmation as if nothing were
  // unusual about it.
  const warningsBlock = a.warnings.length > 0 ? `⚠️ שים לב:\n${a.warnings.map((w) => `• ${w}`).join('\n')}\n\n` : '';
  return (
    `🔔 מחכה לאישור שלך — עסקה בכסף אמיתי\n\n` +
    `קנייה ${intent.symbol} (כמות: ${formatQty(intent.quantity)}, במחיר נוכחי ${intent.limitPrice})\n\n` +
    warningsBlock +
    // a.positionValue is the risk engine's own EUR sizing for this trade;
    // a.portfolioExposure is this trade's share of the ENTIRE wallet
    // (cash + every open position combined, not just what's currently
    // free) — already correct with other positions open, not only when
    // this is the sole position.
    `💰 סכום שיושקע: €${a.positionValue.toFixed(2)} — ${a.portfolioExposure.toFixed(1)}% מכל הכסף שיש לך בחשבון (כולל פוזיציות פתוחות אחרות, לא רק המזומן הפנוי)\n` +
    `💵 מזומן פנוי: €${cashBefore.toFixed(2)} עכשיו → €${cashAfter.toFixed(2)} אחרי העסקה\n` +
    `🛑 סטופ (מוכר אוטומטית אם המחיר יורד לכאן, כדי לעצור הפסד): ${intent.stopLoss}\n` +
    `🎯 יעד (מוכר אוטומטית אם המחיר עולה לכאן, כדי לממש רווח): ${intent.takeProfit}\n` +
    `⚠️ הכי הרבה שאפשר להפסיד בעסקה הזו אם היא נכשלת: €${a.riskAmount.toFixed(2)} ` +
    `(${a.riskPercentage.toFixed(2)}% מכל התיק — סכום קטן בכוונה)\n` +
    `📊 יחס סיכוי-סיכון ${a.rewardRiskRatio.toFixed(1)}:1 — אם זה מצליח, הרווח הפוטנציאלי גדול פי ${a.rewardRiskRatio.toFixed(1)} מהסיכון\n` +
    `📌 אחרי העסקה הזו, ${a.portfolioExposure.toFixed(1)}% מכל התיק (לא רק מהחלק הפנוי) יהיו קשורים בפוזיציות פתוחות\n\n` +
    `${expiryLine(deadlineMs)}\n\n` +
    `לחץ למטה כדי לאשר או לדחות. ללא לחיצה — שום דבר לא קורה, ההזמנה פשוט מתבטלת לבד.`
  );
}

/**
 * A sell intent CLOSES an existing position — `intent.assessment` here is
 * that position's entry assessment (see `server/liveExitFlow.mts`'s
 * `buildLiveExitIntent`), kept for traceability, not a fresh risk proposal.
 * Showing the entry's risk%/reward-ratio numbers as if they applied to THIS
 * decision would be actively misleading, so this renders what's actually
 * true of an exit: which position, at what price, and the resulting
 * profit/loss versus its entry price (`assessment.entry`).
 *
 * `assessment.entry` here MUST be the real fill price, not merely the
 * originally proposed one — `recordLiveEntryFill` (`server/liveExitFlow.mts`)
 * overrides it to the real `avgFillPrice` for exactly this reason (a filled
 * order can slip). Do not construct a sell `OrderIntent` any other way.
 */
function buildExitConfirmationMessage(intent: OrderIntent, deadlineMs: number): string {
  const entryPrice = intent.assessment.entry;
  const pnl = (intent.limitPrice - entryPrice) * intent.quantity;
  const sign = pnl >= 0 ? '+' : '';
  const verdict = pnl >= 0 ? 'ברווח ✅' : 'בהפסד';
  return (
    `🔔 מחכה לאישור שלך — סגירת פוזיציה בכסף אמיתי\n\n` +
    `מכירה ${intent.symbol} (כמות: ${formatQty(intent.quantity)})\n` +
    `נכנסת במחיר ${entryPrice}, יוצא עכשיו במחיר ${intent.limitPrice}\n\n` +
    `💶 רווח/הפסד משוער מהעסקה הזו: ${sign}€${Math.abs(pnl).toFixed(2)} (${verdict})\n\n` +
    `${expiryLine(deadlineMs)}\n\n` +
    `לחץ למטה כדי לאשר או לדחות. ללא לחיצה — שום דבר לא קורה, ההזמנה פשוט מתבטלת לבד.`
  );
}

/** Real, network-backed ConfirmationGate. Every order still waits for an
 * explicit human tap; there is no code path in this class that can resolve
 * `approved: true` on its own. */
export class TelegramConfirmationGate implements ConfirmationGate {
  constructor(
    private readonly store: KeyValueStore,
    private readonly telegram: TelegramConfig,
    private readonly audit: AuditLog,
    /**
     * The SAME store instance `/help`, `/tip`, `/status` and `/discover`
     * poll through — there is only ONE Telegram bot and ONE update offset.
     * Defaults to `store` for backward compatibility, but `autopilotRunner.mts`
     * passes the raw (unprefixed) store here specifically, not the
     * `live:`-prefixed one `store` itself is — see
     * `manualSellCommand.mts`'s matching parameter for the real bug (found
     * 2026-09-03, affecting approve/reject button taps too, not just
     * `/sell`) this fixes.
     */
    private readonly telegramStore: KeyValueStore = store,
  ) {}

  async requestConfirmation(intent: OrderIntent): Promise<ConfirmationDecision> {
    if (!this.telegram.token || !this.telegram.chatId) {
      throw new Error(
        `cannot request confirmation for order ${intent.id}: Telegram credentials are not configured`,
      );
    }

    const pendingAll = this.store.get<Record<string, PendingRecord>>(STORAGE_KEY) ?? {};
    let pending = pendingAll[intent.id];

    if (pending && Date.now() - pending.sentAt > MAX_PENDING_MS) {
      delete pendingAll[intent.id];
      this.store.set(STORAGE_KEY, pendingAll);
      const minutes = Math.round(MAX_PENDING_MS / 60000);
      const decision: ConfirmationDecision = {
        intentId: intent.id,
        approved: false,
        decidedAt: Date.now(),
        decidedBy: 'system',
        note: `auto-expired after ${minutes}m without a reply — the quoted price is likely stale`,
      };
      this.audit.append({
        timestamp: decision.decidedAt,
        intentId: intent.id,
        event: 'rejected',
        mode: intent.mode,
        detail: decision.note!,
      });
      if (pending.messageId !== undefined) {
        await editTelegramMessage(pending.messageId, `⌛ פג התוקף — ההזמנה בוטלה אוטומטית (לא הגיבו תוך ${minutes} דקות).`, this.telegram);
      }
      return decision;
    }

    if (!pending) {
      const sentAt = Date.now();
      // Short, opaque per-instance token — see `confirmationToken`'s doc
      // comment for why this must never embed intent.id directly (Telegram's
      // 64-byte callback_data limit, a real incident 2026-09-03).
      const token = confirmationToken(sentAt, intent.id);
      const result = await sendTelegramMessage(
        buildConfirmationMessage(intent, sentAt + MAX_PENDING_MS, liveCash(this.store)),
        this.telegram,
        {
          inline_keyboard: [
            [
              { text: '✅ אשר', callback_data: `${APPROVE_PREFIX}${token}` },
              { text: '❌ דחה', callback_data: `${REJECT_PREFIX}${token}` },
            ],
          ],
        },
      );
      this.audit.append({
        timestamp: Date.now(),
        intentId: intent.id,
        event: 'awaiting-confirmation',
        mode: intent.mode,
        detail: result.sent
          ? 'confirmation request sent to Telegram'
          : `Telegram send failed: ${result.reason} — will retry next run`,
      });
      // Only lock in "already sent" once the send actually succeeded — a
      // failed send that still persisted `pending` would permanently skip
      // this branch on every future call, so the human would never actually
      // be notified (a real bug: the audit detail claimed "will retry next
      // run" but nothing did). A failed send instead falls straight through
      // as pending (never polled — there is nothing to poll for yet), so
      // the NEXT call re-enters this branch and genuinely retries the send.
      if (!result.sent) {
        throw new ConfirmationPendingError(intent.id);
      }
      pending = { sentAt, messageId: result.messageId, token };
      pendingAll[intent.id] = pending;
      this.store.set(STORAGE_KEY, pendingAll);
    }

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      // Shared poller (telegram.mts) — see its doc comment for why this
      // must never call Telegram's own getUpdates with a private offset:
      // that was a real bug (an update another consumer needed could be
      // silently discarded forever). Every attempt MUST stash back
      // whatever it doesn't use, in every branch below, or the same bug
      // returns in a new shape.
      const polled = await pollAllTelegramUpdates(this.telegramStore, this.telegram);
      // Legacy fallback for a PendingRecord persisted before `token` existed
      // (an in-flight confirmation sent right before this fix deployed) —
      // see PendingRecord's doc comment.
      const token = pending.token ?? `${pending.sentAt}:${intent.id}`;
      const matchIndex = polled.callbacks.findIndex(
        (u) => u.data === `${APPROVE_PREFIX}${token}` || u.data === `${REJECT_PREFIX}${token}`,
      );

      if (matchIndex === -1) {
        stashUnclaimedTelegramUpdates(this.telegramStore, polled);
        if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const match = polled.callbacks[matchIndex]!;
      stashUnclaimedTelegramUpdates(this.telegramStore, {
        messages: polled.messages,
        callbacks: polled.callbacks.filter((_, i) => i !== matchIndex),
      });
      await answerCallbackQuery(match.id, this.telegram);
      const approved = match.data === `${APPROVE_PREFIX}${token}`;
      delete pendingAll[intent.id];
      this.store.set(STORAGE_KEY, pendingAll);
      const decision: ConfirmationDecision = {
        intentId: intent.id,
        approved,
        decidedAt: Date.now(),
        decidedBy: this.telegram.chatId,
      };
      this.audit.append({
        timestamp: decision.decidedAt,
        intentId: intent.id,
        event: approved ? 'confirmed' : 'rejected',
        mode: intent.mode,
        detail: approved ? 'approved via Telegram' : 'rejected via Telegram',
      });
      // David asked for this 2026-09-03: tapping אשר/דחה left the original
      // prompt sitting there untouched with no visible sign it registered
      // (Telegram's answerCallbackQuery alone shows nothing by default) —
      // replace the "awaiting confirmation" text and drop the keyboard
      // immediately so the tap is visibly acknowledged. The follow-up
      // message with the actual broker result (filled/rejected/etc.) is a
      // SEPARATE message sent by the caller once that's known — this class
      // only knows the human's decision, not what the broker will do with it.
      if (pending.messageId !== undefined) {
        await editTelegramMessage(
          pending.messageId,
          approved ? '✅ אישרת — שולח לבורסה...' : '❌ דחית — ההזמנה לא תבוצע.',
          this.telegram,
        );
      }
      return decision;
    }
    throw new ConfirmationPendingError(intent.id);
  }
}
