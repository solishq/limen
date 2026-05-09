// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1
/**
 * Agent Lifecycle Error Types
 *
 * LM-9.01 through LM-9.16: 16 error types as discriminated union.
 * Each error carries context-specific fields for debugging.
 *
 * All errors map to KernelError { code, message, spec } for Result<T> compatibility.
 */

import type { Result } from '../adapters/shared/types.js';
import type { AgentState } from './lifecycle_types.js';

// ============================================================================
// Error Code Constants
// ============================================================================

export const LIFECYCLE_ERROR_CODES = {
  AGENT_NOT_FOUND: 'AGENT_NOT_FOUND',                       // LM-9.01
  AGENT_ALREADY_EXISTS: 'AGENT_ALREADY_EXISTS',             // LM-9.02
  AGENT_DECOMMISSIONED: 'AGENT_DECOMMISSIONED',             // LM-9.03
  AGENT_SUSPENDED: 'AGENT_SUSPENDED',                       // LM-9.04
  CAPABILITY_DENIED: 'CAPABILITY_DENIED',                   // LM-9.05
  PROMOTION_DENIED: 'PROMOTION_DENIED',                     // LM-9.06
  DEMOTION_BELOW_FLOOR: 'DEMOTION_BELOW_FLOOR',             // LM-9.07
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',                     // LM-9.08
  CONSENT_EXPIRED: 'CONSENT_EXPIRED',                       // LM-9.09
  CONSENT_NOT_FOUND: 'CONSENT_NOT_FOUND',                   // LM-9.10
  TRANSFER_DENIED: 'TRANSFER_DENIED',                       // LM-9.11
  IMPORT_INTEGRITY_FAILED: 'IMPORT_INTEGRITY_FAILED',       // LM-9.12
  CLASSIFICATION_EXCEEDED: 'CLASSIFICATION_EXCEEDED',       // LM-9.13
  TRUST_LEVEL_INSUFFICIENT: 'TRUST_LEVEL_INSUFFICIENT',     // LM-9.14
  GOVERNANCE_REFUSAL: 'GOVERNANCE_REFUSAL',                 // LM-9.15
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',     // LM-9.16
} as const;

export type LifecycleErrorCode = typeof LIFECYCLE_ERROR_CODES[keyof typeof LIFECYCLE_ERROR_CODES];

// ============================================================================
// Error Factory Functions
// ============================================================================

function lifecycleErr<T>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message, spec: 'AGENT_LIFECYCLE_MANAGEMENT' } };
}

/** LM-9.01: Agent not found */
export function agentNotFound<T>(agentId: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.AGENT_NOT_FOUND, `Agent '${agentId}' not found`);
}

/** LM-9.02: Agent already exists */
export function agentAlreadyExists<T>(name: string, framework: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.AGENT_ALREADY_EXISTS, `Agent '${name}' with framework '${framework}' already exists`);
}

/** LM-9.03: Agent decommissioned */
export function agentDecommissioned<T>(agentId: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.AGENT_DECOMMISSIONED, `Agent '${agentId}' is decommissioned`);
}

/** LM-9.04: Agent suspended */
export function agentSuspended<T>(agentId: string, reason: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.AGENT_SUSPENDED, `Agent '${agentId}' is suspended: ${reason}`);
}

/** LM-9.05: Capability denied */
export function capabilityDenied<T>(capability: string, reason: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.CAPABILITY_DENIED, `Capability '${capability}' denied: ${reason}`);
}

/** LM-9.06: Promotion denied */
export function promotionDenied<T>(targetLevel: string, reason: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.PROMOTION_DENIED, `Promotion to '${targetLevel}' denied: ${reason}`);
}

/** LM-9.07: Demotion below floor */
export function demotionBelowFloor<T>(agentId: string, currentLevel: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.DEMOTION_BELOW_FLOOR, `Cannot demote agent '${agentId}' below floor (current: '${currentLevel}')`);
}

/** LM-9.08: Consent required */
export function consentRequired<T>(operation: string, dataSubject: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.CONSENT_REQUIRED, `Consent required for operation '${operation}' on data subject '${dataSubject}'`);
}

/** LM-9.09: Consent expired */
export function consentExpired<T>(consentId: string, expiredAt: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.CONSENT_EXPIRED, `Consent '${consentId}' expired at ${expiredAt}`);
}

/** LM-9.10: Consent not found */
export function consentNotFound<T>(consentId: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.CONSENT_NOT_FOUND, `Consent '${consentId}' not found`);
}

/** LM-9.11: Transfer denied */
export function transferDenied<T>(reason: string, fromAgent: string, toAgent: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.TRANSFER_DENIED, `Transfer from '${fromAgent}' to '${toAgent}' denied: ${reason}`);
}

/** LM-9.12: Import integrity failed */
export function importIntegrityFailed<T>(expectedChecksum: string, actualChecksum: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.IMPORT_INTEGRITY_FAILED, `Import integrity check failed: expected '${expectedChecksum}', got '${actualChecksum}'`);
}

/** LM-9.13: Classification exceeded */
export function classificationExceeded<T>(agentLevel: number, dataLevel: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.CLASSIFICATION_EXCEEDED, `Agent clearance level ${agentLevel} insufficient for '${dataLevel}' data`);
}

/** LM-9.14: Trust level insufficient */
export function trustLevelInsufficient<T>(required: string, actual: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.TRUST_LEVEL_INSUFFICIENT, `Trust level insufficient: required '${required}', actual '${actual}'`);
}

/** LM-9.15: Governance refusal */
export function governanceRefusal<T>(reason: string, action: string): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.GOVERNANCE_REFUSAL, `Governance refusal for action '${action}': ${reason}`);
}

/** LM-9.16: Invalid state transition */
export function invalidStateTransition<T>(from: AgentState, to: AgentState): Result<T> {
  return lifecycleErr(LIFECYCLE_ERROR_CODES.INVALID_STATE_TRANSITION, `Invalid state transition from '${from}' to '${to}'`);
}

/** Generic ok result helper */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}
