/**
 * Retrospective comparison: our own stocks agent's real trades/positions
 * against what the tracked "top investors" (TOP_INVESTORS in sec13f.ts)
 * currently hold, per their most recent public 13F filing.
 *
 * This is a calibration read, not a signal: 13F is always a lagged,
 * quarterly snapshot (see sec13f.ts's own doc comment for why), so "smart
 * money holds X" here means "as of their last quarterly filing", not "right
 * now". Nothing here feeds the autopilot or any confidence score.
 *
 * Needs no secrets — data.sec.gov / www.sec.gov are free and keyless.
 *
 *   npx tsx scripts/compareTopInvestors.mts
 */

import { readFileSync, existsSync } from 'node:fs';
import { CURATED_STOCK_INSTRUMENTS } from '../src/core/data/alpacaStocks';
import { Sec13FSource, TOP_INVESTORS, type InvestorHoldings } from '../src/core/data/sec13f';

const STATE_PATH = process.env['STOCKS_STATE_PATH'] ?? 'state/stocks-state.json';

interface JournalEntry {
  readonly symbol: string;
  readonly realizedPnl: number;
}
interface OpenPosition {
  readonly symbol: string;
  readonly quantity: number;
  readonly entryPrice: number;
}

function loadOurRecord(): { closed: JournalEntry[]; open: OpenPosition[] } {
  if (!existsSync(STATE_PATH)) {
    console.error(`No stocks state at ${STATE_PATH} — nothing to compare yet.`);
    return { closed: [], open: [] };
  }
  const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as {
    'trade-journal'?: JournalEntry[];
    'open-positions'?: OpenPosition[];
  };
  return { closed: state['trade-journal'] ?? [], open: state['open-positions'] ?? [] };
}

async function main(): Promise<void> {
  const { closed, open } = loadOurRecord();

  const source = new Sec13FSource();
  const investorHoldings: InvestorHoldings[] = [];
  for (const investor of TOP_INVESTORS) {
    const result = await source.fetchLatest(investor);
    if (!result.ok) {
      console.error(`Skipping ${investor.name}: ${result.error}`);
      continue;
    }
    investorHoldings.push(result.value);
  }
  if (investorHoldings.length === 0) {
    console.error('Could not fetch any investor holdings — nothing to compare.');
    process.exit(1);
  }

  console.log(
    `\nComparing our own record against ${investorHoldings.length} investor(s)' most recent 13F ` +
      `(${investorHoldings.map((h) => `${h.investor} filed ${h.filedAt}`).join(', ')}).\n` +
      `Reminder: a 13F is always a lagged quarterly snapshot, not a live position.\n`,
  );

  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(
    pad('Symbol', 8) + pad('Our realized P&L', 20) + pad('Our open?', 18) +
      investorHoldings.map((h) => pad(h.investor, 22)).join(''),
  );
  console.log('-'.repeat(8 + 20 + 18 + investorHoldings.length * 22));

  for (const inst of CURATED_STOCK_INSTRUMENTS) {
    const symbol = inst.symbol;
    const ourClosed = closed.filter((t) => t.symbol === symbol);
    const ourPnl = ourClosed.reduce((sum, t) => sum + t.realizedPnl, 0);
    const ourOpen = open.find((p) => p.symbol === symbol);
    const pnlStr = ourClosed.length > 0 ? `$${ourPnl.toFixed(2)} (${ourClosed.length}t)` : '—';
    const openStr = ourOpen ? `yes (${ourOpen.quantity.toFixed(2)} sh)` : 'no';

    const perInvestor = investorHoldings.map((h) => {
      const holding = h.matched.find((m) => m.symbol === symbol);
      return pad(holding ? `$${(holding.valueUsd / 1e6).toFixed(0)}M` : '—', 22);
    });
    console.log(pad(symbol, 8) + pad(pnlStr, 20) + pad(openStr, 18) + perInvestor.join(''));
  }
}

void main();
