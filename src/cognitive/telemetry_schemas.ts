// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * FR-004: Telemetry Schemas — Hand-written validation for operational telemetry data.
 *
 * Defines 3 validators for telemetry data standardization:
 * - telemetry.cost: Cost ledger entries (model, tokens, cost, purpose)
 * - telemetry.vital: Operational vital signals (contextPct, quality, costRate)
 * - telemetry.audit: Audit trail entries (action, target, authorized)
 *
 * Design decisions:
 * - Strict validation on all schemas: unknown fields are rejected, not silently dropped.
 *   This prevents schema evolution accidents where an agent sends v2 fields to a v1 engine.
 * - `validateTelemetry()` returns Result<void> to match Limen's error model.
 * - The VALID_TELEMETRY_PREDICATES set is the source of truth for namespace membership.
 * - Follows the FR-001 output_primitives pattern for consistency.
 * - Zero external dependencies: hand-written validators replace Zod (1-dependency promise).
 *
 * Spec ref: v4.0.0 Phase 7 FR-004
 * QAL: 3 (Knowledge integrity. Failure = corrupted telemetry data.)
 */

import type { Result } from '../kernel/interfaces/index.js';

// ============================================================================
// Validation Internals
// ============================================================================

/** Internal validation result for composing validators. */
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

// ============================================================================
// Per-Schema Validators
// ============================================================================

type ValidatorFn = (value: unknown) => ValidationResult<unknown>;

const COST_KEYS = new Set(['model', 'tokens', 'cost', 'purpose']);
function validateCost(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, COST_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'model'); if (e1) errors.push(e1);
  const e2 = requireNumber(obj, 'tokens', { int: true, min: 0 }); if (e2) errors.push(e2);
  const e3 = requireNumber(obj, 'cost', { min: 0 }); if (e3) errors.push(e3);
  const e4 = requireEnum(obj, 'purpose', ['primary', 'fallback', 'routing'] as const); if (e4) errors.push(e4);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const VITAL_KEYS = new Set(['contextPct', 'quality', 'costRate']);
function validateVital(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, VITAL_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireNumber(obj, 'contextPct', { min: 0, max: 100 }); if (e1) errors.push(e1);
  const e2 = requireEnum(obj, 'quality', ['OK', 'DEGRADED', 'CRITICAL'] as const); if (e2) errors.push(e2);
  const e3 = requireNumber(obj, 'costRate', { min: 0 }); if (e3) errors.push(e3);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const AUDIT_KEYS = new Set(['action', 'target', 'authorized']);
function validateAudit(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, AUDIT_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'action'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'target'); if (e2) errors.push(e2);
  const e3 = requireBoolean(obj, 'authorized'); if (e3) errors.push(e3);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Map from telemetry.* predicate to its validator function.
 * This is the single source of truth for which predicates are valid telemetry types
 * and what shape they require.
 */
const TELEMETRY_VALIDATORS: Readonly<Record<string, ValidatorFn>> = {
  'telemetry.cost': validateCost,
  'telemetry.vital': validateVital,
  'telemetry.audit': validateAudit,
};

/**
 * Set of valid telemetry.* predicates for fast membership checks.
 */
export const VALID_TELEMETRY_PREDICATES = new Set(Object.keys(TELEMETRY_VALIDATORS));

/**
 * Check if a predicate belongs to the telemetry.* namespace.
 */
export function isTelemetryPredicate(predicate: string): boolean {
  return predicate.startsWith('telemetry.');
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that a value conforms to the schema for the given telemetry predicate.
 *
 * The value should be the parsed object (not a JSON string).
 *
 * Returns Result<void>:
 * - ok: true if valid
 * - error: { code: 'INVALID_TELEMETRY', message: details }
 *   if the predicate is unknown or the value doesn't match the schema
 *
 * @param predicate - The full predicate (e.g. 'telemetry.cost')
 * @param value - The parsed telemetry object to validate
 */
export function validateTelemetry(predicate: string, value: unknown): Result<void> {
  // Check namespace membership
  if (!isTelemetryPredicate(predicate)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_TELEMETRY',
        message: `Predicate "${predicate}" is not in the telemetry.* namespace`,
        spec: 'FR-004',
      },
    };
  }

  // Check if known telemetry type
  const validator = TELEMETRY_VALIDATORS[predicate];
  if (!validator) {
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_TELEMETRY_PREDICATE',
        message: `Unknown telemetry predicate: "${predicate}". Valid types: ${[...VALID_TELEMETRY_PREDICATES].join(', ')}`,
        spec: 'FR-004',
      },
    };
  }

  // Validate against schema
  const result = validator(value);
  if (!result.success) {
    const issues = result.errors.join('; ');
    return {
      ok: false,
      error: {
        code: 'INVALID_TELEMETRY',
        message: `Telemetry validation failed for "${predicate}": ${issues}`,
        spec: 'FR-004',
      },
    };
  }

  return { ok: true, value: undefined };
}
