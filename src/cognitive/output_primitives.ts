// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * FR-001: Semantic Output Primitives for AAS Agent Output.
 *
 * Defines hand-written validation for 7 output primitive types that agents
 * produce as structured claims in Limen. Each primitive maps to an `output.*`
 * predicate namespace and enforces strict schema validation.
 *
 * Design decisions:
 * - Strict validation on all schemas: unknown fields are rejected, not silently dropped.
 *   This prevents schema evolution accidents where an agent sends v2 fields to a v1 engine.
 * - `validateOutputPrimitive()` returns Result<void> to match Limen's error model.
 * - The VALID_OUTPUT_PREDICATES set is the source of truth for namespace membership.
 * - Zero external dependencies: hand-written validators replace Zod (1-dependency promise).
 *
 * Spec ref: v4.0.0 Phase 4 FR-001
 * QAL: 3 (Knowledge integrity. Failure = corrupted intelligence.)
 */

import type { Result } from '../kernel/interfaces/index.js';

// ============================================================================
// Validation Internals
// ============================================================================

/** Internal validation result for composing validators. */
type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

/**
 * Assert `value` is a non-null object. Returns its keys for strict-mode checking.
 */
function assertObject(value: unknown): ValidationResult<Record<string, unknown>> {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return { success: false, errors: ['Expected an object'] };
  }
  return { success: true, data: value as Record<string, unknown> };
}

/**
 * Collect unknown keys that are not in `allowed`.
 */
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

function optionalNumber(obj: Record<string, unknown>, field: string): string | null {
  if (obj[field] === undefined) return null;
  return requireNumber(obj, field);
}

function optionalString(obj: Record<string, unknown>, field: string): string | null {
  if (obj[field] === undefined) return null;
  return requireString(obj, field, 1);
}

function optionalStringArray(obj: Record<string, unknown>, field: string): string | null {
  if (obj[field] === undefined) return null;
  if (!Array.isArray(obj[field])) return `${field} must be an array`;
  for (let i = 0; i < (obj[field] as unknown[]).length; i++) {
    if (typeof (obj[field] as unknown[])[i] !== 'string') return `${field}[${i}] must be a string`;
  }
  return null;
}

// ============================================================================
// Per-Schema Validators
// ============================================================================

type ValidatorFn = (value: unknown) => ValidationResult<unknown>;

const ASSERTION_KEYS = new Set(['content', 'confidence', 'verifiable']);
function validateAssertion(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, ASSERTION_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'content'); if (e1) errors.push(e1);
  const e2 = requireNumber(obj, 'confidence', { min: 0, max: 1 }); if (e2) errors.push(e2);
  const e3 = requireBoolean(obj, 'verifiable'); if (e3) errors.push(e3);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const JUDGMENT_KEYS = new Set(['subject', 'assessment', 'rationale', 'score']);
function validateJudgment(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, JUDGMENT_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'subject'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'assessment'); if (e2) errors.push(e2);
  const e3 = requireString(obj, 'rationale'); if (e3) errors.push(e3);
  const e4 = optionalNumber(obj, 'score'); if (e4) errors.push(e4);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const EVIDENCE_KEYS = new Set(['supports', 'data', 'source', 'freshness']);
function validateEvidence(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, EVIDENCE_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'supports'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'data'); if (e2) errors.push(e2);
  const e3 = requireString(obj, 'source'); if (e3) errors.push(e3);
  const e4 = requireEnum(obj, 'freshness', ['live', 'cached', 'historical'] as const); if (e4) errors.push(e4);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const ACTION_KEYS = new Set(['description', 'rationale', 'urgency', 'reversible', 'requires_approval']);
function validateAction(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, ACTION_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'description'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'rationale'); if (e2) errors.push(e2);
  const e3 = requireEnum(obj, 'urgency', ['immediate', 'soon', 'background'] as const); if (e3) errors.push(e3);
  const e4 = requireBoolean(obj, 'reversible'); if (e4) errors.push(e4);
  const e5 = requireBoolean(obj, 'requires_approval'); if (e5) errors.push(e5);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const QUESTION_KEYS = new Set(['question', 'context', 'blocking', 'options', 'default']);
function validateQuestion(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, QUESTION_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'question'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'context'); if (e2) errors.push(e2);
  const e3 = requireBoolean(obj, 'blocking'); if (e3) errors.push(e3);
  const e4 = optionalStringArray(obj, 'options'); if (e4) errors.push(e4);
  const e5 = optionalString(obj, 'default'); if (e5) errors.push(e5);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const ALERT_KEYS = new Set(['severity', 'subject', 'details', 'action_required']);
function validateAlert(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, ALERT_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireEnum(obj, 'severity', ['info', 'warning', 'critical'] as const); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'subject'); if (e2) errors.push(e2);
  const e3 = requireString(obj, 'details'); if (e3) errors.push(e3);
  const e4 = requireBoolean(obj, 'action_required'); if (e4) errors.push(e4);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

const NARRATIVE_KEYS = new Set(['topic', 'content', 'audience', 'depth']);
function validateNarrative(value: unknown): ValidationResult<unknown> {
  const objResult = assertObject(value);
  if (!objResult.success) return objResult;
  const obj = objResult.data;
  const errors: string[] = [];
  const extra = unknownKeys(obj, NARRATIVE_KEYS);
  if (extra.length) errors.push(`Unrecognized key(s): ${extra.join(', ')}`);
  const e1 = requireString(obj, 'topic'); if (e1) errors.push(e1);
  const e2 = requireString(obj, 'content'); if (e2) errors.push(e2);
  const e3 = requireEnum(obj, 'audience', ['technical', 'business', 'general'] as const); if (e3) errors.push(e3);
  const e4 = requireEnum(obj, 'depth', ['brief', 'moderate', 'detailed'] as const); if (e4) errors.push(e4);
  return errors.length ? { success: false, errors } : { success: true, data: obj };
}

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Map from output.* predicate to its validator function.
 * This is the single source of truth for which predicates are valid output types
 * and what shape they require.
 */
const OUTPUT_PRIMITIVE_VALIDATORS: Readonly<Record<string, ValidatorFn>> = {
  'output.assertion': validateAssertion,
  'output.judgment': validateJudgment,
  'output.evidence': validateEvidence,
  'output.action': validateAction,
  'output.question': validateQuestion,
  'output.alert': validateAlert,
  'output.narrative': validateNarrative,
};

/**
 * Set of valid output.* predicates for fast membership checks.
 */
export const VALID_OUTPUT_PREDICATES = new Set(Object.keys(OUTPUT_PRIMITIVE_VALIDATORS));

/**
 * Check if a predicate belongs to the output.* namespace.
 */
export function isOutputPredicate(predicate: string): boolean {
  return predicate.startsWith('output.');
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate that a value conforms to the schema for the given output predicate.
 *
 * The value should be the parsed object (not a JSON string).
 *
 * Returns Result<void>:
 * - ok: true if valid
 * - error: { code: 'INVALID_OUTPUT_PRIMITIVE', message: details }
 *   if the predicate is unknown or the value doesn't match the schema
 *
 * @param predicate - The full predicate (e.g. 'output.judgment')
 * @param value - The parsed primitive object to validate
 */
export function validateOutputPrimitive(predicate: string, value: unknown): Result<void> {
  // Check namespace membership
  if (!isOutputPredicate(predicate)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_OUTPUT_PRIMITIVE',
        message: `Predicate "${predicate}" is not in the output.* namespace`,
        spec: 'FR-001',
      },
    };
  }

  // Check if known output type
  const validator = OUTPUT_PRIMITIVE_VALIDATORS[predicate];
  if (!validator) {
    return {
      ok: false,
      error: {
        code: 'UNKNOWN_OUTPUT_PREDICATE',
        message: `Unknown output predicate: "${predicate}". Valid types: ${[...VALID_OUTPUT_PREDICATES].join(', ')}`,
        spec: 'FR-001',
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
        code: 'INVALID_OUTPUT_PRIMITIVE',
        message: `Output primitive validation failed for "${predicate}": ${issues}`,
        spec: 'FR-001',
      },
    };
  }

  return { ok: true, value: undefined };
}
