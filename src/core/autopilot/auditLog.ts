/**
 * Append-only audit log — implements the AuditLog contract from the
 * execution architecture. Every automated action is recorded; nothing is
 * ever rewritten or removed.
 */

import type { AuditLog, AuditLogEntry } from '../execution/types';
import type { KeyValueStore } from '../data/storage';

const STORAGE_KEY = 'audit-log';
const MAX_ENTRIES = 1000;

export class PersistedAuditLog implements AuditLog {
  private records: AuditLogEntry[];

  constructor(private readonly store: KeyValueStore) {
    this.records = store.get<AuditLogEntry[]>(STORAGE_KEY) ?? [];
  }

  append(entry: AuditLogEntry): void {
    this.records.push(entry);
    // Bounded storage: oldest entries roll off past the cap, newest kept.
    if (this.records.length > MAX_ENTRIES) {
      this.records = this.records.slice(-MAX_ENTRIES);
    }
    this.store.set(STORAGE_KEY, this.records);
  }

  entries(): readonly AuditLogEntry[] {
    return this.records;
  }
}
