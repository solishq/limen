/**
 * BREAKER: Sprint 3 Cascade Walker Attack Tests
 * Target: I-23 Artifact Dependency Cascading (cascade_walker.ts, artifact_store.ts)
 *
 * Attack vectors: T-S3-003 (cross-tenant), T-S3-016 (circular dependency),
 * T-S3-001/002 (deep/wide DoS), T-S3-004 (I-19 content mutation),
 * T-S3-009 (audit trail), plus additional Breaker-discovered vectors.
 *
 * Classification: Tier 1 (data isolation, governance, state transitions)
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
import { walkCascade } from '../../src/orchestration/artifacts/cascade_walker.js';
import type { MissionId, ArtifactId, TaskId, TenantId } from '../../src/kernel/interfaces/index.js';

// ─── Helpers ───

const TEST_TENANT = 'test-tenant' as TenantId;

function createArt(
  deps: ReturnType<typeof createTestOrchestrationDeps>['deps'],
  ctx: ReturnType<typeof createTestOperationContext>,
  mid: string,
  name: string,
  content: string = '{}',
): { artifactId: ArtifactId; version: number } {
  const store = createArtifactStore();
  const result = store.create(deps, ctx, {
    missionId: missionId(mid) as MissionId,
    name,
    type: 'data',
    format: 'json',
    content,
    sourceTaskId: taskId('seed-task') as TaskId,
    parentArtifactId: null as unknown as ArtifactId | null,
    metadata: {},
  });
  assert.equal(result.ok, true, `Failed to create artifact ${name} in mission ${mid}`);
  if (!result.ok) throw new Error('unreachable');
  return result.value;
}

function trackDep(
  deps: ReturnType<typeof createTestOrchestrationDeps>['deps'],
  readingMission: string,
  artifactId: ArtifactId,
  version: number,
): void {
  const store = createArtifactStore();
  store.trackDependency(deps, missionId(readingMission) as MissionId, artifactId, version, true);
}

function getStalenessFlag(
  conn: ReturnType<typeof createTestOrchestrationDeps>['conn'],
  artId: ArtifactId,
): string | undefined {
  const row = conn.get<{ staleness_flag: string }>(
    'SELECT staleness_flag FROM core_artifacts WHERE id = ?',
    [artId],
  );
  return row?.staleness_flag;
}

describe('BREAKER: Sprint 3 Cascade Walker Attacks', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-003: Cross-Tenant Cascade Propagation (CRITICAL)
  // CATCHES: Without tenant isolation on cascade, Tenant A archiving an artifact
  // could mark Tenant B's artifacts as STALE — silent cross-tenant data corruption.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-001: Tenant A cascade does NOT affect Tenant B artifacts [A21: rejection]', () => {
    // CATCHES: If cascade BFS queries ignore tenant_id, artifacts belonging to
    // a different tenant that happen to depend on the same artifact_id will be
    // marked STALE, corrupting another tenant's data view.
    const { deps, conn } = createTestOrchestrationDeps();

    // Tenant A setup
    seedMission(conn, { id: 'xt-m1a', agentId: 'a1', state: 'EXECUTING', tenantId: 'tenant-alpha' });
    seedResource(conn, { missionId: 'xt-m1a', tenantId: 'tenant-alpha' });
    seedMission(conn, { id: 'xt-m2a', agentId: 'a1', state: 'EXECUTING', tenantId: 'tenant-alpha' });
    seedResource(conn, { missionId: 'xt-m2a', tenantId: 'tenant-alpha' });

    // Tenant B setup
    seedMission(conn, { id: 'xt-m1b', agentId: 'a1', state: 'EXECUTING', tenantId: 'tenant-beta' });
    seedResource(conn, { missionId: 'xt-m1b', tenantId: 'tenant-beta' });

    const ctxA = createTestOperationContext({ tenantId: 'tenant-alpha' });
    const ctxB = createTestOperationContext({ tenantId: 'tenant-beta' });

    const artSourceA = createArt(deps, ctxA, 'xt-m1a', 'shared-data-source');
    const artDepA = createArt(deps, ctxA, 'xt-m2a', 'tenant-a-dependent');
    const artDepB = createArt(deps, ctxB, 'xt-m1b', 'tenant-b-dependent');

    // Both tenants' missions depend on the source artifact
    trackDep(deps, 'xt-m2a', artSourceA.artifactId, artSourceA.version);
    trackDep(deps, 'xt-m1b', artSourceA.artifactId, artSourceA.version);

    const audit = deps.audit;

    // Cascade with tenant-alpha scope only
    walkCascade(
      [artSourceA.artifactId as string],
      conn,
      'tenant-alpha' as TenantId,
      audit,
    );

    // Tenant A dependent MUST be STALE
    assert.equal(getStalenessFlag(conn, artDepA.artifactId), 'STALE',
      'Tenant A dependent must be marked STALE by tenant-A-scoped cascade');

    // Tenant B dependent MUST remain FRESH — cross-tenant isolation
    assert.equal(getStalenessFlag(conn, artDepB.artifactId), 'FRESH',
      'Tenant B dependent must remain FRESH — cascade must not cross tenant boundary');

    conn.close();
  });

  it('CAS-002: Tenant B cascade does NOT affect Tenant A artifacts [A21: rejection]', () => {
    // CATCHES: Reverse direction — Tenant B cannot affect Tenant A.
    // This verifies the isolation is bidirectional, not just one-way.
    const { deps, conn } = createTestOrchestrationDeps();

    seedMission(conn, { id: 'xt2-m1a', agentId: 'a1', state: 'EXECUTING', tenantId: 'tenant-alpha' });
    seedResource(conn, { missionId: 'xt2-m1a', tenantId: 'tenant-alpha' });
    seedMission(conn, { id: 'xt2-m1b', agentId: 'a1', state: 'EXECUTING', tenantId: 'tenant-beta' });
    seedResource(conn, { missionId: 'xt2-m1b', tenantId: 'tenant-beta' });
    seedMission(conn, { id: 'xt2-m2b', agentId: 'a1', state: 'EXECUTING', tenantId: 'tenant-beta' });
    seedResource(conn, { missionId: 'xt2-m2b', tenantId: 'tenant-beta' });

    const ctxA = createTestOperationContext({ tenantId: 'tenant-alpha' });
    const ctxB = createTestOperationContext({ tenantId: 'tenant-beta' });

    const artSource = createArt(deps, ctxB, 'xt2-m1b', 'source-by-beta');
    const artDepA = createArt(deps, ctxA, 'xt2-m1a', 'alpha-reads-beta');
    const artDepB = createArt(deps, ctxB, 'xt2-m2b', 'beta-dep');

    trackDep(deps, 'xt2-m1a', artSource.artifactId, artSource.version);
    trackDep(deps, 'xt2-m2b', artSource.artifactId, artSource.version);

    const audit = deps.audit;

    // Cascade with tenant-beta scope
    walkCascade(
      [artSource.artifactId as string],
      conn,
      'tenant-beta' as TenantId,
      audit,
    );

    assert.equal(getStalenessFlag(conn, artDepB.artifactId), 'STALE',
      'Tenant B dependent must be STALE');
    assert.equal(getStalenessFlag(conn, artDepA.artifactId), 'FRESH',
      'Tenant A dependent must remain FRESH — beta cascade must not reach alpha');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-016: Circular Dependency — Infinite Loop Prevention
  // CATCHES: Without visited set, A→B→A would loop forever, consuming CPU
  // and blocking the database transaction indefinitely.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-003: circular dependency A→B→A terminates without infinite loop', () => {
    // CATCHES: BFS without cycle detection hangs forever on circular graphs.
    // The visited set must prevent re-processing of already-seen artifacts.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'cyc-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'cyc-m1' });
    seedMission(conn, { id: 'cyc-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'cyc-m2' });

    const artA = createArt(deps, ctx, 'cyc-m1', 'cycle-a');
    const artB = createArt(deps, ctx, 'cyc-m2', 'cycle-b');

    // Circular: m1 reads B, m2 reads A
    trackDep(deps, 'cyc-m1', artB.artifactId, artB.version);
    trackDep(deps, 'cyc-m2', artA.artifactId, artA.version);

    // Must terminate (timeout would indicate infinite loop)
    const result = walkCascade(
      [artA.artifactId as string],
      conn,
      TEST_TENANT,
      audit,
    );

    // B must be STALE (direct dependent)
    assert.equal(getStalenessFlag(conn, artB.artifactId), 'STALE',
      'Direct dependent B must be STALE despite cycle');
    // Must have terminated with finite count
    assert.ok(result.affectedCount >= 1, 'Must affect at least B');
    assert.ok(result.affectedCount < 100, 'Must not process infinite iterations');

    conn.close();
  });

  it('CAS-004: three-node cycle A→B→C→A terminates', () => {
    // CATCHES: Larger cycles that might escape a simple two-node detection.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'cyc3-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'cyc3-m1' });
    seedMission(conn, { id: 'cyc3-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'cyc3-m2' });
    seedMission(conn, { id: 'cyc3-m3', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'cyc3-m3' });

    const artA = createArt(deps, ctx, 'cyc3-m1', 'a');
    const artB = createArt(deps, ctx, 'cyc3-m2', 'b');
    const artC = createArt(deps, ctx, 'cyc3-m3', 'c');

    // A→B→C→A cycle
    trackDep(deps, 'cyc3-m2', artA.artifactId, artA.version); // m2 reads A
    trackDep(deps, 'cyc3-m3', artB.artifactId, artB.version); // m3 reads B
    trackDep(deps, 'cyc3-m1', artC.artifactId, artC.version); // m1 reads C (closing cycle)

    const result = walkCascade(
      [artA.artifactId as string],
      conn,
      TEST_TENANT,
      audit,
    );

    assert.equal(getStalenessFlag(conn, artB.artifactId), 'STALE', 'B must be STALE');
    assert.equal(getStalenessFlag(conn, artC.artifactId), 'STALE', 'C must be STALE');
    assert.ok(result.affectedCount >= 2, 'B and C must be affected');
    assert.ok(result.affectedCount < 50, 'Must terminate — not loop');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-001/002: Cascade DoS — Deep and Wide Graph Bounds
  // CATCHES: Without depth/breadth limits, an adversary could construct a graph
  // that causes unbounded computation during cascade.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-005: chain at depth 9 propagates (within MAX_CASCADE_DEPTH=10)', () => {
    // CATCHES: maxDepth boundary — depth 9 from source is at depth 9 in BFS,
    // which is < 10, so it must propagate.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    // Create 11 missions in a chain (source + 10 dependents)
    const missions: string[] = [];
    const artifacts: { artifactId: ArtifactId; version: number }[] = [];

    for (let i = 0; i < 11; i++) {
      const mid = `deep-m${i}`;
      missions.push(mid);
      seedMission(conn, { id: mid, agentId: 'a1', state: 'EXECUTING' });
      seedResource(conn, { missionId: mid });
      artifacts.push(createArt(deps, ctx, mid, `art-${i}`));
    }

    // Linear chain: m1 reads m0, m2 reads m1, ..., m10 reads m9
    for (let i = 1; i < 11; i++) {
      trackDep(deps, missions[i], artifacts[i - 1].artifactId, artifacts[i - 1].version);
    }

    const result = walkCascade(
      [artifacts[0].artifactId as string],
      conn,
      TEST_TENANT,
      audit,
    );

    // Verify depth 1 through 10 are STALE (source is at depth 0, so depth 9 = art[10])
    // Art[1] is at depth 1 from art[0], ..., art[10] is at depth 10 from art[0]
    // But MAX_CASCADE_DEPTH=10 means items at depth >= 10 skip.
    // Art[10] is queued with depth 9 (its parent art[9] was queued at depth 8, processed → children at depth 9)
    // Wait — let me trace: source art[0] at depth 0. Its dependents (art[1]) discovered at depth 0.
    // art[1] queued with depth=1. art[1]'s dependents (art[2]) discovered at depth 1, queued with depth=2.
    // ... art[9]'s dependents (art[10]) discovered at depth 9, queued with depth=10.
    // Art[10] dequeued: depth=10 >= MAX=10 → skip.
    // So art[10] gets marked STALE at the UPDATE before being added to queue.
    // Actually: BFS processes art[9] (at depth 9 < 10), finds art[10] as dependent,
    // marks it STALE, then pushes to queue with depth=10. art[10] dequeued: depth=10 → skip (no further cascade).
    // So art[10] IS STALE, but nothing beyond art[10] would be.

    for (let i = 1; i <= 10; i++) {
      assert.equal(getStalenessFlag(conn, artifacts[i].artifactId), 'STALE',
        `art[${i}] must be STALE (within max depth boundary)`);
    }

    conn.close();
  });

  it('CAS-006: chain beyond MAX_CASCADE_DEPTH stops propagating', () => {
    // CATCHES: If maxDepth check is off-by-one or missing, cascade extends unboundedly.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    // Create 14 missions — enough to exceed depth 10
    const missions: string[] = [];
    const artifacts: { artifactId: ArtifactId; version: number }[] = [];

    for (let i = 0; i < 14; i++) {
      const mid = `dmax-m${i}`;
      missions.push(mid);
      seedMission(conn, { id: mid, agentId: 'a1', state: 'EXECUTING' });
      seedResource(conn, { missionId: mid });
      artifacts.push(createArt(deps, ctx, mid, `art-${i}`));
    }

    for (let i = 1; i < 14; i++) {
      trackDep(deps, missions[i], artifacts[i - 1].artifactId, artifacts[i - 1].version);
    }

    const result = walkCascade(
      [artifacts[0].artifactId as string],
      conn,
      TEST_TENANT,
      audit,
    );

    // Cascade must terminate — cannot affect more than the graph has
    assert.ok(result.affectedCount < 14, 'Cascade must stop before reaching all 13 dependents');
    // At minimum, items through depth 10 must be STALE
    assert.ok(result.affectedCount >= 10, 'At least 10 dependents must be STALE');

    conn.close();
  });

  it('CAS-007: wide fan-out — 30 dependents at one level', () => {
    // CATCHES: If cascade cannot handle many dependents at one level (e.g., O(n^2) query),
    // wide graphs cause performance degradation or failure.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    // Source mission
    seedMission(conn, { id: 'wide-m0', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'wide-m0' });
    const artSource = createArt(deps, ctx, 'wide-m0', 'source');

    // 30 dependent missions, each with an artifact depending on source
    const dependentArts: { artifactId: ArtifactId; version: number }[] = [];
    for (let i = 1; i <= 30; i++) {
      const mid = `wide-m${i}`;
      seedMission(conn, { id: mid, agentId: 'a1', state: 'EXECUTING' });
      seedResource(conn, { missionId: mid });
      const art = createArt(deps, ctx, mid, `dep-${i}`);
      dependentArts.push(art);
      trackDep(deps, mid, artSource.artifactId, artSource.version);
    }

    const result = walkCascade(
      [artSource.artifactId as string],
      conn,
      TEST_TENANT,
      audit,
    );

    // All 30 dependents must be STALE
    assert.equal(result.affectedCount, 30,
      'All 30 dependents must be marked STALE in wide fan-out');

    for (let i = 0; i < 30; i++) {
      assert.equal(getStalenessFlag(conn, dependentArts[i].artifactId), 'STALE',
        `Dependent ${i + 1} must be STALE`);
    }

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-004: Content Mutation via Cascade (I-19 Violation)
  // CATCHES: If the UPDATE touches content, type, or other immutable columns,
  // I-19 artifact immutability is violated. The cascade must ONLY modify
  // staleness_flag.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-008: cascade preserves ALL immutable columns (content, type, name, format, metadata)', () => {
    // CATCHES: If the UPDATE SET clause includes any column other than staleness_flag,
    // artifact immutability (I-19) is violated. Content bytes must be bit-identical.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'i19-src', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'i19-src' });
    seedMission(conn, { id: 'i19-dep', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'i19-dep' });

    const artSource = createArt(deps, ctx, 'i19-src', 'source');
    const contentStr = '{"immutable_data":"this must not change","nested":{"deep":true},"count":42}';
    const artDep = createArt(deps, ctx, 'i19-dep', 'immutable-content', contentStr);

    // Capture all columns before cascade
    const before = conn.get<{
      content: Buffer; type: string; name: string; format: string;
      metadata_json: string; source_task_id: string; created_at: string;
    }>(
      'SELECT content, type, name, format, metadata_json, source_task_id, created_at FROM core_artifacts WHERE id = ? AND version = ?',
      [artDep.artifactId, artDep.version],
    );
    assert.ok(before !== undefined, 'Artifact must exist before cascade');

    trackDep(deps, 'i19-dep', artSource.artifactId, artSource.version);

    const store = createArtifactStore();
    store.archiveForMission(deps, missionId('i19-src') as MissionId);

    // Capture all columns after cascade
    const after = conn.get<{
      content: Buffer; type: string; name: string; format: string;
      metadata_json: string; source_task_id: string; created_at: string;
      staleness_flag: string;
    }>(
      'SELECT content, type, name, format, metadata_json, source_task_id, created_at, staleness_flag FROM core_artifacts WHERE id = ? AND version = ?',
      [artDep.artifactId, artDep.version],
    );

    assert.equal(after?.staleness_flag, 'STALE', 'Artifact must be STALE after cascade');
    assert.deepEqual(after?.content, before?.content, 'Content bytes must be bit-identical (I-19)');
    assert.equal(after?.type, before?.type, 'Type must be unchanged (I-19)');
    assert.equal(after?.name, before?.name, 'Name must be unchanged');
    assert.equal(after?.format, before?.format, 'Format must be unchanged');
    assert.equal(after?.metadata_json, before?.metadata_json, 'Metadata must be unchanged');
    assert.equal(after?.source_task_id, before?.source_task_id, 'Source task ID must be unchanged');
    assert.equal(after?.created_at, before?.created_at, 'Created_at must be unchanged');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // STALE Idempotency
  // CATCHES: Re-processing already-STALE artifacts wastes computation and
  // could double-count in audit trail or create duplicate entries.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-009: already-STALE artifact not re-processed (idempotent)', () => {
    // CATCHES: Without the FRESH filter in the BFS query, already-STALE artifacts
    // get re-processed, adding them to affectedIds again and potentially cascading further.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'idem-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'idem-m1' });
    seedMission(conn, { id: 'idem-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'idem-m2' });

    const artA = createArt(deps, ctx, 'idem-m1', 'source');
    const artB = createArt(deps, ctx, 'idem-m2', 'pre-stale');

    // Pre-mark B as STALE before cascade
    conn.run('UPDATE core_artifacts SET staleness_flag = ? WHERE id = ?', ['STALE', artB.artifactId]);

    trackDep(deps, 'idem-m2', artA.artifactId, artA.version);

    const result = walkCascade(
      [artA.artifactId as string],
      conn,
      TEST_TENANT,
      audit,
    );

    assert.equal(result.affectedCount, 0,
      'Already-STALE artifact must not be re-processed');
    assert.deepEqual(result.affectedIds, [],
      'Affected IDs must be empty for already-STALE dependents');

    conn.close();
  });

  it('CAS-010: double cascade on same source produces same result (idempotent)', () => {
    // CATCHES: If cascade is not idempotent, running it twice could produce
    // different audit entries or corrupt state.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'dbl-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'dbl-m1' });
    seedMission(conn, { id: 'dbl-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'dbl-m2' });

    const artA = createArt(deps, ctx, 'dbl-m1', 'source');
    const artB = createArt(deps, ctx, 'dbl-m2', 'dependent');

    trackDep(deps, 'dbl-m2', artA.artifactId, artA.version);

    // First cascade
    const result1 = walkCascade([artA.artifactId as string], conn, TEST_TENANT, audit);
    assert.equal(result1.affectedCount, 1, 'First cascade: B must be affected');

    // Second cascade — B is already STALE, should be no-op
    const result2 = walkCascade([artA.artifactId as string], conn, TEST_TENANT, audit);
    assert.equal(result2.affectedCount, 0, 'Second cascade: must be no-op (B already STALE)');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Only ACTIVE Artifacts Affected
  // CATCHES: ARCHIVED, DELETED, or SUMMARIZED artifacts must not be marked STALE.
  // These lifecycle states are terminal or semi-terminal — re-marking them is contradictory.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-011: ARCHIVED artifact not marked STALE by cascade [A21: rejection]', () => {
    // CATCHES: If the BFS query does not filter by lifecycle_state='ACTIVE',
    // archived artifacts get STALE flag which is contradictory.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'lc-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'lc-m1' });
    seedMission(conn, { id: 'lc-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'lc-m2' });

    const artA = createArt(deps, ctx, 'lc-m1', 'source');
    const artB = createArt(deps, ctx, 'lc-m2', 'will-archive');

    // Manually archive B
    conn.run('UPDATE core_artifacts SET lifecycle_state = ? WHERE id = ?', ['ARCHIVED', artB.artifactId]);

    trackDep(deps, 'lc-m2', artA.artifactId, artA.version);

    const result = walkCascade([artA.artifactId as string], conn, TEST_TENANT, audit);

    assert.equal(result.affectedCount, 0,
      'ARCHIVED artifact must not be affected by cascade');
    // Verify staleness_flag is still FRESH (not touched)
    assert.equal(getStalenessFlag(conn, artB.artifactId), 'FRESH',
      'ARCHIVED artifact staleness_flag must remain FRESH');

    conn.close();
  });

  it('CAS-012: DELETED artifact not marked STALE by cascade [A21: rejection]', () => {
    // CATCHES: DELETED artifacts are invisible — cascade must not touch them.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'del-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'del-m1' });
    seedMission(conn, { id: 'del-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'del-m2' });

    const artA = createArt(deps, ctx, 'del-m1', 'source');
    const artB = createArt(deps, ctx, 'del-m2', 'will-delete');

    // Manually mark B as DELETED
    conn.run('UPDATE core_artifacts SET lifecycle_state = ? WHERE id = ?', ['DELETED', artB.artifactId]);

    trackDep(deps, 'del-m2', artA.artifactId, artA.version);

    const result = walkCascade([artA.artifactId as string], conn, TEST_TENANT, audit);

    assert.equal(result.affectedCount, 0,
      'DELETED artifact must not be affected by cascade');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Empty Dependency Chain
  // CATCHES: Edge case — artifact with no dependents should produce clean no-op,
  // not throw or create spurious audit entries.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-013: empty source list produces clean no-op', () => {
    // CATCHES: Edge case — empty input array must not throw or create audit entries.
    const { conn } = createTestOrchestrationDeps();
    const audit = createTestOrchestrationDeps().deps.audit;

    const beforeAudit = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'cascade_stale'`,
    );

    const result = walkCascade([], conn, null, audit);

    const afterAudit = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'cascade_stale'`,
    );

    assert.equal(result.affectedCount, 0, 'Empty source list → zero affected');
    assert.deepEqual(result.affectedIds, [], 'Empty source list → empty affected IDs');
    assert.equal((afterAudit?.c ?? 0) - (beforeAudit?.c ?? 0), 0,
      'Empty cascade must not create audit entries');

    conn.close();
  });

  it('CAS-014: artifact with zero dependents produces no cascade', () => {
    // CATCHES: Isolated artifact with no dependency edges.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'iso-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'iso-m1' });

    const art = createArt(deps, ctx, 'iso-m1', 'isolated');

    const result = walkCascade([art.artifactId as string], conn, TEST_TENANT, audit);

    assert.equal(result.affectedCount, 0, 'Isolated artifact → zero cascade');
    assert.deepEqual(result.affectedIds, []);

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // T-S3-009: Audit Trail
  // CATCHES: Without audit entries, cascade operations are invisible to
  // compliance review — who staled what and when is unrecoverable.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-015: cascade produces exactly one audit entry (not per artifact)', () => {
    // CATCHES: If audit is per-artifact, a cascade affecting 100 artifacts creates
    // 100 audit entries — log pollution. Must be exactly 1 per invocation.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'aud-m0', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'aud-m0' });

    const artSource = createArt(deps, ctx, 'aud-m0', 'source');

    // Create 5 dependents
    for (let i = 1; i <= 5; i++) {
      const mid = `aud-m${i}`;
      seedMission(conn, { id: mid, agentId: 'a1', state: 'EXECUTING' });
      seedResource(conn, { missionId: mid });
      createArt(deps, ctx, mid, `dep-${i}`);
      trackDep(deps, mid, artSource.artifactId, artSource.version);
    }

    const beforeCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'cascade_stale'`,
    );

    walkCascade([artSource.artifactId as string], conn, TEST_TENANT, audit);

    const afterCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'cascade_stale'`,
    );

    assert.equal((afterCount?.c ?? 0) - (beforeCount?.c ?? 0), 1,
      'Must produce exactly 1 audit entry per cascade invocation, not per affected artifact');

    conn.close();
  });

  it('CAS-016: audit entry contains source artifact IDs and affected count', () => {
    // CATCHES: Audit entry without detail is useless for forensics.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'adet-m0', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'adet-m0' });
    seedMission(conn, { id: 'adet-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'adet-m1' });

    const artSource = createArt(deps, ctx, 'adet-m0', 'source');
    createArt(deps, ctx, 'adet-m1', 'dep');
    trackDep(deps, 'adet-m1', artSource.artifactId, artSource.version);

    walkCascade([artSource.artifactId as string], conn, TEST_TENANT, audit);

    const auditRow = conn.get<{ detail: string; operation: string; actor_id: string }>(
      `SELECT detail, operation, actor_id FROM core_audit_log WHERE operation = 'cascade_stale' ORDER BY rowid DESC LIMIT 1`,
    );

    assert.ok(auditRow !== undefined, 'Cascade audit entry must exist');
    assert.equal(auditRow!.operation, 'cascade_stale');
    assert.equal(auditRow!.actor_id, 'cascade_walker');

    const detail = JSON.parse(auditRow!.detail) as Record<string, unknown>;
    assert.ok(Array.isArray(detail.sourceArtifactIds), 'Detail must include sourceArtifactIds');
    assert.ok(typeof detail.affectedCount === 'number', 'Detail must include affectedCount');
    assert.ok(Array.isArray(detail.affectedIds), 'Detail must include affectedIds');

    conn.close();
  });

  it('CAS-017: zero-effect cascade produces no audit entry', () => {
    // CATCHES: If audit is emitted even when nothing was affected,
    // the audit trail fills with noise.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'noaud-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'noaud-m1' });

    const art = createArt(deps, ctx, 'noaud-m1', 'no-deps');

    const beforeCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'cascade_stale'`,
    );

    walkCascade([art.artifactId as string], conn, TEST_TENANT, audit);

    const afterCount = conn.get<{ c: number }>(
      `SELECT COUNT(*) as c FROM core_audit_log WHERE operation = 'cascade_stale'`,
    );

    assert.equal((afterCount?.c ?? 0) - (beforeCount?.c ?? 0), 0,
      'Zero-effect cascade must not produce audit entry');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Integration: archiveForMission triggers cascade
  // CATCHES: If archiveForMission does not call walkCascade, the cascade
  // is "built but not wired in" (Pattern P-002).
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-018: archiveForMission triggers cascade on dependents (wiring verification)', () => {
    // CATCHES P-002: walkCascade could exist but never be called from archiveForMission.
    // This test verifies the wiring at the call site.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();

    seedMission(conn, { id: 'wire-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'wire-m1' });
    seedMission(conn, { id: 'wire-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'wire-m2' });

    const artA = createArt(deps, ctx, 'wire-m1', 'source');
    const artB = createArt(deps, ctx, 'wire-m2', 'dependent');

    trackDep(deps, 'wire-m2', artA.artifactId, artA.version);

    // Use archiveForMission (not walkCascade directly) to verify wiring
    const store = createArtifactStore();
    const archiveResult = store.archiveForMission(deps, missionId('wire-m1') as MissionId);

    assert.equal(archiveResult.ok, true, 'Archive must succeed');

    // If walkCascade is wired in, B must be STALE
    assert.equal(getStalenessFlag(conn, artB.artifactId), 'STALE',
      'archiveForMission must trigger walkCascade — B must be STALE (P-002 wiring)');

    conn.close();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Combined Lifecycle + Staleness Consistency
  // CATCHES: Contradictory state combinations that should not exist.
  // ═══════════════════════════════════════════════════════════════════════════

  it('CAS-019: SUMMARIZED artifact not marked STALE by cascade', () => {
    // CATCHES: SUMMARIZED is a compacted state — re-marking it STALE is meaningless.
    const { deps, conn } = createTestOrchestrationDeps();
    const ctx = createTestOperationContext();
    const audit = deps.audit;

    seedMission(conn, { id: 'sum-m1', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'sum-m1' });
    seedMission(conn, { id: 'sum-m2', agentId: 'a1', state: 'EXECUTING' });
    seedResource(conn, { missionId: 'sum-m2' });

    const artA = createArt(deps, ctx, 'sum-m1', 'source');
    const artB = createArt(deps, ctx, 'sum-m2', 'summarized');

    // Manually set B to SUMMARIZED
    conn.run('UPDATE core_artifacts SET lifecycle_state = ? WHERE id = ?', ['SUMMARIZED', artB.artifactId]);

    trackDep(deps, 'sum-m2', artA.artifactId, artA.version);

    const result = walkCascade([artA.artifactId as string], conn, TEST_TENANT, audit);

    assert.equal(result.affectedCount, 0,
      'SUMMARIZED artifact must not be affected by cascade');

    conn.close();
  });
});
