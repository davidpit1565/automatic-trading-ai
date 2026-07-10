/**
 * Local read-only proxy for the Revolut X API.
 *
 * Purpose:
 *  1. Keep credentials out of the browser — the API key and Ed25519 private
 *     key live in .env on your machine and requests are signed here.
 *  2. Solve CORS — the dashboard calls /api/revx/* on localhost.
 *
 * READ-ONLY BY CONSTRUCTION: only GET requests to an explicit whitelist of
 * market-data paths are forwarded. Orders, balances, and every other
 * account-mutating endpoint are refused with 403 regardless of credentials.
 * This proxy cannot place trades.
 *
 * Configuration (.env or environment):
 *   REVX_API_KEY           API key from the Revolut X web app
 *   REVX_PRIVATE_KEY_PATH  path to your Ed25519 private key PEM, or
 *   REVX_PRIVATE_KEY       the PEM content itself (\n for newlines)
 *   REVX_PROXY_PORT        default 8788
 *
 * Run: npm run proxy
 */

import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildAuthHeaders } from './signing.mjs';

const UPSTREAM = 'https://revx.revolut.com';
const UPSTREAM_PREFIX = '/api/1.0';
const LOCAL_PREFIX = '/api/revx';

/**
 * Market-data paths (relative to the API base) that may be forwarded.
 * Everything else — orders, balances, withdrawals — is refused.
 */
const READ_ONLY_WHITELIST = [
  /^\/candles\/[A-Z0-9-]+$/i,
  /^\/tickers$/,
  /^\/configuration\/pairs$/,
  /^\/configuration\/currencies$/,
  /^\/public\/last-trades$/,
  /^\/public\/order-book\/[A-Z0-9-]+$/i,
];

/** Decide whether a relative path may be forwarded. Exported for tests. */
export function isAllowedPath(relativePath) {
  return READ_ONLY_WHITELIST.some((pattern) => pattern.test(relativePath));
}

/** Map a local request path to the upstream path, or null if out of scope. */
export function toUpstreamPath(localPath) {
  if (!localPath.startsWith(`${LOCAL_PREFIX}/`)) return null;
  const relative = localPath.slice(LOCAL_PREFIX.length);
  if (!isAllowedPath(relative)) return null;
  return `${UPSTREAM_PREFIX}${relative}`;
}

function loadEnvFile() {
  // Minimal .env loader — no dependency needed for KEY=VALUE lines.
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function loadCredentials() {
  const apiKey = process.env.REVX_API_KEY;
  let privateKeyPem = process.env.REVX_PRIVATE_KEY?.replaceAll('\\n', '\n');
  const keyPath = process.env.REVX_PRIVATE_KEY_PATH;
  if (!privateKeyPem && keyPath && existsSync(keyPath)) {
    privateKeyPem = readFileSync(keyPath, 'utf8');
  }
  if (apiKey && privateKeyPem) return { apiKey, privateKeyPem };
  return null;
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function createProxyServer({ credentials, fetchFn = fetch }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (url.pathname === `${LOCAL_PREFIX}/status`) {
      sendJson(response, 200, {
        configured: credentials !== null,
        readOnly: true,
        upstream: UPSTREAM,
      });
      return;
    }

    if (request.method !== 'GET') {
      sendJson(response, 403, {
        error: 'read-only proxy: only GET market-data requests are forwarded',
      });
      return;
    }

    const upstreamPath = toUpstreamPath(url.pathname);
    if (upstreamPath === null) {
      sendJson(response, 403, {
        error: `path not in the read-only market-data whitelist: ${url.pathname}`,
      });
      return;
    }

    const query = url.searchParams.toString();
    const isPublic = upstreamPath.includes('/public/');
    if (!isPublic && credentials === null) {
      sendJson(response, 503, {
        error:
          'Revolut X credentials not configured. Set REVX_API_KEY and ' +
          'REVX_PRIVATE_KEY_PATH in .env — see README "Connecting live Revolut X data".',
      });
      return;
    }

    const headers = { Accept: 'application/json' };
    if (!isPublic && credentials !== null) {
      Object.assign(
        headers,
        buildAuthHeaders({
          apiKey: credentials.apiKey,
          privateKeyPem: credentials.privateKeyPem,
          method: 'GET',
          path: upstreamPath,
          query,
        }),
      );
    }

    try {
      const upstreamUrl = `${UPSTREAM}${upstreamPath}${query ? `?${query}` : ''}`;
      const upstream = await fetchFn(upstreamUrl, { method: 'GET', headers });
      const body = await upstream.text();
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      });
      response.end(body);
    } catch (cause) {
      sendJson(response, 502, {
        error: `upstream request failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }
  });
}

// Entrypoint (skipped when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('revxProxy.mjs')) {
  loadEnvFile();
  const credentials = loadCredentials();
  const port = Number(process.env.REVX_PROXY_PORT ?? 8788);
  createProxyServer({ credentials }).listen(port, () => {
    console.log(`Revolut X read-only proxy on http://localhost:${port}${LOCAL_PREFIX}`);
    console.log(
      credentials
        ? 'Credentials loaded — authenticated market data (candles, pairs, tickers) available.'
        : 'No credentials — only public endpoints work. See README to configure an API key.',
    );
  });
}
