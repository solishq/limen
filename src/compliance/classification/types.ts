/**
 * Classification Types
 *
 * Contract: SHARED_TYPES.md S3, S17
 * Purpose: Classification-specific types for the Enterprise Compliance Pack.
 * All cross-contract types are imported from the CrewAI adapter types module
 * (which re-exports SHARED_TYPES.md canonical definitions).
 */

import type { ClassificationLevel } from '../../adapters/shared/types.js';

/**
 * SHARED_TYPES.md S3 -- Numeric mapping for classification levels.
 * Used in clearance comparisons: actor clearance >= required level.
 */
export const CLASSIFICATION_NUMERIC: Readonly<Record<ClassificationLevel, number>> = {
  unrestricted: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
  critical: 4,
} as const;

/**
 * All classification levels in ascending order of sensitivity.
 * SHARED_TYPES.md S3.
 */
export const CLASSIFICATION_LEVELS: readonly ClassificationLevel[] = [
  'unrestricted',
  'internal',
  'confidential',
  'restricted',
  'critical',
] as const;

/**
 * Result of a classification enforcement check.
 */
/**
 * F-10: Renamed actualLevel -> maxAccessibleLevel for clarity with fractional clearance.
 */
export interface ClassificationEnforcementResult {
  readonly allowed: boolean;
  readonly requiredLevel: ClassificationLevel;
  readonly requiredNumeric: number;
  readonly maxAccessibleLevel: ClassificationLevel;
  readonly actualNumeric: number;
}

/**
 * Operation context for classification decisions.
 */
export interface ClassificationContext {
  readonly operationType: string;
  readonly resourceClassification: ClassificationLevel;
  readonly actorClearance: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}
