/**
 * Phase 12: Cognitive Engine — Type Architecture.
 *
 * All interfaces, enums, constants for the Cognitive Engine subsystem.
 * Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 2)
 * Truth model: PHASE-12-TRUTH-MODEL.md (22 invariants)
 *
 * This file defines the contract. Implementation lives in separate modules:
 *   - self_healing.ts: Event-driven auto-retraction of derived claims
 *   - consolidation.ts: Merge similar + archive stale + suggest contradiction resolution
 *   - importance.ts: 5-factor composite importance score
 *   - auto_connection.ts: KNN-based relationship suggestions
 *   - narrative.ts: Mission-scoped cognitive state snapshots
 */

// ============================================================================
// Self-Healing Types (I-P12-01 through I-P12-05)
// ============================================================================

/**
 * Configuration for the self-healing retraction cascade.
 * I-P12-01: threshold controls auto-retraction sensitivity.
 * I-P12-03: maxCascadeDepth prevents unbounded recursion.
 */
export interface SelfHealingConfig {
  readonly enabled: boolean;
  readonly autoRetractThreshold: number;   // default 0.1
  readonly maxCascadeDepth: number;        // default 5
}

/**
 * Default self-healing configuration.
 * Conservative defaults: threshold 0.1, max depth 5.
 */
export const DEFAULT_SELF_HEALING_CONFIG: SelfHealingConfig = Object.freeze({
  enabled: true,
  autoRetractThreshold: 0.1,
  maxCascadeDepth: 5,
});

/**
 * Event emitted when a claim is auto-retracted by self-healing.
 * Audit trail: logged in consolidation_log with operation='self_heal'.
 */
export interface SelfHealingEvent {
  readonly retractedClaimId: string;
  readonly derivedClaimId: string;
  readonly effectiveConfidence: number;
  readonly reason: string;
}

// ============================================================================
// Consolidation Types (I-P12-10 through I-P12-15)
// ============================================================================

/**
 * Options for the consolidation engine.
 * Controls merge similarity, archive criteria, and dry-run mode.
 */
export interface ConsolidationOptions {
  readonly mergeSimilarityThreshold?: number;   // default 0.98
  readonly archiveFreshnessFilter?: 'stale';    // only archive stale claims
  readonly archiveMaxConfidence?: number;        // default 0.3
  readonly archiveMaxAccessCount?: number;       // default 1
  readonly dryRun?: boolean;                     // default false
}

/**
 * Default consolidation options.
 */
export const DEFAULT_CONSOLIDATION_OPTIONS: Required<ConsolidationOptions> = Object.freeze({
  mergeSimilarityThreshold: 0.98,
  archiveFreshnessFilter: 'stale' as const,
  archiveMaxConfidence: 0.3,
  archiveMaxAccessCount: 1,
  dryRun: false,
});

/**
 * Result of a consolidation run.
 * Provides counts and full audit log for transparency.
 */
export interface ConsolidationResult {
  readonly merged: number;
  readonly archived: number;
  readonly suggestedResolutions: readonly ConflictResolution[];
  readonly log: readonly ConsolidationLogEntry[];
}

/**
 * Suggested resolution for a contradiction pair.
 * I-P12-30: Suggestions only — never auto-creates relationships.
 */
export interface ConflictResolution {
  readonly contradictionId: string;
  readonly weakerClaimId: string;
  readonly strongerClaimId: string;
  readonly confidenceRatio: number;
}

/**
 * Log entry for consolidation operations.
 * Stored in consolidation_log table for audit trail.
 */
export interface ConsolidationLogEntry {
  readonly id: string;
  readonly operation: 'merge' | 'archive' | 'resolve' | 'self_heal';
  readonly sourceClaimIds: readonly string[];
  readonly targetClaimId: string | null;
  readonly reason: string;
}

// ============================================================================
// Importance Types (I-P12-20, I-P12-21)
// ============================================================================

/**
 * Computed importance score for a claim.
 * 5-factor weighted composite in [0, 1].
 */
export interface ImportanceScore {
  readonly claimId: string;
  readonly score: number;                    // composite [0, 1]
  readonly factors: {
    readonly accessFrequency: number;        // [0, 1]
    readonly recency: number;                // [0, 1]
    readonly connectionDensity: number;      // [0, 1]
    readonly confidence: number;             // [0, 1] (effective)
    readonly governanceWeight: number;       // [0.2, 1.0]
  };
  readonly computedAt: string;
}

/**
 * Weights for the 5 importance factors.
 * I-P12-20: importanceScore = w1*accessFreq + w2*recency + w3*density + w4*confidence + w5*governance
 */
export interface ImportanceWeights {
  readonly accessFrequency: number;          // default 0.25
  readonly recency: number;                  // default 0.20
  readonly connectionDensity: number;        // default 0.20
  readonly confidence: number;               // default 0.25
  readonly governance: number;               // default 0.10
}

/**
 * Default importance weights. Sum = 1.0.
 */
export const DEFAULT_IMPORTANCE_WEIGHTS: ImportanceWeights = Object.freeze({
  accessFrequency: 0.25,
  recency: 0.20,
  connectionDensity: 0.20,
  confidence: 0.25,
  governance: 0.10,
});

// ============================================================================
// Auto-Connection Types (I-P12-30, I-P12-31, I-P12-32)
// ============================================================================

/**
 * Connection suggestion from the auto-connection engine.
 * I-P12-30: Suggestions are PENDING — never auto-created.
 * Lifecycle: pending -> accepted | rejected | expired
 */
export interface ConnectionSuggestion {
  readonly id: string;
  readonly fromClaimId: string;
  readonly toClaimId: string;
  readonly suggestedType: 'supports' | 'derived_from';
  readonly similarity: number;
  readonly status: 'pending' | 'accepted' | 'rejected' | 'expired';
  readonly createdAt: string;
}

// ============================================================================
// Narrative Types (I-P12-40, I-P12-41)
// ============================================================================

/**
 * Snapshot of the narrative state of a knowledge base or mission.
 * I-P12-40: mission-scoped or global.
 * I-P12-41: momentum derived from claim creation vs retraction rates.
 */
export interface NarrativeSnapshot {
  readonly id: string;
  readonly missionId: string | null;
  readonly subjectsExplored: number;
  readonly decisionsMade: number;
  readonly conflictsResolved: number;
  readonly claimsAdded: number;
  readonly claimsRetracted: number;
  readonly momentum: 'growing' | 'stable' | 'declining';
  readonly threads: readonly NarrativeThread[];
  readonly createdAt: string;
}

/**
 * A narrative thread — a cluster of related claims by topic.
 * Detected by grouping claims by (subject prefix, predicate prefix).
 */
export interface NarrativeThread {
  readonly topic: string;                    // predicate prefix
  readonly claimCount: number;
  readonly latestClaimAt: string;
  readonly momentum: 'growing' | 'stable' | 'declining';
}

// ============================================================================
// Verification Types (I-P12-50, I-P12-51)
// ============================================================================

/**
 * Provider function for external claim verification.
 * Takes a claim summary, returns a verification result.
 * I-P12-50: Advisory only — never auto-mutates claim state.
 */
export type VerificationProvider = (claim: {
  subject: string;
  predicate: string;
  value: string;
  confidence: number;
}) => Promise<VerificationResult>;

/**
 * Result from a verification provider.
 * I-P12-51: On provider failure, verdict MUST be 'inconclusive'.
 */
export interface VerificationResult {
  readonly verdict: 'confirmed' | 'challenged' | 'inconclusive';
  readonly reasoning: string;
  readonly suggestedConfidence: number | null;
}

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Phase 12 error codes.
 * Design Source Output 5: Error Taxonomy.
 */
export type CognitiveErrorCode =
  | 'SELF_HEALING_DEPTH_EXCEEDED'
  | 'CONSOLIDATION_NO_CANDIDATES'
  | 'CONSOLIDATION_VECTOR_UNAVAILABLE'
  | 'IMPORTANCE_CLAIM_NOT_FOUND'
  | 'SUGGESTION_NOT_FOUND'
  | 'SUGGESTION_ALREADY_RESOLVED'
  | 'NARRATIVE_NO_CLAIMS'
  | 'VERIFY_PROVIDER_MISSING'
  | 'VERIFY_PROVIDER_FAILED'
  | 'VERIFY_CLAIM_NOT_FOUND';
