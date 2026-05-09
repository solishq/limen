// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * FR-002: A2A Governance Block Schema — Zod validation for inter-agent governance.
 *
 * Defines 4 Zod schemas for A2A governance data standardization:
 * - GovernanceBlock: Provider-level governance metadata (extends Agent Card concept)
 * - CapabilityBoundary: Per-skill authorization boundaries
 * - DataClassification: Data handling rules per classification level
 * - ProactiveRule: Autonomous inter-agent action rules with governance constraints
 *
 * Design decisions:
 * - Zod `.strict()` on all schemas: unknown fields are rejected, not silently dropped.
 * - Validators return Result<void> to match Limen's error model.
 * - GovernanceBlock stored as a single claim with subject 'entity:governance:block'.
 * - ProactiveRules stored as individual claims for independent lifecycle management.
 * - Follows the FR-001/FR-004 pattern: Zod schemas + claims for storage.
 *
 * Spec ref: v4.0.0 Phase 7 FR-002
 * QAL: 3 (Governance integrity. Failure = unauthorized inter-agent actions.)
 */

import { z } from 'zod';
import type { Result } from '../kernel/interfaces/index.js';

// ============================================================================
// A2A Governance Block Schema
// ============================================================================

/**
 * A2A Governance Block — provider-level governance metadata.
 * Extends the Agent Card concept with governance constraints.
 */
export const GovernanceBlockSchema = z.object({
  provider: z.literal('limen'),
  version: z.string().min(1),
  dataResidency: z.array(z.string().min(1)).min(1),
  piiHandling: z.enum(['masked', 'redacted', 'allowed']),
  auditTrail: z.boolean(),
  compliance: z.array(z.string()),
  maxConfidence: z.number().min(0).max(1),
}).strict();

export type GovernanceBlock = z.infer<typeof GovernanceBlockSchema>;

// ============================================================================
// Capability Boundary Schema
// ============================================================================

/**
 * Capability Boundary — per-skill authorization rules.
 */
export const CapabilityBoundarySchema = z.object({
  skillId: z.string().min(1),
  clearanceRequired: z.enum(['public', 'confidential', 'secret']),
  dataFieldsAllowed: z.array(z.string()),
  dataFieldsMasked: z.array(z.string()),
  rateLimit: z.object({
    callsPerMinute: z.number().int().min(1),
  }).strict().optional(),
}).strict();

export type CapabilityBoundary = z.infer<typeof CapabilityBoundarySchema>;

// ============================================================================
// Data Classification Schema
// ============================================================================

/**
 * Data Classification — data handling rules per classification level.
 */
export const DataClassificationSchema = z.object({
  level: z.enum(['public', 'confidential', 'secret', 'internal_only']),
  appliesTo: z.string().min(1),
  rule: z.enum(['allow', 'mask', 'redact', 'deny']),
}).strict();

export type DataClassification = z.infer<typeof DataClassificationSchema>;

// ============================================================================
// Proactive Rule Schema
// ============================================================================

/**
 * Proactive Rule — autonomous inter-agent action rules with governance.
 */
export const ProactiveRuleSchema = z.object({
  id: z.string().min(1),
  condition: z.string().min(1),
  targetAgent: z.string().min(1),
  action: z.string().min(1),
  governance: z.object({
    dataShared: z.array(z.string()),
    dataProhibited: z.array(z.string()),
  }).strict(),
  costCeiling: z.number().min(0),
  cooldownSeconds: z.number().int().min(0),
  approvedBy: z.string().min(1),
  status: z.enum(['active', 'suspended', 'retired']),
}).strict();

export type ProactiveRule = z.infer<typeof ProactiveRuleSchema>;

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a governance block object against the schema.
 *
 * @param block - The governance block to validate
 * @returns Result<void> — ok if valid, error with details if not
 */
export function validateGovernanceBlock(block: unknown): Result<void> {
  const parseResult = GovernanceBlockSchema.safeParse(block);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      error: {
        code: 'INVALID_GOVERNANCE_BLOCK',
        message: `Governance block validation failed: ${issues}`,
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
  const parseResult = CapabilityBoundarySchema.safeParse(boundary);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      error: {
        code: 'INVALID_CAPABILITY_BOUNDARY',
        message: `Capability boundary validation failed: ${issues}`,
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
  const parseResult = ProactiveRuleSchema.safeParse(rule);
  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      error: {
        code: 'INVALID_PROACTIVE_RULE',
        message: `Proactive rule validation failed: ${issues}`,
        spec: 'FR-002',
      },
    };
  }
  return { ok: true, value: undefined };
}
