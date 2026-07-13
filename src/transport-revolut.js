/*
 * Revolut X REST transport — the injectable "real transport" for the
 * execution connector (src/execution.js). Node-only (uses node:crypto
 * and curl for proxy-aware HTTPS); never shipped to the dashboard.
 *
 * AUTH (per https://developer.revolut.com/docs/api/revolut-x-crypto-exchange)
 *   Headers: X-Revx-API-Key, X-Revx-Timestamp (ms), X-Revx-Signature.
 *   Signature = base64( Ed25519-sign( timestamp + METHOD + path + query + body ) )
 *   — concatenated with NO separators; path starts at /api; query without '?';
 *   body is minified JSON when present.
 *
 * SAFETY
 *   - Read methods only by default. placeOrder throws unless the
 *     environment explicitly sets REVX_ENABLE_TRADING=1 — defense in
 *     depth on top of the execution connector's own permission modes.
 *   - Credentials live in secrets/ (git-ignored) or env vars; this file
 *     contains none.
 */
const BASE = 'https://revx.revolut.com';
const API_ROOT = '/api/1.0';

function signString({ timestamp, method, path, query = '', body = '' }) {
  return String(timestamp) + method.toUpperCase() + path + query + body;
}

function signRequest(privateKeyPem, parts) {
  const crypto = require('crypto');
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(signString(parts), 'utf8'), key).toString('base64');
}

function verifySignature(publicKeyPem, parts, signatureB64) {
  const crypto = require('crypto');
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(null, Buffer.from(signString(parts), 'utf8'), key,
    Buffer.from(signatureB64, 'base64'));
}

/* HTTPS via curl so the environment's proxy + CA bundle are honored. */
function _curl(url, headers, { method = 'GET', body } = {}) {
  const { execFileSync } = require('child_process');
  const args = ['-sS', '--max-time', '30', '-X', method];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (body) { args.push('-H', 'Content-Type: application/json', '--data', body); }
  args.push(url);
  const out = execFileSync('curl', args, { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(out); }
  catch { throw new Error('revolut-x: non-JSON response: ' + out.slice(0, 200)); }
  if (parsed && parsed.message === 'Unauthorized') {
    throw new Error('revolut-x: unauthorized — check API key, public key registration, and clock');
  }
  return parsed;
}

function createRevolutTransport({ apiKey, privateKeyPem, now = Date.now }) {
  if (!apiKey || !privateKeyPem) throw new Error('revolut-x transport needs apiKey and privateKeyPem');

  function request(method, pathAfterRoot, { query = '', body } = {}) {
    const path = API_ROOT + pathAfterRoot;
    const timestamp = now();
    const bodyStr = body ? JSON.stringify(body) : '';
    const sig = signRequest(privateKeyPem, { timestamp, method, path, query, body: bodyStr });
    const url = BASE + path + (query ? '?' + query : '');
    return _curl(url, {
      'X-Revx-API-Key': apiKey,
      'X-Revx-Timestamp': String(timestamp),
      'X-Revx-Signature': sig,
    }, { method, body: bodyStr || undefined });
  }

  return {
    /* interface expected by src/execution.js createConnector */
    listAssets: () => request('GET', '/pairs'),
    getPrices: (symbol) => request('GET', '/tickers', symbol ? { query: 'symbol=' + symbol } : {}),
    getCandles: (symbol, interval = '1d', limit = 100) =>
      request('GET', '/candles', { query: `symbol=${symbol}&interval=${interval}&limit=${limit}` }),
    getBalances: () => request('GET', '/balances'),
    getPositions: () => request('GET', '/orders'),
    placeOrder: async () => {
      if (process.env.REVX_ENABLE_TRADING !== '1') {
        throw new Error('revolut-x transport: trading disabled in this build (read-only). See docs/ROADMAP.md preconditions.');
      }
      throw new Error('revolut-x transport: order placement intentionally unimplemented until validation, paper record, and security review pass');
    },
  };
}

const transportApi = { signString, signRequest, verifySignature, createRevolutTransport, BASE, API_ROOT };
if (typeof module !== 'undefined') module.exports = transportApi;
