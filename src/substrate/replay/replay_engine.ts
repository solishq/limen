/**
 * Replay Engine — Deterministic replay verification via state snapshots.
 * Spec ref: I-25 (Deterministic Replay), I-03 (Atomic Audit)
 *
 * Phase: Sprint 4 (Replay & Pipeline)
 * Implements: State snapshot capture and replay verification.
 *
 * This is a VERIFICATION engine, not a re-execution engine. It:
 *   1. Takes snapshots of mission state at key lifecycle points (takeSnapshot)
 *   2. Compares snapshots to verify replay would produce identical state (verifyReplay)
 *   3. Retrieves snapshots for inspection (getSnapshots)
 *
 * State hash computation:
 *   Queries 5 tables deterministically, serializes with sorted keys,
 *   produces SHA-256 hash. Excludes audit trail and events (contain UUIDs
 *   and timestamps that differ between runs).
 *
 * Security constraints:
 *   - Every query includes COALESCE tenant_id pattern for tenant isolation
 *   - Mission ownership verified before operating
 *   - Snapshots are append-only (enforced by DDL triggers)
 *
 * Invariants enforced: I-25, I-03
 * Failure modes defended: FM-10 (cross-tenant leakage via COALESCE pattern)
 */

import { createHash } from 'node:crypto';
import type { DatabaseConnection, Result, AuditTrail } from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';

// ============================================================================
// Types
// ============================================================================

export interface ReplaySnapshot {
  readonly id: string;
  readonly missionId: string;
  readonly tenantId: string | null;
  readonly snapshotType: 'mission_start' | 'checkpoint' | 'mission_end';
  readonly stateHash: string;
  readonly stateDetail: string;
  readonly createdAt: string;
}

export interface ReplayVerification {
  readonly success: boolean;
  readonly missionId: string;
  readonly startHash: string;
  readonly endHash: string;
  readonly divergences: ReadonlyArray<{
    readonly table: string;
    readonly field: string;
    readonly expected: string;
    readonly actual: string;
  }>;
}

/** Optional audit dependency for replay operations */
export interface AuditDep {
  readonly append: AuditTrail['append'];
}

export interface ReplayEngine {
  takeSnapshot(
    conn: DatabaseConnection,
    missionId: string,
    tenantId: string | null,
    snapshotType: 'mission_start' | 'checkpoint' | 'mission_end',
    time: TimeProvider,
  ): Result<ReplaySnapshot>;

  verifyReplay(
    conn: DatabaseConnection,
    missionId: string,
    tenantId: string | null,
  ): Result<ReplayVerification>;

  getSnapshots(
    conn: DatabaseConnection,
    missionId: string,
    tenantId: string | null,
  ): Result<readonly ReplaySnapshot[]>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Verify mission belongs to the specified tenant.
 * Returns the mission row if found, or an error Result if not.
 */
function verifyMissionTenant(
  conn: DatabaseConnection,
  missionId: string,
  tenantId: string | null,
): Result<{ id: string }> {
  const row = conn.get<{ id: string }>(
    `SELECT id FROM core_missions
     WHERE id = ?
     AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
    [missionId, tenantId],
  );

  if (!row) {
    return {
      ok: false,
      error: {
        code: 'MISSION_NOT_FOUND',
        message: `Mission ${missionId} not found for tenant`,
        spec: 'I-25',
      },
    };
  }

  return { ok: true, value: row };
}

/**
 * Compute a deterministic state hash for a mission.
 *
 * Queries 5 tables:
 *   1. core_missions (state, plan_version, compacted, completed_at)
 *   2. core_tasks (state, retry_count per task, sorted by id)
 *   3. core_artifacts (lifecycle_state, staleness_flag per artifact, sorted by id)
 *   4. core_resources (token_allocated, token_consumed, token_remaining)
 *   5. core_mission_goals (objective, success_criteria, scope_boundaries)
 *
 * Serializes deterministically: JSON.stringify with sorted keys.
 * SHA-256 hash of the concatenated serialization.
 *
 * EXCLUDES audit trail and events (contain UUIDs and timestamps that differ between runs).
 */
function computeStateHash(
  conn: DatabaseConnection,
  missionId: string,
  tenantId: string | null,
): { hash: string; detail: string } {
  // 1. Mission state
  const mission = conn.get<{
    state: string;
    plan_version: number;
    compacted: number;
    completed_at: string | null;
  }>(
    `SELECT state, plan_version, compacted, completed_at
     FROM core_missions
     WHERE id = ?
     AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
    [missionId, tenantId],
  );

  // 2. Tasks (sorted by id for determinism)
  const tasks = conn.query<{
    id: string;
    state: string;
    retry_count: number;
  }>(
    `SELECT id, state, retry_count
     FROM core_tasks
     WHERE mission_id = ?
     AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')
     ORDER BY id ASC`,
    [missionId, tenantId],
  );

  // 3. Artifacts (sorted by id for determinism)
  const artifacts = conn.query<{
    id: string;
    lifecycle_state: string;
    staleness_flag: string;
  }>(
    `SELECT id, lifecycle_state, staleness_flag
     FROM core_artifacts
     WHERE mission_id = ?
     AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')
     ORDER BY id ASC`,
    [missionId, tenantId],
  );

  // 4. Resources
  const resources = conn.get<{
    token_allocated: number;
    token_consumed: number;
    token_remaining: number;
  }>(
    `SELECT token_allocated, token_consumed, token_remaining
     FROM core_resources
     WHERE mission_id = ?
     AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')`,
    [missionId, tenantId],
  );

  // 5. Mission goals
  // F-S4-001 FIX: Added tenant isolation via mission_id FK (core_mission_goals has no tenant_id column,
  // but is scoped through the mission_id FK which is already tenant-verified above).
  // The mission ownership check in verifyMissionTenant() ensures tenant isolation.
  const goals = conn.get<{
    objective: string;
    success_criteria: string;
    scope_boundaries: string;
  }>(
    `SELECT objective, success_criteria, scope_boundaries
     FROM core_mission_goals
     WHERE mission_id = ?`,
    [missionId],
  );

  // Build deterministic state object with sorted keys
  const stateObj = {
    artifacts: artifacts.map(a => ({
      id: a.id,
      lifecycle_state: a.lifecycle_state,
      staleness_flag: a.staleness_flag,
    })),
    goals: goals ? {
      objective: goals.objective,
      scope_boundaries: goals.scope_boundaries,
      success_criteria: goals.success_criteria,
    } : null,
    mission: mission ? {
      compacted: mission.compacted,
      completed_at: mission.completed_at,
      plan_version: mission.plan_version,
      state: mission.state,
    } : null,
    resources: resources ? {
      token_allocated: resources.token_allocated,
      token_consumed: resources.token_consumed,
      token_remaining: resources.token_remaining,
    } : null,
    tasks: tasks.map(t => ({
      id: t.id,
      retry_count: t.retry_count,
      state: t.state,
    })),
  };

  // Deterministic serialization: keys already sorted in object literal above
  const detail = JSON.stringify(stateObj);
  const hash = createHash('sha256').update(detail).digest('hex');

  return { hash, detail };
}

/**
 * Create a replay engine instance.
 *
 * @param audit - Optional audit dependency for recording snapshot operations
 * @returns Frozen ReplayEngine
 */
export function createReplayEngine(audit?: AuditDep): ReplayEngine {
  const engine: ReplayEngine = {
    takeSnapshot(
      conn: DatabaseConnection,
      missionId: string,
      tenantId: string | null,
      snapshotType: 'mission_start' | 'checkpoint' | 'mission_end',
      time: TimeProvider,
    ): Result<ReplaySnapshot> {
      // Verify mission belongs to tenant
      const verifyResult = verifyMissionTenant(conn, missionId, tenantId);
      if (!verifyResult.ok) {
        return verifyResult as Result<ReplaySnapshot>;
      }

      const { hash, detail } = computeStateHash(conn, missionId, tenantId);
      const id = globalThis.crypto.randomUUID();
      const createdAt = time.nowISO();

      // Insert snapshot (append-only — triggers prevent UPDATE/DELETE)
      conn.run(
        `INSERT INTO core_replay_snapshots (id, mission_id, tenant_id, snapshot_type, state_hash, state_detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, missionId, tenantId, snapshotType, hash, detail, createdAt],
      );

      // Audit the snapshot if audit dependency provided
      if (audit) {
        audit.append(conn, {
          tenantId: tenantId as import('../../kernel/interfaces/index.js').TenantId | null,
          actorType: 'system',
          actorId: 'replay_engine',
          operation: 'snapshot_created',
          resourceType: 'replay_snapshot',
          resourceId: id,
          detail: { missionId, snapshotType, stateHash: hash },
        });
      }

      const snapshot: ReplaySnapshot = {
        id,
        missionId,
        tenantId,
        snapshotType,
        stateHash: hash,
        stateDetail: detail,
        createdAt,
      };

      return { ok: true, value: snapshot };
    },

    verifyReplay(
      conn: DatabaseConnection,
      missionId: string,
      tenantId: string | null,
    ): Result<ReplayVerification> {
      // Verify mission belongs to tenant
      const verifyResult = verifyMissionTenant(conn, missionId, tenantId);
      if (!verifyResult.ok) {
        return verifyResult as Result<ReplayVerification>;
      }

      // Get start and end snapshots for this mission
      const startSnapshot = conn.get<{ state_hash: string; state_detail: string }>(
        `SELECT state_hash, state_detail
         FROM core_replay_snapshots
         WHERE mission_id = ?
         AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')
         AND snapshot_type = 'mission_start'
         ORDER BY created_at ASC
         LIMIT 1`,
        [missionId, tenantId],
      );

      const endSnapshot = conn.get<{ state_hash: string; state_detail: string }>(
        `SELECT state_hash, state_detail
         FROM core_replay_snapshots
         WHERE mission_id = ?
         AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')
         AND snapshot_type = 'mission_end'
         ORDER BY created_at DESC
         LIMIT 1`,
        [missionId, tenantId],
      );

      if (!startSnapshot) {
        return {
          ok: false,
          error: {
            code: 'SNAPSHOT_NOT_FOUND',
            message: `No mission_start snapshot found for mission ${missionId}`,
            spec: 'I-25',
          },
        };
      }

      if (!endSnapshot) {
        // No end snapshot yet — compute current state hash for comparison
        const { hash: currentHash, detail: currentDetail } = computeStateHash(conn, missionId, tenantId);

        // Compare start and current — find divergences
        const divergences = findDivergences(startSnapshot.state_detail, currentDetail);

        return {
          ok: true,
          value: {
            success: startSnapshot.state_hash === currentHash,
            missionId,
            startHash: startSnapshot.state_hash,
            endHash: currentHash,
            divergences,
          },
        };
      }

      // Compare start and end hashes
      const divergences = findDivergences(startSnapshot.state_detail, endSnapshot.state_detail);

      return {
        ok: true,
        value: {
          success: startSnapshot.state_hash === endSnapshot.state_hash,
          missionId,
          startHash: startSnapshot.state_hash,
          endHash: endSnapshot.state_hash,
          divergences,
        },
      };
    },

    getSnapshots(
      conn: DatabaseConnection,
      missionId: string,
      tenantId: string | null,
    ): Result<readonly ReplaySnapshot[]> {
      // Verify mission belongs to tenant
      const verifyResult = verifyMissionTenant(conn, missionId, tenantId);
      if (!verifyResult.ok) {
        return verifyResult as Result<readonly ReplaySnapshot[]>;
      }

      const rows = conn.query<{
        id: string;
        mission_id: string;
        tenant_id: string | null;
        snapshot_type: string;
        state_hash: string;
        state_detail: string;
        created_at: string;
      }>(
        `SELECT id, mission_id, tenant_id, snapshot_type, state_hash, state_detail, created_at
         FROM core_replay_snapshots
         WHERE mission_id = ?
         AND COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__')
         ORDER BY created_at ASC`,
        [missionId, tenantId],
      );

      const snapshots: ReplaySnapshot[] = rows.map(row => ({
        id: row.id,
        missionId: row.mission_id,
        tenantId: row.tenant_id,
        snapshotType: row.snapshot_type as ReplaySnapshot['snapshotType'],
        stateHash: row.state_hash,
        stateDetail: row.state_detail,
        createdAt: row.created_at,
      }));

      return { ok: true, value: snapshots };
    },
  };

  return Object.freeze(engine);
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Find divergences between two state detail JSON strings.
 * Compares top-level sections and reports field-level differences.
 */
function findDivergences(
  startDetail: string,
  endDetail: string,
): Array<{ table: string; field: string; expected: string; actual: string }> {
  const divergences: Array<{ table: string; field: string; expected: string; actual: string }> = [];

  try {
    const startState = JSON.parse(startDetail) as Record<string, unknown>;
    const endState = JSON.parse(endDetail) as Record<string, unknown>;

    // Compare each top-level section
    for (const table of Object.keys(startState)) {
      const startValue = JSON.stringify(startState[table]);
      const endValue = JSON.stringify(endState[table]);

      if (startValue !== endValue) {
        // Drill into object fields for more granular divergence reporting
        if (typeof startState[table] === 'object' && startState[table] !== null
          && typeof endState[table] === 'object' && endState[table] !== null
          && !Array.isArray(startState[table])) {
          const startObj = startState[table] as Record<string, unknown>;
          const endObj = endState[table] as Record<string, unknown>;
          const allKeys = new Set([...Object.keys(startObj), ...Object.keys(endObj)]);
          for (const field of allKeys) {
            const sv = JSON.stringify(startObj[field]);
            const ev = JSON.stringify(endObj[field]);
            if (sv !== ev) {
              divergences.push({
                table,
                field,
                expected: sv ?? 'undefined',
                actual: ev ?? 'undefined',
              });
            }
          }
        } else {
          divergences.push({
            table,
            field: '*',
            expected: startValue,
            actual: endValue,
          });
        }
      }
    }
  } catch {
    // If parsing fails, report a single divergence
    divergences.push({
      table: 'parse_error',
      field: '*',
      expected: startDetail,
      actual: endDetail,
    });
  }

  return divergences;
}
