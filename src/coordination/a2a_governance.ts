// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * FR-002: A2A Governance Block Schema — Hand-written validation for inter-agent governance.
 *
 * Defines 4 validators for A2A governance data standardization:
 * - GovernanceBlock: Provider-level governance metadata (extends Agent Card concept)
 * - CapabilityBoundary: Per-skill authorization boundaries
 * - DataClassification: Data handling rules per classification level
 * - ProactiveRule: Autonomous inter-agent action rules with governance constraints
 *
 * Design decisions:
 * - Strict validation on all schemas: unknown fields are rejected, not silently dropped.
 * - Validators return Result<void> to match Limen's error model.
 * - GovernanceBlock stored as a single claim with subject 'entity:governance:block'.
 * - ProactiveRules stored as individual claims for independent lifecycle management.
 * - Zero external dependencies: hand-written validators replace Zod (1-dependency promise).
 *
 * Spec ref: v4.0.0 Phase 7 FR-002
 * QAL: 3 (Governance integrity. Failure = unauthorized inter-agent actions.)
 */

import type { Result } from '../kernel/interfaces/index.js';

// ============================================================================
// Validation Internals
// ============================================================================

type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

function assertObject(value: unknown): ValidationResult<Record<string, unknown>> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, errors: ['Expected an object'] };
  }
  return { success: true, data: value as Record<string, unknown> };
}

function unknownKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  const extra: string[] = [];
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) extra.push(key);
  }
  return extra;
}

function requireString(obj: Record<string, unknown>, field: string, minLen = 1): string | null {
  const v = obj[field];
  if (typeof v !== 'string') return `${field} must be a string`;
  if (v.length < minLen) return `${field} must be at least ${minLen} character(s)`;
  return null;
}

function requireNumber(obj: Record<string, unknown>, field: string, opts?: { min?: number; max?: number; int?: boolean }): string | null {
  const v = obj[field];
  if (typeof v !== 'number' || Number.isNaN(v)) return `${field} must be a number`;
  if (opts?.int && !Number.isInteger(v)) return `${field} must be an integer`;
  if (opts?.min !== undefined && v < opts.min) return `${field} must be >= ${opts.min}`;
  if (opts?.max !== undefined && v > opts.max) return `${field} must be <= ${opts.max}`;
  return null;
}

function requireBoolean(obj: Record<string, unknown>, field: string): string | null {
  if (typeof obj[field] !== 'boolean') return `${field} must be a boolean`;
  return null;
}

function requireEnum(obj: Record<string, unknown>, field: string, values: readonly string[]): string | null {
  const v = obj[field];
  if (typeof v !== 'string' || !values.includes(v)) return `${field} must be one of: ${values.join(', ')}`;
  return null;
}

function requireLiteral(obj: Record<string, unknown>, field: string, expected: string): string | null {
  if (obj[field] !== expected) return `${field} must be "${expected}"`;
  return null;
}

function requireStringArray(obj: Record<string, unknown>, field: string, opts?: { minLen?: number; minItems?: number }): string | null {
  const v = obj[field];
  if (!Array.isArray(v)) return `${field} must be an array`;
  if (opts?.minItems !== undefined && v.length < opts.minItems) return `${field} must have at least ${opts.minItems} item(s)`;
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string') return `${field}[${i}] must be a string`;
    if (opts?.minLen !== undefined && (v[i] as string).length < opts.minLen) return `${field}[${i}] must be at least ${opts.minLen} character(s)`;
  }
  return null;
}

// ============================================================================
// A2A Governance Block Type + Validator
// ============================================================================

/**
 * A2A Governance Block — provider-level governance metadata.
 * Extends the Agent Card concept with governance constraints.
 */
export interface GovernanceBlock {
  readonly provider: 'limen';
  readonly version: string;
  readonly dataResidency: string[];
  readonly piiHandling: 'masked' | 'redacted' | 'allowed';
  readonly auditTrail: boolean;
  readonly compliance: string[];
  readonly maxConfidence: number;
}

const GOVERNANCE_BLOCK_KEYS = new Set([
  'provider', 'version', 'dataResidency', 'piiHandling',
  'auditTrail', 'compliance', 'maxConfidence',
]);

function validateGovernanceBlockInternal(value: unknown): ValidationResult<GovernanceBlock> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult as ValidationResult<GovernanceBlock>;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, GOVERNANCE_BLOCK_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireLiteral(obj, 'provider', 'limen'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'version'); if (e2) errors.push(e2);
  const e3 = requireStringArray(obj, 'dataResidency', { minLen: 1, minItems: 1 }); if (e3) errors.push(e3);
  const e4 = requireEnum(obj, 'piiHandling', ['masked', 'redacted', 'allowed'] as const); if (e4) errors.push(e4);
  const e5 = requireBoolean(obj, 'auditTrail'); if (e5) errors.push(e5);
  const e6 = requireStringArray(obj, 'compliance'); if (e6) errors.push(e6);
  const e7 = requireNumber(obj, 'maxConfidence', { min: 0, max: 1 }); if (e7) errors.push(e7);
  return errors.length
    ? { success: false, errors }
    : { success: true, data: obj as unknown as GovernanceBlock };
}

// ============================================================================
// Capability Boundary Type + Validator
// ============================================================================

/**
 * Capability Boundary — per-skill authorization rules.
 */
export interface CapabilityBoundary {
  readonly skillId: string;
  readonly clearanceRequired: 'public' | 'confidential' | 'secret';
  readonly dataFieldsAllowed: string[];
  readonly dataFieldsMasked: string[];
  readonly rateLimit?: { readonly callsPerMinute: number };
}

const CAPABILITY_BOUNDARY_KEYS = new Set([
  'skillId', 'clearanceRequired', 'dataFieldsAllowed',
  'dataFieldsMasked', 'rateLimit',
]);
const RATE_LIMIT_KEYS = new Set(['callsPerMinute']);

function validateCapabilityBoundaryInternal(value: unknown): ValidationResult<CapabilityBoundary> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult as ValidationResult<CapabilityBoundary>;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, CAPABILITY_BOUNDARY_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'skillId'); if (e1) errors.push(e1);
  const e2 = requireEnum(obj, 'clearanceRequired', ['public', 'confidential', 'secret'] as const); if (e2) errors.push(e2);
  const e3 = requireStringArray(obj, 'dataFieldsAllowed'); if (e3) errors.push(e3);
  const e4 = requireStringArray(obj, 'dataFieldsMasked'); if (e4) errors.push(e4);
  // rateLimit is optional
  if (obj.rateLimit !== undefined) {
    const rlResult = assertObject(obj.rateLimit);
    if (!rlResult.success) {
      errors.push('rateLimit must be an object');
    } else {
      const rl = rlResult.data;
      const rlExtra = unknownKeys(rl, RATE_LIMIT_KEYS);
      if (rlExtra.length) errors.push(`rateLimit: Unrecognized key(s): ${rlExtra.join(', ')}`);
      const e5 = requireNumber(rl, 'callsPerMinute', { int: true, min: 1 }); if (e5) errors.push(`rateLimit.${e5}`);
    }
  }
  return errors.length
    ? { success: false, errors }
    : { success: true, data: obj as unknown as CapabilityBoundary };
}

// ============================================================================
// Data Classification Type + Validator
// ============================================================================

/**
 * Data Classification — data handling rules per classification level.
 */
export interface DataClassification {
  readonly level: 'public' | 'confidential' | 'secret' | 'internal_only';
  readonly appliesTo: string;
  readonly rule: 'allow' | 'mask' | 'redact' | 'deny';
}

// (DataClassification validator exists for completeness though no public validate fn was exported)

// ============================================================================
// Proactive Rule Type + Validator
// ============================================================================

/**
 * Proactive Rule — autonomous inter-agent action rules with governance.
 */
export interface ProactiveRule {
  readonly id: string;
  readonly condition: string;
  readonly targetAgent: string;
  readonly action: string;
  readonly governance: {
    readonly dataShared: string[];
    readonly dataProhibited: string[];
  };
  readonly costCeiling: number;
  readonly cooldownSeconds: number;
  readonly approvedBy: string;
  readonly status: 'active' | 'suspended' | 'retired';
}

const PROACTIVE_RULE_KEYS = new Set([
  'id', 'condition', 'targetAgent', 'action', 'governance',
  'costCeiling', 'cooldownSeconds', 'approvedBy', 'status',
]);
const GOVERNANCE_SUB_KEYS = new Set(['dataShared', 'dataProhibited']);

function validateProactiveRuleInternal(value: unknown): ValidationResult<ProactiveRule> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult as ValidationResult<ProactiveRule>;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, PROACTIVE_RULE_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'id'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'condition'); if (e2) errors.push(e2);
  const e3 = requireString(obj, 'targetAgent'); if (e3) errors.push(e3);
  const e4 = requireString(obj, 'action'); if (e4) errors.push(e4);
  // governance sub-object
  if (obj.governance === undefined || obj.governance === null) {
    errors.push('governance is required');
  } else {
    const govResult = assertObject(obj.governance);
    if (!govResult.success) {
      errors.push('governance must be an object');
    } else {
      const gov = govResult.data;
      const govExtra = unknownKeys(gov, GOVERNANCE_SUB_KEYS);
      if (govExtra.length) errors.push(`governance: Unrecognized key(s): ${govExtra.join(', ')}`);
      const eg1 = requireStringArray(gov, 'dataShared'); if (eg1) errors.push(`governance.${eg1}`);
      const eg2 = requireStringArray(gov, 'dataProhibited'); if (eg2) errors.push(`governance.${eg2}`);
    }
  }
  const e5 = requireNumber(obj, 'costCeiling', { min: 0 }); if (e5) errors.push(e5);
  const e6 = requireNumber(obj, 'cooldownSeconds', { int: true, min: 0 }); if (e6) errors.push(e6);
  const e7 = requireString(obj, 'approvedBy'); if (e7) errors.push(e7);
  const e8 = requireEnum(obj, 'status', ['active', 'suspended', 'retired'] as const); if (e8) errors.push(e8);
  return errors.length
    ? { success: false, errors }
    : { success: true, data: obj as unknown as ProactiveRule };
}

// ============================================================================
// Validation Functions (Public API — Result<void>)
// ============================================================================

/**
 * Validate a governance block object against the schema.
 *
 * @param block - The governance block to validate
 * @returns Result<void> — ok if valid, error with details if not
 */
export function validateGovernanceBlock(block: unknown): Result<void> {
  const result = validateGovernanceBlockInternal(block);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_GOVERNANCE_BLOCK',
        message: `Governance block validation failed: ${result.errors.join('; ')}`,
        spec: 'FR-002',
      },
    };
  }
  return { ok: true, value: undefined };
}

/**
 * Validate a capability boundary object against the schema.
 *
 * @param boundary - The capability boundary to validate
 * @returns Result<void> — ok if valid, error with details if not
 */
export function validateCapabilityBoundary(boundary: unknown): Result<void> {
  const result = validateCapabilityBoundaryInternal(boundary);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CAPABILITY_BOUNDARY',
        message: `Capability boundary validation failed: ${result.errors.join('; ')}`,
        spec: 'FR-002',
      },
    };
  }
  return { ok: true, value: undefined };
}

/**
 * Validate a proactive rule object against the schema.
 *
 * @param rule - The proactive rule to validate
 * @returns Result<void> — ok if valid, error with details if not
 */
export function validateProactiveRule(rule: unknown): Result<void> {
  const result = validateProactiveRuleInternal(rule);
  if (!result.success) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PROACTIVE_RULE',
        message: `Proactive rule validation failed: ${result.errors.join('; ')}`,
        spec: 'FR-002',
      },
    };
  }
  return { ok: true, value: undefined };
}
