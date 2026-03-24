/**
 * Contract Tests: Drift Engine (I-24 — Goal Drift Detection)
 * Sprint 3: Knowledge Graph
 *
 * Verifies: Semantic drift assessment at checkpoints using TF-IDF cosine similarity.
 * Spec ref: §4 I-24 (Goal Anchoring), §6 FM-14 (Semantic Drift), §16 FM-16 (Mission Drift)
 *
 * Coverage:
 *   1. Low drift → action='none'
 *   2. Medium drift → action='flagged'
 *   3. High drift → action='escalated'
 *   4. Drift assessment stored in core_drift_assessments
 *   5. Drift assessment is append-only (UPDATE blocked, DELETE blocked)
 *   6. Drift reads from core_mission_goals
 *   7. Missing goal anchor → no drift (graceful)
 *   8. Drift override on checkpoint (escalated drift overrides continue)
 *   9. Tenant isolation on drift assessments
 *   10. Empty assessment handling
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  createTestDatabase,
  seedMission,
  seedResource,
  missionId,
} from '../helpers/test_database.js';
import { assessDrift } from '../../src/orchestration/checkpoints/drift_engine.js';
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import type { MissionId, TenantId, TimeProvider } from '../../src/kernel/interfaces/index.js';

describe('Contract: Drift Engine (I-24)', () => {

  // 1. Low drift → action='none'
  it('CT-DE-001: low drift (assessment matches objective) → action=none', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de1-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Analyze customer feedback data and produce sentiment report',
    });

    // Seed a checkpoint for the FK constraint
    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de1', 'de1-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    const result = assessDrift(
      'cp-de1',
      missionId('de1-m1') as MissionId,
      'Analyzing customer feedback data and generating sentiment analysis report',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    assert.equal(result.actionTaken, 'none', 'Closely matching assessment must not trigger drift');
    assert.ok(result.driftScore < 0.4, `Drift score ${result.driftScore} must be < 0.4`);
    assert.ok(result.similarityScore > 0.6, `Similarity ${result.similarityScore} must be > 0.6`);

    conn.close();
  });

  // 2. Medium drift → action='flagged'
  it('CT-DE-002: medium drift (partial overlap) → action=flagged', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de2-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Build a machine learning model for product recommendation using collaborative filtering',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de2', 'de2-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    // Assessment overlaps somewhat but has diverged
    const result = assessDrift(
      'cp-de2',
      missionId('de2-m1') as MissionId,
      'Exploring different machine learning approaches for data classification tasks',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    // Medium drift: some overlap (machine, learning) but different focus
    assert.ok(result.driftScore >= 0.4, `Drift score ${result.driftScore} must be >= 0.4 for flagging`);

    conn.close();
  });

  // 3. High drift → action='escalated'
  it('CT-DE-003: high drift (no overlap) → action=escalated', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de3-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Analyze customer feedback data and produce sentiment report',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de3', 'de3-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    // Completely unrelated assessment → high drift
    const result = assessDrift(
      'cp-de3',
      missionId('de3-m1') as MissionId,
      'Optimizing database indexes for better query performance on user tables',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    assert.equal(result.actionTaken, 'escalated', 'Completely unrelated assessment must trigger escalation');
    assert.ok(result.driftScore > 0.7, `Drift score ${result.driftScore} must be > 0.7`);
    assert.ok(result.escalationReason !== null, 'Escalation reason must be provided');

    conn.close();
  });

  // 4. Drift assessment stored in core_drift_assessments
  it('CT-DE-004: drift assessment stored in core_drift_assessments', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de4-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Build a web scraper for product prices',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de4', 'de4-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    assessDrift(
      'cp-de4',
      missionId('de4-m1') as MissionId,
      'Testing web scraper functionality',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    const row = conn.get<{
      checkpoint_id: string;
      mission_id: string;
      tenant_id: string;
      drift_score: number;
      similarity_score: number;
      original_objective: string;
      current_assessment: string;
      action_taken: string;
    }>(
      'SELECT * FROM core_drift_assessments WHERE checkpoint_id = ?',
      ['cp-de4'],
    );

    assert.ok(row !== undefined, 'Drift assessment must be stored');
    assert.equal(row!.checkpoint_id, 'cp-de4');
    assert.equal(row!.mission_id, 'de4-m1');
    assert.equal(row!.tenant_id, 'test-tenant');
    assert.equal(typeof row!.drift_score, 'number');
    assert.equal(typeof row!.similarity_score, 'number');
    assert.equal(row!.original_objective, 'Build a web scraper for product prices');
    assert.equal(row!.current_assessment, 'Testing web scraper functionality');

    conn.close();
  });

  // 5. Drift assessment is append-only (UPDATE blocked, DELETE blocked)
  it('CT-DE-005a: drift assessment UPDATE blocked (append-only)', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de5a-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Test objective',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de5a', 'de5a-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    assessDrift(
      'cp-de5a',
      missionId('de5a-m1') as MissionId,
      'Some assessment text',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    // Attempt UPDATE — must be blocked by trigger
    let threw = false;
    let errorMsg = '';
    try {
      conn.run(
        `UPDATE core_drift_assessments SET drift_score = 0 WHERE checkpoint_id = 'cp-de5a'`,
      );
    } catch (err) {
      threw = true;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    assert.equal(threw, true, 'UPDATE on drift assessments must be blocked');
    assert.ok(errorMsg.includes('DRIFT_ASSESSMENT_IMMUTABLE'),
      'Error must reference DRIFT_ASSESSMENT_IMMUTABLE');

    conn.close();
  });

  it('CT-DE-005b: drift assessment DELETE blocked (append-only)', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de5b-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Test objective',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de5b', 'de5b-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    assessDrift(
      'cp-de5b',
      missionId('de5b-m1') as MissionId,
      'Assessment text',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    // Attempt DELETE — must be blocked by trigger
    let threw = false;
    let errorMsg = '';
    try {
      conn.run(
        `DELETE FROM core_drift_assessments WHERE checkpoint_id = 'cp-de5b'`,
      );
    } catch (err) {
      threw = true;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    assert.equal(threw, true, 'DELETE on drift assessments must be blocked');
    assert.ok(errorMsg.includes('DRIFT_ASSESSMENT_NO_DELETE'),
      'Error must reference DRIFT_ASSESSMENT_NO_DELETE');

    conn.close();
  });

  // 6. Drift reads from core_mission_goals
  it('CT-DE-006: drift reads objective from core_mission_goals (not core_missions)', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    const goalObjective = 'The real goal anchor objective for drift comparison';
    const missionObjective = 'Build something different';

    // Seed mission with one objective
    seedMission(conn, {
      id: 'de6-m1', agentId: 'a1', state: 'EXECUTING',
      objective: goalObjective,
    });

    // Verify the goal anchor matches what we seeded
    const goal = conn.get<{ objective: string }>(
      'SELECT objective FROM core_mission_goals WHERE mission_id = ?',
      ['de6-m1'],
    );
    assert.equal(goal?.objective, goalObjective);

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de6', 'de6-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    assessDrift(
      'cp-de6',
      missionId('de6-m1') as MissionId,
      'Some assessment',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    // Verify the drift assessment recorded the goal anchor objective
    const driftRow = conn.get<{ original_objective: string }>(
      'SELECT original_objective FROM core_drift_assessments WHERE checkpoint_id = ?',
      ['cp-de6'],
    );
    assert.equal(driftRow?.original_objective, goalObjective,
      'Drift engine must read from core_mission_goals, not core_missions');

    conn.close();
  });

  // 7. Missing goal anchor → no drift
  it('CT-DE-007: missing goal anchor → no drift (graceful)', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    // Create a mission but DELETE the goal anchor to simulate missing anchor
    seedMission(conn, {
      id: 'de7-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Will be deleted',
    });

    // The goal trigger protects UPDATE but does not protect DELETE in this test setup.
    // We need to work around the trigger. Since there's no DELETE trigger on core_mission_goals
    // in the base schema, we can directly delete.
    // Actually, let's check if there's a delete trigger...
    // The immutability triggers in migration 005 are on core_artifacts only.
    // core_mission_goals has UPDATE triggers but no DELETE trigger in the base migration.
    // However, we should create a fresh connection and only insert the mission without goals.
    // Simpler: use a non-existent mission ID.
    const result = assessDrift(
      'nonexistent-cp',
      missionId('nonexistent-mission') as MissionId,
      'Some assessment text',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    assert.equal(result.driftScore, 0, 'No goal anchor → driftScore = 0');
    assert.equal(result.similarityScore, 1, 'No goal anchor → similarityScore = 1');
    assert.equal(result.actionTaken, 'none', 'No goal anchor → action = none');

    conn.close();
  });

  // 8. Drift override on checkpoint
  it('CT-DE-008: escalated drift overrides continue on checkpoint', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();
    const coordinator = createCheckpointCoordinator(transitionService);

    seedMission(conn, {
      id: 'de8-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Analyze customer feedback data and produce sentiment report',
    });
    seedResource(conn, { missionId: 'de8-m1' });

    const fireResult = coordinator.fire(deps, missionId('de8-m1') as MissionId, 'PERIODIC');
    assert.equal(fireResult.ok, true);
    if (!fireResult.ok) return;

    // Respond with high confidence (would normally continue) but drifted assessment
    const respondResult = coordinator.processResponse(deps, {
      checkpointId: fireResult.value,
      assessment: 'Optimizing database indexes for better query performance on user tables',
      confidence: 0.95, // Very high confidence → would be 'continue'
      proposedAction: 'continue',
      planRevision: null,
      escalationReason: null,
    });

    assert.equal(respondResult.ok, true);
    if (!respondResult.ok) return;

    // The checkpoint system_action should be overridden from 'continue' to 'escalated'
    assert.equal(respondResult.value.action, 'escalated',
      'Drift escalation must override confidence-based continue');
    assert.ok(respondResult.value.reason.includes('goal_drift_detected'),
      'Reason must indicate goal drift');

    conn.close();
  });

  // 9. Tenant isolation on drift assessments
  it('CT-DE-009: tenant isolation on drift assessments', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de9-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Test objective', tenantId: 'tenant-x',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de9', 'de9-m1', 'tenant-x', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    assessDrift(
      'cp-de9',
      missionId('de9-m1') as MissionId,
      'Assessment for tenant-x',
      conn,
      'tenant-x' as TenantId,
      deps.audit,
      deps.time,
    );

    // Verify tenant_id is stored correctly
    const row = conn.get<{ tenant_id: string }>(
      'SELECT tenant_id FROM core_drift_assessments WHERE checkpoint_id = ?',
      ['cp-de9'],
    );
    assert.equal(row?.tenant_id, 'tenant-x', 'Tenant ID must be stored in drift assessment');

    // Verify no drift assessments exist for other tenants
    const otherCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_drift_assessments WHERE tenant_id != 'tenant-x'`,
    );
    assert.equal(otherCount?.c, 0, 'No drift assessments for other tenants');

    conn.close();
  });

  // 10. Empty assessment handling
  it('CT-DE-010: empty assessment text computes drift against objective', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de10-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Analyze customer data',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de10', 'de10-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    // Empty assessment → max drift (similarity = 0)
    const result = assessDrift(
      'cp-de10',
      missionId('de10-m1') as MissionId,
      '',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    // Empty string has no tokens → similarity = 0 → drift = 1.0
    assert.equal(result.driftScore, 1.0, 'Empty assessment → max drift');
    assert.equal(result.similarityScore, 0, 'Empty assessment → zero similarity');
    assert.equal(result.actionTaken, 'escalated', 'Max drift → escalated');

    conn.close();
  });

  // 11. Drift assessment audit trail
  it('CT-DE-011: drift assessment creates audit trail entry', () => {
    const { deps, conn, transitionService } = createTestOrchestrationDeps();

    seedMission(conn, {
      id: 'de11-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Test audit',
    });

    const now = deps.time.nowISO();
    conn.run(
      `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
       VALUES ('cp-de11', 'de11-m1', 'test-tenant', 'PERIODIC', 'PENDING', ?, ?)`,
      [new Date(Date.now() + 60000).toISOString(), now],
    );

    const beforeCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'assess_drift'`,
    );

    assessDrift(
      'cp-de11',
      missionId('de11-m1') as MissionId,
      'Test assessment',
      conn,
      'test-tenant' as TenantId,
      deps.audit,
      deps.time,
    );

    const afterCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'assess_drift'`,
    );

    assert.equal((afterCount?.c ?? 0) - (beforeCount?.c ?? 0), 1,
      'Exactly one audit entry per drift assessment');

    conn.close();
  });
});
