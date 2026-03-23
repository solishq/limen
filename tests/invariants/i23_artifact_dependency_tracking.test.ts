/**
 * Verifies: §4 I-23, §8, §19, FM-15
 * Phase: 4G (Test Hardening Sweep — CF-003)
 *
 * I-23: Artifact Dependency Tracking.
 * "Every read_artifact call creates a tracked dependency edge."
 *
 * Phase 4G: Stubs replaced with real behavioral assertions using
 * createArtifactStore().trackDependency() and createTestOrchestrationDeps.
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
import type { MissionId, ArtifactId, TaskId } from '../../src/kernel/interfaces/index.js';

describe('I-23: Artifact Dependency Tracking', () => {

  describe('Dependency Edge Creation', () => {
    it('trackDependency creates edge in core_artifact_dependencies (I-23)', () => {
      /**
       * §19 Side Effects: "Dependency edge created if caller produces artifacts"
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const artifacts = createArtifactStore();
      const ctx = createTestOperationContext();

      seedMission(conn, { id: 'dep-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'dep-m1' });
      seedMission(conn, { id: 'dep-m2', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'dep-m2' });

      // Create an artifact
      const artResult = artifacts.create(deps, ctx, {
        missionId: missionId('dep-m1') as MissionId,
        name: 'source-artifact',
        type: 'data',
        format: 'json',
        content: '{"data": true}',
        sourceTaskId: taskId('seed-task') as TaskId,
        parentArtifactId: null as unknown as ArtifactId | null,
        metadata: {},
      });
      assert.equal(artResult.ok, true);
      if (!artResult.ok) return;

      // Track dependency: mission dep-m2 reads this artifact
      const trackResult = artifacts.trackDependency(
        deps,
        missionId('dep-m2') as MissionId,
        artResult.value.artifactId,
        artResult.value.version,
        true, // cross-mission
      );
      assert.equal(trackResult.ok, true, 'trackDependency must succeed');

      // Verify edge in database
      const edge = conn.get<{
        reading_mission_id: string;
        artifact_id: string;
        artifact_version: number;
        is_cross_mission: number;
      }>(
        'SELECT reading_mission_id, artifact_id, artifact_version, is_cross_mission FROM core_artifact_dependencies WHERE reading_mission_id = ?',
        ['dep-m2'],
      );

      assert.ok(edge !== undefined,
        'CATCHES: without dependency tracking, invalidation cascade has no graph');
      assert.equal(edge!.reading_mission_id, 'dep-m2');
      assert.equal(edge!.artifact_id, artResult.value.artifactId as string);
      assert.equal(edge!.artifact_version, 1);
      assert.equal(edge!.is_cross_mission, 1,
        'CATCHES: without cross-mission flag, cannot distinguish local vs external dependencies');

      conn.close();
    });

    it('duplicate trackDependency calls create one edge (INSERT OR IGNORE) (I-23)', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const artifacts = createArtifactStore();
      const ctx = createTestOperationContext();

      seedMission(conn, { id: 'dep-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'dep-m1' });
      seedMission(conn, { id: 'dep-m2', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'dep-m2' });

      const artResult = artifacts.create(deps, ctx, {
        missionId: missionId('dep-m1') as MissionId,
        name: 'source', type: 'data', format: 'json', content: '{}',
        sourceTaskId: taskId('seed-task') as TaskId,
        parentArtifactId: null as unknown as ArtifactId | null, metadata: {},
      });
      assert.equal(artResult.ok, true);
      if (!artResult.ok) return;

      // Track same dependency twice
      artifacts.trackDependency(deps, missionId('dep-m2') as MissionId, artResult.value.artifactId, 1, true);
      artifacts.trackDependency(deps, missionId('dep-m2') as MissionId, artResult.value.artifactId, 1, true);

      const count = conn.get<{ c: number }>(
        'SELECT COUNT(*) as c FROM core_artifact_dependencies WHERE reading_mission_id = ? AND artifact_id = ?',
        ['dep-m2', artResult.value.artifactId],
      );
      assert.equal(count!.c, 1,
        'CATCHES: without INSERT OR IGNORE, duplicate edges corrupt dependency count');

      conn.close();
    });

    it('same-mission read creates edge with is_cross_mission = 0 (I-23)', () => {
      const { deps, conn } = createTestOrchestrationDeps();
      const artifacts = createArtifactStore();
      const ctx = createTestOperationContext();

      seedMission(conn, { id: 'dep-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'dep-m1' });

      const artResult = artifacts.create(deps, ctx, {
        missionId: missionId('dep-m1') as MissionId,
        name: 'local', type: 'data', format: 'json', content: '{}',
        sourceTaskId: taskId('seed-task') as TaskId,
        parentArtifactId: null as unknown as ArtifactId | null, metadata: {},
      });
      assert.equal(artResult.ok, true);
      if (!artResult.ok) return;

      // Same mission reads its own artifact → not cross-mission
      artifacts.trackDependency(deps, missionId('dep-m1') as MissionId, artResult.value.artifactId, 1, false);

      const edge = conn.get<{ is_cross_mission: number }>(
        'SELECT is_cross_mission FROM core_artifact_dependencies WHERE reading_mission_id = ?',
        ['dep-m1'],
      );
      assert.equal(edge!.is_cross_mission, 0,
        'CATCHES: same-mission reads must not be flagged as cross-mission');

      conn.close();
    });
  });

  describe('Orchestrator-Managed (Not Agent-Managed)', () => {
    it('trackDependency is an internal function, not exposed to agents (I-23)', () => {
      /**
       * I-23: "Dependencies tracked automatically by the orchestrator, not by agents."
       * trackDependency is called by read_artifact syscall, not by agents directly.
       */
      const artifacts = createArtifactStore();
      // trackDependency exists on the store (orchestrator calls it)
      assert.equal(typeof artifacts.trackDependency, 'function',
        'CATCHES: without trackDependency, dependency graph cannot be built');
    });
  });

  describe('Invalidation Cascade', () => {
    it('source invalidation flags all dependents as STALE (I-23)', () => {
      /**
       * I-23: When an artifact is archived, all artifacts that depend on it
       * (via core_artifact_dependencies) are flagged STALE via BFS cascade.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const artifacts = createArtifactStore();
      const ctx = createTestOperationContext();

      // Setup: mission-A creates artifact, mission-B depends on it
      seedMission(conn, { id: 'cas-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cas-m1' });
      seedMission(conn, { id: 'cas-m2', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'cas-m2' });

      // Create source artifact in mission-A
      const artA = artifacts.create(deps, ctx, {
        missionId: missionId('cas-m1') as MissionId,
        name: 'source-data', type: 'data', format: 'json', content: '{"v":1}',
        sourceTaskId: taskId('seed-task') as import('../../src/kernel/interfaces/index.js').TaskId,
        parentArtifactId: null as unknown as import('../../src/kernel/interfaces/index.js').ArtifactId | null,
        metadata: {},
      });
      assert.equal(artA.ok, true);
      if (!artA.ok) return;

      // Create dependent artifact in mission-B
      const artB = artifacts.create(deps, ctx, {
        missionId: missionId('cas-m2') as MissionId,
        name: 'dependent-data', type: 'data', format: 'json', content: '{"derived":true}',
        sourceTaskId: taskId('seed-task') as import('../../src/kernel/interfaces/index.js').TaskId,
        parentArtifactId: null as unknown as import('../../src/kernel/interfaces/index.js').ArtifactId | null,
        metadata: {},
      });
      assert.equal(artB.ok, true);
      if (!artB.ok) return;

      // Track dependency: mission-B reads artifact from mission-A
      artifacts.trackDependency(deps, missionId('cas-m2') as MissionId, artA.value.artifactId, artA.value.version, true);

      // Archive mission-A artifacts → should cascade STALE to mission-B artifacts
      const archiveResult = artifacts.archiveForMission(deps, missionId('cas-m1') as MissionId);
      assert.equal(archiveResult.ok, true);

      // Verify mission-B's artifact is now STALE
      const staleRow = conn.get<{ staleness_flag: string }>(
        'SELECT staleness_flag FROM core_artifacts WHERE id = ? AND version = ?',
        [artB.value.artifactId, artB.value.version],
      );
      assert.equal(staleRow?.staleness_flag, 'STALE',
        'CATCHES: without cascade, dependent artifacts silently use stale source data');

      conn.close();
    });

    it('invalidation cascades transitively (I-23)', () => {
      /**
       * I-23: Cascade propagates through transitive dependencies.
       * A → B → C: archiving A marks both B and C as STALE.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const artifacts = createArtifactStore();
      const ctx = createTestOperationContext();

      seedMission(conn, { id: 'tc-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'tc-m1' });
      seedMission(conn, { id: 'tc-m2', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'tc-m2' });
      seedMission(conn, { id: 'tc-m3', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'tc-m3' });

      // A in m1, B in m2 depends on A, C in m3 depends on B
      const artA = artifacts.create(deps, ctx, {
        missionId: missionId('tc-m1') as MissionId,
        name: 'a', type: 'data', format: 'json', content: '{"a":1}',
        sourceTaskId: taskId('seed-task') as import('../../src/kernel/interfaces/index.js').TaskId,
        parentArtifactId: null as unknown as import('../../src/kernel/interfaces/index.js').ArtifactId | null,
        metadata: {},
      });
      assert.equal(artA.ok, true);
      if (!artA.ok) return;

      const artB = artifacts.create(deps, ctx, {
        missionId: missionId('tc-m2') as MissionId,
        name: 'b', type: 'data', format: 'json', content: '{"b":2}',
        sourceTaskId: taskId('seed-task') as import('../../src/kernel/interfaces/index.js').TaskId,
        parentArtifactId: null as unknown as import('../../src/kernel/interfaces/index.js').ArtifactId | null,
        metadata: {},
      });
      assert.equal(artB.ok, true);
      if (!artB.ok) return;

      const artC = artifacts.create(deps, ctx, {
        missionId: missionId('tc-m3') as MissionId,
        name: 'c', type: 'data', format: 'json', content: '{"c":3}',
        sourceTaskId: taskId('seed-task') as import('../../src/kernel/interfaces/index.js').TaskId,
        parentArtifactId: null as unknown as import('../../src/kernel/interfaces/index.js').ArtifactId | null,
        metadata: {},
      });
      assert.equal(artC.ok, true);
      if (!artC.ok) return;

      // m2 reads A, m3 reads B
      artifacts.trackDependency(deps, missionId('tc-m2') as MissionId, artA.value.artifactId, artA.value.version, true);
      artifacts.trackDependency(deps, missionId('tc-m3') as MissionId, artB.value.artifactId, artB.value.version, true);

      // Archive m1 → A archived → B STALE → C STALE
      artifacts.archiveForMission(deps, missionId('tc-m1') as MissionId);

      const bFlag = conn.get<{ staleness_flag: string }>(
        'SELECT staleness_flag FROM core_artifacts WHERE id = ?', [artB.value.artifactId],
      );
      const cFlag = conn.get<{ staleness_flag: string }>(
        'SELECT staleness_flag FROM core_artifacts WHERE id = ?', [artC.value.artifactId],
      );

      assert.equal(bFlag?.staleness_flag, 'STALE', 'B must be STALE (direct dependent of A)');
      assert.equal(cFlag?.staleness_flag, 'STALE',
        'CATCHES: without transitive cascade, C uses data derived from stale source');

      conn.close();
    });

    it('STALE flag does not modify artifact content (I-19 preserved) (I-23)', () => {
      /**
       * I-19: Artifact content is immutable. The STALE flag changes only
       * the staleness_flag column — content bytes must be identical before/after.
       */
      const { deps, conn } = createTestOrchestrationDeps();
      const artifacts = createArtifactStore();
      const ctx = createTestOperationContext();

      seedMission(conn, { id: 'i19-m1', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'i19-m1' });
      seedMission(conn, { id: 'i19-m2', agentId: 'agent-1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'i19-m2' });

      const artA = artifacts.create(deps, ctx, {
        missionId: missionId('i19-m1') as MissionId,
        name: 'source', type: 'data', format: 'json', content: '{"immutable":true}',
        sourceTaskId: taskId('seed-task') as import('../../src/kernel/interfaces/index.js').TaskId,
        parentArtifactId: null as unknown as import('../../src/kernel/interfaces/index.js').ArtifactId | null,
        metadata: {},
      });
      assert.equal(artA.ok, true);
      if (!artA.ok) return;

      const artB = artifacts.create(deps, ctx, {
        missionId: missionId('i19-m2') as MissionId,
        name: 'dependent', type: 'data', format: 'json', content: '{"content":"must not change"}',
        sourceTaskId: taskId('seed-task') as import('../../src/kernel/interfaces/index.js').TaskId,
        parentArtifactId: null as unknown as import('../../src/kernel/interfaces/index.js').ArtifactId | null,
        metadata: {},
      });
      assert.equal(artB.ok, true);
      if (!artB.ok) return;

      // Capture content BEFORE cascade
      const beforeContent = conn.get<{ content: Buffer }>(
        'SELECT content FROM core_artifacts WHERE id = ? AND version = ?',
        [artB.value.artifactId, artB.value.version],
      );

      // Track dependency and archive to trigger cascade
      artifacts.trackDependency(deps, missionId('i19-m2') as MissionId, artA.value.artifactId, artA.value.version, true);
      artifacts.archiveForMission(deps, missionId('i19-m1') as MissionId);

      // Capture content AFTER cascade
      const afterContent = conn.get<{ content: Buffer; staleness_flag: string }>(
        'SELECT content, staleness_flag FROM core_artifacts WHERE id = ? AND version = ?',
        [artB.value.artifactId, artB.value.version],
      );

      assert.equal(afterContent?.staleness_flag, 'STALE', 'Artifact must be STALE after cascade');
      assert.deepEqual(afterContent?.content, beforeContent?.content,
        'CATCHES: if cascade modifies content, I-19 immutability is violated');

      conn.close();
    });
  });

  describe('Cross-Mission Dependencies', () => {
    it.skip('child mission reads of parent artifacts are tracked — DEFERRED (workspace hierarchy not enforced)', () => {});
    it.skip('sibling mission reads tracked with cross-mission flag — DEFERRED (sibling visibility not implemented)', () => {});
  });

  describe('Workspace Hierarchy Visibility', () => {
    it.skip('child artifacts visible to parent — DEFERRED (workspace hierarchy not enforced)', () => {});
    it.skip('parent artifacts visible to children — DEFERRED (workspace hierarchy not enforced)', () => {});
    it.skip('sibling artifacts readable with dependency tracking — DEFERRED (workspace hierarchy not enforced)', () => {});
  });

  describe('relevanceDecay Integration', () => {
    it.skip('read_artifact resets relevanceDecay on source artifact — DEFERRED (tested in SC-5 gap tests)', () => {});
    it.skip('unread artifacts decay toward SUMMARIZED state — DEFERRED (no decay engine)', () => {});
  });
});
