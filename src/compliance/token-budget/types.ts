/**
 * Token Budget Types
 *
 * Contract: SHARED_TYPES.md S20 (Performance Budget), S20.1 (TokenEstimator)
 *           PHASE_3_DESIGN_SOURCE.md S6 (Token Budget Enforcement)
 *           CREWAI_ADAPTER_CONTRACT.md S3.6 (TokenBudgetConfig)
 * Purpose: Types for the TokenBudgetManager.
 */

import type { TokenEncoding } from '../../adapters/crewai/types.js';

/**
 * Token reservation -- tracks a pending token allocation.
 */
export interface TokenReservation {
  readonly reservationId: string;
  readonly sessionId: string;
  readonly operationType: string;
  readonly estimatedTokens: number;
  readonly createdAt: string;
  readonly consumed: boolean;
  readonly released: boolean;
}

/**
 * Session budget state -- tracks token consumption for a session.
 *
 * PHASE_3_DESIGN_SOURCE.md S6.2: Both per-operation and per-session ceilings
 * must be enforced; neither can be bypassed.
 */
export interface SessionBudgetState {
  readonly sessionId: string;
  readonly totalBudget: number;
  readonly maxTokensPerOperation: number;
  readonly consumed: number;
  readonly reserved: number;
  readonly encoding: TokenEncoding;
  readonly warningEmitted: boolean;
  readonly warningThresholdPct: number;
  readonly replenishmentWindowSeconds: number | null;
  readonly createdAt: string;
  readonly lastActivityAt: string;
}

/**
 * Budget check result -- returned by reserveTokens.
 */
export interface BudgetCheckResult {
  readonly allowed: boolean;
  readonly reservationId: string | null;
  readonly remaining: number;
  readonly required: number;
  readonly reason: string | null;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
}

/**
 * Budget event types emitted by TokenBudgetManager.
 * SHARED_TYPES.md S16 -- Events.
 */
/**
 * F-05: Added 'budget:warning' for threshold crossing (distinct from exhausted).
 */
export type BudgetEventType =
  | 'budget:reserved'
  | 'budget:consumed'
  | 'budget:released'
  | 'budget:warning'
  | 'budget:exhausted';

/**
 * Budget event payload.
 */
export interface BudgetEvent {
  readonly type: BudgetEventType;
  readonly sessionId: string;
  readonly reservationId?: string;
  readonly tokens: number;
  readonly remaining: number;
  readonly timestamp: string;
}

/**
 * Configuration for the TokenBudgetManager.
 */
export interface TokenBudgetManagerConfig {
  readonly defaultMaxTokensPerSession: number;
  readonly defaultMaxTokensPerOperation: number;
  readonly defaultEncoding: TokenEncoding;
  readonly defaultWarningThresholdPct: number;
  readonly defaultReplenishmentWindowSeconds: number | null;
}
