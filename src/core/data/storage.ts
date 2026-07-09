/**
 * Persistent storage abstraction.
 *
 * All persistence goes through `KeyValueStore` so business logic never
 * touches `localStorage` (or any backend) directly. The browser uses
 * `LocalStorageStore`; tests and node use `MemoryStore`.
 */

export interface KeyValueStore {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  keys(): string[];
}

export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get<T>(key: string): T | undefined {
    const raw = this.map.get(key);
    if (raw === undefined) return undefined;
    return JSON.parse(raw) as T;
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, JSON.stringify(value));
  }

  remove(key: string): void {
    this.map.delete(key);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

export class LocalStorageStore implements KeyValueStore {
  constructor(private readonly prefix = 'ata:') {}

  private prefixed(key: string): string {
    return this.prefix + key;
  }

  get<T>(key: string): T | undefined {
    const raw = window.localStorage.getItem(this.prefixed(key));
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt entry: remove it rather than crash every read forever.
      window.localStorage.removeItem(this.prefixed(key));
      return undefined;
    }
  }

  set<T>(key: string, value: T): void {
    window.localStorage.setItem(this.prefixed(key), JSON.stringify(value));
  }

  remove(key: string): void {
    window.localStorage.removeItem(this.prefixed(key));
  }

  keys(): string[] {
    const result: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key !== null && key.startsWith(this.prefix)) {
        result.push(key.slice(this.prefix.length));
      }
    }
    return result;
  }
}
