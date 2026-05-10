// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/AGENT_OUTPUT_GOVERNANCE.md §9
/**
 * Output Governance Error Types
 *
 * All error types derived from AGENT_OUTPUT_GOVERNANCE contract §9.
 * Implements: OG-9.1 through OG-9.15
 *
 * Discriminated union via `code` field.
 * Every error carries a `spec` field referencing the contract section.
 */

import type { GovernanceDecision } from '../adapters/shared/types.js';
import type { ValidationError, HookType } from './output_types.js';

// ============================================================================
// §9: OutputValidationViolation (OG-9.15)
// ============================================================================

/** OG-9.15: Validation violation detail */
export interface OutputValidationViolation {
  readonly field: string;
  readonly constraint: string;
  readonly actual: string;
}

// ============================================================================
// §9: OutputGovernanceError — Discriminated Union (OG-9.1 through OG-9.14)
// ============================================================================

/** OG-9.1 through OG-9.14: All output governance error types */
export type OutputGovernanceError =
  | { readonly code: 'OUTPUT_VALIDATION_FAILED'; readonly message: string; readonly spec: 'AOG-4'; readonly violations: readonly OutputValidationViolation[] }
  | { readonly code: 'OUTPUT_CONTENT_EMPTY'; readonly message: string; readonly spec: 'AOG-4.3' }
  | { readonly code: 'OUTPUT_CONTENT_TOO_LARGE'; readonly message: string; readonly spec: 'AOG-4.3'; readonly maxBytes: number }
  | { readonly code: 'INFERENCE_TIMEOUT'; readonly message: string; readonly spec: 'AOG-6.1'; readonly timeoutMs: number; readonly elapsed: number }
  | { readonly code: 'INFERENCE_SCHEMA_VIOLATION'; readonly message: string; readonly spec: 'AOG-6.3'; readonly errors: readonly ValidationError[] }
  | { readonly code: 'INFERENCE_RETRIES_EXHAUSTED'; readonly message: string; readonly spec: 'AOG-6.4'; readonly attempts: number; readonly errors: readonly ValidationError[] }
  | { readonly code: 'PLUGIN_INSTALL_FAILED'; readonly message: string; readonly spec: 'AOG-7.1'; readonly pluginId: string; readonly reason: string }
  | { readonly code: 'PLUGIN_NOT_FOUND'; readonly message: string; readonly spec: 'AOG-7.4'; readonly pluginId: string }
  | { readonly code: 'PLUGIN_CAPABILITY_DENIED'; readonly message: string; readonly spec: 'AOG-7.1'; readonly required: readonly string[]; readonly available: readonly string[] }
  | { readonly code: 'HOOK_EXECUTION_FAILED'; readonly message: string; readonly spec: 'AOG-7.7'; readonly hookId: string; readonly error: string }
  | { readonly code: 'HOOK_BLOCKED_OPERATION'; readonly message: string; readonly spec: 'AOG-7.7'; readonly hookId: string; readonly hookType: HookType; readonly reason: string }
  | { readonly code: 'HOOK_NOT_FOUND'; readonly message: string; readonly spec: 'AOG-7.8'; readonly hookId: string }
  | { readonly code: 'TELEMETRY_WRITE_FAILED'; readonly message: string; readonly spec: 'AOG-5'; readonly reason: string }
  | { readonly code: 'GOVERNANCE_REFUSAL'; readonly message: string; readonly spec: 'AOG-12'; readonly decision: GovernanceDecision };

// ============================================================================
// Error Factory Functions
// ============================================================================

export function outputValidationFailed(violations: readonly OutputValidationViolation[]): OutputGovernanceError {
  return {
    code: 'OUTPUT_VALIDATION_FAILED',
    message: `Output validation failed: ${violations.length} violation(s)`,
    spec: 'AOG-4',
    violations,
  };
}

export function outputContentEmpty(): OutputGovernanceError {
  return {
    code: 'OUTPUT_CONTENT_EMPTY',
    message: 'Output content must be non-empty (min 1 character)',
    spec: 'AOG-4.3',
  };
}

export function outputContentTooLarge(maxBytes: number): OutputGovernanceError {
  return {
    code: 'OUTPUT_CONTENT_TOO_LARGE',
    message: `Output content exceeds maximum length of ${maxBytes} characters`,
    spec: 'AOG-4.3',
    maxBytes,
  };
}

export function inferenceTimeout(timeoutMs: number, elapsed: number): OutputGovernanceError {
  return {
    code: 'INFERENCE_TIMEOUT',
    message: `Inference timed out after ${elapsed}ms (limit: ${timeoutMs}ms)`,
    spec: 'AOG-6.1',
    timeoutMs,
    elapsed,
  };
}

export function inferenceSchemaViolation(errors: readonly ValidationError[]): OutputGovernanceError {
  return {
    code: 'INFERENCE_SCHEMA_VIOLATION',
    message: `Schema validation failed: ${errors.length} error(s)`,
    spec: 'AOG-6.3',
    errors,
  };
}

export function inferenceRetriesExhausted(attempts: number, errors: readonly ValidationError[]): OutputGovernanceError {
  return {
    code: 'INFERENCE_RETRIES_EXHAUSTED',
    message: `All ${attempts} inference attempts exhausted with ${errors.length} validation error(s)`,
    spec: 'AOG-6.4',
    attempts,
    errors,
  };
}

export function pluginInstallFailed(pluginId: string, reason: string): OutputGovernanceError {
  return {
    code: 'PLUGIN_INSTALL_FAILED',
    message: `Plugin installation failed: ${reason}`,
    spec: 'AOG-7.1',
    pluginId,
    reason,
  };
}

export function pluginNotFound(pluginId: string): OutputGovernanceError {
  return {
    code: 'PLUGIN_NOT_FOUND',
    message: `Plugin not found: ${pluginId}`,
    spec: 'AOG-7.4',
    pluginId,
  };
}

export function pluginCapabilityDenied(required: readonly string[], available: readonly string[]): OutputGovernanceError {
  return {
    code: 'PLUGIN_CAPABILITY_DENIED',
    message: `Plugin requires capabilities [${required.join(', ')}] but agent only has [${available.join(', ')}]`,
    spec: 'AOG-7.1',
    required,
    available,
  };
}

export function hookExecutionFailed(hookId: string, error: string): OutputGovernanceError {
  return {
    code: 'HOOK_EXECUTION_FAILED',
    message: `Hook execution failed: ${error}`,
    spec: 'AOG-7.7',
    hookId,
    error,
  };
}

export function hookBlockedOperation(hookId: string, hookType: HookType, reason: string): OutputGovernanceError {
  return {
    code: 'HOOK_BLOCKED_OPERATION',
    message: `Hook '${hookId}' (${hookType}) blocked operation: ${reason}`,
    spec: 'AOG-7.7',
    hookId,
    hookType,
    reason,
  };
}

export function hookNotFound(hookId: string): OutputGovernanceError {
  return {
    code: 'HOOK_NOT_FOUND',
    message: `Hook not found: ${hookId}`,
    spec: 'AOG-7.8',
    hookId,
  };
}

export function telemetryWriteFailed(reason: string): OutputGovernanceError {
  return {
    code: 'TELEMETRY_WRITE_FAILED',
    message: `Telemetry write failed: ${reason}`,
    spec: 'AOG-5',
    reason,
  };
}

export function governanceRefusal(decision: GovernanceDecision): OutputGovernanceError {
  return {
    code: 'GOVERNANCE_REFUSAL',
    message: `Operation refused by governance: ${decision.verdict}`,
    spec: 'AOG-12',
    decision,
  };
}
