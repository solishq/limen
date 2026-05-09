// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md SS5.1
/**
 * Knowledge Exchange Utilities
 *
 * LM-7: Export, import, transfer operations with classification and consent checks.
 * This module provides helper functions used by AgentLifecycleClient.
 *
 * Core logic lives in agent_lifecycle_client.ts. This module provides:
 * - Checksum computation (LM-7.16)
 * - Classification level comparison utilities
 * - Knowledge format validation
 */

import { createHash } from 'node:crypto';
import type { ClassificationLevel } from '../adapters/shared/types.js';
import type {
  KnowledgeFormat, KnowledgePackage,
  ExportedClaim, ExportedTechnique, ExportedRelationship,
} from './lifecycle_types.js';

// ============================================================================
// Checksum (LM-7.16)
// ============================================================================

/**
 * Compute SHA-256 checksum for a knowledge package's content.
 * LM-7.16: Checksum covers serialized claims + techniques + relationships.
 */
export function computeKnowledgeChecksum(
  claims: readonly ExportedClaim[],
  techniques: readonly ExportedTechnique[],
  relationships: readonly ExportedRelationship[],
): string {
  const serialized = JSON.stringify({ claims, techniques, relationships });
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Verify a knowledge package's checksum integrity.
 * LM-7.42: Validate integrity on import (default true).
 */
export function verifyKnowledgeIntegrity(pkg: KnowledgePackage): boolean {
  const expected = computeKnowledgeChecksum(pkg.claims, pkg.techniques, pkg.relationships);
  return expected === pkg.checksum;
}

// ============================================================================
// Classification Comparison
// ============================================================================

const CLASSIFICATION_ORDER: readonly ClassificationLevel[] = [
  'unrestricted', 'internal', 'confidential', 'restricted', 'critical',
];

/**
 * Compare two classification levels.
 * Returns negative if a < b, 0 if equal, positive if a > b.
 */
export function compareClassification(a: ClassificationLevel, b: ClassificationLevel): number {
  return CLASSIFICATION_ORDER.indexOf(a) - CLASSIFICATION_ORDER.indexOf(b);
}

/**
 * Get the classification level for a given clearance number.
 * Clearance 0 = unrestricted, 4 = critical.
 */
export function clearanceToMaxClassification(clearance: number): ClassificationLevel {
  const clamped = Math.max(0, Math.min(4, clearance));
  return CLASSIFICATION_ORDER[clamped]!;
}

// ============================================================================
// Format Validation (LM-7.07)
// ============================================================================

const VALID_FORMATS: ReadonlySet<string> = new Set(['limen_native', 'json_ld', 'rdf_turtle']);

/**
 * Validate a knowledge format string.
 * LM-7.07: Must be one of 3 values.
 */
export function isValidKnowledgeFormat(format: string): format is KnowledgeFormat {
  return VALID_FORMATS.has(format);
}

// ============================================================================
// Confidence Cap (LM-13.10, LM-13.11)
// ============================================================================

/** Default confidence cap for imported knowledge (LM-7.40, LM-13.10) */
export const DEFAULT_IMPORT_CONFIDENCE_CAP = 0.5;

/**
 * Apply confidence cap to imported claims.
 * LM-13.10: Knowledge import caps confidence at 0.5 by default.
 * LM-13.11: Imported knowledge is never authoritative without local validation.
 */
export function capConfidence(confidence: number, cap: number = DEFAULT_IMPORT_CONFIDENCE_CAP): number {
  return Math.min(confidence, cap);
}
