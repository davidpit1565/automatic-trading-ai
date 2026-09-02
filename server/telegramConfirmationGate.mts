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
import {
  answerCallbackQuery,
  getTelegramUpdates,
  sendTelegramMessage,
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
  readonly updateOffset: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildConfirmationMessage(intent: OrderIntent): string {
  if (intent.side === 'sell') return buildExitConfirmationMessage(intent);
  const a = intent.assessment;
  return (
    `🔔 מחכה לאישור שלך — עסקה בכסף אמיתי\n\n` +
    `קנייה ${intent.symbol}\n` +
    `כמות: ${intent.quantity} · מחיר: ${intent.limitPrice}\n` +
    `סטופ: ${intent.stopLoss} · יעד: ${intent.takeProfit}\n` +
    `סיכון: ${a.riskPercentage.toFixed(2)}% מהתיק (${a.riskAmount.toFixed(2)}) · ` +
    `יחס סיכוי/סיכון ${a.rewardRiskRatio.toFixed(1)}:1\n` +
    `חשיפת תיק לאחר העסקה: ${a.portfolioExposure.toFixed(1)}%\n\n` +
    `לחץ למטה כדי לאשר או לדחות. ללא לחיצה — שום דבר לא יקרה.`
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
function buildExitConfirmationMessage(intent: OrderIntent): string {
  const entryPrice = intent.assessment.entry;
  const pnl = (intent.limitPrice - entryPrice) * intent.quantity;
  const sign = pnl >= 0 ? '+' : '';
  return (
    `🔔 מחכה לאישור שלך — סגירת פוזיציה בכסף אמיתי\n\n` +
    `מכירה ${intent.symbol}\n` +
    `כמות: ${intent.quantity} · מחיר יציאה: ${intent.limitPrice} (נכנס ב-${entryPrice})\n` +
    `רווח/הפסד משוער: ${sign}${pnl.toFixed(2)}\n\n` +
    `לחץ למטה כדי לאשר או לדחות. ללא לחיצה — שום דבר לא יקרה.`
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
      return decision;
    }

    if (!pending) {
      const result = await sendTelegramMessage(buildConfirmationMessage(intent), this.telegram, {
        inline_keyboard: [
          [
            { text: '✅ אשר', callback_data: `${APPROVE_PREFIX}${intent.id}` },
            { text: '❌ דחה', callback_data: `${REJECT_PREFIX}${intent.id}` },
          ],
        ],
      });
      pending = { sentAt: Date.now(), updateOffset: 0 };
      pendingAll[intent.id] = pending;
      this.store.set(STORAGE_KEY, pendingAll);
      this.audit.append({
        timestamp: Date.now(),
        intentId: intent.id,
        event: 'awaiting-confirmation',
        mode: intent.mode,
        detail: result.sent
          ? 'confirmation request sent to Telegram'
          : `Telegram send failed: ${result.reason} — will retry next run`,
      });
    }

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const { updates, nextOffset } = await getTelegramUpdates(this.telegram, pending.updateOffset);
      pending = { ...pending, updateOffset: nextOffset };
      pendingAll[intent.id] = pending;
      this.store.set(STORAGE_KEY, pendingAll);

      const match = updates.find(
        (u) => u.data === `${APPROVE_PREFIX}${intent.id}` || u.data === `${REJECT_PREFIX}${intent.id}`,
      );
      if (match) {
        await answerCallbackQuery(match.id, this.telegram);
        const approved = match.data === `${APPROVE_PREFIX}${intent.id}`;
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
        return decision;
      }
      if (attempt < POLL_ATTEMPTS - 1) await sleep(POLL_INTERVAL_MS);
    }
    throw new ConfirmationPendingError(intent.id);
  }
}
