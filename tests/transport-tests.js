/*
 * Revolut X transport test suite (no network, no real credentials).
 * Run: node tests/transport-tests.js
 */
const crypto = require('crypto');
const T = require('../src/transport-revolut');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL: ' + name); }
}

/* ---------- string-to-sign construction (spec: no separators) ---------- */
{
  const s = T.signString({
    timestamp: 1783936578630, method: 'get', path: '/api/1.0/balances',
    query: 'symbol=BTC-EUR', body: '{"a":1}',
  });
  check('signString: exact concatenation, uppercased method',
    s === '1783936578630GET/api/1.0/balancessymbol=BTC-EUR{"a":1}');
  check('signString: optional parts default empty',
    T.signString({ timestamp: 1, method: 'GET', path: '/api/1.0/pairs' }) === '1GET/api/1.0/pairs');
}

/* ---------- Ed25519 signing round-trip with a throwaway keypair ---------- */
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const parts = { timestamp: 1783936578630, method: 'GET', path: '/api/1.0/balances', query: '', body: '' };

  const sig = T.signRequest(privPem, parts);
  check('sign: base64 output', /^[A-Za-z0-9+/=]+$/.test(sig) && Buffer.from(sig, 'base64').length === 64);
  check('sign: verifies with matching public key', T.verifySignature(pubPem, parts, sig) === true);
  check('sign: deterministic (Ed25519)', T.signRequest(privPem, parts) === sig);
  check('sign: tampered payload fails verification',
    T.verifySignature(pubPem, { ...parts, body: '{"x":2}' }, sig) === false);

  const other = crypto.generateKeyPairSync('ed25519');
  check('sign: wrong key fails verification',
    T.verifySignature(other.publicKey.export({ type: 'spki', format: 'pem' }), parts, sig) === false);
}

/* ---------- session keypair on disk is usable and consistent ---------- */
{
  const fs = require('fs');
  const path = require('path');
  const privPath = path.join(__dirname, '..', 'secrets', 'revx_private.pem');
  const pubPath = path.join(__dirname, '..', 'secrets', 'revx_public.pem');
  if (fs.existsSync(privPath) && fs.existsSync(pubPath)) {
    const privPem = fs.readFileSync(privPath, 'utf8');
    const pubPem = fs.readFileSync(pubPath, 'utf8');
    const parts = { timestamp: 42, method: 'GET', path: '/api/1.0/pairs', query: '', body: '' };
    check('keys: on-disk pair signs and verifies',
      T.verifySignature(pubPem, parts, T.signRequest(privPem, parts)) === true);
  } else {
    check('keys: secrets absent — skipped consistency check (regenerate before connecting)', true);
  }
}

/* ---------- trading stays disabled by default ---------- */
{
  const t = T.createRevolutTransport({ apiKey: 'k'.repeat(64), privateKeyPem: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n-----END PRIVATE KEY-----\n' });
  let refused = false;
  (async () => {
    try { await t.placeOrder({}); } catch (e) { refused = /disabled|read-only/i.test(e.message); }
    check('transport: placeOrder refused without REVX_ENABLE_TRADING', refused);
    check('transport: requires credentials', (() => {
      try { T.createRevolutTransport({}); return false; } catch { return true; }
    })());
    console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
    process.exit(fail === 0 ? 0 : 1);
  })();
}
