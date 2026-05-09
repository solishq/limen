/**
 * TokenBudgetManager
 *
 * Contract: SHARED_TYPES.md S20 (Performance Budget), S20.1 (TokenEstimator)
 *           PHASE_3_DESIGN_SOURCE.md S6 (Token Budget Enforcement)
 *           CREWAI_ADAPTER_CONTRACT.md S7 (Token Budget Enforcement)
 * Purpose: Per-session and per-operation token budget tracking with reservation pattern.
 *
 * Design decisions:
 * - Reservation pattern: reserve before operation, consume or release after
 * - Checked arithmetic: all additions/subtractions verify no overflow past MAX_SAFE_INTEGER
 * - Both per-operation and per-session ceilings enforced (PHASE_3_DESIGN_SOURCE.md S6.2)
 * - Events emitted per SHARED_TYPES.md S16
 */

import type { Result, KernelError } from '../../adapters/shared/types.js';
import type {
  TokenReservation,
  SessionBudgetState,
  BudgetCheckResult,
  BudgetEvent,
  TokenBudgetManagerConfig,
} from './types.js';
import { MAX_TOKEN_BUDGET_CAP } from './types.js';
import type { TimeProvider } from '../audit/enterprise-logger.js';

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'SHARED_TYPES.md S20' };
}

const DEFAULT_TIME_PROVIDER: TimeProvider = {
  now: () => new Date().toISOString(),
};

/**
 * TokenBudgetManager -- tracks per-session and per-operation token budgets.
 *
 * PHASE_3_DESIGN_SOURCE.md S6.2: Both per-operation and per-session ceilings
 * must be enforced; neither can be bypassed.
 * SHARED_TYPES.md S20.1: Token overflow detection via Number.MAX_SAFE_INTEGER.
 *
 * ARCHITECTURAL CONSTRAINT (Finding-31): Token budget state is in-memory only.
 * - Sessions and reservations are Map objects with no persistence.
 * - State is lost on process restart.
 * - State is not shared across multiple Limen instances.
 * - Suitable for single-process deployments only.
 * - For multi-process: implement SQLite-backed persistence via core_token_budgets table.
 * - cleanupStaleSessions() should be called periodically or on new session creation
 *   to prevent unbounded memory growth from abandoned sessions.
 *
 * #governed = true -- this manager has no ungoverned mode.
 */
export class TokenBudgetManager {
  /** Governance is always enforced. */
  readonly #governed: true = true;
  /** Verify governance is active. */
  get governed(): boolean { return this.#governed; }
  readonly #sessions: Map<string, SessionBudgetState> = new Map();
  readonly #reservations: Map<string, TokenReservation> = new Map();
  readonly #config: TokenBudgetManagerConfig;
  readonly #eventListeners: Array<(event: BudgetEvent) => void> = [];
  readonly #timeProvider: TimeProvider;
  #nextReservationId = 0;

  /**
   * F-11: Validates all numeric config values on construction.
   * F-13: Accepts optional TimeProvider for deterministic testing.
   */
  constructor(config: TokenBudgetManagerConfig, timeProvider?: TimeProvider) {
    // F-11: Config validation -- all numeric values must be finite, non-negative, <= MAX_SAFE_INTEGER
    this.#validateNumeric('defaultMaxTokensPerSession', config.defaultMaxTokensPerSession);
    this.#validateNumeric('defaultMaxTokensPerOperation', config.defaultMaxTokensPerOperation);
    this.#validateNumeric('defaultWarningThresholdPct', config.defaultWarningThresholdPct);
    if (config.defaultReplenishmentWindowSeconds !== null) {
      this.#validateNumeric('defaultReplenishmentWindowSeconds', config.defaultReplenishmentWindowSeconds);
    }
    this.#config = config;
    this.#timeProvider = timeProvider ?? DEFAULT_TIME_PROVIDER;
  }

  #validateNumeric(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new Error(`Invalid config '${name}': must be a finite non-negative number <= Number.MAX_SAFE_INTEGER, got ${String(value)}`);
    }
    // R2-10: Token budget values must not exceed MAX_TOKEN_BUDGET_CAP.
    // MAX_SAFE_INTEGER effectively disables budget enforcement, which defeats
    // the purpose of this manager. Cap at 100M tokens for safety.
    if ((name === 'defaultMaxTokensPerSession' || name === 'defaultMaxTokensPerOperation') && value > MAX_TOKEN_BUDGET_CAP) {
      throw new Error(`Invalid config '${name}': must be <= ${MAX_TOKEN_BUDGET_CAP} (R2-10: prevent effectively unlimited budgets), got ${String(value)}`);
    }
  }

  /**
   * Initialize a session budget.
   *
   * PHASE_3_DESIGN_SOURCE.md S6.2: Per-session ceiling is set here.
   * CREWAI_ADAPTER_CONTRACT.md S3.6: TokenBudgetConfig values applied.
   */
  initSession(
    sessionId: string,
    maxTokensPerSession?: number,
    maxTokensPerOperation?: number,
    warningThresholdPct?: number,
    replenishmentWindowSeconds?: number | null,
  ): Result<void> {
    if (this.#sessions.has(sessionId)) {
      return { ok: false, error: makeError('SESSION_EXISTS', `Session ${sessionId} already has a budget`) };
    }

    const now = this.#timeProvider.now();
    const state: SessionBudgetState = {
      sessionId,
      totalBudget: maxTokensPerSession ?? this.#config.defaultMaxTokensPerSession,
      maxTokensPerOperation: maxTokensPerOperation ?? this.#config.defaultMaxTokensPerOperation,
      consumed: 0,
      reserved: 0,
      encoding: this.#config.defaultEncoding,
      warningEmitted: false,
      warningThresholdPct: warningThresholdPct ?? this.#config.defaultWarningThresholdPct,
      replenishmentWindowSeconds: replenishmentWindowSeconds !== undefined
        ? replenishmentWindowSeconds
        : this.#config.defaultReplenishmentWindowSeconds,
      createdAt: now,
      lastActivityAt: now,
    };

    this.#sessions.set(sessionId, state);
    return { ok: true, value: undefined };
  }

  /**
   * SHARED_TYPES.md S20 + PHASE_3_DESIGN_SOURCE.md S6 -- Reserve tokens for an operation.
   *
   * Enforces BOTH ceilings:
   * 1. Per-operation: estimatedTokens <= maxTokensPerOperation
   * 2. Per-session: (consumed + reserved + estimatedTokens) <= totalBudget
   *
   * SHARED_TYPES.md S20.1: Checks Number.MAX_SAFE_INTEGER for overflow.
   *
   * @returns BudgetCheckResult with reservation details or denial reason
   */
  reserveTokens(
    sessionId: string,
    operationType: string,
    estimatedTokens: number,
  ): Result<BudgetCheckResult> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: makeError('SESSION_NOT_FOUND', `No budget for session ${sessionId}`) };
    }

    // Overflow check per SHARED_TYPES.md S20.1
    if (!Number.isFinite(estimatedTokens) || estimatedTokens < 0) {
      return { ok: false, error: makeError('INVALID_TOKENS', 'Token count must be a non-negative finite number') };
    }
    if (estimatedTokens > Number.MAX_SAFE_INTEGER) {
      return { ok: false, error: makeError('TOKEN_OVERFLOW', 'Token count exceeds Number.MAX_SAFE_INTEGER') };
    }

    const remaining = session.totalBudget - session.consumed - session.reserved;

    // Per-operation ceiling check (PHASE_3_DESIGN_SOURCE.md S6.2)
    if (estimatedTokens > session.maxTokensPerOperation) {
      const result: BudgetCheckResult = {
        allowed: false,
        reservationId: null,
        remaining,
        required: estimatedTokens,
        reason: `Exceeds per-operation ceiling: ${estimatedTokens} > ${session.maxTokensPerOperation}`,
        retryable: false,
        retryAfterSeconds: null,
      };
      return { ok: true, value: result };
    }

    // Per-session ceiling check (PHASE_3_DESIGN_SOURCE.md S6.2)
    if (estimatedTokens > remaining) {
      const retryable = session.replenishmentWindowSeconds !== null;
      const result: BudgetCheckResult = {
        allowed: false,
        reservationId: null,
        remaining,
        required: estimatedTokens,
        reason: `Exceeds session budget: ${estimatedTokens} required, ${remaining} remaining`,
        retryable,
        retryAfterSeconds: retryable ? session.replenishmentWindowSeconds : null,
      };

      // Emit budget:exhausted event
      this.#emitEvent({
        type: 'budget:exhausted',
        sessionId,
        tokens: estimatedTokens,
        remaining,
        timestamp: this.#timeProvider.now(),
      });

      return { ok: true, value: result };
    }

    // Checked addition for overflow
    const newReserved = session.reserved + estimatedTokens;
    if (newReserved > Number.MAX_SAFE_INTEGER) {
      return { ok: false, error: makeError('TOKEN_OVERFLOW', 'Reserved token total would exceed Number.MAX_SAFE_INTEGER') };
    }

    // Create reservation
    const reservationId = `res-${String(++this.#nextReservationId)}`;
    const now = this.#timeProvider.now();
    const reservation: TokenReservation = {
      reservationId,
      sessionId,
      operationType,
      estimatedTokens,
      createdAt: now,
      consumed: false,
      released: false,
    };

    this.#reservations.set(reservationId, reservation);
    this.#sessions.set(sessionId, {
      ...session,
      reserved: newReserved,
      lastActivityAt: now,
    });

    // Emit budget:reserved event (SHARED_TYPES.md S16)
    this.#emitEvent({
      type: 'budget:reserved',
      sessionId,
      reservationId,
      tokens: estimatedTokens,
      remaining: remaining - estimatedTokens,
      timestamp: now,
    });

    const result: BudgetCheckResult = {
      allowed: true,
      reservationId,
      remaining: remaining - estimatedTokens,
      required: estimatedTokens,
      reason: null,
      retryable: false,
      retryAfterSeconds: null,
    };

    return { ok: true, value: result };
  }

  /**
   * SHARED_TYPES.md S20 -- Record actual token consumption.
   *
   * Converts a reservation to consumed tokens. The actualTokens may differ
   * from the estimated amount (typically less).
   *
   * CREWAI_ADAPTER_CONTRACT.md S7.2 step 6: consumption recorded with checked
   * arithmetic only after the operation is admitted.
   */
  consumeTokens(
    sessionId: string,
    reservationId: string,
    actualTokens: number,
  ): Result<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: makeError('SESSION_NOT_FOUND', `No budget for session ${sessionId}`) };
    }

    const reservation = this.#reservations.get(reservationId);
    if (!reservation) {
      return { ok: false, error: makeError('RESERVATION_NOT_FOUND', `Reservation ${reservationId} not found`) };
    }
    if (reservation.sessionId !== sessionId) {
      return { ok: false, error: makeError('SESSION_MISMATCH', 'Reservation does not belong to this session') };
    }
    if (reservation.consumed || reservation.released) {
      return { ok: false, error: makeError('RESERVATION_CLOSED', 'Reservation already consumed or released') };
    }

    if (!Number.isFinite(actualTokens) || actualTokens < 0) {
      return { ok: false, error: makeError('INVALID_TOKENS', 'Actual tokens must be a non-negative finite number') };
    }

    // Checked arithmetic
    const newConsumed = session.consumed + actualTokens;
    if (newConsumed > Number.MAX_SAFE_INTEGER) {
      return { ok: false, error: makeError('TOKEN_OVERFLOW', 'Consumed token total would exceed Number.MAX_SAFE_INTEGER') };
    }

    const newReserved = Math.max(0, session.reserved - reservation.estimatedTokens);
    const now = this.#timeProvider.now();

    // Finding-40: Delete consumed reservation from Map to prevent unbounded growth.
    // The reservation data is no longer needed after consumption.
    this.#reservations.delete(reservationId);

    // Check warning threshold (CREWAI_ADAPTER_CONTRACT.md S7.2 step 7)
    const usedPct = (newConsumed / session.totalBudget) * 100;
    const shouldWarn = usedPct >= session.warningThresholdPct && !session.warningEmitted;

    this.#sessions.set(sessionId, {
      ...session,
      consumed: newConsumed,
      reserved: newReserved,
      lastActivityAt: now,
      warningEmitted: session.warningEmitted || shouldWarn,
    });

    // F-05: Emit budget:warning (not budget:exhausted) when crossing warning threshold
    if (shouldWarn) {
      this.#emitEvent({
        type: 'budget:warning',
        sessionId,
        tokens: actualTokens,
        remaining: session.totalBudget - newConsumed - newReserved,
        timestamp: now,
      });
    }

    // Emit budget:consumed event (SHARED_TYPES.md S16)
    this.#emitEvent({
      type: 'budget:consumed',
      sessionId,
      reservationId,
      tokens: actualTokens,
      remaining: session.totalBudget - newConsumed - newReserved,
      timestamp: now,
    });

    return { ok: true, value: undefined };
  }

  /**
   * SHARED_TYPES.md S20 -- Release unused reservation.
   *
   * Called when an operation was reserved but not executed (e.g., governance refused).
   */
  releaseTokens(
    sessionId: string,
    reservationId: string,
  ): Result<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: makeError('SESSION_NOT_FOUND', `No budget for session ${sessionId}`) };
    }

    const reservation = this.#reservations.get(reservationId);
    if (!reservation) {
      return { ok: false, error: makeError('RESERVATION_NOT_FOUND', `Reservation ${reservationId} not found`) };
    }
    if (reservation.sessionId !== sessionId) {
      return { ok: false, error: makeError('SESSION_MISMATCH', 'Reservation does not belong to this session') };
    }
    if (reservation.consumed || reservation.released) {
      return { ok: false, error: makeError('RESERVATION_CLOSED', 'Reservation already consumed or released') };
    }

    const newReserved = Math.max(0, session.reserved - reservation.estimatedTokens);
    const now = this.#timeProvider.now();

    // Finding-40: Delete released reservation from Map to prevent unbounded growth.
    this.#reservations.delete(reservationId);
    this.#sessions.set(sessionId, {
      ...session,
      reserved: newReserved,
      lastActivityAt: now,
    });

    // Emit budget:released event (SHARED_TYPES.md S16)
    this.#emitEvent({
      type: 'budget:released',
      sessionId,
      reservationId,
      tokens: reservation.estimatedTokens,
      remaining: session.totalBudget - session.consumed - newReserved,
      timestamp: now,
    });

    return { ok: true, value: undefined };
  }

  /**
   * Get remaining budget for a session.
   *
   * CREWAI_ADAPTER_CONTRACT.md S7.1: TokenBudgetState exposure.
   */
  getSessionBudget(sessionId: string): Result<SessionBudgetState> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: makeError('SESSION_NOT_FOUND', `No budget for session ${sessionId}`) };
    }
    return { ok: true, value: session };
  }

  /**
   * Reset budget for a new window (replenishment).
   *
   * CREWAI_ADAPTER_CONTRACT.md S3.6: replenishmentWindowSeconds controls
   * whether budget reset is available.
   */
  resetBudget(sessionId: string): Result<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) {
      return { ok: false, error: makeError('SESSION_NOT_FOUND', `No budget for session ${sessionId}`) };
    }

    if (session.replenishmentWindowSeconds === null) {
      return { ok: false, error: makeError('REPLENISHMENT_DISABLED', 'Budget replenishment is not configured for this session') };
    }

    const now = this.#timeProvider.now();
    this.#sessions.set(sessionId, {
      ...session,
      consumed: 0,
      reserved: 0,
      warningEmitted: false,
      lastActivityAt: now,
    });

    // Release all pending reservations for this session
    for (const [id, res] of this.#reservations) {
      if (res.sessionId === sessionId && !res.consumed && !res.released) {
        this.#reservations.set(id, { ...res, released: true });
      }
    }

    return { ok: true, value: undefined };
  }

  /**
   * Remove session budget tracking entirely.
   */
  removeSession(sessionId: string): Result<void> {
    if (!this.#sessions.has(sessionId)) {
      return { ok: false, error: makeError('SESSION_NOT_FOUND', `No budget for session ${sessionId}`) };
    }

    this.#sessions.delete(sessionId);

    // Clean up reservations
    for (const [id, res] of this.#reservations) {
      if (res.sessionId === sessionId) {
        this.#reservations.delete(id);
      }
    }

    return { ok: true, value: undefined };
  }

  /**
   * Finding-31: Clean up stale sessions to prevent unbounded memory growth.
   * Removes sessions where lastActivityAt is older than maxIdleMs from now.
   * Should be called periodically or on new session creation.
   *
   * @param maxIdleMs Maximum idle time in milliseconds before a session is considered stale.
   * @returns Number of sessions cleaned up.
   */
  cleanupStaleSessions(maxIdleMs: number): number {
    const now = new Date(this.#timeProvider.now()).getTime();
    let cleaned = 0;

    for (const [sessionId, session] of this.#sessions) {
      const lastActivity = new Date(session.lastActivityAt).getTime();
      if (now - lastActivity > maxIdleMs) {
        this.#sessions.delete(sessionId);
        // Clean up associated reservations
        for (const [resId, res] of this.#reservations) {
          if (res.sessionId === sessionId) {
            this.#reservations.delete(resId);
          }
        }
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Subscribe to budget events.
   * F-14: Returns an unsubscribe function to prevent memory leaks.
   */
  onEvent(listener: (event: BudgetEvent) => void): () => void {
    this.#eventListeners.push(listener);
    return () => this.offEvent(listener);
  }

  /**
   * F-14: Unsubscribe from budget events.
   */
  offEvent(listener: (event: BudgetEvent) => void): void {
    const idx = this.#eventListeners.indexOf(listener);
    if (idx !== -1) {
      this.#eventListeners.splice(idx, 1);
    }
  }

  #emitEvent(event: BudgetEvent): void {
    // Finding-60: Isolate listener failures — one bad listener must not break others
    for (const listener of this.#eventListeners) {
      try {
        listener(event);
      } catch {
        // Finding-60: Swallow listener error to prevent cascade failure
      }
    }
  }
}
