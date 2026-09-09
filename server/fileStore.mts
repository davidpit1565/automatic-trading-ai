/**
 * File-backed KeyValueStore for the headless cloud autopilot.
 *
 * The browser uses LocalStorageStore; the Node runner uses this, persisting
 * the entire platform state (portfolio, positions, journal, audit log, kill
 * switch) to a single JSON file that the GitHub Actions workflow commits
 * back to the repo between scheduled runs — so the cloud agent resumes
 * exactly where it left off.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyValueStore } from '../src/core/data/storage';

export class FileStore implements KeyValueStore {
  private map: Map<string, string>;
  /** Keys this INSTANCE has written since construction (not persisted — a
   * per-process record). Lets a caller (autopilotRunner.mts's
   * persistStateToGit) reapply exactly what THIS run actually changed on
   * top of a fresher origin/main after a concurrent-run push race, instead
   * of a git-level whole-file merge that can silently discard one side's
   * changes wholesale (found 2026-09-03: a cancelled-but-still-executing
   * run and its freshly-dispatched replacement both wrote this same file). */
  private dirty: Set<string>;
  /** Snapshot of every key's raw value at CONSTRUCTION time, never touched
   * afterward — this run's own baseline. Lets `persistStateToGit` detect
   * whether a key it's about to overlay onto a fresher origin/main was ALSO
   * changed by another run in the same window (both runs racing the exact
   * same key, not just the same file) — previously invisible; the dirty-key
   * merge alone silently let this run's value win either way. See
   * `originalValue`. */
  private readonly initial: Map<string, string>;

  constructor(private readonly path: string) {
    this.map = new Map();
    this.dirty = new Set();
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        for (const [key, value] of Object.entries(raw)) {
          this.map.set(key, JSON.stringify(value));
        }
      } catch (cause) {
        // Corrupt/partial file: start clean rather than crash the run. Logged
        // (found silent in review, 2026-09-03) — combined with the dirty-key
        // merge above, a corrupt read right before a push race could let
        // this run's much-smaller rebuilt state overwrite origin's fuller
        // history for whatever keys it touches, with zero visibility that it
        // happened, unless this is at least surfaced in the run's own logs.
        console.error(`FileStore: ${path} is corrupt or unreadable, starting clean:`, cause instanceof Error ? cause.message : cause);
        this.map = new Map();
      }
    }
    this.initial = new Map(this.map);
  }

  get<T>(key: string): T | undefined {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, JSON.stringify(value));
    this.dirty.add(key);
    this.flush();
  }

  remove(key: string): void {
    if (this.map.delete(key)) {
      this.dirty.add(key);
      this.flush();
    }
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  /** Keys set/removed by this instance so far — see the `dirty` field doc. */
  dirtyKeys(): string[] {
    return [...this.dirty];
  }

  /**
   * This key's value as it was when THIS instance was constructed — a fixed
   * baseline, unaffected by anything this run itself has since set/removed.
   * See the `initial` field doc for why this exists.
   */
  originalValue<T>(key: string): T | undefined {
    const raw = this.initial.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  private flush(): void {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of this.map) obj[key] = JSON.parse(value);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(obj, null, 2));
  }
}
