/**
 * File-backed KeyValueStore for the headless cloud autopilot.
 *
 * The browser uses LocalStorageStore; the Node runner uses this, persisting
 * the entire platform state (portfolio, positions, journal, audit log, kill
 * switch) to a single JSON file that the GitHub Actions workflow commits
 * back to the repo between scheduled runs — so the cloud robot resumes
 * exactly where it left off.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { KeyValueStore } from '../src/core/data/storage';

export class FileStore implements KeyValueStore {
  private map: Map<string, string>;

  constructor(private readonly path: string) {
    this.map = new Map();
    if (existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
        for (const [key, value] of Object.entries(raw)) {
          this.map.set(key, JSON.stringify(value));
        }
      } catch {
        // Corrupt/partial file: start clean rather than crash the run.
        this.map = new Map();
      }
    }
  }

  get<T>(key: string): T | undefined {
    const raw = this.map.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  set<T>(key: string, value: T): void {
    this.map.set(key, JSON.stringify(value));
    this.flush();
  }

  remove(key: string): void {
    if (this.map.delete(key)) this.flush();
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  private flush(): void {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of this.map) obj[key] = JSON.parse(value);
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(obj, null, 2));
  }
}
