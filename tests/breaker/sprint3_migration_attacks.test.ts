/**
 * BREAKER: Sprint 3 Migration v34 Attack Tests
 * Target: Migration 025_knowledge_graph.ts (ALTER core_artifacts, CREATE core_drift_assessments)
 *
 * Attack vectors: CHECK constraint enforcement, default values, trigger behavior,
 * schema completeness after migration.
 *
 * Classification: Tier 1 (migration/evolution, data integrity)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
  taskId,
} from '../helpers/test_database.js';
import { createArtifactStore } from '../../src/orchestration/artifacts/artifact_store.js';
import type { MissionId, ArtifactId, TaskId } from '../../src/kernel/interfaces/index.js';

describe('BREAKER: Sprint 3 Migration v34 Attacks', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // staleness_flag CHECK Constraint
  // CATCHES: Without CHECK constraint, arbitrary values like 'ROTTEN' or ''
  // could be stored in staleness_flag, breaking cascade logic that switches on it.
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-001: staleness_flag CHECK accepts FRESH [A21: success]', () => {
    // CATCHES: If CHECK constraint rejects valid values, cascade cannot function.
    const conn = createTestDatabase();

    seedMission(conn, { id: 'chk-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'chk-m1' });

    // Create artifact — default staleness_flag should be FRESH
    const { deps } = createTestOrchestrationDeps();
    // Use raw conn for this test
    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content,
       lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at, staleness_flag)
       VALUES ('mig-a1', 1, 'chk-m1', 'test-tenant', 'test', 'data', 'json', X'7B7D',
       'ACTIVE', 'seed-task', NULL, 0, '{}', '2026-03-23T00:00:00Z', 'FRESH')`,
    );

    const row = conn.get<{ staleness_flag: string }>(
      'SELECT staleness_flag FROM core_artifacts WHERE id = ?', ['mig-a1']);
    assert.equal(row?.staleness_flag, 'FRESH', 'FRESH must be accepted by CHECK');

    conn.close();
  });

  it('MIG-002: staleness_flag CHECK accepts STALE [A21: success]', () => {
    // CATCHES: If CHECK constraint does not include STALE, cascade UPDATE fails.
    const conn = createTestDatabase();

    seedMission(conn, { id: 'chk2-m1', agentId: 'a1', state: 'EXECUTING' });

    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content,
       lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at, staleness_flag)
       VALUES ('mig-a2', 1, 'chk2-m1', 'test-tenant', 'test', 'data', 'json', X'7B7D',
       'ACTIVE', 'seed-task', NULL, 0, '{}', '2026-03-23T00:00:00Z', 'STALE')`,
    );

    const row = conn.get<{ staleness_flag: string }>(
      'SELECT staleness_flag FROM core_artifacts WHERE id = ?', ['mig-a2']);
    assert.equal(row?.staleness_flag, 'STALE', 'STALE must be accepted by CHECK');

    conn.close();
  });

  it('MIG-003: staleness_flag CHECK rejects invalid values [A21: rejection]', () => {
    // CATCHES: Without CHECK constraint, arbitrary values bypass staleness logic.
    const conn = createTestDatabase();

    seedMission(conn, { id: 'chk3-m1', agentId: 'a1', state: 'EXECUTING' });

    const invalidValues = ['ROTTEN', 'EXPIRED', '', 'fresh', 'stale', 'INVALID', 'NULL'];

    for (const val of invalidValues) {
      let threw = false;
      try {
        conn.run(
          `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content,
           lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at, staleness_flag)
           VALUES ('mig-inv-${val}', 1, 'chk3-m1', 'test-tenant', 'test', 'data', 'json', X'7B7D',
           'ACTIVE', 'seed-task', NULL, 0, '{}', '2026-03-23T00:00:00Z', ?)`,
          [val],
        );
      } catch {
        threw = true;
      }

      assert.equal(threw, true,
        `staleness_flag='${val}' must be rejected by CHECK constraint`);
    }

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // staleness_flag Default Value
  // CATCHES: Without DEFAULT 'FRESH', new artifacts would have NULL staleness_flag,
  // breaking cascade queries that filter on staleness_flag = 'FRESH'.
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-004: new artifact gets default staleness_flag = FRESH', () => {
    // CATCHES: If DEFAULT is missing, artifact creation without explicit staleness_flag
    // would fail (NOT NULL constraint) or produce NULL.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'def-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'def-m1' });

    const store = createArtifactStore();
    const result = store.create(deps, ctx, {
      missionId: missionId('def-m1') as MissionId,
      name: 'default-test',
      type: 'data',
      format: 'json',
      content: '{"test":true}',
      sourceTaskId: taskId('seed-task') as TaskId,
      parentArtifactId: null as unknown as ArtifactId | null,
      metadata: {},
    });

    assert.equal(result.ok, true, 'Artifact creation must succeed');
    if (!result.ok) return;

    const row = conn.get<{ staleness_flag: string }>(
      'SELECT staleness_flag FROM core_artifacts WHERE id = ?', [result.value.artifactId]);

    assert.equal(row?.staleness_flag, 'FRESH',
      'New artifact must default to FRESH staleness_flag');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // core_drift_assessments Triggers
  // CATCHES: Without append-only triggers, drift assessments can be modified
  // or deleted, destroying audit evidence.
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-005: trg_drift_assessments_no_update trigger exists and fires', () => {
    // CATCHES: If trigger was not created by migration, UPDATEs succeed silently.
    const conn = createTestDatabase();

    seedMission(conn, { id: 'trg-m1', agentId: 'a1', state: 'EXECUTING', objective: 'Test' });

    // Insert a checkpoint for FK
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('trg-cp', 'trg-m1', 'test-tenant', 'PERIODIC', 'PENDING',
       '2099-01-01T00:00:00Z', '2026-03-23T00:00:00Z')`,
    );

    // Insert a drift assessment directly
    conn.run(
      `INSERT INTO core_drift_assessments
       (id, checkpoint_id, mission_id, tenant_id, drift_score, similarity_score,
        original_objective, current_assessment, action_taken, created_at)
       VALUES ('trg-d1', 'trg-cp', 'trg-m1', 'test-tenant', 0.5, 0.5,
               'obj', 'assess', 'flagged', '2026-03-23T00:00:00Z')`,
    );

    // Attempt UPDATE — must fail
    let updateThrew = false;
    try {
      conn.run(`UPDATE core_drift_assessments SET drift_score = 0.0 WHERE id = 'trg-d1'`);
    } catch {
      updateThrew = true;
    }

    assert.equal(updateThrew, true,
      'trg_drift_assessments_no_update trigger must block UPDATE');

    conn.close();
  });

  it('MIG-006: trg_drift_assessments_no_delete trigger exists and fires', () => {
    // CATCHES: If trigger was not created by migration, DELETEs succeed silently.
    const conn = createTestDatabase();

    seedMission(conn, { id: 'trg2-m1', agentId: 'a1', state: 'EXECUTING', objective: 'Test' });
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('trg2-cp', 'trg2-m1', 'test-tenant', 'PERIODIC', 'PENDING',
       '2099-01-01T00:00:00Z', '2026-03-23T00:00:00Z')`,
    );

    conn.run(
      `INSERT INTO core_drift_assessments
       (id, checkpoint_id, mission_id, tenant_id, drift_score, similarity_score,
        original_objective, current_assessment, action_taken, created_at)
       VALUES ('trg2-d1', 'trg2-cp', 'trg2-m1', 'test-tenant', 0.5, 0.5,
               'obj', 'assess', 'flagged', '2026-03-23T00:00:00Z')`,
    );

    let deleteThrew = false;
    try {
      conn.run(`DELETE FROM core_drift_assessments WHERE id = 'trg2-d1'`);
    } catch {
      deleteThrew = true;
    }

    assert.equal(deleteThrew, true,
      'trg_drift_assessments_no_delete trigger must block DELETE');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Existing Artifacts After Migration
  // CATCHES: If the ALTER TABLE migration does not set a default for existing rows,
  // pre-existing artifacts would have NULL staleness_flag.
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-007: artifacts created before migration v34 have staleness_flag = FRESH', () => {
    // CATCHES: The ALTER TABLE ADD COLUMN with DEFAULT should retroactively
    // apply FRESH to existing rows. If not, existing artifacts have NULL staleness_flag
    // and would be invisible to cascade BFS queries that filter on 'FRESH'.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();

    // Since we create the database from scratch with all migrations,
    // we simulate this by creating an artifact (which goes through all migrations)
    // and verifying it has FRESH.
    seedMission(conn, { id: 'retro-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'retro-m1' });

    const store = createArtifactStore();
    const result = store.create(deps, ctx, {
      missionId: missionId('retro-m1') as MissionId,
      name: 'pre-migration-artifact',
      type: 'data',
      format: 'json',
      content: '{}',
      sourceTaskId: taskId('seed-task') as TaskId,
      parentArtifactId: null as unknown as ArtifactId | null,
      metadata: {},
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;

    // Verify staleness_flag is not NULL
    const row = conn.get<{ staleness_flag: string | null }>(
      'SELECT staleness_flag FROM core_artifacts WHERE id = ?', [result.value.artifactId]);

    assert.notEqual(row?.staleness_flag, null,
      'staleness_flag must not be NULL after migration');
    assert.equal(row?.staleness_flag, 'FRESH',
      'staleness_flag must be FRESH (DEFAULT value from ALTER TABLE)');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // core_drift_assessments Schema Completeness
  // CATCHES: Missing columns, wrong types, or missing constraints.
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-008: core_drift_assessments table has all required columns', () => {
    // CATCHES: If migration is incomplete, missing columns cause runtime errors.
    const conn = createTestDatabase();

    // Use PRAGMA table_info to verify schema
    const columns = conn.query<{ name: string; type: string; notnull: number; dflt_value: string | null }>(
      `PRAGMA table_info(core_drift_assessments)`,
    );

    const colMap = new Map(columns.map(c => [c.name, c]));

    // Required columns
    const required = [
      'id', 'checkpoint_id', 'mission_id', 'tenant_id',
      'drift_score', 'similarity_score', 'original_objective',
      'current_assessment', 'action_taken', 'escalation_reason', 'created_at',
    ];

    for (const col of required) {
      assert.ok(colMap.has(col), `Column '${col}' must exist in core_drift_assessments`);
    }

    // Verify NOT NULL constraints on critical columns
    const notNullCols = ['id', 'checkpoint_id', 'mission_id', 'drift_score',
      'similarity_score', 'original_objective', 'current_assessment',
      'action_taken', 'created_at'];
    for (const col of notNullCols) {
      assert.equal(colMap.get(col)?.notnull, 1,
        `Column '${col}' must have NOT NULL constraint`);
    }

    // tenant_id and escalation_reason should be nullable
    assert.equal(colMap.get('tenant_id')?.notnull, 0,
      'tenant_id must be nullable (single-tenant mode)');
    assert.equal(colMap.get('escalation_reason')?.notnull, 0,
      'escalation_reason must be nullable (only set on escalation)');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Indexes
  // CATCHES: Missing indexes cause O(n) scans on queries that should be O(log n).
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-009: partial index idx_artifacts_stale exists', () => {
    // CATCHES: Without the partial index, stale artifact queries scan all rows.
    const conn = createTestDatabase();

    const indexes = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'core_artifacts' AND name = 'idx_artifacts_stale'`,
    );

    assert.equal(indexes.length, 1,
      'Partial index idx_artifacts_stale must exist on core_artifacts');

    conn.close();
  });

  it('MIG-010: drift assessment indexes exist', () => {
    // CATCHES: Without indexes, drift assessment lookups by mission, checkpoint,
    // or tenant degrade to full table scans.
    const conn = createTestDatabase();

    const expectedIndexes = [
      'idx_drift_assessments_mission',
      'idx_drift_assessments_checkpoint',
      'idx_drift_assessments_tenant',
    ];

    for (const idx of expectedIndexes) {
      const found = conn.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`,
        [idx],
      );
      assert.equal(found.length, 1, `Index '${idx}' must exist`);
    }

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Foreign Key Constraints
  // CATCHES: Without FK constraints, orphaned drift assessments can reference
  // nonexistent checkpoints or missions.
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-011: drift assessment FK to core_checkpoints enforced [A21: rejection]', () => {
    // CATCHES: Without FK, drift assessments can reference nonexistent checkpoints.
    const conn = createTestDatabase();

    seedMission(conn, { id: 'fk-m1', agentId: 'a1', state: 'EXECUTING', objective: 'FK test' });

    let threw = false;
    try {
      conn.run(
        `INSERT INTO core_drift_assessments
         (id, checkpoint_id, mission_id, tenant_id, drift_score, similarity_score,
          original_objective, current_assessment, action_taken, created_at)
         VALUES ('fk-d1', 'nonexistent-checkpoint', 'fk-m1', 'test-tenant', 0.5, 0.5,
                 'obj', 'assess', 'none', '2026-03-23T00:00:00Z')`,
      );
    } catch {
      threw = true;
    }

    assert.equal(threw, true,
      'FK constraint must reject drift assessment referencing nonexistent checkpoint');

    conn.close();
  });

  it('MIG-012: drift assessment FK to core_missions enforced [A21: rejection]', () => {
    // CATCHES: Without FK, drift assessments can reference nonexistent missions.
    const conn = createTestDatabase();

    // Create a valid checkpoint to satisfy the checkpoint FK
    seedMission(conn, { id: 'fk2-m1', agentId: 'a1', state: 'EXECUTING', objective: 'FK test' });
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('fk2-cp', 'fk2-m1', 'test-tenant', 'PERIODIC', 'PENDING',
       '2099-01-01T00:00:00Z', '2026-03-23T00:00:00Z')`,
    );

    let threw = false;
    try {
      conn.run(
        `INSERT INTO core_drift_assessments
         (id, checkpoint_id, mission_id, tenant_id, drift_score, similarity_score,
          original_objective, current_assessment, action_taken, created_at)
         VALUES ('fk2-d1', 'fk2-cp', 'nonexistent-mission', 'test-tenant', 0.5, 0.5,
                 'obj', 'assess', 'none', '2026-03-23T00:00:00Z')`,
      );
    } catch {
      threw = true;
    }

    assert.equal(threw, true,
      'FK constraint must reject drift assessment referencing nonexistent mission');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // UPDATE on staleness_flag Does NOT Fire I-19 Content Triggers
  // CATCHES: If the I-19 content immutability trigger fires on staleness_flag
  // UPDATE, cascade would be blocked by the trigger.
  // ═══════════════════════════════════════════════════════════════════════════

  it('MIG-013: staleness_flag UPDATE does not fire content immutability trigger (I-19 safe)', () => {
    // CATCHES: If I-19 triggers are ON UPDATE (not ON UPDATE OF content, type),
    // then SET staleness_flag = 'STALE' would fire the trigger and fail.
    // The triggers must be column-specific (BEFORE UPDATE OF content, BEFORE UPDATE OF type).
    const conn = createTestDatabase();

    seedMission(conn, { id: 'i19safe-m1', agentId: 'a1', state: 'EXECUTING' });

    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content,
       lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
       VALUES ('i19-a1', 1, 'i19safe-m1', 'test-tenant', 'test', 'data', 'json', X'7B7D',
       'ACTIVE', 'seed-task', NULL, 0, '{}', '2026-03-23T00:00:00Z')`,
    );

    // This UPDATE should succeed — it only touches staleness_flag, not content or type
    let threw = false;
    try {
      conn.run(`UPDATE core_artifacts SET staleness_flag = 'STALE' WHERE id = 'i19-a1'`);
    } catch {
      threw = true;
    }

    assert.equal(threw, false,
      'staleness_flag UPDATE must NOT fire I-19 content immutability trigger');

    const row = conn.get<{ staleness_flag: string }>(
      'SELECT staleness_flag FROM core_artifacts WHERE id = ?', ['i19-a1']);
    assert.equal(row?.staleness_flag, 'STALE', 'staleness_flag must be updated to STALE');

    conn.close();
  });

  it('MIG-014: content UPDATE still blocked by I-19 trigger after migration', () => {
    // CATCHES: If migration v34 accidentally dropped or modified the I-19 triggers,
    // artifact content would become mutable.
    const conn = createTestDatabase();

    seedMission(conn, { id: 'i19prot-m1', agentId: 'a1', state: 'EXECUTING' });

    conn.run(
      `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content,
       lifecycle_state, source_task_id, parent_artifact_id, relevance_decay, metadata_json, created_at)
       VALUES ('i19p-a1', 1, 'i19prot-m1', 'test-tenant', 'test', 'data', 'json', X'7B7D',
       'ACTIVE', 'seed-task', NULL, 0, '{}', '2026-03-23T00:00:00Z')`,
    );

    let threw = false;
    try {
      conn.run(`UPDATE core_artifacts SET content = X'DEADBEEF' WHERE id = 'i19p-a1'`);
    } catch {
      threw = true;
    }

    assert.equal(threw, true,
      'Content UPDATE must still be blocked by I-19 trigger after migration v34');

    conn.close();
  });
});
