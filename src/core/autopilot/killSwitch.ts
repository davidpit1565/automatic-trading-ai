/**
 * Kill switch — implements the KillSwitch contract from the execution
 * architecture (docs/execution-architecture.md).
 *
 * Engaging halts all automated activity instantly and never asks for
 * confirmation: stopping is always safe. Disengaging requires an explicit
 * human actor. State persists so a reload can never silently resume.
 */

import type { KillSwitch } from '../execution/types';
import type { KeyValueStore } from '../data/storage';

interface KillSwitchState {
  engaged: boolean;
  reason: string | null;
}

const STORAGE_KEY = 'kill-switch';

export class PersistedKillSwitch implements KillSwitch {
  private state: KillSwitchState;

  constructor(private readonly store: KeyValueStore) {
    this.state = store.get<KillSwitchState>(STORAGE_KEY) ?? { engaged: false, reason: null };
  }

  isEngaged(): boolean {
    return this.state.engaged;
  }

  reason(): string | null {
    return this.state.reason;
  }

  engage(reason: string): void {
    this.state = { engaged: true, reason };
    this.store.set(STORAGE_KEY, this.state);
  }

  disengage(confirmedBy: string): void {
    if (confirmedBy.trim() === '') {
      throw new Error('disengaging the kill switch requires an explicit human actor');
    }
    this.state = { engaged: false, reason: null };
    this.store.set(STORAGE_KEY, this.state);
  }
}
