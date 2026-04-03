/**
 * Phase 11: Embedding Queue -- pending embeddings table management + batch processing.
 *
 * Spec ref: PHASE-11-DESIGN-SOURCE.md (Output 1, Embedding Queue)
 * Invariants: I-P11-12 (pending queue atomicity), I-P11-50 (idempotent processing),
 *             I-P11-51 (provider failure isolation), I-P11-52 (batch size limit)
 * DCs: DC-P11-103, DC-P11-203, DC-P11-301, DC-P11-502
 *
 * Architecture: store layer in three-file pattern.
 */

import type { DatabaseConnection } from '../kernel/interfaces/database.js';
import type { Result } from '../kernel/interfaces/common.js';
import type { EmbeddingProvider, PendingEmbedding } from './vector_types.js';
import type { VectorStore } from './vector_store.js';

// ── Result Helpers ──

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

// ── Embedding Queue Interface ──

export interface EmbeddingQueue {
  /** Enqueue a claim for embedding generation. I-P11-12: same transaction as claim INSERT. */
  enqueue(conn: DatabaseConnection, claimId: string, tenantId: string | null, content: string): Result<void>;
  /** Dequeue a batch of pending embeddings (FIFO). I-P11-52: batch size limit. */
  dequeue(conn: DatabaseConnection, batchSize: number): Result<readonly PendingEmbedding[]>;
  /** Remove a specific pending entry (for tombstone). I-P11-31. */
  remove(conn: DatabaseConnection, claimId: string): Result<void>;
  /** Process pending embeddings: fetch batch, call provider, store. I-P11-50, I-P11-51. */
  process(conn: DatabaseConnection, provider: EmbeddingProvider, vectorStore: VectorStore, config: {
    readonly batchSize: number;
    readonly dimensions: number;
    readonly modelId: string;
  }): Promise<Result<{ processed: number; failed: number }>>;
  /** Count pending embeddings. */
  count(conn: DatabaseConnection): Result<number>;
}

// ── Embedding Queue Factory ──

export function createEmbeddingQueue(): EmbeddingQueue {
  return {
    enqueue(conn: DatabaseConnection, claimId: string, tenantId: string | null, content: string): Result<void> {
      try {
        conn.run(
          `INSERT OR IGNORE INTO embedding_pending(claim_id, tenant_id, content) VALUES (?, ?, ?)`,
          [claimId, tenantId, content],
        );
        return ok(undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_ENQUEUE_FAILED', `Failed to enqueue embedding: ${msg}`, 'I-P11-12');
      }
    },

    dequeue(conn: DatabaseConnection, batchSize: number): Result<readonly PendingEmbedding[]> {
      try {
        const effectiveBatchSize = Math.max(1, Math.min(batchSize, 1000));
        const rows = conn.query<Record<string, unknown>>(
          `SELECT claim_id, tenant_id, content, created_at
           FROM embedding_pending
           ORDER BY created_at ASC
           LIMIT ?`,
          [effectiveBatchSize],
        );

        const pending: PendingEmbedding[] = rows.map(row => ({
          claimId: row['claim_id'] as string,
          tenantId: (row['tenant_id'] ?? null) as string | null,
          content: row['content'] as string,
          createdAt: row['created_at'] as string,
        }));

        return ok(pending);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_DEQUEUE_FAILED', `Failed to dequeue: ${msg}`, 'I-P11-52');
      }
    },

    remove(conn: DatabaseConnection, claimId: string): Result<void> {
      try {
        conn.run(`DELETE FROM embedding_pending WHERE claim_id = ?`, [claimId]);
        return ok(undefined);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_REMOVE_FAILED', `Failed to remove pending: ${msg}`, 'I-P11-31');
      }
    },

    async process(conn: DatabaseConnection, provider: EmbeddingProvider, vectorStore: VectorStore, config: {
      readonly batchSize: number;
      readonly dimensions: number;
      readonly modelId: string;
    }): Promise<Result<{ processed: number; failed: number }>> {
      // I-P11-52: Batch size limit
      const dequeueResult = this.dequeue(conn, config.batchSize);
      if (!dequeueResult.ok) return dequeueResult;

      const pending = dequeueResult.value;
      if (pending.length === 0) return ok({ processed: 0, failed: 0 });

      let processed = 0;
      let failed = 0;

      // I-P11-51: Provider failure isolation -- process each claim individually
      for (const item of pending) {
        try {
          // I-P11-50: Check if already embedded (idempotent)
          const existingResult = vectorStore.get(conn, item.claimId);
          if (existingResult.ok && existingResult.value !== null) {
            // Already embedded -- remove from pending queue, count as processed
            conn.run(`DELETE FROM embedding_pending WHERE claim_id = ?`, [item.claimId]);
            processed++;
            continue;
          }

          // Call provider
          const vector = await provider(item.content);

          // I-P11-11: Dimension check
          if (vector.length !== config.dimensions) {
            failed++;
            // Leave in pending for retry with correct provider
            continue;
          }

          // Store embedding
          const storeResult = vectorStore.store(
            conn, item.claimId, item.tenantId, vector, config.modelId,
          );

          if (storeResult.ok) {
            // Remove from pending queue
            conn.run(`DELETE FROM embedding_pending WHERE claim_id = ?`, [item.claimId]);
            processed++;
          } else {
            failed++;
          }
        } catch {
          // I-P11-51: Provider threw for this claim -- continue with next
          // Claim remains in pending queue for retry
          failed++;
        }
      }

      return ok({ processed, failed });
    },

    count(conn: DatabaseConnection): Result<number> {
      try {
        const row = conn.get<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM embedding_pending`,
        );
        return ok(row?.cnt ?? 0);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return err('VECTOR_COUNT_FAILED', `Failed to count pending: ${msg}`, 'I-P11-52');
      }
    },
  };
}
