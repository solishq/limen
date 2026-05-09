// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Adapter Error Taxonomy
 *
 * Implements: Full error taxonomy with deterministic precedence,
 *             retryable field, and NEVER_RETRYABLE enforcement.
 */

import type {
  AdapterErrorCode,
  AdapterId,
  GovernanceVerdict,
} from './types.js';
import { NEVER_RETRYABLE, ERROR_PRECEDENCE } from './types.js';

// ── AGENT_ADAPTER_ARCHITECTURE.md S11 -- AdapterKernelError (parent) ──

/** AGENT_ADAPTER_ARCHITECTURE.md S11 -- Canonical adapter error base */
export interface AdapterKernelError {
  readonly code: string;
  readonly message: string;
  readonly adapterId: AdapterId;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
}

// ── Adapter Error Class ──

/**
 * Adapter error with deterministic precedence and retryable semantics.
 *
 * - `retryable` field per error code semantics
 * - Deterministic precedence via ERROR_PRECEDENCE
 * - NEVER_RETRYABLE enforcement (GOVERNANCE_REFUSAL and NOT_INITIALIZED)
 */
export class AdapterError extends Error implements AdapterKernelError {
  readonly code: AdapterErrorCode;
  readonly adapterId: AdapterId;
  readonly retryable: boolean;
  readonly context: Readonly<Record<string, unknown>> | undefined;

  constructor(params: {
    code: AdapterErrorCode;
    message: string;
    adapterId: AdapterId;
    retryable: boolean;
    context?: Readonly<Record<string, unknown>> | undefined;
  }) {
    super(params.message);
    this.name = 'AdapterError';
    this.code = params.code;
    this.adapterId = params.adapterId;
    // GOVERNANCE_REFUSAL and NOT_INITIALIZED are NEVER retryable
    this.retryable = NEVER_RETRYABLE.has(params.code) ? false : params.retryable;
    this.context = params.context;
  }

  /** Precedence value (1=highest) */
  get precedence(): number {
    return ERROR_PRECEDENCE[this.code];
  }
}

/** @deprecated Use AdapterError */
export const CrewAIAdapterError = AdapterError;

// ── Factory Functions ──

/**
 * NOT_INITIALIZED -- Never retryable. Caller must call initialize first.
 */
export function notInitialized(adapterId: AdapterId): AdapterError {
  return new AdapterError({
    code: 'NOT_INITIALIZED',
    message: 'Adapter is not initialized. Call initialize() first.',
    adapterId,
    retryable: false,
  });
}

/**
 * ALREADY_INITIALIZED -- Config digest mismatch on re-init attempt.
 */
export function alreadyInitialized(adapterId: AdapterId): AdapterError {
  return new AdapterError({
    code: 'ALREADY_INITIALIZED',
    message: 'Adapter is already initialized with a different configuration.',
    adapterId,
    retryable: false,
  });
}

/**
 * GOVERNANCE_REFUSAL -- Never retryable. Governance decision is authoritative.
 */
export function governanceRefusal(
  adapterId: AdapterId,
  action: string,
  reason: string,
  rule: string,
  verdict: GovernanceVerdict,
  alternatives?: readonly string[],
): AdapterError {
  return new AdapterError({
    code: 'GOVERNANCE_REFUSAL',
    message: `Governance refused: ${reason}`,
    adapterId,
    retryable: false,
    context: {
      action,
      reason,
      rule,
      verdict,
      ...(alternatives ? { alternatives } : {}),
    },
  });
}

/**
 * BUDGET_EXCEEDED -- Retryable only when replenishmentWindowSeconds is non-null.
 */
export function budgetExceeded(
  adapterId: AdapterId,
  remaining: number,
  required: number,
  retryAfterSeconds: number | null,
): AdapterError {
  return new AdapterError({
    code: 'BUDGET_EXCEEDED',
    message: `Token budget exceeded: ${remaining} remaining, ${required} required`,
    adapterId,
    retryable: retryAfterSeconds !== null,
    context: {
      remaining,
      required,
      ...(retryAfterSeconds !== null ? { retryAfterSeconds } : {}),
    },
  });
}

/**
 * UNKNOWN_TOOL -- Never retryable without registry change.
 */
export function unknownTool(
  adapterId: AdapterId,
  tool: string,
  availableOperations: readonly string[],
): AdapterError {
  return new AdapterError({
    code: 'UNKNOWN_TOOL',
    message: `Unknown tool: "${tool}"`,
    adapterId,
    retryable: false,
    context: { tool, availableOperations },
  });
}

/**
 * CORE_PORT_UNAVAILABLE -- Retryable subject to RetryPolicy.
 */
export function corePortUnavailable(
  adapterId: AdapterId,
  endpoint: string,
  reason: string,
): AdapterError {
  return new AdapterError({
    code: 'CORE_PORT_UNAVAILABLE',
    message: `Core port unavailable: ${reason}`,
    adapterId,
    retryable: true,
    context: { endpoint, reason },
  });
}

/** AUDIT_FAILURE */
export function auditFailure(
  adapterId: AdapterId,
  operation: string,
  reason: string,
): AdapterError {
  return new AdapterError({
    code: 'AUDIT_FAILURE',
    message: `Audit failure during ${operation}: ${reason}`,
    adapterId,
    retryable: false,
    context: { operation, reason },
  });
}

/** SERDE_ERROR */
export function serdeError(
  adapterId: AdapterId,
  detail: string,
): AdapterError {
  return new AdapterError({
    code: 'SERDE_ERROR',
    message: `Serialization/validation error: ${detail}`,
    adapterId,
    retryable: false,
    context: { detail },
  });
}

/** TRUST_LEVEL_INSUFFICIENT */
export function trustLevelInsufficient(
  adapterId: AdapterId,
  required: string,
  actual: string,
): AdapterError {
  return new AdapterError({
    code: 'TRUST_LEVEL_INSUFFICIENT',
    message: `Trust level insufficient: requires ${required}, have ${actual}`,
    adapterId,
    retryable: false,
    context: { required, actual },
  });
}

/** CAPABILITY_NOT_DECLARED */
export function capabilityNotDeclared(
  adapterId: AdapterId,
  capability: string,
): AdapterError {
  return new AdapterError({
    code: 'CAPABILITY_NOT_DECLARED',
    message: `Capability not declared: ${capability}`,
    adapterId,
    retryable: false,
    context: { capability },
  });
}

/** SESSION_NOT_FOUND */
export function sessionNotFound(
  adapterId: AdapterId,
  sessionId: string,
): AdapterError {
  return new AdapterError({
    code: 'SESSION_NOT_FOUND',
    message: `Session not found: ${sessionId}`,
    adapterId,
    retryable: false,
    context: { sessionId },
  });
}

/** CLIENT_ERROR */
export function clientError(
  adapterId: AdapterId,
  source: string,
  message: string,
): AdapterError {
  return new AdapterError({
    code: 'CLIENT_ERROR',
    message: `Client error from ${source}: ${message}`,
    adapterId,
    retryable: false,
    context: { source, message },
  });
}

/** TRANSLATION_FAILED */
export function translationFailed(
  adapterId: AdapterId,
  tool: string,
  detail: string,
): AdapterError {
  return new AdapterError({
    code: 'TRANSLATION_FAILED',
    message: `Translation failed for tool "${tool}": ${detail}`,
    adapterId,
    retryable: false,
    context: { tool, detail },
  });
}

/** SHUTDOWN_FAILED */
export function shutdownFailed(
  adapterId: AdapterId,
  reason: string,
): AdapterError {
  return new AdapterError({
    code: 'SHUTDOWN_FAILED',
    message: `Shutdown failed: ${reason}`,
    adapterId,
    retryable: false,
    context: { reason },
  });
}

/** MAX_SESSIONS_EXCEEDED */
export function maxSessionsExceeded(
  adapterId: AdapterId,
  current: number,
  max: number,
): AdapterError {
  return new AdapterError({
    code: 'MAX_SESSIONS_EXCEEDED',
    message: `Maximum sessions exceeded: ${current} active, max ${max}`,
    adapterId,
    retryable: false,
    context: { current, max },
  });
}

/** INTERNAL */
export function internalError(
  adapterId: AdapterId,
  message: string,
): AdapterError {
  return new AdapterError({
    code: 'INTERNAL',
    message: `Internal error: ${message}`,
    adapterId,
    retryable: false,
    context: { message },
  });
}

/** BRANCH_CONFLICT */
export function branchConflict(
  adapterId: AdapterId,
  branchIds: readonly string[],
  reason: string,
): AdapterError {
  return new AdapterError({
    code: 'BRANCH_CONFLICT',
    message: `Branch conflict: ${reason}`,
    adapterId,
    retryable: false,
    context: { branchIds, reason },
  });
}

/** TIME_PROVIDER_UNAVAILABLE */
export function timeProviderUnavailable(
  adapterId: AdapterId,
): AdapterError {
  return new AdapterError({
    code: 'TIME_PROVIDER_UNAVAILABLE',
    message: 'Time provider is unavailable for governance and audit timestamps.',
    adapterId,
    retryable: false,
  });
}

/**
 * Select highest-precedence error from a list.
 * Deterministic: given multiple simultaneous conditions,
 * the highest-precedence error is returned.
 */
export function selectHighestPrecedence(
  errors: readonly AdapterError[],
): AdapterError {
  if (errors.length === 0) {
    throw new Error('selectHighestPrecedence called with empty array');
  }
  return errors.reduce((a, b) => (a.precedence <= b.precedence ? a : b));
}

/**
 * Convert an AdapterError to a Result error shape.
 */
export function toResultError(err: AdapterError): {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string; readonly spec: string; readonly violations?: readonly unknown[] };
} {
  return {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      spec: 'AGENT_ADAPTER_ARCHITECTURE.md',
      ...(err.context ? { violations: [err.context] as readonly unknown[] } : {}),
    },
  };
}
