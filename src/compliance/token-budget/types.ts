/**
 * Token Budget Types
 *
 * Contract: SHARED_TYPES.md S20 (Performance Budget), S20.1 (TokenEstimator)
 *           PHASE_3_DESIGN_SOURCE.md S6 (Token Budget Enforcement)
 *           CREWAI_ADAPTER_CONTRACT.md S3.6 (TokenBudgetConfig)
 * Purpose: Types for the TokenBudgetManager.
 */

import type { TokenEncoding } from '../../adapters/shared/types.js';

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
 * R2-10: Token budget default should be finite and configurable.
 * MAX_SAFE_INTEGER effectively disables token budget enforcement.
 * 1M tokens is a reasonable default for most sessions — callers can
 * override via TokenBudgetManagerConfig if they need more.
 */
export const DEFAULT_TOKEN_BUDGET = 1_000_000;

/**
 * R2-10: Default per-operation token ceiling.
 * 100K tokens per individual operation prevents any single call
 * from consuming a disproportionate share of the session budget.
 */
export const DEFAULT_TOKEN_BUDGET_PER_OPERATION = 100_000;

/**
 * R2-10: Maximum allowed token budget value.
 * Prevents callers from setting effectively unlimited budgets.
 * 100M tokens is the hard cap — well above any reasonable usage
 * but far below MAX_SAFE_INTEGER, preserving overflow safety margin.
 */
export const MAX_TOKEN_BUDGET_CAP = 100_000_000;

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
