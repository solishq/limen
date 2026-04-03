/**
 * Phase 11: Vector Search module barrel export.
 */

export type {
  EmbeddingProvider, VectorConfig, StoredEmbedding,
  DuplicateCandidate, DuplicateCheckResult,
  SearchMode, HybridScore, HybridWeights,
  VectorErrorCode, EmbeddingStats, PendingEmbedding,
} from './vector_types.js';
export { DEFAULT_HYBRID_WEIGHTS, DEFAULT_VECTOR_CONFIG } from './vector_types.js';

export type { VectorStore } from './vector_store.js';
export { createVectorStore } from './vector_store.js';

export type { EmbeddingQueue } from './embedding_queue.js';
export { createEmbeddingQueue } from './embedding_queue.js';

export type { Fts5Result, VectorResult } from './hybrid_ranker.js';
export { hybridRank } from './hybrid_ranker.js';

export { checkDuplicate, distanceToSimilarity } from './duplicate_detector.js';
