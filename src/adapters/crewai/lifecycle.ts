/**
 * CrewAI Adapter Lifecycle Management
 *
 * Contract: CREWAI_ADAPTER_CONTRACT.md S9
 * Implements: 5-state lifecycle (UNINITIALIZED -> INITIALIZING -> READY -> DEGRADED -> SHUTDOWN)
 *
 * Claims covered: 7.1 (atomic transitions), 7.2 (SHUTDOWN terminal),
 *                 7.3 (DEGRADED blocks), 7.5 (serialized operations)
 */

import type { AdapterLifecycleState } from './types.js';

/**
 * CREWAI_ADAPTER_CONTRACT.md S9.3 -- Valid state transitions
 * Claim 7.1: All state transitions are atomic. No intermediate state is observable.
 */
const VALID_TRANSITIONS: Record<AdapterLifecycleState, readonly AdapterLifecycleState[]> = {
  'UNINITIALIZED': ['INITIALIZING', 'SHUTDOWN'],
  'INITIALIZING': ['READY', 'UNINITIALIZED', 'SHUTDOWN'],
  'READY': ['READY', 'DEGRADED', 'SHUTDOWN'],
  'DEGRADED': ['READY', 'SHUTDOWN'],
  'SHUTDOWN': ['SHUTDOWN'], // Claim 7.2: terminal, self-transition only (idempotent)
};

/**
 * CREWAI_ADAPTER_CONTRACT.md S9 -- Lifecycle state manager
 *
 * Ensures all transitions follow the state machine rules.
 * Claim 7.1: Atomic transitions.
 * Claim 7.2: SHUTDOWN is terminal.
 */
export class AdapterLifecycle {
  private _state: AdapterLifecycleState = 'UNINITIALIZED';
  private _startedAt: number | null = null;

  /** Current lifecycle state */
  get state(): AdapterLifecycleState {
    return this._state;
  }

  /** Time the adapter was initialized (for uptime calculation) */
  get startedAt(): number | null {
    return this._startedAt;
  }

  /** Uptime in milliseconds */
  get uptimeMs(): number {
    if (this._startedAt === null) return 0;
    return Date.now() - this._startedAt;
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S9.3 -- Attempt a state transition.
   * Returns true if the transition is valid and was applied.
   * Returns false if the transition is invalid (state unchanged).
   *
   * Claim 7.1: Transition is atomic (single assignment).
   * Claim 7.2: No transition out of SHUTDOWN except self-transition.
   */
  transition(target: AdapterLifecycleState): boolean {
    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed.includes(target)) {
      return false;
    }

    // Record start time on first transition to READY
    if (target === 'READY' && this._startedAt === null) {
      this._startedAt = Date.now();
    }

    this._state = target;
    return true;
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S9.4 -- Check if a core operation is permitted.
   * Core operations: remember, recall, createBranch, mergeBranches, resolveConflict,
   *                  translateToolCall, translateActionToGovernance, onAgentSessionStart/End
   *
   * Only allowed in READY state.
   * Claim 7.3: DEGRADED blocks all reads and writes.
   */
  isCoreOperationAllowed(): boolean {
    return this._state === 'READY';
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S9.4 -- Check if health operations are permitted.
   * healthCheck and getHealth are allowed in all states except SHUTDOWN (healthCheck)
   * and all states for getHealth.
   */
  isHealthCheckAllowed(): boolean {
    return this._state !== 'SHUTDOWN';
  }

  /**
   * CREWAI_ADAPTER_CONTRACT.md S9.4 -- Check if subscription management is allowed.
   * Claim 1.13: on/off permitted in all states except SHUTDOWN.
   */
  isSubscriptionAllowed(): boolean {
    return this._state !== 'SHUTDOWN';
  }

  /** CREWAI_ADAPTER_CONTRACT.md S9.4 -- Check if initialize is allowed */
  isInitializeAllowed(): boolean {
    return this._state === 'UNINITIALIZED' || this._state === 'READY';
  }

  /** Is adapter in a state that can serve operations? */
  isOperational(): boolean {
    return this._state === 'READY';
  }

  /** Is adapter degraded (core port lost)? */
  isDegraded(): boolean {
    return this._state === 'DEGRADED';
  }

  /** Is adapter shut down? */
  isShutdown(): boolean {
    return this._state === 'SHUTDOWN';
  }

  /** Is adapter uninitialized? */
  isUninitialized(): boolean {
    return this._state === 'UNINITIALIZED';
  }
}
