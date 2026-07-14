/**
 * Ed25519 request signing for the Revolut X API.
 *
 * Per https://developer.revolut.com/docs/x-api, every authenticated request
 * carries:
 *   X-Revx-API-Key:    the API key created in the Revolut X web app
 *   X-Revx-Timestamp:  Unix epoch milliseconds
 *   X-Revx-Signature:  base64(Ed25519-sign(payload)) with the private key
 *
 * The signed payload is the concatenation — with NO separators — of:
 *   timestamp + METHOD + path (starting at /api) + queryString (no '?') + body
 *
 * Runs in Node only (the local proxy). Private keys never reach the browser.
 */

import { createPrivateKey, sign } from 'node:crypto';

/**
 * Build the exact string that must be signed.
 *
 * @param {object} input
 * @param {number} input.timestamp Epoch milliseconds (same as the header).
 * @param {string} input.method HTTP method, e.g. 'GET'.
 * @param {string} input.path Request path starting at /api, e.g. '/api/1.0/candles/BTC-USD'.
 * @param {string} [input.query] Query string without the leading '?'.
 * @param {string} [input.body] Minified JSON body, if any.
 * @returns {string}
 */
export function buildSigningPayload({ timestamp, method, path, query = '', body = '' }) {
  if (!Number.isFinite(timestamp)) throw new RangeError(`invalid timestamp: ${timestamp}`);
  if (!path.startsWith('/api')) throw new RangeError(`path must start at /api, got: ${path}`);
  return `${timestamp}${method.toUpperCase()}${path}${query}${body}`;
}

/**
 * Sign a payload with an Ed25519 private key (PEM, PKCS#8).
 *
 * @param {string} payload Output of buildSigningPayload.
 * @param {string} privateKeyPem PEM text ("-----BEGIN PRIVATE KEY-----...").
 * @returns {string} base64-encoded signature.
 */
export function signPayload(payload, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new TypeError(`expected an Ed25519 private key, got ${key.asymmetricKeyType}`);
  }
  return sign(null, Buffer.from(payload, 'utf8'), key).toString('base64');
}

/**
 * Produce the full set of authentication headers for a request.
 *
 * @param {object} input
 * @param {string} input.apiKey
 * @param {string} input.privateKeyPem
 * @param {string} input.method
 * @param {string} input.path Path starting at /api.
 * @param {string} [input.query]
 * @param {string} [input.body]
 * @param {number} [input.timestamp] Injectable for tests; defaults to now.
 * @returns {{ 'X-Revx-API-Key': string, 'X-Revx-Timestamp': string, 'X-Revx-Signature': string }}
 */
export function buildAuthHeaders({ apiKey, privateKeyPem, method, path, query, body, timestamp }) {
  if (!apiKey) throw new RangeError('apiKey is required');
  const ts = timestamp ?? Date.now();
  const payload = buildSigningPayload({ timestamp: ts, method, path, query, body });
  return {
    'X-Revx-API-Key': apiKey,
    'X-Revx-Timestamp': String(ts),
    'X-Revx-Signature': signPayload(payload, privateKeyPem),
  };
}
