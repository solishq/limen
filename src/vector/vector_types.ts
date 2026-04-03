/**
 * Phase 11: Vector Search Type Definitions.
 *
 * Spec ref: PHASE-11-DESIGN-SOURCE.md (Output 2)
 * Invariants: I-P11-01 through I-P11-52
 * DCs: DC-P11-101 through DC-P11-904
 *
 * These types define the vector search subsystem contract.
 * No implementation logic. Pure type definitions.
 *
 * Design principle: sqlite-vec is OPTIONAL. Every type must be usable
 * regardless of whether sqlite-vec is installed.
 */

// ── Embedding Provider ──

/**
 * The embedding provider interface -- what callers implement.
 * Limen does not ship an embedding model. The caller provides this function.
 *
 * Design choice: single function, not a class. Simplest possible contract.
 * The function takes text and returns a vector of numbers.
 * Dimensions must match the configured embeddingDimensions.
 */
export type EmbeddingProvider = (text: string) => Promise<number[]>;

// ── Vector Configuration ──

export interface VectorConfig {
  /** The embedding provider function. Required for semantic search. */
  readonly provider: EmbeddingProvider;
  /** Embedding dimensions. Must match the provider's output. Default: 768. */
  readonly dimensions?: number;
  /** Auto-embed pending claims before semantic search. Default: true. */
  readonly autoEmbed?: boolean;
  /** Background embedding interval in ms. 0 = disabled. Default: 0. */
  readonly embeddingInterval?: number;
  /** Duplicate detection threshold (cosine similarity). 0 = disabled. Default: 0.95. */
  readonly duplicateThreshold?: number;
  /** Maximum number of pending embeddings to process per batch. Default: 50. */
  readonly batchSize?: number;
  /** Model identifier stored with embeddings for staleness detection. */
  readonly modelId?: string;
}

/** Default vector configuration values. */
export const DEFAULT_VECTOR_CONFIG = {
  dimensions: 768,
  autoEmbed: true,
  embeddingInterval: 0,
  duplicateThreshold: 0.95,
  batchSize: 50,
  modelId: 'unknown',
} as const;

// ── Stored Embedding ──

export interface StoredEmbedding {
  readonly claimId: string;
  readonly modelId: string;
  readonly dimensions: number;
  readonly createdAt: string;
}

// ── Duplicate Detection ──

export interface DuplicateCandidate {
  readonly claimId: string;
  readonly similarity: number;  // cosine similarity 0-1
  readonly subject: string;
  readonly predicate: string;
}

export interface DuplicateCheckResult {
  readonly isDuplicate: boolean;
  readonly candidates: readonly DuplicateCandidate[];
  readonly threshold: number;
}

// ── Search Mode Extension ──

export type SearchMode = 'fulltext' | 'semantic' | 'hybrid';

// ── Hybrid Ranking ──

export interface HybridScore {
  readonly claimId: string;
  readonly fts5Score: number | null;    // null if not in FTS5 results
  readonly vectorScore: number | null;   // null if not in vector results
  readonly combinedScore: number;        // unified ranking
}

/** Hybrid ranking weights -- how much each signal contributes */
export interface HybridWeights {
  readonly fts5: number;    // default: 0.4
  readonly vector: number;  // default: 0.6
}

/** Default hybrid ranking weights. I-P11-23: fts5=0.4, vector=0.6. */
export const DEFAULT_HYBRID_WEIGHTS: HybridWeights = {
  fts5: 0.4,
  vector: 0.6,
} as const;

// ── Embedding Stats ──

export interface EmbeddingStats {
  readonly embeddedCount: number;
  readonly pendingCount: number;
  readonly modelId: string;
  readonly dimensions: number;
  readonly vectorAvailable: boolean;
}

// ── Error Codes ──

export type VectorErrorCode =
  | 'VECTOR_NOT_AVAILABLE'        // sqlite-vec not installed
  | 'VECTOR_DIMENSION_MISMATCH'   // embedding size doesn't match config
  | 'VECTOR_PROVIDER_FAILED'      // embedding provider threw
  | 'VECTOR_NO_EMBEDDINGS'        // no embeddings exist yet
  | 'DUPLICATE_DETECTED';         // cosine similarity above threshold

// ── Pending Embedding ──

export interface PendingEmbedding {
  readonly claimId: string;
  readonly tenantId: string | null;
  readonly content: string;
  readonly createdAt: string;
}
