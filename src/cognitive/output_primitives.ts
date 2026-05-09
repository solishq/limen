// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * FR-001: Semantic Output Primitives for AAS Agent Output.
 *
 * Defines Zod validation schemas for 7 output primitive types that agents
 * produce as structured claims in Limen. Each primitive maps to an `output.*`
 * predicate namespace and enforces strict schema validation.
 *
 * Design decisions:
 * - Zod `.strict()` on all schemas: unknown fields are rejected, not silently dropped.
 *   This prevents schema evolution accidents where an agent sends v2 fields to a v1 engine.
 * - `validateOutputPrimitive()` returns Result<void> to match Limen's error model.
 * - The VALID_OUTPUT_PREDICATES set is the source of truth for namespace membership.
 *
 * Spec ref: v4.0.0 Phase 4 FR-001
 * QAL: 3 (Knowledge integrity. Failure = corrupted intelligence.)
 */

import { z } from 'zod';
import type { Result } from '../kernel/interfaces/index.js';

// ============================================================================
// Output Primitive Schemas
// ============================================================================

/**
 * output.assertion — A factual claim an agent asserts to be true.
 */
export const AssertionPrimitiveSchema = z.object({
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  verifiable: z.boolean(),
}).strict();

/**
 * output.judgment — An evaluative assessment of a subject.
 */
export const JudgmentPrimitiveSchema = z.object({
  subject: z.string().min(1),
  assessment: z.string().min(1),
  rationale: z.string().min(1),
  score: z.number().optional(),
}).strict();

/**
 * output.evidence — Supporting data for another claim.
 */
export const EvidencePrimitiveSchema = z.object({
  supports: z.string().min(1),     // claimId reference
  data: z.string().min(1),
  source: z.string().min(1),
  freshness: z.enum(['live', 'cached', 'historical']),
}).strict();

/**
 * output.action — A proposed or executed action.
 */
export const ActionPrimitiveSchema = z.object({
  description: z.string().min(1),
  rationale: z.string().min(1),
  urgency: z.enum(['immediate', 'soon', 'background']),
  reversible: z.boolean(),
  requires_approval: z.boolean(),
}).strict();

/**
 * output.question — A question requiring human or agent input.
 */
export const QuestionPrimitiveSchema = z.object({
  question: z.string().min(1),
  context: z.string().min(1),
  blocking: z.boolean(),
  options: z.array(z.string()).optional(),
  default: z.string().optional(),
}).strict();

/**
 * output.alert — A notification about a condition requiring attention.
 */
export const AlertPrimitiveSchema = z.object({
  severity: z.enum(['info', 'warning', 'critical']),
  subject: z.string().min(1),
  details: z.string().min(1),
  action_required: z.boolean(),
}).strict();

/**
 * output.narrative — Structured content for communication.
 */
export const NarrativePrimitiveSchema = z.object({
  topic: z.string().min(1),
  content: z.string().min(1),
  audience: z.enum(['technical', 'business', 'general']),
  depth: z.enum(['brief', 'moderate', 'detailed']),
}).strict();

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Map from output.* predicate to its Zod schema.
 * This is the single source of truth for which predicates are valid output types
 * and what shape they require.
 */
export const OUTPUT_PRIMITIVE_SCHEMAS: Readonly<Record<string, z.ZodTypeAny>> = {
  'output.assertion': AssertionPrimitiveSchema,
  'output.judgment': JudgmentPrimitiveSchema,
  'output.evidence': EvidencePrimitiveSchema,
  'output.action': ActionPrimitiveSchema,
  'output.question': QuestionPrimitiveSchema,
  'output.alert': AlertPrimitiveSchema,
  'output.narrative': NarrativePrimitiveSchema,
};

/**
 * Set of valid output.* predicates for fast membership checks.
 */
export const VALID_OUTPUT_PREDICATES = new Set(Object.keys(OUTPUT_PRIMITIVE_SCHEMAS));

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
  const schema = OUTPUT_PRIMITIVE_SCHEMAS[predicate];
  if (!schema) {
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
  const parseResult = schema.safeParse(value);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
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
