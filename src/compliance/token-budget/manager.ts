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

import type { Result, KernelError } from '../../adapters/crewai/types.js';
import type {
  TokenReservation,
  SessionBudgetState,
  BudgetCheckResult,
  BudgetEvent,
  TokenBudgetManagerConfig,
} from './types.js';

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'SHARED_TYPES.md S20' };
}

/**
 * TokenBudgetManager -- tracks per-session and per-operation token budgets.
 *
 * PHASE_3_DESIGN_SOURCE.md S6.2: Both per-operation and per-session ceilings
 * must be enforced; neither can be bypassed.
 * SHARED_TYPES.md S20.1: Token overflow detection via Number.MAX_SAFE_INTEGER.
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
  #nextReservationId = 0;

  constructor(config: TokenBudgetManagerConfig) {
    this.#config = config;
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

    const now = new Date().toISOString();
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
        timestamp: new Date().toISOString(),
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
    const now = new Date().toISOString();
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
    const now = new Date().toISOString();

    // Mark reservation consumed
    this.#reservations.set(reservationId, { ...reservation, consumed: true });

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

    if (shouldWarn) {
      this.#emitEvent({
        type: 'budget:exhausted',
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
    const now = new Date().toISOString();

    this.#reservations.set(reservationId, { ...reservation, released: true });
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

    const now = new Date().toISOString();
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
   * Subscribe to budget events.
   */
  onEvent(listener: (event: BudgetEvent) => void): void {
    this.#eventListeners.push(listener);
  }

  #emitEvent(event: BudgetEvent): void {
    for (const listener of this.#eventListeners) {
      listener(event);
    }
  }
}
