/*
 * Validate raw CoinGecko payloads in data/ and compile them into a single
 * compact dataset (data/dataset.json) for the dashboard build:
 *   { generatedAt, currency, coins: [{id, symbol, name, dates, closes, volumes}] }
 * Exits non-zero if any check fails. Run: node tools/validate-data.js
 */
const fs = require('fs');
const path = require('path');

const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
];

let failures = 0;
const fail = msg => { failures++; console.error('FAIL: ' + msg); };
const dataDir = path.join(__dirname, '..', 'data');
const out = { generatedAt: null, currency: 'EUR', coins: [] };
let newestTs = 0;

for (const coin of COINS) {
  const file = path.join(dataDir, coin.id + '.json');
  if (!fs.existsSync(file)) { fail(`${coin.id}: file missing`); continue; }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(raw.prices) || !Array.isArray(raw.total_volumes)) {
    fail(`${coin.id}: missing prices/total_volumes`); continue;
  }
  if (raw.prices.length < 300) fail(`${coin.id}: only ${raw.prices.length} price points (<300)`);
  if (raw.prices.length !== raw.total_volumes.length)
    fail(`${coin.id}: prices/volumes length mismatch`);

  const dates = [], closes = [], volumes = [];
  let lastTs = 0, ok = true;
  for (let i = 0; i < raw.prices.length; i++) {
    const [ts, price] = raw.prices[i];
    if (!(price > 0) || !Number.isFinite(price)) { fail(`${coin.id}: bad price at ${i}`); ok = false; break; }
    if (ts <= lastTs) { fail(`${coin.id}: timestamps not increasing at ${i}`); ok = false; break; }
    lastTs = ts;
    dates.push(new Date(ts).toISOString().slice(0, 10));
    closes.push(price);
    volumes.push(raw.total_volumes[i][1]);
  }
  if (!ok) continue;
  const ageDays = (Date.now() - lastTs) / 86400e3;
  if (ageDays > 2) fail(`${coin.id}: latest point is ${ageDays.toFixed(1)} days old`);
  if (lastTs > newestTs) newestTs = lastTs;
  out.coins.push({ ...coin, dates, closes, volumes });
  console.log(`OK   ${coin.symbol.padEnd(5)} ${closes.length} days, latest ${dates[dates.length - 1]}, last close €${closes[closes.length - 1].toFixed(closes[closes.length - 1] < 10 ? 4 : 0)}`);
}

// Cross-source sanity: BTC last close should be in a plausible band vs the
// independently observed spot (€54,830 on 2026-07-09).
const btc = out.coins.find(c => c.id === 'bitcoin');
if (btc) {
  const last = btc.closes[btc.closes.length - 1];
  if (last < 20000 || last > 200000) fail(`bitcoin: implausible last close €${last}`);
}

out.generatedAt = new Date(newestTs).toISOString();
if (failures === 0) {
  fs.writeFileSync(path.join(dataDir, 'dataset.json'), JSON.stringify(out));
  console.log(`\nAll checks passed. Wrote data/dataset.json (${out.coins.length} coins).`);
  process.exit(0);
} else {
  console.error(`\n${failures} check(s) failed. dataset.json NOT written.`);
  process.exit(1);
}
