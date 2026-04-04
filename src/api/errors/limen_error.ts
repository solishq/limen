/**
 * LimenError: Public API error class and error mapping utilities.
 * S ref: S39 IP-4 (error redaction), SD-02 (exception model), §6.13 (error codes)
 *
 * Phase: 4 (API Surface)
 * Implements: §6.13 of the Synthesized SDD
 *
 * Design decisions:
 *   SD-02: All public methods throw LimenError (exception model).
 *          Internal Result<T> from kernel/substrate/orchestration is mapped at the boundary.
 *   FPD-3: Error redaction happens at the API boundary, not per-layer.
 *          Internal KernelError details (SQL, stack traces, file paths) are NEVER exposed.
 *
 * Invariants enforced: I-13 (authorization completeness -- UNAUTHORIZED errors)
 * Failure modes defended: FM-10 (tenant data leakage -- no internal state in errors)
 */

import type { KernelError, Result, LimenViolation } from '../../kernel/interfaces/index.js';
import type { LimenErrorCode } from '../interfaces/api.js';

// ============================================================================
// Redaction Patterns (S39 IP-4)
// ============================================================================

/**
 * Patterns that indicate internal state leakage.
 * Any message matching these is replaced with a sanitized version.
 * S ref: S39 IP-4 (no internal state in public errors)
 */
const REDACTION_PATTERNS: readonly RegExp[] = [
  /(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA)\s/i,   // SQL statements
  /\/[a-zA-Z0-9_/.]+\.[a-z]{1,4}/i,                               // File paths (CF-030: case-insensitive for .TS/.JS)
  /at\s+\S+\s+\(.+:\d+:\d+\)/,                                    // Stack trace frames
  /Error:\s+[A-Za-z_]+\s+at\s+/,                                  // Stack trace headers (CF-030: mixed-case error names)
  /\b(?:api[_-]?key|token|secret|password|credential)\b/i,        // Sensitive tokens
  /sqlite3?_/i,                                                    // SQLite internals
  /SQLITE_/i,                                                      // SQLite error codes (CF-030: case-insensitive)
  /better-sqlite3/i,                                               // Dependency internals
  /node_modules/i,                                                 // Node internals (CF-030: case-insensitive)
];

/**
 * S39 IP-4: Check whether a message contains internal implementation details.
 * Returns true if the message should be redacted.
 */
function containsInternalDetails(message: string): boolean {
  for (const pattern of REDACTION_PATTERNS) {
    if (pattern.test(message)) {
      return true;
    }
  }
  return false;
}

/**
 * S39 IP-4: Sanitize a message by removing internal details.
 * Returns a generic message if internal state is detected.
 */
function sanitizeMessage(code: LimenErrorCode, message: string): string {
  if (containsInternalDetails(message)) {
    return GENERIC_MESSAGES[code] ?? 'An internal error occurred.';
  }
  return message;
}

// ============================================================================
// Generic Messages (one per error code)
// ============================================================================

/**
 * Safe, generic messages per error code.
 * Used when the original message contains internal implementation details.
 */
const GENERIC_MESSAGES: Readonly<Record<LimenErrorCode, string>> = {
  // API surface errors
  RATE_LIMITED: 'Request rate limit exceeded.',
  TIMEOUT: 'The operation timed out.',
  CANCELLED: 'The operation was cancelled.',
  UNAUTHORIZED: 'Insufficient permissions for this operation.',
  PROVIDER_UNAVAILABLE: 'No LLM provider is currently available.',
  SCHEMA_VALIDATION_FAILED: 'Output did not match the expected schema.',
  ENGINE_UNHEALTHY: 'The engine is in an unhealthy state.',
  SESSION_NOT_FOUND: 'The specified session was not found.',
  INVALID_CONFIG: 'The engine configuration is invalid.',
  INVALID_INPUT: 'The provided input is invalid.',

  // SC-1 through SC-10 pass-through error codes
  BUDGET_EXCEEDED: 'Token budget has been exceeded.',
  DEPTH_EXCEEDED: 'Mission tree depth limit exceeded.',
  CHILDREN_EXCEEDED: 'Maximum child missions exceeded.',
  TREE_SIZE_EXCEEDED: 'Mission tree size limit exceeded.',
  CAPABILITY_VIOLATION: 'Agent capability does not include the required permission.',
  AGENT_NOT_FOUND: 'The specified agent was not found.',
  DEADLINE_EXCEEDED: 'The mission deadline has passed.',
  DELEGATION_CYCLE: 'A delegation cycle was detected in the mission tree.',
  CYCLE_DETECTED: 'A dependency cycle was detected in the task graph.',
  TASK_LIMIT_EXCEEDED: 'Maximum task count exceeded.',
  INVALID_DEPENDENCY: 'Invalid task dependency specified.',
  MISSION_NOT_ACTIVE: 'The mission is not in an active state.',
  PLAN_REVISION_LIMIT: 'Maximum plan revision count exceeded.',
  DEPENDENCIES_UNMET: 'Task dependencies have not been satisfied.',
  CAPABILITY_DENIED: 'Capability request was denied.',
  WORKER_UNAVAILABLE: 'No worker is available for task execution.',
  TASK_NOT_PENDING: 'The task is not in a pending state.',
  STORAGE_EXCEEDED: 'Storage limit exceeded.',
  ARTIFACT_LIMIT_EXCEEDED: 'Artifact count limit exceeded.',
  NOT_FOUND: 'The requested resource was not found.',
  ARCHIVED: 'The requested resource has been archived.',
  INVALID_TYPE: 'Invalid event type.',
  MISSION_NOT_FOUND: 'The specified mission was not found.',
  SANDBOX_VIOLATION: 'Capability execution violated sandbox constraints.',
  PARENT_INSUFFICIENT: 'Parent mission has insufficient budget.',
  HUMAN_APPROVAL_REQUIRED: 'Human approval is required for this budget request.',
  JUSTIFICATION_REQUIRED: 'A justification is required for this budget request.',
  TASKS_INCOMPLETE: 'Cannot submit result: tasks are incomplete.',
  NO_ARTIFACTS: 'Cannot submit result: no artifacts produced.',
  CHECKPOINT_EXPIRED: 'The checkpoint has expired.',
  INVALID_PLAN: 'The plan revision is invalid.',
  // Phase 0A governance error codes
  LIFECYCLE_INVALID_TRANSITION: 'Invalid lifecycle state transition.',
  SUSPENSION_ACTIVE: 'Operation is blocked by an active suspension.',
  SUSPENSION_NOT_FOUND: 'The referenced suspension record was not found.',
  AUTHORITY_INSUFFICIENT: 'Insufficient authority for this operation.',
  AUTHORITY_SCOPE_EXCEEDED: 'Action exceeds the caller\'s authority scope.',
  HARD_POLICY_VIOLATION: 'A hard policy constraint was violated.',
  SOFT_POLICY_VIOLATION: 'A soft policy constraint was violated.',
  DECISION_CONFLICT: 'A conflicting supervisor decision exists.',
  CONTRACT_UNSATISFIED: 'Mission contract criteria have not been met.',
  HANDOFF_REJECTED: 'The handoff was rejected by the delegate.',
  ATTEMPT_EXHAUSTED: 'Maximum retry attempts have been exhausted.',
  TRACE_EMISSION_FAILED: 'Trace event emission failed.',
  EVAL_GATE_FAILED: 'Evaluation gate blocked completion.',
  MANIFEST_TRUST_VIOLATION: 'Capability manifest trust tier violation.',
  RESUME_TOKEN_INVALID: 'The resume token is invalid or has been consumed.',
  RESUME_TOKEN_EXPIRED: 'The resume token has expired.',
  IDEMPOTENCY_CONFLICT: 'Same idempotency key with different payload.',
  NOT_IMPLEMENTED: 'This method is not yet implemented.',
};

// ============================================================================
// Retryability Classification
// ============================================================================

/**
 * Error codes that indicate the operation may succeed on retry.
 * Derived from the nature of each error per spec sections.
 *
 * S36: RATE_LIMITED is retryable after cooldown.
 * S27: TIMEOUT is retryable (transient).
 * FM-06: PROVIDER_UNAVAILABLE is retryable (provider may recover).
 * S17: WORKER_UNAVAILABLE is retryable (worker may become free).
 */
const RETRYABLE_CODES: ReadonlySet<LimenErrorCode> = new Set([
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'WORKER_UNAVAILABLE',
]);

// ============================================================================
// LimenError Class
// ============================================================================

/**
 * S39 IP-4, SD-02: Public API error.
 * Extends Error for standard catch semantics.
 * Internal details (stack traces, SQL errors, file paths) are NEVER exposed.
 *
 * All public API methods throw this type. Internal Result<T> errors are mapped
 * to LimenError at the API boundary (FPD-3).
 *
 * S ref: §6.13, S39 IP-4, SD-02
 */
export class LimenError extends Error {
  readonly code: LimenErrorCode;
  readonly retryable: boolean;
  readonly cooldownMs?: number;
  readonly suggestion?: string;
  /** Phase 0A: Governance violations that triggered this error (BC-080) */
  readonly violations?: readonly LimenViolation[];

  constructor(
    code: LimenErrorCode,
    message: string,
    options?: {
      readonly cooldownMs?: number;
      readonly suggestion?: string;
      readonly violations?: readonly LimenViolation[];
      readonly debug?: boolean;
    },
  ) {
    // S39 IP-4: Sanitize message to remove any internal details (unless debug mode)
    const safeMessage = options?.debug ? message : sanitizeMessage(code, message);
    super(safeMessage);

    this.name = 'LimenError';
    this.code = code;
    this.message = safeMessage;
    this.retryable = RETRYABLE_CODES.has(code);

    if (options?.cooldownMs !== undefined) {
      this.cooldownMs = options.cooldownMs;
    }

    if (options?.suggestion !== undefined) {
      this.suggestion = options.suggestion;
    }

    if (options?.violations !== undefined) {
      this.violations = options.violations;
    }

    // S39 IP-4: Redact the stack trace. Internal file paths must never leak.
    // In debug mode, preserve the original JS stack trace for diagnostics.
    if (!options?.debug) {
      this.stack = `LimenError [${code}]: ${safeMessage}`;
    }
  }
}

// ============================================================================
// Error Mapping Utilities
// ============================================================================

/**
 * S39 IP-4: Known kernel error codes mapped to public LimenErrorCode.
 * L1/L1.5/L2 use KernelError with string codes.
 * At the API boundary, we map to the LimenErrorCode union.
 *
 * Mapping strategy:
 *   - Exact match: kernel code IS a LimenErrorCode -> pass through
 *   - Common internal patterns -> map to closest LimenErrorCode
 *   - Unknown -> ENGINE_UNHEALTHY (safe catch-all, never exposes internals)
 */
const KERNEL_CODE_MAP: Readonly<Record<string, LimenErrorCode>> = {
  // Direct matches (kernel codes that ARE LimenErrorCodes)
  BUDGET_EXCEEDED: 'BUDGET_EXCEEDED',
  DEPTH_EXCEEDED: 'DEPTH_EXCEEDED',
  CHILDREN_EXCEEDED: 'CHILDREN_EXCEEDED',
  TREE_SIZE_EXCEEDED: 'TREE_SIZE_EXCEEDED',
  CAPABILITY_VIOLATION: 'CAPABILITY_VIOLATION',
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',
  DEADLINE_EXCEEDED: 'DEADLINE_EXCEEDED',
  DELEGATION_CYCLE: 'DELEGATION_CYCLE',
  CYCLE_DETECTED: 'CYCLE_DETECTED',
  TASK_LIMIT_EXCEEDED: 'TASK_LIMIT_EXCEEDED',
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  MISSION_NOT_ACTIVE: 'MISSION_NOT_ACTIVE',
  PLAN_REVISION_LIMIT: 'PLAN_REVISION_LIMIT',
  DEPENDENCIES_UNMET: 'DEPENDENCIES_UNMET',
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',
  WORKER_UNAVAILABLE: 'WORKER_UNAVAILABLE',
  TASK_NOT_PENDING: 'TASK_NOT_PENDING',
  STORAGE_EXCEEDED: 'STORAGE_EXCEEDED',
  ARTIFACT_LIMIT_EXCEEDED: 'ARTIFACT_LIMIT_EXCEEDED',
  NOT_FOUND: 'NOT_FOUND',
  ARCHIVED: 'ARCHIVED',
  INVALID_TYPE: 'INVALID_TYPE',
  MISSION_NOT_FOUND: 'MISSION_NOT_FOUND',
  SANDBOX_VIOLATION: 'SANDBOX_VIOLATION',
  PARENT_INSUFFICIENT: 'PARENT_INSUFFICIENT',
  HUMAN_APPROVAL_REQUIRED: 'HUMAN_APPROVAL_REQUIRED',
  JUSTIFICATION_REQUIRED: 'JUSTIFICATION_REQUIRED',
  TASKS_INCOMPLETE: 'TASKS_INCOMPLETE',
  NO_ARTIFACTS: 'NO_ARTIFACTS',
  CHECKPOINT_EXPIRED: 'CHECKPOINT_EXPIRED',
  INVALID_PLAN: 'INVALID_PLAN',

  // Kernel-specific codes mapped to API equivalents
  UNAUTHORIZED: 'UNAUTHORIZED',
  PERMISSION_DENIED: 'UNAUTHORIZED',
  RBAC_DENIED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMITED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'TIMEOUT',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_NOT_FOUND',
  INVALID_CONFIG: 'INVALID_CONFIG',
  INVALID_INPUT: 'INVALID_INPUT',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  // Phase 0A governance code mappings
  LIFECYCLE_INVALID_TRANSITION: 'LIFECYCLE_INVALID_TRANSITION',
  SUSPENSION_ACTIVE: 'SUSPENSION_ACTIVE',
  SUSPENSION_NOT_FOUND: 'SUSPENSION_NOT_FOUND',
  AUTHORITY_INSUFFICIENT: 'AUTHORITY_INSUFFICIENT',
  AUTHORITY_SCOPE_EXCEEDED: 'AUTHORITY_SCOPE_EXCEEDED',
  HARD_POLICY_VIOLATION: 'HARD_POLICY_VIOLATION',
  SOFT_POLICY_VIOLATION: 'SOFT_POLICY_VIOLATION',
  DECISION_CONFLICT: 'DECISION_CONFLICT',
  CONTRACT_UNSATISFIED: 'CONTRACT_UNSATISFIED',
  HANDOFF_REJECTED: 'HANDOFF_REJECTED',
  ATTEMPT_EXHAUSTED: 'ATTEMPT_EXHAUSTED',
  TRACE_EMISSION_FAILED: 'TRACE_EMISSION_FAILED',
  EVAL_GATE_FAILED: 'EVAL_GATE_FAILED',
  MANIFEST_TRUST_VIOLATION: 'MANIFEST_TRUST_VIOLATION',
  RESUME_TOKEN_INVALID: 'RESUME_TOKEN_INVALID',
  RESUME_TOKEN_EXPIRED: 'RESUME_TOKEN_EXPIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
};

/**
 * S39 IP-4, FPD-3: Map a kernel/orchestration Result<T> error to a LimenError.
 *
 * This is the API boundary error transformation.
 * Internal KernelError details are redacted. Only the machine-readable code
 * and a sanitized message are exposed to consumers.
 *
 * @param error - The internal KernelError from L1/L1.5/L2
 * @returns LimenError ready to throw to consumers
 */
/**
 * Helpful suggestion messages for common error codes.
 * Populated in LimenError.suggestion to guide consumers toward resolution.
 */
const SUGGESTION_MAP: Partial<Record<LimenErrorCode, string>> = {
  INVALID_INPUT: 'Check the input parameters match the expected types and formats.',
  BUDGET_EXCEEDED: 'Increase budget limits or wait for the current window to reset.',
  UNAUTHORIZED: 'The agent does not have the required permission. Check RBAC configuration.',
  RATE_LIMITED: 'Too many requests. Wait for the rate limit window to reset.',
  ENGINE_UNHEALTHY: 'Check that dataDir is writable and the database is not corrupted.',
};

export function mapKernelError(error: KernelError, debug?: boolean): LimenError {
  const code: LimenErrorCode = KERNEL_CODE_MAP[error.code] ?? 'ENGINE_UNHEALTHY';
  const message = debug ? error.message : sanitizeMessage(code, error.message);
  const suggestion = SUGGESTION_MAP[code];

  const opts: {
    readonly suggestion?: string;
    readonly debug?: boolean;
  } = {
    ...(suggestion !== undefined ? { suggestion } : {}),
    ...(debug !== undefined ? { debug } : {}),
  };

  return new LimenError(code, message, opts);
}

/**
 * S39 IP-4, SD-02: Unwrap a Result<T> or throw LimenError.
 *
 * Convenience function for the common pattern:
 *   const result = await orchestration.someCall(ctx, input);
 *   const value = unwrapResult(result);
 *
 * If the Result is ok, returns the value.
 * If the Result is not ok, maps the KernelError and throws LimenError.
 *
 * @param result - The internal Result<T> from L1/L1.5/L2
 * @returns The unwrapped value of type T
 * @throws LimenError if result.ok is false
 */
export function unwrapResult<T>(result: Result<T>, debug?: boolean): T {
  if (result.ok) {
    return result.value;
  }
  throw mapKernelError(result.error, debug);
}

/**
 * S39 IP-4: Guard function that ensures any thrown error is a LimenError.
 *
 * If the caught error is already a LimenError, re-throw as-is.
 * If it's a standard Error, map to ENGINE_UNHEALTHY with redacted message.
 * If it's something else entirely, map to ENGINE_UNHEALTHY with generic message.
 *
 * Usage:
 *   try { ... } catch (e) { throw ensureLimenError(e); }
 *
 * This guarantees SD-02: all public methods throw LimenError, never raw errors.
 */
export function ensureLimenError(error: unknown, debug?: boolean): LimenError {
  if (error instanceof LimenError) {
    return error;
  }

  if (debug && error instanceof Error) {
    // Debug mode: preserve original message and cause chain for diagnostics.
    const le = new LimenError('ENGINE_UNHEALTHY', error.message, { debug });
    le.cause = error;
    return le;
  }

  if (error instanceof Error) {
    // S39 IP-4: Do not expose the original error message -- it may contain internals
    return new LimenError('ENGINE_UNHEALTHY', 'An internal error occurred.');
  }

  return new LimenError('ENGINE_UNHEALTHY', 'An internal error occurred.');
}
