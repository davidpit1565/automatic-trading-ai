/**
 * Ed25519 request signing tests.
 *
 * A fresh keypair is generated per run; signatures are checked by
 * verification with the matching public key (Ed25519 signing is
 * deterministic, so equal inputs must also produce equal signatures).
 */

import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain-JS server module without type declarations
import { buildAuthHeaders, buildSigningPayload, signPayload } from '../../server/signing.mjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('buildSigningPayload', () => {
  it('concatenates timestamp, METHOD, path, query, body with no separators', () => {
    const payload = buildSigningPayload({
      timestamp: 1700000000000,
      method: 'get',
      path: '/api/1.0/candles/BTC-USD',
      query: 'interval=60&since=1&until=2',
      body: '',
    });
    expect(payload).toBe('1700000000000GET/api/1.0/candles/BTC-USDinterval=60&since=1&until=2');
  });

  it('includes the minified body when present', () => {
    const payload = buildSigningPayload({
      timestamp: 1,
      method: 'POST',
      path: '/api/1.0/thing',
      body: '{"a":1}',
    });
    expect(payload).toBe('1POST/api/1.0/thing{"a":1}');
  });

  it('rejects paths that do not start at /api and invalid timestamps', () => {
    expect(() =>
      buildSigningPayload({ timestamp: 1, method: 'GET', path: '/candles/BTC-USD' }),
    ).toThrow(RangeError);
    expect(() =>
      buildSigningPayload({ timestamp: Number.NaN, method: 'GET', path: '/api/x' }),
    ).toThrow(RangeError);
  });
});

describe('signPayload', () => {
  it('produces a base64 Ed25519 signature that verifies against the public key', () => {
    const payload = '1700000000000GET/api/1.0/tickers';
    const signature = signPayload(payload, privatePem);
    const valid = verify(null, Buffer.from(payload, 'utf8'), publicKey, Buffer.from(signature, 'base64'));
    expect(valid).toBe(true);
  });

  it('is deterministic for identical input (Ed25519 property)', () => {
    const payload = 'xyz';
    expect(signPayload(payload, privatePem)).toBe(signPayload(payload, privatePem));
  });

  it('does not verify against a tampered payload', () => {
    const signature = signPayload('payload-A', privatePem);
    const valid = verify(null, Buffer.from('payload-B', 'utf8'), publicKey, Buffer.from(signature, 'base64'));
    expect(valid).toBe(false);
  });

  it('rejects non-Ed25519 keys', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(() => signPayload('x', rsaPem)).toThrow(TypeError);
  });
});

describe('buildAuthHeaders', () => {
  it('emits the three Revolut X headers with a verifiable signature', () => {
    const headers = buildAuthHeaders({
      apiKey: 'test-key',
      privateKeyPem: privatePem,
      method: 'GET',
      path: '/api/1.0/candles/BTC-USD',
      query: 'interval=60',
      timestamp: 1700000000000,
    });
    expect(headers['X-Revx-API-Key']).toBe('test-key');
    expect(headers['X-Revx-Timestamp']).toBe('1700000000000');
    const expectedPayload = '1700000000000GET/api/1.0/candles/BTC-USDinterval=60';
    const valid = verify(
      null,
      Buffer.from(expectedPayload, 'utf8'),
      publicKey,
      Buffer.from(headers['X-Revx-Signature'], 'base64'),
    );
    expect(valid).toBe(true);
  });

  it('requires an API key', () => {
    expect(() =>
      buildAuthHeaders({ apiKey: '', privateKeyPem: privatePem, method: 'GET', path: '/api/x' }),
    ).toThrow(RangeError);
  });
});
