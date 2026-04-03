/**
 * Phase 12: Auto-Connection Engine — KNN-based relationship suggestions.
 *
 * Async function (calls embedding provider):
 * 1. Get/generate embedding for the claim
 * 2. KNN with k=10
 * 3. Filter: same tenant, different claim, similarity > 0.85
 * 4. For same-domain candidates: suggest 'supports'
 * 5. For temporal ordering candidates: suggest 'derived_from'
 * 6. Store in connection_suggestions as pending
 *
 * If vector unavailable: return empty array (I-P12-32).
 *
 * Spec ref: PHASE-12-DESIGN-SOURCE.md (Output 1, Auto-Connection)
 * Truth model: I-P12-30, I-P12-31, I-P12-32
 * DCs: DC-P12-804
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { TimeProvider } from '../kernel/interfaces/time.js';
import type { VectorStore } from '../vector/vector_store.js';
import type { EmbeddingProvider } from '../vector/vector_types.js';
import type { ConnectionSuggestion } from './cognitive_types.js';

/**
 * Minimum similarity threshold for auto-connection suggestions.
 */
const AUTO_CONNECTION_SIMILARITY_THRESHOLD = 0.85;

/**
 * Maximum number of KNN results to retrieve.
 */
const AUTO_CONNECTION_K = 10;

/**
 * Suggest connections for a claim based on embedding similarity.
 *
 * I-P12-30: All suggestions stored as 'pending' — never auto-created.
 * I-P12-32: Without sqlite-vec, returns empty array (not error).
 *
 * @param conn - Database connection
 * @param claimId - The claim to suggest connections for
 * @param tenantId - Tenant scope
 * @param time - Time provider
 * @param vectorStore - Vector store for KNN (optional)
 * @param embeddingProvider - Embedding provider (optional)
 * @returns Array of connection suggestions (empty if vectors unavailable)
 */
export async function suggestConnections(
  conn: DatabaseConnection,
  claimId: string,
  tenantId: string | null,
  time: TimeProvider,
  vectorStore: VectorStore | null,
  embeddingProvider: EmbeddingProvider | null,
): Promise<ConnectionSuggestion[]> {
  // I-P12-32: Without sqlite-vec, return empty array
  if (!vectorStore || !vectorStore.isAvailable()) return [];

  // Get the source claim
  const sourceClaim = conn.get<{
    id: string;
    subject: string;
    predicate: string;
    valid_at: string;
  }>(
    `SELECT id, subject, predicate, valid_at FROM claim_assertions WHERE id = ? AND status = 'active'`,
    [claimId],
  );
  if (!sourceClaim) return [];

  // Get or generate embedding
  let embedding: number[] | null = null;

  // Try to read stored embedding directly from vec0 table
  try {
    const embRow = conn.get<{ embedding: Buffer }>(
      `SELECT embedding FROM claim_embeddings WHERE claim_id = ?`,
      [claimId],
    );
    if (embRow?.embedding) {
      const float32 = new Float32Array(embRow.embedding.buffer, embRow.embedding.byteOffset, embRow.embedding.byteLength / 4);
      embedding = Array.from(float32);
    }
  } catch {
    // vec0 table might not exist or read failed — try provider
  }

  if (!embedding && embeddingProvider) {
    // Generate embedding from claim content
    const claimFull = conn.get<{ object_value: string }>(
      `SELECT object_value FROM claim_assertions WHERE id = ?`,
      [claimId],
    );
    if (claimFull) {
      try {
        const text = `${sourceClaim.subject} ${sourceClaim.predicate} ${claimFull.object_value}`;
        embedding = await embeddingProvider(text);
      } catch {
        return []; // Provider failure is non-blocking
      }
    }
  }


  if (!embedding) return [];

  // KNN search
  const knnResult = vectorStore.knn(conn, embedding, AUTO_CONNECTION_K, tenantId);
  if (!knnResult.ok) return [];

  const suggestions: ConnectionSuggestion[] = [];
  const nowISO = time.nowISO();

  // Extract the domain (first segment of predicate)
  const sourceDomain = sourceClaim.predicate.split('.')[0];

  for (const result of knnResult.value) {
    // Skip self
    if (result.claimId === claimId) continue;

    // Convert distance to similarity (cosine distance → similarity)
    const similarity = 1 - result.distance;
    if (similarity < AUTO_CONNECTION_SIMILARITY_THRESHOLD) continue;

    // Get candidate claim details
    const candidate = conn.get<{
      id: string;
      subject: string;
      predicate: string;
      valid_at: string;
      status: string;
    }>(
      `SELECT id, subject, predicate, valid_at, status FROM claim_assertions WHERE id = ?`,
      [result.claimId],
    );
    if (!candidate || candidate.status !== 'active') continue;

    // Determine suggested relationship type
    const candidateDomain = candidate.predicate.split('.')[0];
    let suggestedType: 'supports' | 'derived_from';

    if (sourceDomain === candidateDomain) {
      // Same domain: suggest 'supports'
      suggestedType = 'supports';
    } else {
      // Different domain with temporal ordering: suggest 'derived_from'
      // The more recent claim derives from the older one
      if (sourceClaim.valid_at > candidate.valid_at) {
        suggestedType = 'derived_from';
      } else {
        suggestedType = 'supports';
      }
    }

    // Check if a suggestion already exists for this pair
    const existing = conn.get<{ id: string }>(
      `SELECT id FROM connection_suggestions
       WHERE ((from_claim_id = ? AND to_claim_id = ?) OR (from_claim_id = ? AND to_claim_id = ?))
       AND status = 'pending'`,
      [claimId, result.claimId, result.claimId, claimId],
    );
    if (existing) continue;

    // Store as pending suggestion (I-P12-30)
    const id = randomUUID();
    conn.run(
      `INSERT INTO connection_suggestions
       (id, tenant_id, from_claim_id, to_claim_id, suggested_type, similarity, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, tenantId, claimId, result.claimId, suggestedType, similarity, nowISO],
    );

    suggestions.push({
      id,
      fromClaimId: claimId,
      toClaimId: result.claimId,
      suggestedType,
      similarity,
      status: 'pending',
      createdAt: nowISO,
    });
  }

  return suggestions;
}
