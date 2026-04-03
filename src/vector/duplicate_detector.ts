/**
 * Phase 11: Duplicate Detector -- cosine similarity check before assertion.
 *
 * Spec ref: PHASE-11-DESIGN-SOURCE.md (Output 1, Duplicate Detector)
 * Invariants: I-P11-40 (threshold), I-P11-41 (tenant isolation), I-P11-42 (disabled)
 * DCs: DC-P11-401, DC-P11-402, DC-P11-403
 *
 * Algorithm:
 *   1. Takes the new claim's embedding
 *   2. Runs KNN with k=5 against existing embeddings
 *   3. Filters by same predicate pattern
 *   4. Checks if any cosine similarity >= threshold
 *
 * Distance conversion for normalized vectors stored in vec0 (L2 distance):
 *   cosine_similarity ≈ 1 - (distance^2 / 2)
 *
 * For unnormalized vectors, the relationship is approximate.
 * We use the simpler: similarity = 1 - (distance / 2) for moderate accuracy
 * with the understanding that provider-specific calibration may be needed.
 *
 * Architecture: Pure function. No state. Database access via VectorStore.
 */

import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { Result } from '../kernel/interfaces/common.js';
import type { DuplicateCandidate, DuplicateCheckResult } from './vector_types.js';
import type { VectorStore } from './vector_store.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** Convert L2 distance to approximate cosine similarity for normalized vectors. */
export function distanceToSimilarity(distance: number): number {
  // For normalized vectors: L2_distance^2 = 2 * (1 - cosine_similarity)
  // So: cosine_similarity = 1 - (L2_distance^2 / 2)
  // Clamp to [0, 1]
  const similarity = 1 - (distance * distance / 2);
  return Math.max(0, Math.min(1, similarity));
}

/**
 * Check if a new claim is a duplicate of an existing one.
 *
 * @param conn - Database connection
 * @param vectorStore - Vector store for KNN
 * @param embedding - The new claim's embedding vector
 * @param predicate - The new claim's predicate (for same-predicate filtering)
 * @param tenantId - Tenant isolation
 * @param threshold - Cosine similarity threshold (0 = disabled)
 * @returns DuplicateCheckResult with candidates
 */
export function checkDuplicate(
  conn: DatabaseConnection,
  vectorStore: VectorStore,
  embedding: number[],
  predicate: string,
  tenantId: string | null,
  threshold: number,
): Result<DuplicateCheckResult> {
  // I-P11-42: Disabled when threshold === 0
  if (threshold === 0) {
    return ok({ isDuplicate: false, candidates: [], threshold });
  }

  if (!vectorStore.isAvailable()) {
    // No vector store -- cannot detect duplicates, skip silently
    return ok({ isDuplicate: false, candidates: [], threshold });
  }

  // Run KNN with k=10 (fetch more to filter by predicate)
  const knnResult = vectorStore.knn(conn, embedding, 10, tenantId);
  if (!knnResult.ok) {
    // KNN failure is non-blocking for duplicate detection
    return ok({ isDuplicate: false, candidates: [], threshold });
  }

  const knnResults = knnResult.value;
  if (knnResults.length === 0) {
    return ok({ isDuplicate: false, candidates: [], threshold });
  }

  // Hydrate claim subject + predicate for filtering
  const candidates: DuplicateCandidate[] = [];

  for (const result of knnResults) {
    const similarity = distanceToSimilarity(result.distance);

    // Fetch claim metadata for predicate filtering
    const claimRow = conn.get<Record<string, unknown>>(
      `SELECT subject, predicate FROM claim_assertions WHERE id = ? AND status = 'active' AND purged_at IS NULL`,
      [result.claimId],
    );
    if (!claimRow) continue;

    const claimPredicate = claimRow['predicate'] as string;

    // Filter by same predicate (domain match)
    if (claimPredicate !== predicate) continue;

    candidates.push({
      claimId: result.claimId,
      similarity,
      subject: claimRow['subject'] as string,
      predicate: claimPredicate,
    });
  }

  // Check if any candidate exceeds threshold
  const isDuplicate = candidates.some(c => c.similarity >= threshold);

  return ok({
    isDuplicate,
    candidates: candidates.slice(0, 5), // Top 5 candidates
    threshold,
  });
}
