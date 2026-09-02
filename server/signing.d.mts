export function buildSigningPayload(input: {
  timestamp: number;
  method: string;
  path: string;
  query?: string;
  body?: string;
}): string;

export function signPayload(payload: string, privateKeyPem: string): string;

export function buildAuthHeaders(input: {
  apiKey: string;
  privateKeyPem: string;
  method: string;
  path: string;
  query?: string;
  body?: string;
  timestamp?: number;
}): {
  'X-Revx-API-Key': string;
  'X-Revx-Timestamp': string;
  'X-Revx-Signature': string;
};
