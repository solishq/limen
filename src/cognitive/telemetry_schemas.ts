// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * FR-004: Telemetry Schemas — Zod validation for operational telemetry data.
 *
 * Defines 3 Zod schemas for telemetry data standardization:
 * - telemetry.cost: Cost ledger entries (model, tokens, cost, purpose)
 * - telemetry.vital: Operational vital signals (contextPct, quality, costRate)
 * - telemetry.audit: Audit trail entries (action, target, authorized)
 *
 * Design decisions:
 * - Zod `.strict()` on all schemas: unknown fields are rejected, not silently dropped.
 *   This prevents schema evolution accidents where an agent sends v2 fields to a v1 engine.
 * - `validateTelemetry()` returns Result<void> to match Limen's error model.
 * - The VALID_TELEMETRY_PREDICATES set is the source of truth for namespace membership.
 * - Follows the FR-001 output_primitives pattern for consistency.
 *
 * Spec ref: v4.0.0 Phase 7 FR-004
 * QAL: 3 (Knowledge integrity. Failure = corrupted telemetry data.)
 */

import { z } from 'zod';
import type { Result } from '../kernel/interfaces/index.js';

// ============================================================================
// Telemetry Schemas
// ============================================================================

/**
 * telemetry.cost — A cost ledger entry recording LLM/API consumption.
 */
export const TelemetryCostSchema = z.object({
  model: z.string().min(1),
  tokens: z.number().int().min(0),
  cost: z.number().min(0),
  purpose: z.enum(['primary', 'fallback', 'routing']),
}).strict();

/**
 * telemetry.vital — An operational vital signal snapshot.
 */
export const TelemetryVitalSchema = z.object({
  contextPct: z.number().min(0).max(100),
  quality: z.enum(['OK', 'DEGRADED', 'CRITICAL']),
  costRate: z.number().min(0),
}).strict();

/**
 * telemetry.audit — An audit trail entry recording an action.
 */
export const TelemetryAuditSchema = z.object({
  action: z.string().min(1),
  target: z.string().min(1),
  authorized: z.boolean(),
}).strict();

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Map from telemetry.* predicate to its Zod schema.
 * This is the single source of truth for which predicates are valid telemetry types
 * and what shape they require.
 */
export const TELEMETRY_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = {
  'telemetry.cost': TelemetryCostSchema,
  'telemetry.vital': TelemetryVitalSchema,
  'telemetry.audit': TelemetryAuditSchema,
};

/**
 * Set of valid telemetry.* predicates for fast membership checks.
 */
export const VALID_TELEMETRY_PREDICATES = new Set(Object.keys(TELEMETRY_SCHEMAS));

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
  const schema = TELEMETRY_SCHEMAS[predicate];
  if (!schema) {
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
  const parseResult = schema.safeParse(value);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
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
