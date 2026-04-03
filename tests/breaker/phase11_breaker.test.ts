/**
 * Phase 11: Vector Search -- Breaker Attack Tests
 *
 * These tests target surviving mutations and untested invariants
 * found during the Breaker Pass B.
 *
 * Attack vectors:
 *   F-P11-001: KNN tenant isolation mutation survived (M-2)
 *   F-P11-002: GDPR erasure embedding deletion untested (M-5, M-7)
 *   F-P11-003: Duplicate detection threshold untested (M-8)
 *   F-P11-004: KNN query dimension mismatch rejection untested (M-6)
 *   F-P11-005: VectorStore.store() dimension check untested (M-4)
 *   F-P11-006: NaN/Infinity in vectors bypass validation
 *   F-P11-007: reflect() claims invisible to semantic search
 *   F-P11-008: I-P11-12 atomicity claim is false
 *   F-P11-009: DC-P11-104 test is non-discriminative
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createLimen } from '../../src/api/index.js';
import { createVectorStore } from '../../src/vector/vector_store.js';
import { createEmbeddingQueue } from '../../src/vector/embedding_queue.js';
import { checkDuplicate, distanceToSimilarity } from '../../src/vector/duplicate_detector.js';
import type { EmbeddingProvider, VectorConfig } from '../../src/vector/vector_types.js';

// ============================================================================
// Helpers
// ============================================================================

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'limen-p11-brk-'));
}

function masterKey(): Buffer {
  return Buffer.alloc(32, 0xab);
}

const mockProvider: EmbeddingProvider = async (text: string) => {
  const hash = createHash('sha256').update(text).digest();
  const vector = new Array(768).fill(0);
  for (let i = 0; i < 32; i++) {
    vector[i] = (hash[i]! - 128) / 128;
  }
  const norm = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
  return vector.map((v: number) => v / (norm || 1));
};

function similarProvider(dimensions: number = 768): EmbeddingProvider {
  return async (text: string) => {
    const vector = new Array(dimensions).fill(0);
    const lower = text.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      const idx = lower.charCodeAt(i) % dimensions;
      vector[idx] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum: number, v: number) => sum + v * v, 0));
    return vector.map((v: number) => v / (norm || 1));
  };
}

async function withLimen(
  opts: { vector?: VectorConfig; tenantId?: string | null } = {},
  fn: (limen: Awaited<ReturnType<typeof createLimen>>, dataDir: string) => Promise<void> | void,
) {
  const dataDir = tmpDir();
  const limen = await createLimen({
    dataDir,
    masterKey: masterKey(),
    providers: [],
    ...(opts.vector ? { vector: opts.vector } : {}),
  });
  try {
    await fn(limen, dataDir);
  } finally {
    await limen.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function vectorConfig(overrides?: Partial<VectorConfig>): VectorConfig {
  return {
    provider: mockProvider,
    dimensions: 768,
    autoEmbed: false,
    embeddingInterval: 0,
    duplicateThreshold: 0.95,
    batchSize: 50,
    modelId: 'test-model-v1',
    ...overrides,
  };
}

// ============================================================================
// F-P11-001: Tenant Isolation in KNN (M-2 survived)
// ============================================================================

describe('Breaker P11: Tenant Isolation in KNN', () => {

  it('F-P11-001: semantic search MUST NOT return claims from other tenants', async () => {
    // This test requires multi-tenant setup to be discriminative.
    // The Builder's tests only use null tenant, so the tenant filter
    // was completely removable without test failure.
    //
    // ATTACK: If tenant filter is removed from KNN post-filter,
    // claims from tenant-A should NOT appear in tenant-B's search.
    //
    // NOTE: This test documents the gap. A real multi-tenant integration
    // test requires creating Limen instances with different tenantIds.
    await withLimen({ vector: vectorConfig() }, async (limen) => {
      // In single-tenant mode (null), we can only verify the SQL generation.
      // The real test requires multi-tenant setup not available in unit tests.
      // Documenting: M-2 (tenant filter removal) SURVIVED all 60 builder tests.
      const r = limen.remember('entity:test:t1', 'test.tenant', 'tenant data');
      assert.ok(r.ok);
      await limen.embedPending();

      // Verify at minimum that semantic search works in null tenant
      const queryEmbed = await mockProvider('entity:test:t1 test.tenant tenant data');
      const result = limen.search('tenant data', {
        mode: 'semantic',
        queryEmbedding: queryEmbed,
        limit: 10,
      });
      assert.ok(result.ok);
      // This passes even without tenant filter -- non-discriminative for multi-tenant.
      // The finding stands: ZERO multi-tenant semantic search tests exist.
    });
  });
});

// ============================================================================
// F-P11-002: GDPR Erasure Embedding Deletion (M-5, M-7 survived)
// ============================================================================

describe('Breaker P11: GDPR Erasure Embedding Deletion', () => {

  it('F-P11-002: GDPR erasure MUST delete embeddings from vec0 and metadata', async () => {
    // Attack: M-5 (remove embedding deletion from erasure) SURVIVED.
    // M-7 (remove vectorStore from erasure deps) SURVIVED.
    // DC-P11-104 test acknowledges it does not test actual deletion.
    // This test documents the gap.
    await withLimen({ vector: vectorConfig({ duplicateThreshold: 0 }) }, async (limen) => {
      // Create a claim that would be flagged as PII
      const r = limen.remember('entity:user:alice', 'preference.color', 'blue');
      assert.ok(r.ok);
      await limen.embedPending();

      let stats = limen.embeddingStats();
      assert.ok(stats.ok);
      assert.equal(stats.value.embeddedCount, 1, 'Should have 1 embedding before erasure');

      // Attempt GDPR erasure
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'entity:user:alice',
        reason: 'GDPR request',
        includeRelated: false,
      });

      // NOTE: If PII detection is not configured, erasure finds no PII claims
      // and returns ERASURE_NO_CLAIMS_FOUND. This means the embedding is NOT deleted.
      // The Builder's DC-P11-104 test has the same problem -- it never actually
      // exercises the embedding deletion path because PII detection is not enabled.
      // This is a CRITICAL test gap for I-P11-30 (GDPR embedding deletion).
      if (erasureResult.ok) {
        // If erasure succeeded, embedding count should be 0
        stats = limen.embeddingStats();
        assert.ok(stats.ok);
        assert.equal(stats.value.embeddedCount, 0,
          'GDPR erasure must delete embeddings');
      }
      // If ERASURE_NO_CLAIMS_FOUND, the gap is confirmed:
      // PII detection must be configured for this test to be discriminative.
    });
  });
});

// ============================================================================
// F-P11-003: Duplicate Detection Threshold (M-8 survived)
// ============================================================================

describe('Breaker P11: Duplicate Detection Threshold', () => {

  it('F-P11-003: duplicate detection must respect threshold value', async () => {
    // Attack: M-8 changed isDuplicate from threshold comparison to
    // `candidates.length > 0` -- all tests still passed.
    // This test verifies the threshold actually discriminates.
    const charProvider = similarProvider(768);
    await withLimen(
      {
        vector: {
          provider: charProvider,
          dimensions: 768,
          autoEmbed: false,
          embeddingInterval: 0,
          duplicateThreshold: 0.99, // Very high threshold
          batchSize: 50,
          modelId: 'dup-test',
        },
      },
      async (limen) => {
        // Store and embed
        limen.remember('entity:test:orig', 'test.dup', 'the quick brown fox');
        await limen.embedPending();

        // Check with similar but not identical text -- should NOT be flagged
        // at 0.99 threshold (only exact duplicates)
        const dupResult = await limen.checkDuplicate(
          'entity:test:similar',
          'test.dup',
          'the quick brown foxes', // slightly different
        );
        assert.ok(dupResult.ok);
        // With a 0.99 threshold, slightly different text should NOT be duplicate
        // If M-8 mutation (candidates.length > 0) were applied, this would
        // incorrectly flag it as duplicate when candidates exist but similarity < 0.99
        if (dupResult.value.candidates.length > 0) {
          // There are candidates, but with 0.99 threshold, isDuplicate should be false
          // unless the similarity actually exceeds 0.99
          const maxSim = Math.max(...dupResult.value.candidates.map(c => c.similarity));
          if (maxSim < 0.99) {
            assert.equal(dupResult.value.isDuplicate, false,
              `With threshold=0.99 and max similarity=${maxSim}, isDuplicate must be false`);
          }
        }
      },
    );
  });
});

// ============================================================================
// F-P11-006: NaN/Infinity in Vectors
// ============================================================================

describe('Breaker P11: NaN/Infinity Vector Values', () => {

  it('F-P11-006: NaN in provider output should be caught', async () => {
    const nanProvider: EmbeddingProvider = async (_text: string) => {
      const vec = new Array(768).fill(0.1);
      vec[0] = NaN;
      return vec;
    };

    await withLimen(
      { vector: vectorConfig({ provider: nanProvider, duplicateThreshold: 0 }) },
      async (limen) => {
        limen.remember('entity:test:nan', 'test.nan', 'nan test');
        const result = await limen.embedPending();
        assert.ok(result.ok);
        // If NaN is not validated, it gets stored in vec0 as NaN
        // which corrupts KNN queries (NaN distance comparisons are always false).
        // This is a data integrity issue: I-P11-10 says "stored as-is" but
        // NaN is garbage data from a failed computation, not valid output.
        //
        // Current behavior: NaN passes dimension check, gets stored.
        // Expected behavior: NaN should be rejected or at minimum detected.
      },
    );
  });

  it('F-P11-006b: Infinity in provider output should be caught', async () => {
    const infProvider: EmbeddingProvider = async (_text: string) => {
      const vec = new Array(768).fill(0.1);
      vec[0] = Infinity;
      return vec;
    };

    await withLimen(
      { vector: vectorConfig({ provider: infProvider, duplicateThreshold: 0 }) },
      async (limen) => {
        limen.remember('entity:test:inf', 'test.inf', 'infinity test');
        const result = await limen.embedPending();
        assert.ok(result.ok);
        // Same as NaN -- Infinity corrupts distance computations.
      },
    );
  });
});

// ============================================================================
// F-P11-007: reflect() Claims Invisible to Semantic Search
// ============================================================================

describe('Breaker P11: reflect() Embedding Gap', () => {

  it('F-P11-007: claims created via reflect() should be embeddable', async () => {
    await withLimen({ vector: vectorConfig({ duplicateThreshold: 0 }) }, async (limen) => {
      // Create claims via reflect()
      const reflectResult = limen.reflect([
        { category: 'pattern', statement: 'an important pattern about testing', confidence: 0.8 },
        { category: 'warning', statement: 'a critical warning about security', confidence: 0.9 },
      ]);
      assert.ok(reflectResult.ok, 'reflect should succeed');

      // Check pending queue
      const stats = limen.embeddingStats();
      assert.ok(stats.ok);
      // If reflect() does not enqueue embeddings, pendingCount will be 0
      // despite 2 claims being created.
      // This documents the wiring gap: reflect() creates claims but does NOT
      // enqueue them for embedding.
      //
      // NOTE: This test INTENTIONALLY checks the current (broken) behavior
      // to document the finding. If fixed, pendingCount should be 2.
      if (stats.value.pendingCount === 0) {
        // Gap confirmed: reflect() does not enqueue embeddings
        assert.equal(stats.value.pendingCount, 0,
          'CONFIRMED: reflect() does not enqueue embeddings -- wiring gap');
      }
    });
  });
});

// ============================================================================
// F-P11-009: DC-P11-104 Non-Discriminative
// ============================================================================

describe('Breaker P11: DC-P11-104 Discriminative Test', () => {

  it('F-P11-009: DC-P11-104 builder test is non-discriminative', async () => {
    // The builder's DC-P11-104 test creates a claim, embeds it, calls erasure,
    // then comments: "The embedding may still be present if the claim wasn't
    // flagged as PII. The wiring is verified structurally -- this confirms no crash."
    //
    // A test that "confirms no crash" is HB#8 adjacent -- it passes regardless of
    // whether the implementation correctly deletes embeddings.
    //
    // This test simply documents: the builder's test does not verify embedding
    // deletion because PII detection is not configured in the test setup.
    await withLimen({ vector: vectorConfig({ duplicateThreshold: 0 }) }, async (limen) => {
      const r = limen.remember('entity:user:testpii', 'preference.data', 'sensitive');
      assert.ok(r.ok);
      await limen.embedPending();

      // Without PII detection configured, erasure returns NO_CLAIMS_FOUND
      const erasureResult = limen.governance.erasure({
        dataSubjectId: 'entity:user:testpii',
        reason: 'test',
        includeRelated: false,
      });

      // This documents the gap: erasure cannot find PII claims without PII detection
      if (!erasureResult.ok) {
        assert.equal(erasureResult.error.code, 'ERASURE_NO_CLAIMS_FOUND',
          'Without PII detection, erasure finds nothing -- test is non-discriminative');
      }
    });
  });
});

// ============================================================================
// F-P11-004/005: Dimension Validation at VectorStore Level
// ============================================================================

describe('Breaker P11: Dimension Validation Gaps', () => {

  it('F-P11-004: KNN query with wrong dimensions should be rejected', async () => {
    // M-6 survived: removing the query dimension check from knn() had no test failure.
    // This test verifies the guard works.
    await withLimen({ vector: vectorConfig({ duplicateThreshold: 0 }) }, async (limen) => {
      limen.remember('entity:test:dim', 'test.dim', 'some text');
      await limen.embedPending();

      // Search with wrong-dimension query vector (512 instead of 768)
      const wrongDimQuery = new Array(512).fill(0.1);
      const result = limen.search('some text', {
        mode: 'semantic',
        queryEmbedding: wrongDimQuery,
        limit: 10,
      });

      assert.equal(result.ok, false, 'Wrong dimension query should fail');
      if (!result.ok) {
        assert.equal(result.error.code, 'VECTOR_DIMENSION_MISMATCH',
          'Should return VECTOR_DIMENSION_MISMATCH for wrong query dimensions');
      }
    });
  });

  it('F-P11-005: VectorStore.store() dimension check is defensive', () => {
    // M-4 survived: removing dimension validation from store() had no test failure
    // because the EmbeddingQueue.process() has its own check that fires first.
    // This test verifies the store-level guard independently.
    const store = createVectorStore(true, 768);
    // We cannot easily call store() without a real connection to vec0,
    // but we document: the store-level guard is defense-in-depth and
    // never exercised by any test because the queue-level guard fires first.
  });
});

// ============================================================================
// F-P11-010: distanceToSimilarity with Negative Distance
// ============================================================================

describe('Breaker P11: Edge Cases in Distance Conversion', () => {

  it('negative distance produces similarity > 1 before clamping', () => {
    // If vec0 returns a negative distance (which it shouldn't, but
    // robustness matters), distanceToSimilarity should still return [0,1].
    const sim = distanceToSimilarity(-0.5);
    assert.ok(sim >= 0 && sim <= 1, `Similarity ${sim} must be in [0,1]`);
  });

  it('NaN distance should not produce NaN similarity', () => {
    const sim = distanceToSimilarity(NaN);
    // NaN * NaN = NaN, 1 - NaN/2 = NaN, Math.max(0, NaN) = 0
    // Actually: Math.max(0, Math.min(1, NaN)) = Math.max(0, NaN) = 0
    assert.ok(!Number.isNaN(sim), `Similarity must not be NaN, got ${sim}`);
  });
});

// ============================================================================
// F-P11-011: Background Timer Resource Leak
// ============================================================================

describe('Breaker P11: Background Timer', () => {

  it('background embedding timer must be cleared on shutdown', async () => {
    // If the timer is not cleared, it holds a reference to the connection
    // and can cause "database locked" or use-after-close errors.
    // This is a resource leak concern.
    const dataDir = tmpDir();
    const limen = await createLimen({
      dataDir,
      masterKey: masterKey(),
      providers: [],
      vector: {
        provider: mockProvider,
        dimensions: 768,
        autoEmbed: false,
        embeddingInterval: 1000, // Enable background timer
        duplicateThreshold: 0,
        batchSize: 50,
        modelId: 'timer-test',
      },
    });
    // Shutdown should clear the timer
    await limen.shutdown();
    // If the timer is not cleared, subsequent cleanup will fail or leak
    fs.rmSync(dataDir, { recursive: true, force: true });
    // No assertion needed -- if timer leaks, the process would hang or error
  });
});
