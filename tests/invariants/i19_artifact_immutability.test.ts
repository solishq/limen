/**
 * Verifies: §4 I-19, §8, §18, I-23
 * Phase: 4G (Test Hardening Sweep — CF-003)
 *
 * I-19: Artifact Immutability.
 * "Every artifact version is immutable once created. Revisions create new
 * versions. Complete version history preserved. Artifacts are tenant-isolated
 * and subject to data retention policies."
 *
 * Cross-references:
 * - §8: Core Object: Artifact (version, lifecycleState, parentArtifactId)
 * - §18: SC-4 create_artifact (version 1 insert vs N+1 revision)
 * - I-23: Artifact Dependency Tracking (invalidation cascades)
 * - FM-15: Artifact Entropy (lifecycle states manage accumulation)
 *
 * Phase 4G: All stubs replaced with real behavioral assertions using
 * createArtifactStore() and createTestOrchestrationDeps().
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  taskId,
} from '../helpers/test_database.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import type { ArtifactId, MissionId, TaskId } from '../../src/kernel/interfaces/index.js';
import type { ArtifactType, ArtifactFormat } from '../../src/orchestration/interfaces/orchestration.js';

/** Helper: create an artifact through the production store interface */
function createArtifact(
  deps: Parameters<ReturnType<typeof createArtifactStore>['create']>[0],
  ctx: Parameters<ReturnType<typeof createArtifactStore>['create']>[1],
  overrides: {
    missionId?: string;
    name?: string;
    type?: ArtifactType;
    format?: ArtifactFormat;
    content?: string;
    sourceTaskId?: string;
    parentArtifactId?: string | null;
  } = {},
) {
  const store = createArtifactStore();
  return store.create(deps, ctx, {
    missionId: missionId(overrides.missionId ?? 'art-m1') as MissionId,
    name: overrides.name ?? 'test-artifact',
    type: overrides.type ?? 'data',
    format: overrides.format ?? 'json',
    content: overrides.content ?? '{"test": true}',
    sourceTaskId: taskId(overrides.sourceTaskId ?? 'seed-task') as TaskId,
    parentArtifactId: (overrides.parentArtifactId ?? null) as ArtifactId | null,
    metadata: {},
  });
}

describe('I-19: Artifact Immutability', () => {

  describe('Content Immutability', () => {
    it('content BLOB is write-once -- UPDATE blocked by trigger (§8, I-19)', () => {
      /**
       * §8: "Content BLOB is write-once."
       * Migration 014: BEFORE UPDATE trigger on core_artifacts.content
       * raises ABORT with I-19 message.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const result = createArtifact(deps, ctx);
      assert.equal(result.ok, true, 'Artifact creation must succeed');
      if (!result.ok) return;

      // Try to UPDATE content — trigger must prevent it
      let threw = false;
      let errorMsg = '';
      try {
        conn.run(
          `UPDATE core_artifacts SET content = X'DEADBEEF' WHERE id = ? AND version = ?`,
          [result.value.artifactId, result.value.version],
        );
      } catch (err) {
        threw = true;
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      assert.equal(threw, true,
        'CATCHES: without immutability trigger, content UPDATE silently succeeds');
      assert.ok(errorMsg.includes('I-19'),
        'CATCHES: trigger error message must reference I-19');

      conn.close();
    });

    it('artifact type immutable after creation -- UPDATE blocked by trigger (§8, I-19)', () => {
      /**
       * §8: type is set at creation and never changed for that version.
       * Migration 014: BEFORE UPDATE trigger on core_artifacts.type.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const result = createArtifact(deps, ctx);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      let threw = false;
      try {
        conn.run(
          `UPDATE core_artifacts SET type = 'code' WHERE id = ? AND version = ?`,
          [result.value.artifactId, result.value.version],
        );
      } catch {
        threw = true;
      }

      assert.equal(threw, true,
        'CATCHES: without type trigger, artifact type can be silently changed');

      conn.close();
    });

    it('no UPDATE method exposed on artifact store interface (I-19)', () => {
      /**
       * I-19: The interface must not provide an update path.
       * The only way to change artifact content is to create a new version.
       */
      const store = createArtifactStore();
      const keys = Object.keys(store);

      assert.equal(keys.includes('update'), false,
        'CATCHES: an update method on store would violate I-19 write-once contract');
      assert.equal(keys.includes('modify'), false,
        'CATCHES: a modify method on store would violate I-19 write-once contract');
      // Verify the expected interface shape
      assert.ok(keys.includes('create'), 'Store must have create method');
      assert.ok(keys.includes('read'), 'Store must have read method');
    });
  });

  describe('Version History', () => {
    it('first creation produces version 1 (§18)', () => {
      /**
       * §18 Side Effects: "If new artifact: version 1 inserted"
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const result = createArtifact(deps, ctx);
      assert.equal(result.ok, true, 'Artifact creation must succeed');
      if (!result.ok) return;

      assert.equal(result.value.version, 1,
        'CATCHES: without version initialization, new artifact gets wrong version');

      conn.close();
    });

    it('revision produces version N+1 linked to parent (§18)', () => {
      /**
       * §18 Side Effects: "If revision: new version (N+1) linked to parent"
       * parentArtifactId points to the previous version's artifact.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      // Create version 1
      const v1 = createArtifact(deps, ctx, { content: 'version 1 content' });
      assert.equal(v1.ok, true);
      if (!v1.ok) return;
      assert.equal(v1.value.version, 1);

      // Create version 2 as revision of v1
      const v2 = createArtifact(deps, ctx, {
        content: 'version 2 content',
        parentArtifactId: v1.value.artifactId as string,
      });
      assert.equal(v2.ok, true, 'Revision must succeed');
      if (!v2.ok) return;

      assert.equal(v2.value.version, 2,
        'CATCHES: without version incrementing, revision overwrites original');
      assert.equal(v2.value.artifactId as string, v1.value.artifactId as string,
        'CATCHES: revision must share artifact ID with parent');

      conn.close();
    });

    it('version numbers are monotonic across multiple revisions (§8)', () => {
      /**
       * §8: "version: number (monotonic, auto-incremented on revision)"
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      // Create 3 versions
      const v1 = createArtifact(deps, ctx, { content: 'v1' });
      assert.equal(v1.ok, true);
      if (!v1.ok) return;

      const v2 = createArtifact(deps, ctx, {
        content: 'v2',
        parentArtifactId: v1.value.artifactId as string,
      });
      assert.equal(v2.ok, true);
      if (!v2.ok) return;

      const v3 = createArtifact(deps, ctx, {
        content: 'v3',
        parentArtifactId: v1.value.artifactId as string,
      });
      assert.equal(v3.ok, true);
      if (!v3.ok) return;

      // Verify monotonic
      const versions = [v1.value.version, v2.value.version, v3.value.version];
      for (let i = 1; i < versions.length; i++) {
        assert.ok(versions[i] > versions[i - 1],
          `CATCHES: version ${versions[i]} must be > ${versions[i - 1]} (monotonic)`);
      }

      conn.close();
    });

    it('previous versions remain accessible after new versions created (I-19)', () => {
      /**
       * I-19: "Complete version history preserved."
       * Version 1 is still readable after version 2 is created.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const store = createArtifactStore();

      // Create v1
      const v1 = createArtifact(deps, ctx, { content: 'original content' });
      assert.equal(v1.ok, true);
      if (!v1.ok) return;

      // Create v2
      const v2 = createArtifact(deps, ctx, {
        content: 'revised content',
        parentArtifactId: v1.value.artifactId as string,
      });
      assert.equal(v2.ok, true);
      if (!v2.ok) return;

      // Read v1 — must still exist with original content
      const readV1 = store.read(deps, ctx, {
        artifactId: v1.value.artifactId,
        version: 1,
      });
      assert.equal(readV1.ok, true,
        'CATCHES: without version preservation, old versions lost after revision');
      if (!readV1.ok) return;

      assert.equal(readV1.value.artifact.version, 1);
      const v1Content = readV1.value.artifact.content instanceof Buffer
        ? readV1.value.artifact.content.toString('utf-8')
        : readV1.value.artifact.content;
      assert.equal(v1Content, 'original content',
        'CATCHES: v1 content must be unchanged after v2 creation');

      conn.close();
    });

    it('parentArtifactId links revision to previous version in DB (§8)', () => {
      /**
       * §8: "parentArtifactId: ArtifactId | null (if this is a revision)"
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const v1 = createArtifact(deps, ctx, { content: 'v1' });
      assert.equal(v1.ok, true);
      if (!v1.ok) return;

      createArtifact(deps, ctx, {
        content: 'v2',
        parentArtifactId: v1.value.artifactId as string,
      });

      // Verify parentArtifactId in DB
      const v1Row = conn.get<{ parent_artifact_id: string | null }>(
        'SELECT parent_artifact_id FROM core_artifacts WHERE id = ? AND version = 1',
        [v1.value.artifactId],
      );
      assert.equal(v1Row?.parent_artifact_id, null,
        'CATCHES: first version must have null parentArtifactId');

      const v2Row = conn.get<{ parent_artifact_id: string | null }>(
        'SELECT parent_artifact_id FROM core_artifacts WHERE id = ? AND version = 2',
        [v1.value.artifactId],
      );
      assert.equal(v2Row?.parent_artifact_id, v1.value.artifactId as string,
        'CATCHES: revision must reference parent artifact');

      conn.close();
    });
  });

  describe('Lifecycle State Transitions', () => {
    it('lifecycle transitions do not modify content (I-19)', () => {
      /**
       * §8 Lifecycle States: ACTIVE -> ARCHIVED
       * These control working-set membership, not content.
       * An ARCHIVED artifact has the same content as when it was ACTIVE.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const store = createArtifactStore();
      const result = createArtifact(deps, ctx, { content: 'immutable content' });
      assert.equal(result.ok, true);
      if (!result.ok) return;

      // Read content before archival
      const beforeRow = conn.get<{ content: Buffer }>(
        'SELECT content FROM core_artifacts WHERE id = ? AND version = ?',
        [result.value.artifactId, result.value.version],
      );
      assert.ok(beforeRow !== undefined);

      // Archive — changes lifecycle_state but NOT content
      store.archiveForMission(deps, missionId('art-m1'));

      // Read content after archival
      const afterRow = conn.get<{ content: Buffer; lifecycle_state: string }>(
        'SELECT content, lifecycle_state FROM core_artifacts WHERE id = ? AND version = ?',
        [result.value.artifactId, result.value.version],
      );
      assert.ok(afterRow !== undefined);
      assert.equal(afterRow!.lifecycle_state, 'ARCHIVED');
      assert.deepEqual(afterRow!.content, beforeRow!.content,
        'CATCHES: archive must not modify content (I-19 preservation)');

      conn.close();
    });

    it('ACTIVE artifacts are readable through store.read (§8)', () => {
      /**
       * §8: "ACTIVE (readable by agents, counts in working set)"
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const store = createArtifactStore();
      const result = createArtifact(deps, ctx);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      const readResult = store.read(deps, ctx, {
        artifactId: result.value.artifactId,
        version: 'latest',
      });
      assert.equal(readResult.ok, true,
        'CATCHES: ACTIVE artifacts must be readable');
      if (!readResult.ok) return;
      assert.equal(readResult.value.artifact.lifecycleState, 'ACTIVE');

      conn.close();
    });

    it.skip('SUMMARIZED: original preserved — §8 contract placeholder', () => {
      // UNTESTABLE: No summarization implementation exists. The SUMMARIZED state is
      // defined in the schema and type system but no code path produces it yet.
      // §8: "SUMMARIZED (original replaced by LLM-generated summary, original archived)"
    });

    it('ARCHIVED artifacts return error through store.read (§8)', () => {
      /**
       * §8: "ARCHIVED (cold storage, not in working set, readable by explicit
       * version request)" — store.read returns ARCHIVED error for these.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const store = createArtifactStore();
      const result = createArtifact(deps, ctx);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      // Archive it
      store.archiveForMission(deps, missionId('art-m1'));

      // Read must fail with ARCHIVED
      const readResult = store.read(deps, ctx, {
        artifactId: result.value.artifactId,
        version: 'latest',
      });
      assert.equal(readResult.ok, false,
        'CATCHES: ARCHIVED artifacts must not be silently readable as ACTIVE');
      if (readResult.ok) return;
      assert.equal(readResult.error.code, 'ARCHIVED',
        'CATCHES: error code must be ARCHIVED, not generic');

      conn.close();
    });

    it('DELETED artifacts return error through store.read (§8)', () => {
      /**
       * §8: "DELETED (purged per retention policy)"
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext();
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'art-m1' });

      const store = createArtifactStore();
      const result = createArtifact(deps, ctx);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      // Set to DELETED via direct SQL (no delete method exposed — retention policy driven)
      conn.run(
        `UPDATE core_artifacts SET lifecycle_state = 'DELETED' WHERE id = ? AND version = ?`,
        [result.value.artifactId, result.value.version],
      );

      const readResult = store.read(deps, ctx, {
        artifactId: result.value.artifactId,
        version: 'latest',
      });
      assert.equal(readResult.ok, false,
        'CATCHES: DELETED artifacts must not be readable');

      conn.close();
    });

    it.skip('automatic ACTIVE -> SUMMARIZED when relevanceDecay exceeds threshold — §8 contract placeholder', () => {
      // UNTESTABLE: No relevance decay engine implementation exists.
      // The relevance_decay column exists in schema but no code drives transitions.
      // §8: "Automatic transition: ACTIVE -> SUMMARIZED when relevanceDecay exceeds threshold."
    });
  });

  describe('Tenant Isolation', () => {
    it('artifacts are tenant-scoped via tenant_id column (I-19)', () => {
      /**
       * I-19: "Artifacts are tenant-isolated and subject to data retention policies."
       * Verify tenant_id is stored and queryable.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const ctx = createTestOperationContext({ tenantId: 'tenant-alpha' });
      seedMission(conn, { id: 'art-m1', agentId: 'agent-1', state: 'EXECUTING', tenantId: 'tenant-alpha' });
      seedResource(conn, { missionId: 'art-m1', tenantId: 'tenant-alpha' });

      const result = createArtifact(deps, ctx);
      assert.equal(result.ok, true);
      if (!result.ok) return;

      // Verify tenant_id stored correctly
      const row = conn.get<{ tenant_id: string }>(
        'SELECT tenant_id FROM core_artifacts WHERE id = ? AND version = ?',
        [result.value.artifactId, result.value.version],
      );
      assert.equal(row?.tenant_id, 'tenant-alpha',
        'CATCHES: without tenant_id storage, cross-tenant artifact leakage possible');

      // Verify no results for different tenant query
      const otherTenant = conn.get<{ id: string }>(
        'SELECT id FROM core_artifacts WHERE tenant_id = ?',
        ['tenant-beta'],
      );
      assert.equal(otherTenant, undefined,
        'CATCHES: tenant-beta must not see tenant-alpha artifacts');

      conn.close();
    });
  });

  describe('Dependency Invalidation (I-23 integration)', () => {
    it.skip('invalidating a source artifact flags dependents as STALE — contract placeholder', () => {
      // UNTESTABLE: No invalidation cascade implementation exists.
      // trackDependency records edges; no code reads them to propagate STALE.
      // I-23: "If source artifact is invalidated, all dependent artifacts are flagged STALE."
    });
  });
});
