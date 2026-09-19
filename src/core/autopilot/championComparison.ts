/**
 * Champion-vs-Challenger comparison — pulled out of `shadowEvaluator.ts`
 * into its own file, deliberately kept dependency-free (no signal/portfolio/
 * trailing-stop imports), so the UI layer can use the real implementation
 * instead of a hand-duplicated copy while staying inside
 * `tests/ui/architecture.test.ts`'s enforced import boundary. Only this
 * narrow file is on that boundary's allowlist — `shadowEvaluator.ts` itself
 * (which pulls in the full paper-trading stack) is not.
 */

/** The minimal shape this comparison actually reads — a structural subset
 * of `shadowEvaluator.ts`'s own `ShadowStanding` and `cloudState.ts`'s
 * `CloudShadowStanding`, both of which satisfy this without adapting. */
export interface ComparableStanding {
  readonly key: string;
  readonly trades: number;
  readonly returnPct: number;
  readonly profitFactor: number | null;
  readonly winRatePct: number | null;
}

/**
 * Below this many closed trades, a candidate's record is too short to mean
 * anything — an early streak is luck, not edge. Shared by the standings
 * script, the Telegram digest, and the Strategies UI so all three apply the
 * same bar.
 */
export const SHADOW_MEANINGFUL_TRADES = 20;

/**
 * The shadow candidate whose config mirrors real production exactly — the
 * only formal "champion" this project has ever had. Naming it here is what
 * lets `compareToChampion` (below) find it without a caller having to know
 * or guess which key that is.
 */
export const CHAMPION_KEY = 'live-mirror';

/**
 * Compares a challenger's standing against the champion's. Deliberately
 * does NOT collapse the comparison into one "wins" verdict (this project's
 * own rule: don't judge by profit factor alone, and a real decision trades
 * metrics off against each other) — it reports which named metrics each
 * side leads on, and leaves the judgment to a human. Returns
 * `comparable: false` when EITHER side has too short a record to mean
 * anything (`SHADOW_MEANINGFUL_TRADES`), including the champion itself — a
 * brand-new champion is not yet a reliable baseline.
 *
 * This is only ONE piece of a real promotion decision (see this project's
 * own established practice: a challenger's promotion has always also
 * needed validation against real history and explicit human approval —
 * this function doesn't change or shortcut that, it only makes the
 * champion-vs-challenger comparison itself explicit instead of implicit).
 */
export interface ChallengerComparison {
  readonly comparable: boolean;
  /** Set only when `comparable` is false. */
  readonly reason?: string;
  readonly challengerAheadOn: readonly string[];
  readonly championAheadOn: readonly string[];
}

export function compareToChampion(champion: ComparableStanding, challenger: ComparableStanding): ChallengerComparison {
  if (challenger.trades < SHADOW_MEANINGFUL_TRADES) {
    return {
      comparable: false,
      reason: `challenger '${challenger.key}' has only ${challenger.trades}/${SHADOW_MEANINGFUL_TRADES} trades — too early to trust`,
      challengerAheadOn: [],
      championAheadOn: [],
    };
  }
  if (champion.trades < SHADOW_MEANINGFUL_TRADES) {
    return {
      comparable: false,
      reason: `champion '${champion.key}' itself has only ${champion.trades}/${SHADOW_MEANINGFUL_TRADES} trades — no reliable baseline to compare against yet`,
      challengerAheadOn: [],
      championAheadOn: [],
    };
  }
  const challengerAheadOn: string[] = [];
  const championAheadOn: string[] = [];
  const compare = (name: string, championValue: number | null, challengerValue: number | null): void => {
    if (championValue === null || challengerValue === null) return;
    if (challengerValue > championValue) challengerAheadOn.push(name);
    else if (championValue > challengerValue) championAheadOn.push(name);
  };
  compare('returnPct', champion.returnPct, challenger.returnPct);
  compare('profitFactor', champion.profitFactor, challenger.profitFactor);
  compare('winRatePct', champion.winRatePct, challenger.winRatePct);
  return { comparable: true, challengerAheadOn, championAheadOn };
}
