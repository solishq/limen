/**
 * Limen v1.0 — CGP ↔ CCP Integration Tests
 * Phase 2B: Cross-Subsystem Wiring Verification — P4 Claim Candidates
 *
 * These tests verify real claims from the CCP store flow through the CGP admission
 * pipeline as P4 candidates via the ClaimCandidateCollector boundary. No mocks of
 * CCP — real claim creation, real artifact linkage, real admission.
 *
 * Defect classes: DC-CCP-001 through DC-CCP-013
 * Key invariants: I-70 (scope), I-74 (independence), I-68 (eviction order),
 *                 I-72 (token cost), I-73 (replay), I-75 (canonical repr),
 *                 §51.1 (P4 filtering), §51.3 (temporal gate), §14.7 (serialization)
 *
 * Pattern:
 *   1. Create in-memory SQLite with full schema
 *   2. Seed missions, tasks, artifacts, and claims
 *   3. Create CGP governor via harness (injects real ClaimCandidateCollector)
 *   4. Call governor.admitContext() — verify P4 candidates from real CCP data
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// CGP — admission pipeline with real claim collector wired
import { createContextGovernor } from '../../src/context/harness/cgp_harness.js';
import type {
  ContextGovernor,
  TaskContextSpec,
  ContextInvocationId,
  TemporalScope,
  ClaimCandidateCollector,
  ClaimCandidate,
} from '../../src/context/interfaces/cgp_types.js';

// CGP stores — for governor with injected test collector (DC-CCP-013, IT-CCP-14)
import { createContextGovernor as createStoresGovernor } from '../../src/context/stores/cgp_stores.js';

// Test infrastructure
import type {
  DatabaseConnection,
  TaskId,
  AgentId,
  MissionId,
  ArtifactId,
  Result,
} from '../../src/kernel/interfaces/index.js';
import {
  createTestDatabase,
  seedMission,
} from '../helpers/test_database.js';

// ============================================================================
// Test Helpers
// ============================================================================

const TEST_MISSION_A = 'mission-ccp-A';
const TEST_MISSION_B = 'mission-ccp-B';
const TEST_TASK = 'task-ccp-001';
const TEST_AGENT = 'agent-ccp-001';
const TEST_MODEL = 'test-model-ccp';
const TEST_ECB = 5000; // generous budget

function testTaskId(id: string = TEST_TASK): TaskId {
  return id as TaskId;
}

function testMissionId(id: string = TEST_MISSION_A): MissionId {
  return id as MissionId;
}

function testInvocationId(id: string = 'inv-ccp-001'): ContextInvocationId {
  return id as ContextInvocationId;
}

/** Seed a task into the database */
function seedTask(c: DatabaseConnection, options: {
  id: string;
  missionId: string;
  state?: string;
  agentId?: string;
}): void {
  const now = new Date().toISOString();
  const state = options.state ?? 'RUNNING';
  const agentIdVal = options.agentId ?? TEST_AGENT;

  const graphId = `graph-${options.missionId}`;
  const existingGraph = c.get<{ id: string }>(
    'SELECT id FROM core_task_graphs WHERE id = ?', [graphId],
  );
  if (!existingGraph) {
    c.run(
      `INSERT INTO core_task_graphs (id, mission_id, version, objective_alignment, is_active, created_at)
       VALUES (?, ?, 1, 'Aligned with test objective', 1, ?)`,
      [graphId, options.missionId, now],
    );
  }

  const completedAt = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(state) ? now : null;
  c.run(
    `INSERT INTO core_tasks (id, mission_id, tenant_id, graph_id, description, execution_mode, estimated_tokens, capabilities_required, state, assigned_agent, retry_count, max_retries, created_at, updated_at, completed_at)
     VALUES (?, ?, 'test-tenant', ?, 'CCP integration test task', 'deterministic', 100, '[]', ?, ?, 0, 3, ?, ?, ?)`,
    [options.id, options.missionId, graphId, state, agentIdVal, now, now, completedAt],
  );
}

function seedMissionAndTask(c: DatabaseConnection, opts?: {
  missionId?: string;
  taskId?: string;
  taskState?: string;
}): void {
  const mid = opts?.missionId ?? TEST_MISSION_A;
  const tid = opts?.taskId ?? TEST_TASK;
  const state = opts?.taskState ?? 'RUNNING';

  seedMission(c, { id: mid, state: 'EXECUTING' });
  seedTask(c, { id: tid, missionId: mid, state });
}

/** Seed an artifact into the database */
function seedArtifact(c: DatabaseConnection, options: {
  id: string;
  missionId: string;
  taskId?: string;
  name?: string;
  state?: string;
}): void {
  const now = new Date().toISOString();
  c.run(
    `INSERT INTO core_artifacts (id, version, mission_id, tenant_id, name, type, format, content, lifecycle_state, source_task_id, created_at)
     VALUES (?, 1, ?, 'test-tenant', ?, 'report', 'markdown', X'74657374', ?, ?, ?)`,
    [options.id, options.missionId, options.name ?? `artifact-${options.id}`, options.state ?? 'ACTIVE', options.taskId ?? TEST_TASK, now],
  );
}

/** Seed a claim into the database */
function seedClaim(c: DatabaseConnection, options: {
  id: string;
  missionId?: string;
  subject?: string;
  predicate?: string;
  objectType?: string;
  objectValue?: string;
  confidence?: number;
  validAt?: string;
  status?: string;
  archived?: boolean;
  createdAt?: string;
}): void {
  const {
    id,
    missionId = TEST_MISSION_A,
    subject = 'entity:company:acme',
    predicate = 'financial.revenue',
    objectType = 'number',
    objectValue = '1000000',
    confidence = 0.85,
    validAt = '2026-01-15T00:00:00.000Z',
    status = 'active',
    archived = false,
    createdAt,
  } = options;
  const ts = createdAt ?? new Date().toISOString();
  c.run(
    `INSERT INTO claim_assertions (id, tenant_id, subject, predicate, object_type, object_value,
       confidence, valid_at, source_agent_id, source_mission_id, source_task_id,
       grounding_mode, status, archived, created_at)
     VALUES (?, 'test-tenant', ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       'evidence_path', ?, ?, ?)`,
    [id, subject, predicate, objectType, objectValue,
     confidence, validAt, TEST_AGENT, missionId, TEST_TASK,
     status, archived ? 1 : 0, ts],
  );
}

/** Link a claim to an artifact via claim_artifact_refs */
function linkClaimToArtifact(c: DatabaseConnection, claimId: string, artifactId: string): void {
  c.run(
    'INSERT INTO claim_artifact_refs (artifact_id, claim_id) VALUES (?, ?)',
    [artifactId, claimId],
  );
}

/** Add evidence to a claim */
function seedEvidence(c: DatabaseConnection, claimId: string, evidenceType: string, evidenceId: string): void {
  const evId = `ev-${claimId}-${evidenceType}-${evidenceId}`;
  c.run(
    `INSERT INTO claim_evidence (id, claim_id, evidence_type, evidence_id, source_state)
     VALUES (?, ?, ?, ?, 'live')`,
    [evId, claimId, evidenceType, evidenceId],
  );
}

/** Tombstone a claim (NULL content, set purged_at) */
function tombstoneClaim(c: DatabaseConnection, claimId: string): void {
  const now = new Date().toISOString();
  c.run(
    `UPDATE claim_assertions SET
       subject = NULL, predicate = NULL, object_type = NULL, object_value = NULL,
       confidence = NULL, valid_at = NULL, source_agent_id = NULL,
       source_mission_id = NULL, source_task_id = NULL, runtime_witness = NULL,
       status = 'retracted', archived = 1,
       purged_at = ?, purge_reason = 'test tombstone'
     WHERE id = ?`,
    [now, claimId],
  );
}

function makeTaskSpec(overrides?: Partial<TaskContextSpec>): TaskContextSpec {
  return {
    taskId: testTaskId(),
    missionId: testMissionId(),
    isChatMode: false,
    ...overrides,
  };
}

// ============================================================================
// Integration State
// ============================================================================

let conn: DatabaseConnection;
let governor: ContextGovernor;

function setup(): void {
  conn = createTestDatabase();
  governor = createContextGovernor();
  seedMissionAndTask(conn);
}

/** Get P4 candidates from an admission result */
function getP4Candidates(result: { ok: true; value: { admittedCandidates: readonly { candidateType: string; candidateId: string }[] } }): readonly { candidateType: string; candidateId: string }[] {
  return result.value.admittedCandidates.filter(c => c.candidateType === 'claim');
}

// ============================================================================
// IT-CCP-01: P4 collects real claims linked to mission artifacts
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-001 — Mission-scoped claims in P4', () => {
  beforeEach(() => setup());

  it('IT-CCP-01: Claims linked to mission artifacts appear as P4 candidates', () => {
    // DC-CCP-001 success path: Claims linked to mission A's artifacts appear in P4.
    // CATCHES: Collector not wired, collector not querying claim_artifact_refs, candidate missing.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedArtifact(conn, { id: 'art-A2', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-01' });
    seedClaim(conn, { id: 'claim-02', subject: 'entity:company:beta' });
    linkClaimToArtifact(conn, 'claim-01', 'art-A1');
    linkClaimToArtifact(conn, 'claim-02', 'art-A2');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    assert.strictEqual(p4.length, 2, 'Both claims linked to mission artifacts must appear in P4');
    const ids = p4.map(c => c.candidateId).sort();
    assert.deepStrictEqual(ids, ['claim-01', 'claim-02']);
  });
});

// ============================================================================
// IT-CCP-02: P4 excludes claims from other missions
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-001 — Cross-mission exclusion', () => {
  beforeEach(() => setup());

  it('IT-CCP-02: Claims linked to other mission artifacts excluded from P4', () => {
    // DC-CCP-001 rejection: Claims linked to mission B's artifacts must NOT appear
    // when admission runs for mission A. Scope contamination test.
    seedMission(conn, { id: TEST_MISSION_B, state: 'EXECUTING' });
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedArtifact(conn, { id: 'art-B1', missionId: TEST_MISSION_B });
    seedClaim(conn, { id: 'claim-A', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-B', missionId: TEST_MISSION_B });
    linkClaimToArtifact(conn, 'claim-A', 'art-A1');
    linkClaimToArtifact(conn, 'claim-B', 'art-B1');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);
    assert.ok(ids.includes('claim-A'), 'Mission A claim must be in P4');
    assert.ok(!ids.includes('claim-B'), 'Mission B claim must NOT be in P4');
  });
});

// ============================================================================
// IT-CCP-03: Retracted claims excluded from P4
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-002 — Retracted exclusion', () => {
  beforeEach(() => setup());

  it('IT-CCP-03: Retracted claims excluded from P4 candidates', () => {
    // DC-CCP-002 rejection: A claim with status='retracted' must not appear in P4.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-active' });
    seedClaim(conn, { id: 'claim-retracted', status: 'retracted' });
    linkClaimToArtifact(conn, 'claim-active', 'art-A1');
    linkClaimToArtifact(conn, 'claim-retracted', 'art-A1');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);
    assert.ok(ids.includes('claim-active'), 'Active claim must be in P4');
    assert.ok(!ids.includes('claim-retracted'), 'Retracted claim must NOT be in P4');
  });
});

// ============================================================================
// IT-CCP-04: Archived claims excluded from P4
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-003 — Archived exclusion', () => {
  beforeEach(() => setup());

  it('IT-CCP-04: Archived claims excluded from P4 candidates', () => {
    // DC-CCP-003 rejection: A claim with archived=true must not appear in P4.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-live' });
    seedClaim(conn, { id: 'claim-archived', archived: true });
    linkClaimToArtifact(conn, 'claim-live', 'art-A1');
    linkClaimToArtifact(conn, 'claim-archived', 'art-A1');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);
    assert.ok(ids.includes('claim-live'), 'Non-archived claim must be in P4');
    assert.ok(!ids.includes('claim-archived'), 'Archived claim must NOT be in P4');
  });
});

// ============================================================================
// IT-CCP-05: Active non-archived claim admitted
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-002/003 — Active admission', () => {
  beforeEach(() => setup());

  it('IT-CCP-05: Active, non-archived claim with artifact linkage enters P4', () => {
    // DC-CCP-002/003 success: An active, non-archived claim linked to a mission
    // artifact MUST enter P4 candidacy.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-good', subject: 'entity:product:widget', predicate: 'market.share', confidence: 0.92 });
    linkClaimToArtifact(conn, 'claim-good', 'art-A1');
    seedEvidence(conn, 'claim-good', 'memory', 'mem-001');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    assert.strictEqual(p4.length, 1, 'Exactly one claim must be admitted');
    assert.strictEqual(p4[0].candidateId, 'claim-good');
  });
});

// ============================================================================
// IT-CCP-06: Temporal gate filters out-of-window claims
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-008 — Temporal gate', () => {
  beforeEach(() => setup());

  it('IT-CCP-06: Claims outside temporal scope excluded from P4', () => {
    // DC-CCP-008 rejection: Claims with validAt outside temporalScope are excluded.
    // §51.3: This is filtering, not eviction — excluded claims never enter candidacy.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-in', validAt: '2025-06-01T00:00:00.000Z' });
    seedClaim(conn, { id: 'claim-out', validAt: '2025-01-01T00:00:00.000Z' });
    linkClaimToArtifact(conn, 'claim-in', 'art-A1');
    linkClaimToArtifact(conn, 'claim-out', 'art-A1');

    const temporalScope: TemporalScope = {
      start: '2025-05-01T00:00:00.000Z',
      end: '2025-07-01T00:00:00.000Z',
    };
    const result = governor.admitContext(
      conn, makeTaskSpec({ temporalScope }), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);
    assert.ok(ids.includes('claim-in'), 'In-window claim must be in P4');
    assert.ok(!ids.includes('claim-out'), 'Out-of-window claim must NOT be in P4');
  });

  it('IT-CCP-07: No temporalScope = all linked claims pass temporal gate', () => {
    // DC-CCP-008 success: When task has no temporalScope, all linked claims enter P4.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-old', validAt: '2020-01-01T00:00:00.000Z' });
    seedClaim(conn, { id: 'claim-new', validAt: '2026-06-01T00:00:00.000Z' });
    linkClaimToArtifact(conn, 'claim-old', 'art-A1');
    linkClaimToArtifact(conn, 'claim-new', 'art-A1');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    assert.strictEqual(p4.length, 2, 'Both claims must enter P4 when no temporalScope');
  });
});

// ============================================================================
// IT-CCP-08: Claims without artifact linkage excluded
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-009 — Unlinked exclusion', () => {
  beforeEach(() => setup());

  it('IT-CCP-08: Claims without artifact linkage AND no matching temporal scope excluded', () => {
    // DC-CCP-009 rejection: A claim with no claim_artifact_refs and no matching
    // temporalScope must NOT enter P4. No demonstrable mission link (I-70).
    seedClaim(conn, { id: 'claim-orphan', validAt: '2025-06-01T00:00:00.000Z' });
    // No linkClaimToArtifact call — orphan claim
    // No temporalScope on task — so temporal path is inactive

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    assert.strictEqual(p4.length, 0, 'Orphan claim with no artifact link must NOT be in P4');
  });
});

// ============================================================================
// IT-CCP-09: Claims via temporal scope match (no artifact linkage)
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-009 — Temporal-only admission', () => {
  beforeEach(() => setup());

  it('IT-CCP-09: Claim admitted via temporal scope match without artifact linkage', () => {
    // DC-CCP-009 success (alternate path): I-70 OR semantics — a claim can enter P4
    // via temporal scope match even without artifact linkage.
    // Claim must have sourceMissionId = current mission.
    seedClaim(conn, {
      id: 'claim-temporal',
      missionId: TEST_MISSION_A,
      validAt: '2025-06-15T00:00:00.000Z',
    });
    // No artifact linkage — but validAt is within temporal scope

    const temporalScope: TemporalScope = {
      start: '2025-06-01T00:00:00.000Z',
      end: '2025-07-01T00:00:00.000Z',
    };
    const result = governor.admitContext(
      conn, makeTaskSpec({ temporalScope }), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);
    assert.ok(ids.includes('claim-temporal'), 'Claim with matching temporal scope must enter P4 via path 2');
  });
});

// ============================================================================
// IT-CCP-10: P4 eviction order by createdAt ascending
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-006 — Eviction order', () => {
  beforeEach(() => setup());

  it('IT-CCP-10: P4 eviction follows createdAt ascending under budget pressure', () => {
    // DC-CCP-006: §51.1 eviction order — oldest claims evicted first (createdAt ASC).
    // Create 5 claims with known timestamps. Budget forces some eviction.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });

    const baseDate = new Date('2025-01-01T00:00:00.000Z');
    for (let i = 0; i < 5; i++) {
      const created = new Date(baseDate.getTime() + i * 86400000).toISOString();
      seedClaim(conn, {
        id: `claim-order-${i}`,
        subject: `entity:item:${i}`,
        createdAt: created,
      });
      linkClaimToArtifact(conn, `claim-order-${i}`, 'art-A1');
    }

    // First: run with generous budget to verify all 5 are collected
    const fullResult = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId('inv-full'),
    );
    assert.ok(fullResult.ok, 'Full admission must succeed');
    if (!fullResult.ok) return;

    const allP4 = fullResult.value.admittedCandidates.filter(c => c.candidateType === 'claim');
    assert.strictEqual(allP4.length, 5, 'All 5 claims must be collected');

    // Now: run with tight budget — P1 cost + only 2-3 claims fit
    // P1 control state costs ~15-20 tokens. Each claim ~25-30 tokens.
    // ECB that forces eviction of some but not all P4 claims.
    const p1Cost = fullResult.value.replayRecord.position1.tokenCost;
    // Budget = P1 + room for ~2 claims (each ~25-30 tokens)
    const tightBudget = p1Cost + 60;

    const tightResult = governor.admitContext(
      conn, makeTaskSpec(), tightBudget, TEST_MODEL, testInvocationId('inv-tight'),
    );
    assert.ok(tightResult.ok, 'Tight admission must succeed');
    if (!tightResult.ok) return;

    const p4Admitted = tightResult.value.admittedCandidates.filter(c => c.candidateType === 'claim');
    const p4Pos = tightResult.value.replayRecord.positions.find(
      (p: { positionNumber: number }) => p.positionNumber === 4,
    );

    // There must be eviction — fewer admitted than 5
    assert.ok(p4Admitted.length < 5, `Must evict some claims (admitted=${p4Admitted.length})`);
    assert.ok(p4Admitted.length > 0, 'At least one claim must survive');

    // P4 position entry must account for all 5 candidates
    assert.ok(p4Pos, 'P4 position must exist in replay');
    assert.strictEqual(p4Pos.candidateCount, 5, 'P4 must report 5 total candidates');

    // Evicted candidates should be older (lower index) than admitted ones
    const admittedIndices = p4Admitted.map(c => parseInt(c.candidateId.split('-')[2]));
    const evictedCandidates = p4Pos.candidates.filter(
      (c: { evicted: boolean }) => c.evicted,
    );
    const evictedIndices = evictedCandidates.map(
      (c: { candidateId: string }) => parseInt(c.candidateId.split('-')[2]),
    );

    // All evicted indices must be less than all admitted indices (oldest first)
    for (const evIdx of evictedIndices) {
      for (const admIdx of admittedIndices) {
        assert.ok(evIdx < admIdx,
          `Evicted claim-order-${evIdx} must be older than admitted claim-order-${admIdx}`);
      }
    }
  });
});

// ============================================================================
// IT-CCP-11: Canonical serialization is deterministic
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-011 — Deterministic serialization', () => {
  beforeEach(() => setup());

  it('IT-CCP-11: Same claim produces identical canonical text across invocations', () => {
    // DC-CCP-011: I-75 — canonical serializer must be deterministic.
    // Same claim → same text → same token cost → replay consistency.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, {
      id: 'claim-det',
      subject: 'entity:company:deterministic',
      predicate: 'quality.score',
      objectType: 'number',
      objectValue: '99',
      confidence: 0.95,
      validAt: '2025-06-01T00:00:00.000Z',
    });
    linkClaimToArtifact(conn, 'claim-det', 'art-A1');
    seedEvidence(conn, 'claim-det', 'memory', 'mem-det-001');

    // Run admission twice
    const result1 = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId('inv-1'),
    );
    const result2 = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId('inv-2'),
    );

    assert.ok(result1.ok && result2.ok, 'Both admissions must succeed');
    if (!result1.ok || !result2.ok) return;

    // Find the claim candidate in both results
    const p4r1 = result1.value.admittedCandidates.filter(c => c.candidateType === 'claim');
    const p4r2 = result2.value.admittedCandidates.filter(c => c.candidateType === 'claim');

    assert.strictEqual(p4r1.length, 1, 'Run 1 must have 1 claim');
    assert.strictEqual(p4r2.length, 1, 'Run 2 must have 1 claim');

    // Canonical text must be identical
    assert.strictEqual(
      (p4r1[0] as { canonicalText: string }).canonicalText,
      (p4r2[0] as { canonicalText: string }).canonicalText,
      'Canonical text must be identical across invocations (I-75)',
    );

    // Token cost must be identical
    assert.strictEqual(
      (p4r1[0] as { tokenCost: number }).tokenCost,
      (p4r2[0] as { tokenCost: number }).tokenCost,
      'Token cost must be identical across invocations (I-72)',
    );
  });
});

// ============================================================================
// IT-CCP-12: Canonical serialization contains required fields
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-012 — Complete serialization', () => {
  beforeEach(() => setup());

  it('IT-CCP-12: Canonical text contains subject, predicate, object, confidence, validAt, evidence', () => {
    // DC-CCP-012: §14.7 — canonical representation must include all 6 fields.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, {
      id: 'claim-full',
      subject: 'entity:company:fulltest',
      predicate: 'financial.growth',
      objectType: 'number',
      objectValue: '42',
      confidence: 0.88,
      validAt: '2025-03-15T00:00:00.000Z',
    });
    linkClaimToArtifact(conn, 'claim-full', 'art-A1');
    seedEvidence(conn, 'claim-full', 'artifact', 'art-ev-001');
    seedEvidence(conn, 'claim-full', 'memory', 'mem-ev-001');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = result.value.admittedCandidates.filter(c => c.candidateType === 'claim');
    assert.strictEqual(p4.length, 1, 'One claim must be admitted');

    const text = (p4[0] as { canonicalText: string }).canonicalText;

    // §14.7: subject, predicate, object, confidence, validAt, evidence summary
    assert.ok(text.includes('entity:company:fulltest'), 'Canonical text must contain subject');
    assert.ok(text.includes('financial.growth'), 'Canonical text must contain predicate');
    assert.ok(text.includes('42'), 'Canonical text must contain object value');
    assert.ok(text.includes('0.88'), 'Canonical text must contain confidence');
    assert.ok(text.includes('2025-03-15'), 'Canonical text must contain validAt');
    assert.ok(text.includes('evidence='), 'Canonical text must contain evidence summary');
  });
});

// ============================================================================
// IT-CCP-13: P4 recorded in replay log
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-010 — Replay record', () => {
  beforeEach(() => setup());

  it('IT-CCP-13: Admission record includes P4 claim candidate details', () => {
    // DC-CCP-010: I-73 — replay record must include P4 details.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-replay' });
    linkClaimToArtifact(conn, 'claim-replay', 'art-A1');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    // Check replay record contains P4 position info
    const record = result.value.replayRecord;
    const p4Position = record.positions.find(
      (p: { positionNumber: number }) => p.positionNumber === 4,
    );
    assert.ok(p4Position, 'Replay record must include P4 position details');
    assert.strictEqual(p4Position.applicable, true, 'P4 must be applicable');
    assert.ok(p4Position.candidateCount >= 1, 'P4 must have at least 1 candidate');

    // Verify candidate details include claim info
    const claimEntry = p4Position.candidates.find(
      (c: { candidateId: string }) => c.candidateId === 'claim-replay',
    );
    assert.ok(claimEntry, 'Replay must include claim-replay candidate');
    assert.ok((claimEntry as { tokenCost: number }).tokenCost > 0, 'Token cost must be positive');
  });
});

// ============================================================================
// IT-CCP-14: CCP failure = graceful P4 empty
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-013 — Graceful degradation', () => {
  beforeEach(() => {
    conn = createTestDatabase();
    seedMissionAndTask(conn);
  });

  it('IT-CCP-14: CCP collector failure results in empty P4 (graceful degradation)', () => {
    // DC-CCP-013: CCP failure = empty P4 + trace event. The model can still
    // reason without claims. Same pattern as WMP (DC-WIRE-010).
    const failingCollector: ClaimCandidateCollector = Object.freeze({
      collectCandidates(): Result<readonly ClaimCandidate[]> {
        throw new Error('CCP store unavailable');
      },
    });

    const failGovernor = createStoresGovernor({ claimCollector: failingCollector });

    const result = failGovernor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    // Admission must SUCCEED — P4 is degraded, not failed
    assert.ok(result.ok, 'Admission must succeed despite CCP failure');
    if (!result.ok) return;

    // P4 should be empty (graceful degradation)
    const p4 = getP4Candidates(result);
    assert.strictEqual(p4.length, 0, 'P4 must be empty when CCP collector fails');
  });
});

// ============================================================================
// IT-CCP-15: P4 independent of P3 collected set (I-74)
// ============================================================================

describe('CGP ↔ CCP Integration: I-74 — P4 independence from P3', () => {
  beforeEach(() => setup());

  it('IT-CCP-15: P4 produces same candidates regardless of P3 state', () => {
    // I-74: P4 collects independently of P3. P4 queries mission-scoped artifacts
    // directly, not P3's candidate list. Since P3 is still stubbed (empty),
    // P4 must still find claims via its own artifact query.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-ind' });
    linkClaimToArtifact(conn, 'claim-ind', 'art-A1');

    // P3 is stubbed (returns empty via safeProviderCall graceful degradation).
    // P4 MUST still find claims because it queries core_artifacts independently.
    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    assert.ok(p4.length >= 1, 'P4 must find claims independently of P3 (I-74)');
    assert.ok(
      p4.some(c => c.candidateId === 'claim-ind'),
      'claim-ind must be in P4 despite P3 being stubbed',
    );
  });
});

// ============================================================================
// IT-CCP-TOMBSTONE: Tombstoned claims excluded from P4
// ============================================================================

describe('CGP ↔ CCP Integration: DC-CCP-004 — Tombstone exclusion', () => {
  beforeEach(() => setup());

  it('IT-CCP-TOMBSTONE: Tombstoned claims excluded from P4 candidates', () => {
    // DC-CCP-004: Tombstoned claims (purged_at IS NOT NULL) must not appear in P4.
    // Tombstoned claims are retracted + archived + content purged. Triple-filtered.
    seedArtifact(conn, { id: 'art-A1', missionId: TEST_MISSION_A });
    seedClaim(conn, { id: 'claim-alive' });
    seedClaim(conn, { id: 'claim-tomb' });
    linkClaimToArtifact(conn, 'claim-alive', 'art-A1');
    linkClaimToArtifact(conn, 'claim-tomb', 'art-A1');
    tombstoneClaim(conn, 'claim-tomb');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId(),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);
    assert.ok(ids.includes('claim-alive'), 'Alive claim must be in P4');
    assert.ok(!ids.includes('claim-tomb'), 'Tombstoned claim must NOT be in P4');
  });
});

// ============================================================================
// IT-CCP-POISON: Malformed claim does not drop valid claims [F-02]
// ============================================================================

describe('CGP ↔ CCP Integration: F-02 — Poison claim resilience', () => {
  beforeEach(() => setup());

  it('IT-CCP-POISON: malformed claim object_value does not drop valid claims from P4 [F-02]', () => {
    // F-02: One claim with malformed JSON in object_value must NOT drop the entire P4.
    // The valid claim must survive; only the malformed one is skipped.
    seedArtifact(conn, { id: 'art-poison', missionId: TEST_MISSION_A });

    // Valid claim with parseable JSON
    seedClaim(conn, { id: 'claim-valid', objectType: 'number', objectValue: '42' });
    linkClaimToArtifact(conn, 'claim-valid', 'art-poison');
    seedEvidence(conn, 'claim-valid', 'artifact', 'art-poison');

    // Poison claim with malformed JSON
    seedClaim(conn, { id: 'claim-bad-json', objectType: 'object', objectValue: '{not valid json!!!' });
    linkClaimToArtifact(conn, 'claim-bad-json', 'art-poison');
    seedEvidence(conn, 'claim-bad-json', 'artifact', 'art-poison');

    const result = governor.admitContext(
      conn, makeTaskSpec(), TEST_ECB, TEST_MODEL, testInvocationId('inv-poison'),
    );

    assert.ok(result.ok, 'Admission must succeed — malformed claim is skipped, not fatal');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);

    assert.ok(ids.includes('claim-valid'),
      'IT-CCP-POISON: Valid claim must survive despite poison sibling');
    assert.ok(!ids.includes('claim-bad-json'),
      'IT-CCP-POISON: Malformed claim must be excluded');

    // Verify P4 is applicable (not degraded to empty)
    const p4Replay = result.value.replayRecord.positions.find(p => p.positionNumber === 4);
    assert.ok(p4Replay, 'P4 position must exist in replay');
    assert.ok(p4Replay!.candidateCount >= 1,
      'IT-CCP-POISON: P4 must have at least the valid claim, not be empty');
  });
});

// ============================================================================
// IT-CCP-TZ: Temporal gate handles mixed timezone offsets [F-03]
// ============================================================================

describe('CGP ↔ CCP Integration: F-03 — Temporal gate timezone handling', () => {
  beforeEach(() => setup());

  it('IT-CCP-TZ: temporal gate handles mixed timezone offsets correctly [F-03]', () => {
    // F-03: The temporal gate must compare actual time values, not string lexicography.
    // '2025-06-15T00:00:00.000+05:30' = '2025-06-14T18:30:00.000Z' (UTC)
    // Window: 2025-06-14T00:00:00Z to 2025-06-15T00:00:00Z
    // The +05:30 claim is within the window (June 14 18:30 UTC).
    // Under string comparison it would be excluded because '+' < 'Z' lexicographically.

    seedArtifact(conn, { id: 'art-tz', missionId: TEST_MISSION_A });

    // Claim with offset timezone — equivalent to 2025-06-14T18:30:00Z
    seedClaim(conn, {
      id: 'claim-offset',
      validAt: '2025-06-15T00:00:00.000+05:30',
    });
    linkClaimToArtifact(conn, 'claim-offset', 'art-tz');
    seedEvidence(conn, 'claim-offset', 'artifact', 'art-tz');

    // Claim with Z timezone — within window
    seedClaim(conn, {
      id: 'claim-utc',
      validAt: '2025-06-14T12:00:00.000Z',
    });
    linkClaimToArtifact(conn, 'claim-utc', 'art-tz');
    seedEvidence(conn, 'claim-utc', 'artifact', 'art-tz');

    // Claim outside window (before start)
    seedClaim(conn, {
      id: 'claim-outside',
      validAt: '2025-06-13T23:59:59.000Z',
    });
    linkClaimToArtifact(conn, 'claim-outside', 'art-tz');
    seedEvidence(conn, 'claim-outside', 'artifact', 'art-tz');

    const temporalScope = {
      start: '2025-06-14T00:00:00.000Z',
      end: '2025-06-15T00:00:00.000Z',
    };

    const result = governor.admitContext(
      conn,
      makeTaskSpec({ temporalScope }),
      TEST_ECB, TEST_MODEL, testInvocationId('inv-tz'),
    );

    assert.ok(result.ok, 'Admission must succeed');
    if (!result.ok) return;

    const p4 = getP4Candidates(result);
    const ids = p4.map(c => c.candidateId);

    // +05:30 claim = 2025-06-14T18:30:00Z → within [June 14 00:00, June 15 00:00]
    assert.ok(ids.includes('claim-offset'),
      'IT-CCP-TZ: Claim with +05:30 offset (within window in UTC) must be included');

    // Z claim = 2025-06-14T12:00:00Z → within window
    assert.ok(ids.includes('claim-utc'),
      'IT-CCP-TZ: Claim with Z timezone within window must be included');

    // Outside claim = 2025-06-13T23:59:59Z → before start
    assert.ok(!ids.includes('claim-outside'),
      'IT-CCP-TZ: Claim before window start must be excluded');
  });
});
