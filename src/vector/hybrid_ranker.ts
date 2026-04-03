/**
 * Phase 11: Hybrid Ranker -- combine FTS5 BM25 + vector cosine into unified ranking.
 *
 * Spec ref: PHASE-11-DESIGN-SOURCE.md (Output 1, Hybrid Ranker)
 * Invariants: I-P11-23 (hybrid ranking with configurable weights)
 * DCs: DC-P11-802
 *
 * Algorithm: Reciprocal Rank Fusion (RRF) -- industry standard for hybrid search.
 * RRF handles different score scales (BM25 vs distance) gracefully because it
 * operates on ranks, not raw scores.
 *
 * For each result appearing in either list:
 *   rrf_score = weights.fts5 * (1 / (k + fts5_rank)) + weights.vector * (1 / (k + vector_rank))
 *
 * where k=60 (standard RRF constant). Sort by rrf_score descending.
 *
 * Architecture: Pure function. No state. No database access.
 */

import type { HybridScore, HybridWeights } from './vector_types.js';
import { DEFAULT_HYBRID_WEIGHTS } from './vector_types.js';

/** FTS5 search result (from existing search infrastructure). */
export interface Fts5Result {
  readonly claimId: string;
  /** BM25 relevance (negative -- lower = more relevant). */
  readonly relevance: number;
}

/** Vector search result (from VectorStore.knn). */
export interface VectorResult {
  readonly claimId: string;
  /** L2 distance (lower = more similar). */
  readonly distance: number;
}

/** RRF constant. Standard value used in literature and production systems. */
const RRF_K = 60;

/**
 * Combine FTS5 BM25 results and vector KNN results using Reciprocal Rank Fusion.
 *
 * @param fts5Results - FTS5 results ordered by relevance (most relevant first)
 * @param vectorResults - Vector results ordered by distance (closest first)
 * @param weights - Weighting for each signal. Default: fts5=0.4, vector=0.6.
 * @returns Combined results ordered by unified score (descending)
 */
export function hybridRank(
  fts5Results: readonly Fts5Result[],
  vectorResults: readonly VectorResult[],
  weights: HybridWeights = DEFAULT_HYBRID_WEIGHTS,
): readonly HybridScore[] {
  // Build rank maps from input order (already sorted by relevance/distance)
  const fts5RankMap = new Map<string, number>();
  const fts5ScoreMap = new Map<string, number>();
  for (let i = 0; i < fts5Results.length; i++) {
    const r = fts5Results[i]!;
    fts5RankMap.set(r.claimId, i + 1); // 1-based rank
    fts5ScoreMap.set(r.claimId, r.relevance);
  }

  const vectorRankMap = new Map<string, number>();
  const vectorScoreMap = new Map<string, number>();
  for (let i = 0; i < vectorResults.length; i++) {
    const r = vectorResults[i]!;
    vectorRankMap.set(r.claimId, i + 1); // 1-based rank
    vectorScoreMap.set(r.claimId, r.distance);
  }

  // Union of all claim IDs from both result sets
  const allClaimIds = new Set([
    ...fts5RankMap.keys(),
    ...vectorRankMap.keys(),
  ]);

  const scores: HybridScore[] = [];

  for (const claimId of allClaimIds) {
    const fts5Rank = fts5RankMap.get(claimId);
    const vectorRank = vectorRankMap.get(claimId);

    // RRF: score = sum of weighted reciprocal ranks
    let combinedScore = 0;
    if (fts5Rank !== undefined) {
      combinedScore += weights.fts5 * (1 / (RRF_K + fts5Rank));
    }
    if (vectorRank !== undefined) {
      combinedScore += weights.vector * (1 / (RRF_K + vectorRank));
    }

    scores.push({
      claimId,
      fts5Score: fts5ScoreMap.get(claimId) ?? null,
      vectorScore: vectorScoreMap.get(claimId) ?? null,
      combinedScore,
    });
  }

  // Sort by combinedScore descending (higher = better)
  scores.sort((a, b) => b.combinedScore - a.combinedScore);

  return scores;
}
