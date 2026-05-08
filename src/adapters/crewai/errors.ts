/**
 * CrewAI Adapter Error Taxonomy
 *
 * Contract: CREWAI_ADAPTER_CONTRACT.md S6
 * Implements: Full error taxonomy with deterministic precedence,
 *             retryable field (CrewAI-specific extension of AdapterKernelError),
 *             and NEVER_RETRYABLE enforcement for GOVERNANCE_REFUSAL and NOT_INITIALIZED.
 */

import type {
  CrewAIAdapterErrorCode,
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
  readonly context?: Readonly<Record<string, unknown>>;
}

// ── CREWAI_ADAPTER_CONTRACT.md S6.1 -- CrewAIAdapterError ──

/**
 * CREWAI_ADAPTER_CONTRACT.md S6.1 -- CrewAI adapter error
 *
 * Extends AdapterKernelError with:
 * - `retryable` field (CrewAI-specific, per S6.1 note)
 * - Deterministic precedence via ERROR_PRECEDENCE
 * - NEVER_RETRYABLE enforcement (Claims 4.2, 4.3)
 */
export class CrewAIAdapterError extends Error implements AdapterKernelError {
  readonly code: CrewAIAdapterErrorCode;
  readonly adapterId: AdapterId;
  readonly retryable: boolean;
  readonly context?: Readonly<Record<string, unknown>>;

  constructor(params: {
    code: CrewAIAdapterErrorCode;
    message: string;
    adapterId: AdapterId;
    retryable: boolean;
    context?: Readonly<Record<string, unknown>>;
  }) {
    super(params.message);
    this.name = 'CrewAIAdapterError';
    this.code = params.code;
    this.adapterId = params.adapterId;
    // Claim 4.2, 4.3: GOVERNANCE_REFUSAL and NOT_INITIALIZED are NEVER retryable
    this.retryable = NEVER_RETRYABLE.has(params.code) ? false : params.retryable;
    this.context = params.context;
  }

  /** CREWAI_ADAPTER_CONTRACT.md S6.2 -- Precedence value (1=highest) */
  get precedence(): number {
    return ERROR_PRECEDENCE[this.code];
  }
}

// ── Factory Functions ──

/**
 * CREWAI_ADAPTER_CONTRACT.md S6.1 -- NOT_INITIALIZED
 * Claim 4.3: Never retryable. Caller must call initialize first.
 */
export function notInitialized(adapterId: AdapterId): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'NOT_INITIALIZED',
    message: 'Adapter is not initialized. Call initialize() first.',
    adapterId,
    retryable: false,
  });
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S6.1 -- ALREADY_INITIALIZED
 * Claim 2.10: Config digest mismatch on re-init attempt.
 */
export function alreadyInitialized(adapterId: AdapterId): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'ALREADY_INITIALIZED',
    message: 'Adapter is already initialized with a different configuration.',
    adapterId,
    retryable: false,
  });
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S6.1 -- GOVERNANCE_REFUSAL
 * Claim 4.2: Never retryable. Governance decision is authoritative.
 * Claim 3.4: Must include rule field.
 */
export function governanceRefusal(
  adapterId: AdapterId,
  action: string,
  reason: string,
  rule: string,
  verdict: GovernanceVerdict,
  alternatives?: readonly string[],
): CrewAIAdapterError {
  return new CrewAIAdapterError({
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
 * CREWAI_ADAPTER_CONTRACT.md S6.1 -- BUDGET_EXCEEDED
 * Claim 4.4: Retryable only when replenishmentWindowSeconds is non-null.
 */
export function budgetExceeded(
  adapterId: AdapterId,
  remaining: number,
  required: number,
  retryAfterSeconds: number | null,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
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
 * CREWAI_ADAPTER_CONTRACT.md S6.1 -- UNKNOWN_TOOL
 * Claim 4.6: Never retryable without registry change.
 */
export function unknownTool(
  adapterId: AdapterId,
  tool: string,
  availableOperations: readonly string[],
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'UNKNOWN_TOOL',
    message: `Unknown tool: "${tool}"`,
    adapterId,
    retryable: false,
    context: { tool, availableOperations },
  });
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S6.1 -- CORE_PORT_UNAVAILABLE
 * Claim 4.5: Retryable subject to RetryPolicy.
 */
export function corePortUnavailable(
  adapterId: AdapterId,
  endpoint: string,
  reason: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'CORE_PORT_UNAVAILABLE',
    message: `Core port unavailable: ${reason}`,
    adapterId,
    retryable: true,
    context: { endpoint, reason },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- AUDIT_FAILURE */
export function auditFailure(
  adapterId: AdapterId,
  operation: string,
  reason: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'AUDIT_FAILURE',
    message: `Audit failure during ${operation}: ${reason}`,
    adapterId,
    retryable: false,
    context: { operation, reason },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- SERDE_ERROR */
export function serdeError(
  adapterId: AdapterId,
  detail: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'SERDE_ERROR',
    message: `Serialization/validation error: ${detail}`,
    adapterId,
    retryable: false,
    context: { detail },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- TRUST_LEVEL_INSUFFICIENT */
export function trustLevelInsufficient(
  adapterId: AdapterId,
  required: string,
  actual: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'TRUST_LEVEL_INSUFFICIENT',
    message: `Trust level insufficient: requires ${required}, have ${actual}`,
    adapterId,
    retryable: false,
    context: { required, actual },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- CAPABILITY_NOT_DECLARED */
export function capabilityNotDeclared(
  adapterId: AdapterId,
  capability: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'CAPABILITY_NOT_DECLARED',
    message: `Capability not declared: ${capability}`,
    adapterId,
    retryable: false,
    context: { capability },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- SESSION_NOT_FOUND */
export function sessionNotFound(
  adapterId: AdapterId,
  sessionId: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'SESSION_NOT_FOUND',
    message: `Session not found: ${sessionId}`,
    adapterId,
    retryable: false,
    context: { sessionId },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- CLIENT_ERROR */
export function clientError(
  adapterId: AdapterId,
  source: string,
  message: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'CLIENT_ERROR',
    message: `Client error from ${source}: ${message}`,
    adapterId,
    retryable: false,
    context: { source, message },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- TRANSLATION_FAILED */
export function translationFailed(
  adapterId: AdapterId,
  tool: string,
  detail: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'TRANSLATION_FAILED',
    message: `Translation failed for tool "${tool}": ${detail}`,
    adapterId,
    retryable: false,
    context: { tool, detail },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- SHUTDOWN_FAILED */
export function shutdownFailed(
  adapterId: AdapterId,
  reason: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'SHUTDOWN_FAILED',
    message: `Shutdown failed: ${reason}`,
    adapterId,
    retryable: false,
    context: { reason },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- MAX_SESSIONS_EXCEEDED */
export function maxSessionsExceeded(
  adapterId: AdapterId,
  current: number,
  max: number,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'MAX_SESSIONS_EXCEEDED',
    message: `Maximum sessions exceeded: ${current} active, max ${max}`,
    adapterId,
    retryable: false,
    context: { current, max },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- INTERNAL */
export function internalError(
  adapterId: AdapterId,
  message: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'INTERNAL',
    message: `Internal error: ${message}`,
    adapterId,
    retryable: false,
    context: { message },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- BRANCH_CONFLICT */
export function branchConflict(
  adapterId: AdapterId,
  branchIds: readonly string[],
  reason: string,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'BRANCH_CONFLICT',
    message: `Branch conflict: ${reason}`,
    adapterId,
    retryable: false,
    context: { branchIds, reason },
  });
}

/** CREWAI_ADAPTER_CONTRACT.md S6.1 -- TIME_PROVIDER_UNAVAILABLE */
export function timeProviderUnavailable(
  adapterId: AdapterId,
): CrewAIAdapterError {
  return new CrewAIAdapterError({
    code: 'TIME_PROVIDER_UNAVAILABLE',
    message: 'Time provider is unavailable for governance and audit timestamps.',
    adapterId,
    retryable: false,
  });
}

/**
 * CREWAI_ADAPTER_CONTRACT.md S6.2 -- Select highest-precedence error
 * Claim 4.1: Deterministic precedence. Given multiple simultaneous conditions,
 * the highest-precedence error is returned.
 */
export function selectHighestPrecedence(
  errors: readonly CrewAIAdapterError[],
): CrewAIAdapterError {
  if (errors.length === 0) {
    throw new Error('selectHighestPrecedence called with empty array');
  }
  return errors.reduce((a, b) => (a.precedence <= b.precedence ? a : b));
}

/**
 * Convert a CrewAIAdapterError to a Result error shape.
 */
export function toResultError(err: CrewAIAdapterError): {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string; readonly spec: string; readonly violations?: readonly unknown[] };
} {
  return {
    ok: false,
    error: {
      code: err.code,
      message: err.message,
      spec: 'CREWAI_ADAPTER_CONTRACT.md',
      violations: err.context ? [err.context] : undefined,
    },
  };
}
