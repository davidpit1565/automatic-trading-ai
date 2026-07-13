/*
 * One-command Revolut X connection check (read-only).
 * Expects:
 *   secrets/revx_private.pem  — Ed25519 private key (generated locally)
 *   secrets/revx_api_key      — the API key string from the Revolut X app
 * Run: node tools/revolut-connect.js
 */
const fs = require('fs');
const path = require('path');
const { createRevolutTransport } = require('../src/transport-revolut');

const root = path.join(__dirname, '..');
const privPath = path.join(root, 'secrets', 'revx_private.pem');
const keyPath = path.join(root, 'secrets', 'revx_api_key');

if (!fs.existsSync(privPath) || !fs.existsSync(keyPath)) {
  console.error('Missing credentials. Need secrets/revx_private.pem and secrets/revx_api_key.');
  process.exit(1);
}

const t = createRevolutTransport({
  apiKey: fs.readFileSync(keyPath, 'utf8').trim(),
  privateKeyPem: fs.readFileSync(privPath, 'utf8'),
});

(async () => {
  try {
    const pairs = await t.listAssets();
    const n = Array.isArray(pairs) ? pairs.length : (pairs && pairs.pairs ? pairs.pairs.length : '?');
    console.log(`OK: authenticated. Tradable pairs visible: ${n}`);
  } catch (e) {
    console.error('FAILED at pairs: ' + e.message);
    process.exit(1);
  }
  try {
    const bal = await t.getBalances();
    console.log('OK: balances readable: ' + JSON.stringify(bal).slice(0, 300));
  } catch (e) {
    console.error('NOTE: balances not readable (' + e.message + ') — market data may still work.');
  }
  console.log('Connection check complete. Transport is READ-ONLY (trading code path disabled).');
})();
