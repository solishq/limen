/**
 * BREAKER: Sprint 3 Drift Engine Attack Tests
 * Target: I-24 Goal Drift Detection (drift_engine.ts, checkpoint_coordinator.ts)
 *
 * Attack vectors: T-S3-008 (append-only bypass), T-S3-017 (tenant isolation),
 * T-S3-018 (wrong table), T-S3-006/007 (keyword stuffing evasion),
 * plus additional Breaker-discovered vectors.
 *
 * Classification: Tier 1 (governance, data integrity, behavioral/model quality)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestOrchestrationDeps,
  createTestOperationContext,
  seedMission,
  seedResource,
  missionId,
} from '../helpers/test_database.js';
import { assessDrift } from '../../src/orchestration/checkpoints/drift_engine.js';
import { createCheckpointCoordinator } from '../../src/orchestration/checkpoints/checkpoint_coordinator.js';
import type { MissionId, TenantId, TimeProvider } from '../../src/kernel/interfaces/index.js';

// ─── Helper: create a checkpoint for FK constraint ───

function seedCheckpoint(
  conn: ReturnType<typeof createTestOrchestrationDeps>['conn'],
  deps: ReturnType<typeof createTestOrchestrationDeps>['deps'],
  id: string,
  missionId: string,
  tenantId: string = 'test-tenant',
): void {
  const now = deps.time.nowISO();
  conn.run(
    `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, state, timeout_at, created_at)
     VALUES (?, ?, ?, 'PERIODIC', 'PENDING', ?, ?)`,
    [id, missionId, tenantId, new Date(Date.now() + 60000).toISOString(), now],
  );
}

describe('BREAKER: Sprint 3 Drift Engine Attacks', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-008: Append-Only Bypass on Drift Assessments (HIGH)
  // CATCHES: Without triggers blocking UPDATE/DELETE, an attacker could
  // retroactively modify drift assessment records to hide goal drift.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-001: UPDATE on core_drift_assessments blocked by trigger [A21: rejection]', () => {
    // CATCHES: Without the BEFORE UPDATE trigger, drift_score could be retroactively
    // changed to hide evidence of drift. This is an audit integrity violation.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'ao-m1', agentId: 'a1', state: 'EXECUTING', objective: 'Test objective' });
    seedCheckpoint(conn, deps, 'cp-ao1', 'ao-m1');

    assessDrift('cp-ao1', missionId('ao-m1') as MissionId, 'Assessment text', conn,
      'test-tenant' as TenantId, deps.audit, deps.time);

    // Attempt UPDATE — must be blocked
    let threw = false;
    let errorMsg = '';
    try {
      conn.run(`UPDATE core_drift_assessments SET drift_score = 0.0 WHERE checkpoint_id = 'cp-ao1'`);
    } catch (err) {
      threw = true;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    assert.equal(threw, true, 'UPDATE on drift assessments must throw');
    assert.ok(errorMsg.includes('DRIFT_ASSESSMENT_IMMUTABLE'),
      `Error must reference DRIFT_ASSESSMENT_IMMUTABLE, got: ${errorMsg}`);

    conn.close();
  });

  it('DFT-002: DELETE on core_drift_assessments blocked by trigger [A21: rejection]', () => {
    // CATCHES: Without the BEFORE DELETE trigger, drift assessment records could
    // be silently removed, destroying audit evidence.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'ao2-m1', agentId: 'a1', state: 'EXECUTING', objective: 'Test' });
    seedCheckpoint(conn, deps, 'cp-ao2', 'ao2-m1');

    assessDrift('cp-ao2', missionId('ao2-m1') as MissionId, 'Text', conn,
      'test-tenant' as TenantId, deps.audit, deps.time);

    let threw = false;
    let errorMsg = '';
    try {
      conn.run(`DELETE FROM core_drift_assessments WHERE checkpoint_id = 'cp-ao2'`);
    } catch (err) {
      threw = true;
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    assert.equal(threw, true, 'DELETE on drift assessments must throw');
    assert.ok(errorMsg.includes('DRIFT_ASSESSMENT_NO_DELETE'),
      `Error must reference DRIFT_ASSESSMENT_NO_DELETE, got: ${errorMsg}`);

    conn.close();
  });

  it('DFT-003: UPDATE on action_taken blocked (cannot downgrade escalation) [A21: rejection]', () => {
    // CATCHES: Attacker changes action_taken from 'escalated' to 'none' to hide drift.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'ao3-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Build machine learning pipeline for customer analysis' });
    seedCheckpoint(conn, deps, 'cp-ao3', 'ao3-m1');

    // Create an escalated assessment
    assessDrift('cp-ao3', missionId('ao3-m1') as MissionId,
      'Totally unrelated topic about cooking recipes and restaurant management',
      conn, 'test-tenant' as TenantId, deps.audit, deps.time);

    let threw = false;
    try {
      conn.run(`UPDATE core_drift_assessments SET action_taken = 'none' WHERE checkpoint_id = 'cp-ao3'`);
    } catch {
      threw = true;
    }

    assert.equal(threw, true,
      'Cannot change action_taken on drift assessment — append-only trigger must fire');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-017: Tenant Isolation on Drift Assessments (HIGH)
  // CATCHES: Drift assessments must carry correct tenant_id so they are
  // filtered properly in multi-tenant queries.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-004: drift assessment stores correct tenant_id', () => {
    // CATCHES: If tenant_id is omitted or wrong, drift assessments from one tenant
    // become visible to another in tenant-filtered queries.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'ti-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Tenant isolation test', tenantId: 'tenant-gamma' });
    seedCheckpoint(conn, deps, 'cp-ti', 'ti-m1', 'tenant-gamma');

    assessDrift('cp-ti', missionId('ti-m1') as MissionId, 'Test assessment', conn,
      'tenant-gamma' as TenantId, deps.audit, deps.time);

    const row = conn.get<{ tenant_id: string }>(
      'SELECT tenant_id FROM core_drift_assessments WHERE checkpoint_id = ?', ['cp-ti']);

    assert.equal(row?.tenant_id, 'tenant-gamma',
      'Drift assessment must carry the correct tenant_id');

    conn.close();
  });

  it('DFT-005: drift assessments for different tenants are isolated', () => {
    // CATCHES: Cross-tenant visibility — tenant A's assessments must not appear
    // in tenant B's queries.
    const { deps, conn } = createTestOrchestrationDeps();

    // Tenant Alpha
    seedMission(conn, { id: 'iso-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Alpha objective', tenantId: 'alpha' });
    seedCheckpoint(conn, deps, 'cp-iso1', 'iso-m1', 'alpha');
    assessDrift('cp-iso1', missionId('iso-m1') as MissionId, 'Alpha assessment', conn,
      'alpha' as TenantId, deps.audit, deps.time);

    // Tenant Beta
    seedMission(conn, { id: 'iso-m2', agentId: 'a1', state: 'EXECUTING',
      objective: 'Beta objective', tenantId: 'beta' });
    seedCheckpoint(conn, deps, 'cp-iso2', 'iso-m2', 'beta');
    assessDrift('cp-iso2', missionId('iso-m2') as MissionId, 'Beta assessment', conn,
      'beta' as TenantId, deps.audit, deps.time);

    // Query for Alpha's assessments only
    const alphaCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_drift_assessments WHERE tenant_id = 'alpha'`);
    const betaCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_drift_assessments WHERE tenant_id = 'beta'`);

    assert.equal(alphaCount?.c, 1, 'Alpha must have exactly 1 assessment');
    assert.equal(betaCount?.c, 1, 'Beta must have exactly 1 assessment');

    // Verify no cross-contamination
    const alphaRow = conn.get<{ mission_id: string }>(
      `SELECT mission_id FROM core_drift_assessments WHERE tenant_id = 'alpha'`);
    assert.equal(alphaRow?.mission_id, 'iso-m1',
      'Alpha assessment must reference Alpha mission, not Beta');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-018: Drift Engine Reads Wrong Table (MEDIUM)
  // CATCHES: If drift engine reads from core_missions.objective instead of
  // core_mission_goals.objective, it compares against a potentially mutated
  // objective (core_missions.objective is not trigger-protected).
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-006: drift engine reads from core_mission_goals, not core_missions', () => {
    // CATCHES T-S3-018: If the drift engine queries core_missions.objective,
    // an attacker who modifies core_missions.objective (possible since it's not
    // trigger-protected for UPDATE) can evade drift detection.
    const { deps, conn } = createTestOrchestrationDeps();

    const goalObjective = 'Immutable goal objective anchored in core_mission_goals';

    seedMission(conn, { id: 'tbl-m1', agentId: 'a1', state: 'EXECUTING',
      objective: goalObjective });
    seedCheckpoint(conn, deps, 'cp-tbl', 'tbl-m1');

    // Modify core_missions.objective (NOT protected by I-24 triggers)
    conn.run(`UPDATE core_missions SET objective = 'MODIFIED by attacker' WHERE id = 'tbl-m1'`);

    assessDrift('cp-tbl', missionId('tbl-m1') as MissionId, 'Some assessment', conn,
      'test-tenant' as TenantId, deps.audit, deps.time);

    // Verify the drift assessment used the goal anchor (from core_mission_goals),
    // not the modified mission objective
    const driftRow = conn.get<{ original_objective: string }>(
      'SELECT original_objective FROM core_drift_assessments WHERE checkpoint_id = ?', ['cp-tbl']);

    assert.equal(driftRow?.original_objective, goalObjective,
      'Drift engine must read from core_mission_goals (trigger-protected), not core_missions');
    assert.notEqual(driftRow?.original_objective, 'MODIFIED by attacker',
      'Drift engine must NOT have read the modified core_missions.objective');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-006/007: Drift Evasion via Keyword Stuffing (HIGH/MEDIUM)
  // CATCHES: TF-IDF cosine similarity is vulnerable to keyword stuffing —
  // an agent can copy the objective verbatim into its assessment while actually
  // pursuing unrelated work.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-007: verbatim objective copy in assessment produces low drift (evasion possible)', () => {
    // CATCHES T-S3-006: An adversarial agent copies the objective word-for-word
    // into its assessment. TF-IDF cosine similarity will be ~1.0, meaning drift ~0.
    // This is a known design limitation of TF-IDF similarity — this test documents
    // the vulnerability so it can be addressed when embedding-based similarity ships (FO-004).
    const { deps, conn } = createTestOrchestrationDeps();

    const objective = 'Analyze customer feedback data and produce sentiment report';
    seedMission(conn, { id: 'stuff-m1', agentId: 'a1', state: 'EXECUTING', objective });
    seedCheckpoint(conn, deps, 'cp-stuff', 'stuff-m1');

    // Agent copies objective verbatim as its assessment
    const result = assessDrift('cp-stuff', missionId('stuff-m1') as MissionId,
      objective, // verbatim copy
      conn, 'test-tenant' as TenantId, deps.audit, deps.time);

    // TF-IDF will see identical token distributions → similarity ~1.0 → drift ~0
    assert.ok(result.driftScore < 0.1,
      `Verbatim copy: drift ${result.driftScore} must be near 0 (known TF-IDF limitation)`);
    assert.equal(result.actionTaken, 'none',
      'Verbatim copy evades drift detection (FO-004: upgrade to embeddings will fix this)');

    conn.close();
  });

  it('DFT-008: keyword-stuffed assessment with filler evades drift detection', () => {
    // CATCHES T-S3-007: Agent adds objective keywords into unrelated content.
    // "Analyze customer feedback data" keywords peppered into unrelated work.
    // TF-IDF partial overlap lowers drift score.
    const { deps, conn } = createTestOrchestrationDeps();

    const objective = 'Analyze customer feedback data and produce sentiment report';
    seedMission(conn, { id: 'kw-m1', agentId: 'a1', state: 'EXECUTING', objective });
    seedCheckpoint(conn, deps, 'cp-kw', 'kw-m1');

    // Stuffed assessment: includes key objective words but is actually about something else
    const stuffedAssessment = 'I am analyzing the customer feedback data pipeline. ' +
      'The sentiment report infrastructure is being deployed. ' +
      'Meanwhile I am also mining cryptocurrency and building a social media platform ' +
      'that is completely unrelated to the original objective.';

    const result = assessDrift('cp-kw', missionId('kw-m1') as MissionId,
      stuffedAssessment, conn, 'test-tenant' as TenantId, deps.audit, deps.time);

    // This documents that keyword stuffing partially works with TF-IDF.
    // The drift score will be lower than if the assessment were completely unrelated.
    // We cannot assert a specific threshold because TF-IDF behavior depends on token overlap,
    // but we document this as a known attack vector.
    assert.ok(typeof result.driftScore === 'number', 'Drift score must be computed');
    assert.ok(result.driftScore >= 0 && result.driftScore <= 1,
      `Drift score ${result.driftScore} must be in [0,1] range`);

    // Record the actual score for the Breaker report
    // (this test passes regardless — it documents the vulnerability, not defends against it)

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Empty Assessment Handling
  // CATCHES: Edge case — empty string assessment should not crash or produce
  // undefined behavior.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-009: empty assessment text → max drift (driftScore = 1.0)', () => {
    // CATCHES: Empty assessment has zero tokens. computeSimilarity returns 0.
    // driftScore = 1.0 - 0 = 1.0. Must trigger escalation.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'empty-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Non-empty objective for comparison' });
    seedCheckpoint(conn, deps, 'cp-empty', 'empty-m1');

    const result = assessDrift('cp-empty', missionId('empty-m1') as MissionId,
      '', conn, 'test-tenant' as TenantId, deps.audit, deps.time);

    assert.equal(result.driftScore, 1.0, 'Empty assessment → drift must be 1.0');
    assert.equal(result.similarityScore, 0, 'Empty assessment → similarity must be 0');
    assert.equal(result.actionTaken, 'escalated',
      'Max drift must trigger escalation');
    assert.ok(result.escalationReason !== null, 'Escalation must have a reason');

    conn.close();
  });

  it('DFT-010: whitespace-only assessment → max drift', () => {
    // CATCHES: Whitespace tokenizes to empty after split/filter. Same as empty.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'ws-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Build recommendation engine' });
    seedCheckpoint(conn, deps, 'cp-ws', 'ws-m1');

    const result = assessDrift('cp-ws', missionId('ws-m1') as MissionId,
      '   \t\n  ', conn, 'test-tenant' as TenantId, deps.audit, deps.time);

    assert.equal(result.driftScore, 1.0,
      'Whitespace-only assessment → drift must be 1.0 (no tokens)');
    assert.equal(result.actionTaken, 'escalated');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Missing Mission Goal
  // CATCHES: If goal anchor is missing, drift engine must fail gracefully,
  // not crash with an unhandled null/undefined.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-011: missing mission goal → graceful fallback (no drift)', () => {
    // CATCHES: If the code does not check for null goalRow, accessing
    // goalRow.objective would throw a TypeError.
    const { deps, conn } = createTestOrchestrationDeps();

    // Use nonexistent mission ID — no row in core_mission_goals
    const result = assessDrift('nonexistent-cp', missionId('nonexistent') as MissionId,
      'Assessment text', conn, 'test-tenant' as TenantId, deps.audit, deps.time);

    assert.equal(result.driftScore, 0, 'Missing goal → driftScore = 0 (no drift detectable)');
    assert.equal(result.similarityScore, 1, 'Missing goal → similarityScore = 1');
    assert.equal(result.actionTaken, 'none', 'Missing goal → no action');
    assert.equal(result.escalationReason, null, 'Missing goal → no escalation reason');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Drift Override of Confidence
  // CATCHES: I-24 requires that escalated drift overrides a confidence-based
  // 'continue' decision. Without this override, a high-confidence agent can
  // pursue divergent objectives undetected.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-012: escalated drift overrides high-confidence continue [A21: success]', () => {
    // CATCHES: If drift override is missing in checkpoint_coordinator, an agent
    // with confidence=0.95 continues even though it has completely drifted.
    const { deps, conn } = createTestOrchestrationDeps();
    const coordinator = createCheckpointCoordinator();

    seedMission(conn, { id: 'ovr-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Analyze customer feedback data and produce sentiment report' });
    seedResource(conn, { missionId: 'ovr-m1' });

    const fireResult = coordinator.fire(deps, missionId('ovr-m1') as MissionId, 'PERIODIC');
    assert.equal(fireResult.ok, true);
    if (!fireResult.ok) return;

    // Agent has high confidence but completely drifted assessment
    const respondResult = coordinator.processResponse(deps, {
      checkpointId: fireResult.value,
      assessment: 'Optimizing database indexes for better query performance on user tables',
      confidence: 0.95, // Would normally → 'continue'
      proposedAction: 'continue',
      planRevision: null,
      escalationReason: null,
    });

    assert.equal(respondResult.ok, true);
    if (!respondResult.ok) return;

    assert.equal(respondResult.value.action, 'escalated',
      'Drift escalation must override high-confidence continue');
    assert.ok(respondResult.value.reason.includes('goal_drift_detected'),
      'Reason must indicate goal drift detection');

    // Verify mission state was changed to BLOCKED
    const mission = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?', ['ovr-m1']);
    assert.equal(mission?.state, 'BLOCKED',
      'Mission must transition to BLOCKED when drift escalation overrides continue');

    conn.close();
  });

  it('DFT-013: drift does NOT override agent-proposed escalation [A21: rejection]', () => {
    // CATCHES: If drift override logic is poorly written, it might downgrade
    // an already-escalated action to 'continue'. The override must only
    // work in one direction: continue → escalated.
    const { deps, conn } = createTestOrchestrationDeps();
    const coordinator = createCheckpointCoordinator();

    seedMission(conn, { id: 'noovr-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Analyze customer feedback data and produce sentiment report' });
    seedResource(conn, { missionId: 'noovr-m1' });

    const fireResult = coordinator.fire(deps, missionId('noovr-m1') as MissionId, 'PERIODIC');
    assert.equal(fireResult.ok, true);
    if (!fireResult.ok) return;

    // Agent already proposes escalation — drift should not downgrade it
    const respondResult = coordinator.processResponse(deps, {
      checkpointId: fireResult.value,
      assessment: 'Analyzing customer feedback — this matches well',
      confidence: 0.9,
      proposedAction: 'escalate',
      escalationReason: 'Agent requests human review',
      planRevision: null,
    });

    assert.equal(respondResult.ok, true);
    if (!respondResult.ok) return;

    assert.equal(respondResult.value.action, 'escalated',
      'Agent-proposed escalation must NOT be downgraded by low drift');

    conn.close();
  });

  it('DFT-014: drift does NOT override agent-proposed abort [A21: rejection]', () => {
    // CATCHES: Abort is a terminal action — drift must not override it.
    const { deps, conn } = createTestOrchestrationDeps();
    const coordinator = createCheckpointCoordinator();

    seedMission(conn, { id: 'noab-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Analyze customer feedback data' });
    seedResource(conn, { missionId: 'noab-m1' });

    const fireResult = coordinator.fire(deps, missionId('noab-m1') as MissionId, 'PERIODIC');
    assert.equal(fireResult.ok, true);
    if (!fireResult.ok) return;

    const respondResult = coordinator.processResponse(deps, {
      checkpointId: fireResult.value,
      assessment: 'Cannot proceed — aborting mission',
      confidence: 0.1,
      proposedAction: 'abort',
      planRevision: null,
      escalationReason: null,
    });

    assert.equal(respondResult.ok, true);
    if (!respondResult.ok) return;

    assert.equal(respondResult.value.action, 'aborted',
      'Agent-proposed abort must NOT be overridden by drift assessment');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Large Assessment Text
  // CATCHES: Very long text could cause performance issues in TF-IDF
  // computation or exceed storage limits.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-015: large assessment text (10KB) processes without error', () => {
    // CATCHES: If computeSimilarity has O(n^2) behavior on large inputs,
    // or if the INSERT statement fails on large text.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'big-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Build machine learning pipeline for data analysis' });
    seedCheckpoint(conn, deps, 'cp-big', 'big-m1');

    // Generate 10KB of text with some relevant keywords
    const words = ['machine', 'learning', 'pipeline', 'data', 'analysis',
      'neural', 'network', 'training', 'inference', 'optimization',
      'gradient', 'descent', 'backpropagation', 'loss', 'function'];
    let bigText = '';
    while (bigText.length < 10000) {
      bigText += words[Math.floor(Math.random() * words.length)] + ' ';
    }

    const result = assessDrift('cp-big', missionId('big-m1') as MissionId,
      bigText, conn, 'test-tenant' as TenantId, deps.audit, deps.time);

    assert.ok(typeof result.driftScore === 'number', 'Drift score must be a number');
    assert.ok(result.driftScore >= 0 && result.driftScore <= 1,
      `Drift score ${result.driftScore} must be in [0,1]`);

    // Verify it was stored
    const row = conn.get<{ current_assessment: string }>(
      'SELECT current_assessment FROM core_drift_assessments WHERE checkpoint_id = ?', ['cp-big']);
    assert.ok(row !== undefined, 'Large assessment must be stored');
    assert.equal(row!.current_assessment, bigText, 'Stored assessment must match input');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Drift Assessment Storage Completeness
  // CATCHES: All required fields must be populated in core_drift_assessments.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-016: drift assessment stores all required fields', () => {
    // CATCHES: If any column is NULL when it should have a value, downstream
    // queries will produce incorrect results.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'fields-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Complete field storage test' });
    seedCheckpoint(conn, deps, 'cp-fields', 'fields-m1');

    assessDrift('cp-fields', missionId('fields-m1') as MissionId,
      'Field storage verification assessment', conn,
      'test-tenant' as TenantId, deps.audit, deps.time);

    const row = conn.get<{
      id: string;
      checkpoint_id: string;
      mission_id: string;
      tenant_id: string;
      drift_score: number;
      similarity_score: number;
      original_objective: string;
      current_assessment: string;
      action_taken: string;
      created_at: string;
    }>('SELECT * FROM core_drift_assessments WHERE checkpoint_id = ?', ['cp-fields']);

    assert.ok(row !== undefined, 'Row must exist');
    assert.ok(row!.id.length > 0, 'id must be non-empty');
    assert.equal(row!.checkpoint_id, 'cp-fields');
    assert.equal(row!.mission_id, 'fields-m1');
    assert.equal(row!.tenant_id, 'test-tenant');
    assert.equal(typeof row!.drift_score, 'number');
    assert.equal(typeof row!.similarity_score, 'number');
    assert.ok(row!.drift_score >= 0 && row!.drift_score <= 1, 'drift_score in [0,1]');
    assert.ok(row!.similarity_score >= 0 && row!.similarity_score <= 1, 'similarity_score in [0,1]');
    assert.equal(row!.original_objective, 'Complete field storage test');
    assert.equal(row!.current_assessment, 'Field storage verification assessment');
    assert.ok(['none', 'flagged', 'escalated'].includes(row!.action_taken),
      `action_taken must be valid enum, got: ${row!.action_taken}`);
    assert.ok(row!.created_at.length > 0, 'created_at must be non-empty');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Drift Audit Trail
  // CATCHES: Drift assessments must create audit entries for traceability.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-017: drift assessment creates audit trail entry', () => {
    // CATCHES: Without audit entries, drift assessments are invisible to compliance.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'daud-m1', agentId: 'a1', state: 'EXECUTING',
      objective: 'Audit trail test' });
    seedCheckpoint(conn, deps, 'cp-daud', 'daud-m1');

    const beforeCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'assess_drift'`);

    assessDrift('cp-daud', missionId('daud-m1') as MissionId, 'Audit assessment', conn,
      'test-tenant' as TenantId, deps.audit, deps.time);

    const afterCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'assess_drift'`);

    assert.equal((afterCount?.c ?? 0) - (beforeCount?.c ?? 0), 1,
      'Exactly one audit entry per drift assessment');

    // Verify audit detail contains relevant fields
    const auditRow = conn.get<{ detail: string; actor_id: string }>(
      `SELECT detail, actor_id FROM core_audit_log WHERE operation = 'assess_drift' ORDER BY rowid DESC LIMIT 1`);
    assert.equal(auditRow?.actor_id, 'drift_engine');
    const detail = JSON.parse(auditRow!.detail) as Record<string, unknown>;
    assert.ok('checkpointId' in detail, 'Audit detail must include checkpointId');
    assert.ok('missionId' in detail, 'Audit detail must include missionId');
    assert.ok('driftScore' in detail, 'Audit detail must include driftScore');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // action_taken CHECK Constraint
  // CATCHES: Invalid action_taken values must be rejected by the CHECK constraint.
  // ═══════════════════════════════════════════════════════════════════════════

  it('DFT-018: invalid action_taken rejected by CHECK constraint [A21: rejection]', () => {
    // CATCHES: If the CHECK constraint is missing, arbitrary strings can be
    // stored in action_taken, breaking downstream logic that switches on it.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'chk-m1', agentId: 'a1', state: 'EXECUTING', objective: 'Check test' });
    seedCheckpoint(conn, deps, 'cp-chk', 'chk-m1');

    let threw = false;
    try {
      conn.run(
        `INSERT INTO core_drift_assessments
         (id, checkpoint_id, mission_id, tenant_id, drift_score, similarity_score,
          original_objective, current_assessment, action_taken, created_at)
         VALUES ('test-id', 'cp-chk', 'chk-m1', 'test-tenant', 0.5, 0.5,
                 'obj', 'assessment', 'INVALID_ACTION', '2026-03-23T00:00:00Z')`,
      );
    } catch {
      threw = true;
    }

    assert.equal(threw, true,
      'Invalid action_taken value must be rejected by CHECK constraint');

    conn.close();
  });
});
