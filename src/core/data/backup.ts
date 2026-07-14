/**
 * Backup / restore of the platform's persisted state.
 *
 * Browser storage can be wiped by the browser at any time; the accumulated
 * track record (journal, positions, audit log, watchlists) is too valuable
 * to lose. Export captures every key in the store into a versioned, plain
 * JSON payload; import validates before writing anything.
 */

import type { KeyValueStore } from './storage';
import type { Result } from '../types';
import { err, ok } from '../types';

export const BACKUP_VERSION = 1;

export interface BackupPayload {
  readonly version: number;
  readonly exportedAt: number;
  readonly data: Record<string, unknown>;
}

export function exportState(store: KeyValueStore, timestamp: number): BackupPayload {
  const data: Record<string, unknown> = {};
  for (const key of store.keys()) {
    data[key] = store.get(key);
  }
  return { version: BACKUP_VERSION, exportedAt: timestamp, data };
}

/**
 * Erase every stored key — an explicit, owner-initiated fresh start (e.g.
 * clearing demo-data practice trades before a real tracking period begins).
 * Returns the number of keys removed. Callers should offer a backup first.
 */
export function resetAllState(store: KeyValueStore): number {
  const keys = store.keys();
  for (const key of keys) {
    store.remove(key);
  }
  return keys.length;
}

export function importState(
  store: KeyValueStore,
  payload: BackupPayload,
): Result<{ restoredKeys: number }> {
  if (typeof payload !== 'object' || payload === null) {
    return err('backup payload is not an object');
  }
  if (payload.version !== BACKUP_VERSION) {
    return err(`unsupported backup version ${String(payload.version)} (expected ${BACKUP_VERSION})`);
  }
  if (typeof payload.data !== 'object' || payload.data === null || Array.isArray(payload.data)) {
    return err('backup payload has no data map');
  }
  const entries = Object.entries(payload.data);
  for (const [key, value] of entries) {
    store.set(key, value);
  }
  return ok({ restoredKeys: entries.length });
}
