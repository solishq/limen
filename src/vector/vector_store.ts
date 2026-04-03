/**
 * Phase 11: Vector Store -- vec0 table management, embedding CRUD, KNN queries.
 *
 * Spec ref: PHASE-11-DESIGN-SOURCE.md (Output 1, Vector Store)
 * Invariants: I-P11-10 (fidelity), I-P11-11 (dimension enforcement),
 *             I-P11-13 (model identity), I-P11-20 (retracted exclusion),
 *             I-P11-21 (tenant isolation), I-P11-22 (KNN ordering),
 *             I-P11-30 (tombstone deletes), I-P11-31 (tombstone clears pending)
 * DCs: DC-P11-101, DC-P11-102, DC-P11-104, DC-P11-105, DC-P11-202,
 *       DC-P11-701, DC-P11-803, DC-P11-804
 *
 * Architecture: store layer in three-file pattern.
 * All business logic lives here.
 */

import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { Result } from '../kernel/interfaces/common.js';
import type { StoredEmbedding } from './vector_types.js';
import { DEFAULT_VECTOR_CONFIG } from './vector_types.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

// ── Vector Store Interface ──

export interface VectorStore {
  /** Store an embedding in vec0 + metadata. I-P11-10: fidelity. I-P11-11: dimension check. */
  store(conn: DatabaseConnection, claimId: string, tenantId: string | null, vector: number[], modelId: string): Result<void>;
  /** Delete an embedding from vec0 + metadata. I-P11-30: tombstone deletes. */
  delete(conn: DatabaseConnection, claimId: string): Result<void>;
  /** Batch delete embeddings. I-P11-30: GDPR erasure. */
  deleteBatch(conn: DatabaseConnection, claimIds: readonly string[]): Result<number>;
  /** KNN search with tenant isolation. I-P11-20, I-P11-21, I-P11-22. */
  knn(conn: DatabaseConnection, queryVector: number[], k: number, tenantId: string | null): Result<Array<{ claimId: string; distance: number }>>;
  /** Retrieve stored embedding metadata. */
  get(conn: DatabaseConnection, claimId: string): Result<StoredEmbedding | null>;
  /** Whether vec0 is usable. I-P11-01: core independence. */
  isAvailable(): boolean;
}

// ── Vector Store Factory ──

/**
 * Create a VectorStore instance.
 *
 * @param vectorAvailable - Whether sqlite-vec was loaded successfully
 * @param dimensions - Configured embedding dimensions (from VectorConfig)
 */
export function createVectorStore(
  vectorAvailable: boolean,
  dimensions: number = DEFAULT_VECTOR_CONFIG.dimensions,
): VectorStore {
  return {
    store(conn: DatabaseConnection, claimId: string, tenantId: string | null, vector: number[], modelId: string): Result<void> {
      if (!vectorAvailable) {
        return err('VECTOR_NOT_AVAILABLE', 'sqlite-vec is not installed', 'I-P11-01');
      }

      // I-P11-11: Dimension enforcement
      if (vector.length !== dimensions) {
        return err(
          'VECTOR_DIMENSION_MISMATCH',
          `Expected ${dimensions} dimensions, got ${vector.length}`,
          'I-P11-11',
        );
      }

      // F-P11-006: Reject vectors containing NaN, Infinity, or -Infinity
      for (let i = 0; i < vector.length; i++) {
        if (!Number.isFinite(vector[i])) {
          return err(
            'VECTOR_INVALID_VALUES',
            `Vector contains non-finite value at index ${i}: ${vector[i]}`,
            'I-P11-10',
          );
        }
      }

      try {
        // I-P11-10: Store vector as-is (no normalization, no truncation)
        // sqlite-vec expects a Buffer from Float32Array
        const vectorBuffer = Buffer.from(new Float32Array(vector).buffer);

        conn.run(
          `INSERT OR REPLACE INTO claim_embeddings(claim_id, embedding) VALUES (?, ?)`,
          [claimId, vectorBuffer],
        );

        // I-P11-13: Record model identity in metadata
        const now = conn.get<{ now: string }>(
          `SELECT strftime('%Y-%m-%dT%H:%M:%f', 'now') as now`,
        );
        conn.run(
          `INSERT OR REPLACE INTO embedding_metadata(claim_id, tenant_id, model_id, dimensions, created_at) VALUES (?, ?, ?, ?, ?)`,
          [claimId, tenantId, modelId, dimensions, now?.now ?? new Date().toISOString()],
        );

        return ok(undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_STORE_FAILED', `Failed to store embedding: ${msg}`, 'I-P11-10');
      }
    },

    delete(conn: DatabaseConnection, claimId: string): Result<void> {
      try {
        // Delete from vec0 first (if available), then metadata
        if (vectorAvailable) {
          try {
            conn.run(`DELETE FROM claim_embeddings WHERE claim_id = ?`, [claimId]);
          } catch {
            // vec0 row might not exist -- that is fine
          }
        }
        conn.run(`DELETE FROM embedding_metadata WHERE claim_id = ?`, [claimId]);
        conn.run(`DELETE FROM embedding_pending WHERE claim_id = ?`, [claimId]);
        return ok(undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_DELETE_FAILED', `Failed to delete embedding: ${msg}`, 'I-P11-30');
      }
    },

    deleteBatch(conn: DatabaseConnection, claimIds: readonly string[]): Result<number> {
      if (claimIds.length === 0) return ok(0);

      try {
        let deleted = 0;
        for (const claimId of claimIds) {
          if (vectorAvailable) {
            try {
              conn.run(`DELETE FROM claim_embeddings WHERE claim_id = ?`, [claimId]);
            } catch {
              // vec0 row might not exist
            }
          }
          const result = conn.run(`DELETE FROM embedding_metadata WHERE claim_id = ?`, [claimId]);
          conn.run(`DELETE FROM embedding_pending WHERE claim_id = ?`, [claimId]);
          deleted += result.changes;
        }
        return ok(deleted);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_DELETE_FAILED', `Batch delete failed: ${msg}`, 'I-P11-30');
      }
    },

    knn(conn: DatabaseConnection, queryVector: number[], k: number, tenantId: string | null): Result<Array<{ claimId: string; distance: number }>> {
      if (!vectorAvailable) {
        return err('VECTOR_NOT_AVAILABLE', 'sqlite-vec is not installed', 'I-P11-01');
      }

      // I-P11-11: Dimension enforcement for query vector
      if (queryVector.length !== dimensions) {
        return err(
          'VECTOR_DIMENSION_MISMATCH',
          `Query vector has ${queryVector.length} dimensions, expected ${dimensions}`,
          'I-P11-11',
        );
      }

      try {
        const queryBuffer = Buffer.from(new Float32Array(queryVector).buffer);

        // vec0 KNN queries have restricted syntax: WHERE embedding MATCH ? AND k = ?
        // Cannot JOIN in the same query. Two-phase approach:
        //   1. KNN against vec0 to get candidate claim_ids + distances
        //   2. Filter candidates by status, tenant, purged_at from claim_assertions
        //
        // I-P11-20: Retracted claims excluded via status='active' (post-filter)
        // I-P11-21: Tenant isolation via tenant_id (post-filter)
        // I-P11-22: Results ordered by distance ascending (closest first)
        const fetchSize = Math.min(k * 5, 1000); // Fetch more to account for post-filtering

        // Phase 1: KNN search on vec0
        const knnRows = conn.query<Record<string, unknown>>(
          `SELECT claim_id, distance
           FROM claim_embeddings
           WHERE embedding MATCH ?
             AND k = ?`,
          [queryBuffer, fetchSize],
        );

        // Phase 2: Post-filter against claim_assertions
        const results: Array<{ claimId: string; distance: number }> = [];
        for (const row of knnRows) {
          if (results.length >= k) break;

          const claimId = row['claim_id'] as string;
          const distance = row['distance'] as number;

          // Check claim status + tenant
          const tenantCheck = tenantId !== null
            ? 'AND tenant_id = ?'
            : 'AND tenant_id IS NULL';
          const tenantParams = tenantId !== null ? [tenantId] : [];

          const claim = conn.get<Record<string, unknown>>(
            `SELECT id FROM claim_assertions
             WHERE id = ?
               AND status = 'active'
               AND purged_at IS NULL
               ${tenantCheck}`,
            [claimId, ...tenantParams],
          );

          if (claim) {
            results.push({ claimId, distance });
          }
        }

        return ok(results);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_KNN_FAILED', `KNN search failed: ${msg}`, 'I-P11-22');
      }
    },

    get(conn: DatabaseConnection, claimId: string): Result<StoredEmbedding | null> {
      try {
        const row = conn.get<Record<string, unknown>>(
          `SELECT claim_id, model_id, dimensions, created_at FROM embedding_metadata WHERE claim_id = ?`,
          [claimId],
        );
        if (!row) return ok(null);
        return ok({
          claimId: row['claim_id'] as string,
          modelId: row['model_id'] as string,
          dimensions: row['dimensions'] as number,
          createdAt: row['created_at'] as string,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_GET_FAILED', `Failed to get embedding: ${msg}`, 'I-P11-13');
      }
    },

    isAvailable(): boolean {
      return vectorAvailable;
    },
  };
}
