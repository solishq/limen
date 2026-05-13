/*
 * Strict five-state lifecycle machine.
 * Contract refs: CREWAI_ADAPTER_CONTRACT.md Claims 1.1-1.3, 1.12-1.13; Phase 1 prompt action 5.
 */

import type { AdapterHealth, AdapterLifecycleState } from '../adapter/AgentAdapter.js';
import {
  adapterError,
  type AdapterId,
  type AdapterKernelError,
  type Result,
  ok,
  err,
} from '../types/index.js';

export interface LifecycleSnapshot {
  readonly state: AdapterLifecycleState;
  readonly enteredAt: string;
  readonly lastError: string | null;
  readonly transitionCount: number;
}

export interface LifecycleOptions {
  readonly adapterId: AdapterId;
  readonly initializationTimeoutMs: number;
  readonly now: () => number;
  readonly isoNow: () => string;
}

export const VALID_TRANSITIONS: Readonly<Record<AdapterLifecycleState, readonly AdapterLifecycleState[]>> = {
  UNINITIALIZED: ['INITIALIZING', 'SHUTDOWN'],
  INITIALIZING: ['READY', 'DEGRADED', 'SHUTDOWN'],
  READY: ['DEGRADED', 'SHUTDOWN'],
  DEGRADED: ['READY', 'SHUTDOWN'],
  SHUTDOWN: [],
};

export class AgentLifecycle {
  private state: AdapterLifecycleState = 'UNINITIALIZED';
  private enteredAtMs: number;
  private enteredAtIso: string;
  private initializingStartedAtMs: number | null = null;
  private lastError: string | null = null;
  private transitionCount = 0;

  public constructor(private readonly options: LifecycleOptions) {
    this.enteredAtMs = options.now();
    this.enteredAtIso = options.isoNow();
  }

  // Phase 1 prompt action 5: snapshot exposes the exact 5-state machine state without mutation.
  public snapshot(): LifecycleSnapshot {
    return {
      state: this.state,
      enteredAt: this.enteredAtIso,
      lastError: this.lastError,
      transitionCount: this.transitionCount,
    };
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.1: initialization is the only path from UNINITIALIZED to READY.
  public beginInitializing(): Result<void, AdapterKernelError> {
    const transition = this.transitionTo('INITIALIZING');
    if (!transition.ok) {
      return transition;
    }
    this.initializingStartedAtMs = this.options.now();
    return ok(undefined);
  }

  // Phase 1 prompt action 5: INITIALIZING enforces timeout before READY completion.
  public completeInitializing(): Result<void, AdapterKernelError> {
    const timeout = this.enforceInitializingTimeout();
    if (!timeout.ok) {
      return timeout;
    }
    return this.transitionTo('READY');
  }

  // Phase 1 prompt action 5: governance failure automatically enters DEGRADED fail-closed state.
  public markDegraded(reason: string): Result<void, AdapterKernelError> {
    this.lastError = reason;
    if (this.state === 'DEGRADED') {
      return ok(undefined);
    }
    if (this.state === 'SHUTDOWN') {
      return err(adapterError(this.options.adapterId, 'NOT_INITIALIZED', 'Lifecycle is shut down.', 'CREWAI_ADAPTER_CONTRACT.md Claim 1.12'));
    }
    return this.transitionTo('DEGRADED');
  }

  // CREWAI_ADAPTER_CONTRACT.md Claims 1.2-1.3: shutdown is terminal and idempotent.
  public shutdown(): Result<void, AdapterKernelError> {
    if (this.state === 'SHUTDOWN') {
      return ok(undefined);
    }
    this.initializingStartedAtMs = null;
    return this.transitionTo('SHUTDOWN');
  }

  // Phase 1 prompt actions 3 and 6: core operations are allowed only while READY.
  public assertReadyForCoreOperation(operation: string): Result<void, AdapterKernelError> {
    if (this.state === 'READY') {
      return ok(undefined);
    }
    if (this.state === 'DEGRADED') {
      return err(adapterError(
        this.options.adapterId,
        'CORE_PORT_UNAVAILABLE',
        `Core operation ${operation} is fail-closed while lifecycle state is DEGRADED.`,
        'Phase 1 prompt action 6; CREWAI_ADAPTER_CONTRACT.md Claim 1.12',
        { lifecycleState: this.state, operation },
      ));
    }
    return err(adapterError(
      this.options.adapterId,
      'NOT_INITIALIZED',
      `Core operation ${operation} requires READY lifecycle state.`,
      'CREWAI_ADAPTER_CONTRACT.md Claim 1.1',
      { lifecycleState: this.state, operation },
    ));
  }

  // CREWAI_ADAPTER_CONTRACT.md Claim 1.8: cached health must not block on I/O.
  public toHealth(base: Omit<AdapterHealth, 'status' | 'lifecycleState' | 'lastError'>): AdapterHealth {
    const status = this.state === 'READY'
      ? 'healthy'
      : this.state === 'DEGRADED'
        ? 'degraded'
        : 'unhealthy';
    const healthBase = {
      ...base,
      status,
      lifecycleState: this.state,
    } as const;
    return this.lastError === null ? healthBase : { ...healthBase, lastError: this.lastError };
  }

  // Phase 1 prompt action 5: transition rules reject every invalid edge.
  public transitionTo(next: AdapterLifecycleState): Result<void, AdapterKernelError> {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      return err(adapterError(
        this.options.adapterId,
        'INVALID_TRANSITION',
        `Invalid lifecycle transition ${this.state} -> ${next}.`,
        'Phase 1 prompt action 5',
        { from: this.state, to: next },
      ));
    }
    this.state = next;
    this.enteredAtMs = this.options.now();
    this.enteredAtIso = this.options.isoNow();
    this.transitionCount += 1;
    if (next !== 'DEGRADED') {
      this.lastError = null;
    }
    return ok(undefined);
  }

  // Phase 1 prompt action 5: INITIALIZING timeout becomes DEGRADED and rejects initialization.
  public enforceInitializingTimeout(): Result<void, AdapterKernelError> {
    if (this.state !== 'INITIALIZING' || this.initializingStartedAtMs === null) {
      return ok(undefined);
    }
    const elapsedMs = this.options.now() - this.initializingStartedAtMs;
    if (elapsedMs <= this.options.initializationTimeoutMs) {
      return ok(undefined);
    }
    const message = `Initialization exceeded ${this.options.initializationTimeoutMs}ms timeout.`;
    const degraded = this.markDegraded(message);
    if (!degraded.ok) {
      return degraded;
    }
    return err(adapterError(
      this.options.adapterId,
      'CORE_PORT_UNAVAILABLE',
      message,
      'Phase 1 prompt action 5',
      { elapsedMs, timeoutMs: this.options.initializationTimeoutMs },
    ));
  }

  public ageMs(): number {
    return this.options.now() - this.enteredAtMs;
  }
}
