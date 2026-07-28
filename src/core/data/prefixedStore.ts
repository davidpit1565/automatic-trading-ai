/**
 * A namespaced view over an existing `KeyValueStore`.
 *
 * The engines (portfolio, positions, journal, audit) each persist under a
 * fixed key, so two instances sharing a store would silently overwrite each
 * other. Wrapping a store per namespace gives every instance its own isolated
 * slice of the same backing file — which is what lets several shadow
 * strategies run side by side against one persisted state.
 *
 * `keys()` returns UNPREFIXED keys, so a caller sees only its own namespace and
 * cannot reach a sibling's data by accident.
 */

import type { KeyValueStore } from './storage';

export class PrefixedStore implements KeyValueStore {
  private readonly prefix: string;

  constructor(
    private readonly inner: KeyValueStore,
    namespace: string,
  ) {
    if (namespace.trim() === '') throw new RangeError('namespace must not be empty');
    this.prefix = `${namespace}:`;
  }

  get<T>(key: string): T | undefined {
    return this.inner.get<T>(this.prefix + key);
  }

  set<T>(key: string, value: T): void {
    this.inner.set(this.prefix + key, value);
  }

  remove(key: string): void {
    this.inner.remove(this.prefix + key);
  }

  keys(): string[] {
    return this.inner
      .keys()
      .filter((key) => key.startsWith(this.prefix))
      .map((key) => key.slice(this.prefix.length));
  }
}
