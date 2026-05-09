/**
 * ClassificationEngine
 *
 * Contract: SHARED_TYPES.md S3 (Classification), S17 (Retention Policy)
 * Purpose: Determines classification levels for operations, enforces clearance,
 *          and maps classification to retention policy.
 *
 * Design decisions:
 * - Pure functions where possible (no internal state mutation)
 * - Result<T> pattern for all fallible operations
 * - Every public method cites its contract clause
 */

import type { ClassificationLevel, Result, KernelError } from '../../adapters/shared/types.js';
import {
  CLASSIFICATION_NUMERIC,
  CLASSIFICATION_LEVELS,
  type ClassificationEnforcementResult,
  type ClassificationContext,
} from './types.js';

/**
 * SHARED_TYPES.md S17 -- Retention policy per classification level.
 * Extended from the contract with enterprise fields (tombstoneOnExpiry, gdprOverride).
 */
export interface EnterpriseRetentionPolicy {
  readonly classification: ClassificationLevel;
  readonly retentionDays: number;
  readonly autoArchiveDays: number | null;
  readonly tombstoneOnExpiry: boolean;
  readonly gdprOverride: boolean;
}

/**
 * SHARED_TYPES.md S17 -- Default retention policies per classification level.
 *
 * | Classification | Retention | Auto-Archive | Expiry Action | GDPR Override |
 * |----------------|-----------|--------------|---------------|---------------|
 * | unrestricted   | 90 days   | 30 days      | hard delete   | allowed       |
 * | internal       | 1 year    | 90 days      | tombstone     | allowed       |
 * | confidential   | 3 years   | 1 year       | tombstone     | allowed       |
 * | restricted     | 5 years   | 2 years      | tombstone     | NOT allowed   |
 * | critical       | 7 years   | NEVER        | tombstone     | NOT allowed   |
 */
export const DEFAULT_RETENTION: Readonly<Record<ClassificationLevel, EnterpriseRetentionPolicy>> = {
  unrestricted: {
    classification: 'unrestricted',
    retentionDays: 90,
    autoArchiveDays: 30,
    tombstoneOnExpiry: false,
    gdprOverride: true,
  },
  internal: {
    classification: 'internal',
    retentionDays: 365,
    autoArchiveDays: 90,
    tombstoneOnExpiry: true,
    gdprOverride: true,
  },
  confidential: {
    classification: 'confidential',
    retentionDays: 1095,
    autoArchiveDays: 365,
    tombstoneOnExpiry: true,
    gdprOverride: true,
  },
  restricted: {
    classification: 'restricted',
    retentionDays: 1825,
    autoArchiveDays: 730,
    tombstoneOnExpiry: true,
    gdprOverride: false,
  },
  critical: {
    classification: 'critical',
    retentionDays: 2555,
    autoArchiveDays: null,
    tombstoneOnExpiry: true,
    gdprOverride: false,
  },
} as const;

function makeError(code: string, message: string): KernelError {
  return { code, message, spec: 'SHARED_TYPES.md' };
}

/**
 * ClassificationEngine -- determines classification levels, enforces clearance,
 * and maps to retention policy.
 *
 * All methods are governed (#governed = true, no bypass).
 */
export class ClassificationEngine {
  // Finding-37: governance is always active (no ungoverned mode)

  /**
   * SHARED_TYPES.md S3 -- Classify an operation based on action and context.
   *
   * Classification is determined by:
   * 1. Explicit classification in context (if provided)
   * 2. Resource classification (the data being accessed)
   * 3. Default to 'unrestricted' if no classification context
   *
   * @param action - The operation being performed
   * @param context - Classification context with resource info
   * @returns Result containing the determined ClassificationLevel
   */
  classifyOperation(
    action: string,
    context: ClassificationContext,
  ): Result<ClassificationLevel> {
    // GOVERNANCE: This component is always governed (readonly #governed = true).
    // Finding-37: Removed dead governance bypass check — #governed is readonly true.

    if (!action || action.trim().length === 0) {
      return { ok: false, error: makeError('INVALID_ACTION', 'Action must be a non-empty string') };
    }

    const level = context.resourceClassification;
    if (!CLASSIFICATION_LEVELS.includes(level)) {
      return {
        ok: false,
        error: makeError('INVALID_CLASSIFICATION', `Unknown classification level: ${String(level)}`),
      };
    }

    return { ok: true, value: level };
  }

  /**
   * SHARED_TYPES.md S3 -- Enforce classification clearance.
   *
   * An actor's clearance (numeric) must be >= the required classification level's
   * numeric value. Clearance mapping per SHARED_TYPES.md S5:
   *   unrestricted=0, internal=1, confidential=2, restricted=3, critical=4
   *
   * @param required - The classification level required for the operation
   * @param actualClearance - The actor's numeric clearance level
   * @returns Result containing enforcement result with allowed/denied and details
   */
  enforceClassification(
    required: ClassificationLevel,
    actualClearance: number,
  ): Result<ClassificationEnforcementResult> {
    if (!CLASSIFICATION_LEVELS.includes(required)) {
      return {
        ok: false,
        error: makeError('INVALID_CLASSIFICATION', `Unknown classification level: ${String(required)}`),
      };
    }

    if (!Number.isFinite(actualClearance) || actualClearance < 0) {
      return {
        ok: false,
        error: makeError('INVALID_CLEARANCE', `Clearance must be a non-negative finite number, got: ${String(actualClearance)}`),
      };
    }

    const requiredNumeric = CLASSIFICATION_NUMERIC[required];
    // F-10: Determine the actor's maximum accessible classification level from their numeric clearance
    const maxAccessibleLevel = this.#numericToLevel(actualClearance);

    const result: ClassificationEnforcementResult = {
      allowed: actualClearance >= requiredNumeric,
      requiredLevel: required,
      requiredNumeric,
      maxAccessibleLevel,
      actualNumeric: actualClearance,
    };

    return { ok: true, value: result };
  }

  /**
   * SHARED_TYPES.md S17 -- Get the retention policy for a classification level.
   *
   * Returns the default enterprise retention policy that maps:
   *   unrestricted -> 90 days, hard delete, GDPR allowed
   *   internal     -> 1 year, tombstone, GDPR allowed
   *   confidential -> 3 years, tombstone, GDPR allowed
   *   restricted   -> 5 years, tombstone, GDPR NOT allowed
   *   critical     -> 7 years, tombstone, GDPR NOT allowed
   *
   * @param level - Classification level to look up
   * @returns Result containing the retention policy
   */
  getRetentionPolicy(level: ClassificationLevel): Result<EnterpriseRetentionPolicy> {
    if (!CLASSIFICATION_LEVELS.includes(level)) {
      return {
        ok: false,
        error: makeError('INVALID_CLASSIFICATION', `Unknown classification level: ${String(level)}`),
      };
    }

    return { ok: true, value: DEFAULT_RETENTION[level] };
  }

  /**
   * SHARED_TYPES.md S3 -- Get numeric value for a classification level.
   *
   * @param level - Classification level
   * @returns The numeric value (0-4)
   */
  getNumericLevel(level: ClassificationLevel): number {
    return CLASSIFICATION_NUMERIC[level];
  }

  /**
   * SHARED_TYPES.md S3 -- Compare two classification levels.
   *
   * @returns negative if a < b, 0 if equal, positive if a > b
   */
  compareClassifications(a: ClassificationLevel, b: ClassificationLevel): number {
    return CLASSIFICATION_NUMERIC[a] - CLASSIFICATION_NUMERIC[b];
  }

  /**
   * Convert numeric clearance to the highest classification level accessible.
   */
  #numericToLevel(clearance: number): ClassificationLevel {
    // Walk from highest to lowest; return the first level the clearance covers
    for (let i = CLASSIFICATION_LEVELS.length - 1; i >= 0; i--) {
      const level = CLASSIFICATION_LEVELS[i]!;
      if (clearance >= CLASSIFICATION_NUMERIC[level]) {
        return level;
      }
    }
    return 'unrestricted';
  }
}
