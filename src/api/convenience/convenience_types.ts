/**
 * Phase 1 Convenience API Type Definitions.
 *
 * Spec refs: LIMEN_BUILD_PHASES.md (Phase 1), LIMEN_DEFINITIVE_SPEC_ADDENDUM.md (A.2, A.3, B.5, C.11)
 * Design Source: docs/sprints/PHASE-1-DESIGN-SOURCE.md (Output 2)
 *
 * These types define the cognitive interface for Limen's convenience API.
 * No implementation logic. Pure type definitions.
 *
 * Invariants: I-CONV-04 (confidence ceiling), I-CONV-06 (governance boundary)
 */

import type { ClaimId, RelationshipType, EvidenceRef } from '../../claims/interfaces/claim_types.js';

// Re-export for consumer convenience
export type { ClaimId } from '../../claims/interfaces/claim_types.js';
export type { EvidenceRef } from '../../claims/interfaces/claim_types.js';

// ── Configuration ──

/**
 * Phase 1: Cognitive configuration for convenience API.
 * Passed to createLimen() config. Controls convenience API behavior.
 */
export interface CognitiveConfig {
  /**
   * A.2 Rule 1: Maximum confidence for auto-extracted claims.
   * Claims created via remember() are capped at this value
   * unless options.groundingMode is 'evidence_path' AND
   * options.evidenceRefs is non-empty.
   *
   * Default: 0.7
   * Range: [0.0, 1.0], must be finite.
   * CONSTITUTIONAL: Primary defense against confidence laundering.
   */
  readonly maxAutoConfidence?: number;
}

// ── remember() Types ──

/**
 * Options for remember() calls.
 * All fields optional -- sane defaults applied.
 */
export interface RememberOptions {
  /**
   * Confidence score [0.0, 1.0].
   * Default: CognitiveConfig.maxAutoConfidence (0.7).
   * If provided AND groundingMode is 'evidence_path' with non-empty evidenceRefs, not capped.
   * Otherwise, capped at maxAutoConfidence.
   */
  readonly confidence?: number;

  /**
   * How the claim's truth is anchored.
   * 'runtime_witness': observed at runtime (default).
   * 'evidence_path': grounded by external evidence (bypasses confidence cap
   *   when evidenceRefs is non-empty).
   * Default: 'runtime_witness'.
   */
  readonly groundingMode?: 'runtime_witness' | 'evidence_path';

  /**
   * Evidence references grounding this claim.
   * Required for 'evidence_path' grounding mode to bypass confidence cap.
   * Default: [].
   */
  readonly evidenceRefs?: readonly EvidenceRef[];

  /**
   * ISO 8601 timestamp for temporal anchoring.
   * Default: current time.
   */
  readonly validAt?: string;

  /**
   * Object value type hint.
   * Default: 'string'.
   */
  readonly objectType?: 'string' | 'number' | 'boolean' | 'date' | 'json';
}

/**
 * Result of a remember() call.
 */
export interface RememberResult {
  /** The created claim's ID */
  readonly claimId: ClaimId;
  /** The actual confidence stored (may be capped by maxAutoConfidence) */
  readonly confidence: number;
}

// ── recall() Types ──

/**
 * Options for recall() calls.
 */
export interface RecallOptions {
  /**
   * Minimum confidence threshold.
   * Default: none (all confidences).
   */
  readonly minConfidence?: number;

  /**
   * Include superseded claims in results.
   * Default: false (superseded claims are excluded).
   */
  readonly includeSuperseded?: boolean;

  /**
   * Maximum number of results.
   * Default: 50 (matches CLAIM_QUERY_DEFAULT_LIMIT).
   */
  readonly limit?: number;
}

/**
 * Simplified claim view for convenience API consumers.
 * Hides internal fields (tenantId, agentId, missionId, etc.).
 */
export interface BeliefView {
  /** Claim identifier */
  readonly claimId: ClaimId;
  /** Subject URN (entity:<type>:<id>) */
  readonly subject: string;
  /** Predicate (<domain>.<property>) */
  readonly predicate: string;
  /**
   * String representation of the claim's object value.
   * For typed access, use ClaimApi.queryClaims() directly.
   */
  readonly value: string;
  /** Confidence score [0.0, 1.0] */
  readonly confidence: number;
  /** Temporal anchor (ISO 8601) */
  readonly validAt: string;
  /** Creation timestamp (ISO 8601) */
  readonly createdAt: string;
  /** Whether this claim has been superseded */
  readonly superseded: boolean;
  /** Whether this claim has been contradicted */
  readonly disputed: boolean;
}

// ── forget() Types ──

/**
 * Options for forget() calls.
 * Reserved for future use (e.g., retraction reason taxonomy in Phase 4).
 */
export interface ForgetOptions {
  // Currently empty but defined for forward compatibility.
}

// ── reflect() Types ──

/**
 * A single entry for batch reflection.
 * Maps to a categorized remember() call.
 */
export interface ReflectEntry {
  /**
   * Learning category.
   * Maps to predicate: 'reflection.<category>'
   */
  readonly category: 'decision' | 'pattern' | 'warning' | 'finding';

  /**
   * The learning statement. Max 500 characters.
   */
  readonly statement: string;

  /**
   * Optional confidence override.
   * Default: CognitiveConfig.maxAutoConfidence (0.7).
   */
  readonly confidence?: number;
}

/**
 * Result of a reflect() call.
 */
export interface ReflectResult {
  /** Number of claims successfully created */
  readonly stored: number;
  /** Claim IDs of created claims, in order of input entries */
  readonly claimIds: readonly ClaimId[];
}

// ── Error Types ──

/**
 * Convenience API error codes.
 * Prefixed with CONV_ to distinguish from system-call error codes.
 */
export type ConvenienceErrorCode =
  | 'CONV_INVALID_TEXT'          // 1-param remember() with empty text
  | 'CONV_INVALID_CONFIDENCE'   // Confidence not in [0.0, 1.0]
  | 'CONV_INVALID_CATEGORY'     // reflect() category not in allowed set
  | 'CONV_STATEMENT_TOO_LONG'   // reflect() statement exceeds 500 chars
  | 'CONV_EMPTY_ENTRIES'        // reflect() called with empty array
  | 'CONV_ENTRIES_LIMIT'        // reflect() entries count exceeds maximum (100)
  | 'CONV_BATCH_PARTIAL'        // reflect() transaction failed mid-batch (rolled back)
  | 'CONV_CLAIM_NOT_FOUND'      // forget() target not found
  | 'CONV_ALREADY_RETRACTED'    // forget() target already retracted
  | 'CONV_INVALID_RELATIONSHIP' // connect() invalid relationship type
  | 'CONV_SELF_REFERENCE';      // connect() same claim on both sides

/** Valid relationship types for connect() */
export const VALID_RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  'supports', 'contradicts', 'supersedes', 'derived_from',
] as readonly RelationshipType[];

/** Valid reflect() categories */
export const VALID_CATEGORIES = ['decision', 'pattern', 'warning', 'finding'] as const;

/** Maximum statement length for reflect() entries */
export const MAX_STATEMENT_LENGTH = 500;

/** Default maxAutoConfidence value */
export const DEFAULT_MAX_AUTO_CONFIDENCE = 0.7;

/** Default recall limit */
export const DEFAULT_RECALL_LIMIT = 50;

/** Maximum number of entries in a single reflect() call */
export const MAX_REFLECT_ENTRIES = 100;
