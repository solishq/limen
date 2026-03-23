/**
 * Contract tests for Replay Engine (I-25: Deterministic Replay).
 * Phase: Sprint 4 (Replay & Pipeline)
 *
 * Verifies:
 *   - takeSnapshot produces deterministic hash
 *   - Same state produces same hash
 *   - Different state produces different hash
 *   - verifyReplay succeeds when hashes match
 *   - verifyReplay reports divergences when hashes differ
 *   - Tenant isolation: snapshot for tenant A not visible to tenant B
 *   - Append-only: cannot UPDATE or DELETE snapshots
 *
 * Amendment 21: Every enforcement DC has success AND rejection tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestAuditTrail,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';
import { createReplayEngine } from '../../src/substrate/replay/replay_engine.js';
import type { TimeProvider } from '../../src/kernel/interfaces/time.js';

const time: TimeProvider = {
  nowISO: () => '2026-01-01T00:00:00.000Z',
  nowMs: () => 1735689600000,
};

describe('Contract: Replay Engine (I-25)', () => {

  describe('takeSnapshot', () => {
    it('success: produces hash for valid mission', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();
      const engine = createReplayEngine({ append: audit.append.bind(audit) });

      seedMission(conn, { id: 'snap-m1', tenantId: 'tenant-a', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'snap-m1', tenantId: 'tenant-a' });

      const result = engine.takeSnapshot(conn, 'snap-m1', 'tenant-a', 'mission_start', time);

      assert.equal(result.ok, true, 'takeSnapshot must succeed for valid mission');
      if (result.ok) {
        assert.ok(result.value.stateHash.length === 64,
          'State hash must be 64-char hex SHA-256');
        assert.equal(result.value.missionId, 'snap-m1');
        assert.equal(result.value.tenantId, 'tenant-a');
        assert.equal(result.value.snapshotType, 'mission_start');
        assert.ok(result.value.stateDetail.length > 0, 'State detail must be non-empty JSON');
      }

      conn.close();
    });

    it('rejection: fails for non-existent mission', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      const result = engine.takeSnapshot(conn, 'nonexistent', 'tenant-a', 'mission_start', time);

      assert.equal(result.ok, false, 'Must fail for non-existent mission');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_FOUND');
      }

      conn.close();
    });

    it('success: same state produces same hash (deterministic)', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'det-m1', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'det-m1', tenantId: 'tenant-a' });

      const snap1 = engine.takeSnapshot(conn, 'det-m1', 'tenant-a', 'mission_start', time);
      const snap2 = engine.takeSnapshot(conn, 'det-m1', 'tenant-a', 'checkpoint', time);

      assert.equal(snap1.ok, true);
      assert.equal(snap2.ok, true);
      if (snap1.ok && snap2.ok) {
        assert.equal(snap1.value.stateHash, snap2.value.stateHash,
          'CATCHES: same state must produce identical hash for deterministic replay');
      }

      conn.close();
    });

    it('success: different state produces different hash', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'diff-m1', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'diff-m1', tenantId: 'tenant-a' });

      const snap1 = engine.takeSnapshot(conn, 'diff-m1', 'tenant-a', 'mission_start', time);

      // Change mission state
      conn.run(
        `UPDATE core_missions SET state = 'PLANNING', updated_at = ? WHERE id = ?`,
        ['2026-01-01T01:00:00.000Z', 'diff-m1'],
      );

      const snap2 = engine.takeSnapshot(conn, 'diff-m1', 'tenant-a', 'checkpoint', time);

      assert.equal(snap1.ok, true);
      assert.equal(snap2.ok, true);
      if (snap1.ok && snap2.ok) {
        assert.notEqual(snap1.value.stateHash, snap2.value.stateHash,
          'CATCHES: different state must produce different hash — otherwise replay verification is meaningless');
      }

      conn.close();
    });
  });

  describe('verifyReplay', () => {
    it('success: verification succeeds when start hash matches current state', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'verify-m1', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'verify-m1', tenantId: 'tenant-a' });

      // Take start snapshot
      engine.takeSnapshot(conn, 'verify-m1', 'tenant-a', 'mission_start', time);

      // State unchanged — verify should report success
      const result = engine.verifyReplay(conn, 'verify-m1', 'tenant-a');

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.success, true,
          'CATCHES: unchanged state must verify as identical');
        assert.equal(result.value.divergences.length, 0,
          'No divergences expected when state unchanged');
      }

      conn.close();
    });

    it('success: verification reports divergences when state changed', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'diverge-m1', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'diverge-m1', tenantId: 'tenant-a' });

      // Take start snapshot
      engine.takeSnapshot(conn, 'diverge-m1', 'tenant-a', 'mission_start', time);

      // Mutate mission state
      conn.run(
        `UPDATE core_missions SET state = 'PLANNING', updated_at = ? WHERE id = ?`,
        ['2026-01-01T01:00:00.000Z', 'diverge-m1'],
      );

      // Verify — should report divergence
      const result = engine.verifyReplay(conn, 'diverge-m1', 'tenant-a');

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.success, false,
          'CATCHES: changed state must not verify as identical');
        assert.ok(result.value.divergences.length > 0,
          'Must report at least one divergence');
        assert.notEqual(result.value.startHash, result.value.endHash);
      }

      conn.close();
    });

    it('success: verifyReplay with start and end snapshots', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'se-m1', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'se-m1', tenantId: 'tenant-a' });

      // Take start and end snapshots (same state)
      engine.takeSnapshot(conn, 'se-m1', 'tenant-a', 'mission_start', time);
      engine.takeSnapshot(conn, 'se-m1', 'tenant-a', 'mission_end', time);

      const result = engine.verifyReplay(conn, 'se-m1', 'tenant-a');

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.success, true,
          'Start and end snapshots with same state must match');
      }

      conn.close();
    });

    it('rejection: fails for non-existent mission', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      const result = engine.verifyReplay(conn, 'nonexistent', 'tenant-a');

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_FOUND');
      }

      conn.close();
    });

    it('rejection: fails when no start snapshot exists', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'nosnap-m1', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'nosnap-m1', tenantId: 'tenant-a' });

      // No snapshot taken — verifyReplay should fail
      const result = engine.verifyReplay(conn, 'nosnap-m1', 'tenant-a');

      assert.equal(result.ok, false,
        'CATCHES: verifyReplay without start snapshot must fail');
      if (!result.ok) {
        assert.equal(result.error.code, 'SNAPSHOT_NOT_FOUND');
      }

      conn.close();
    });
  });

  describe('getSnapshots', () => {
    it('success: returns all snapshots for a mission', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'list-m1', tenantId: 'tenant-a', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'list-m1', tenantId: 'tenant-a' });

      engine.takeSnapshot(conn, 'list-m1', 'tenant-a', 'mission_start', time);
      engine.takeSnapshot(conn, 'list-m1', 'tenant-a', 'checkpoint', time);
      engine.takeSnapshot(conn, 'list-m1', 'tenant-a', 'mission_end', time);

      const result = engine.getSnapshots(conn, 'list-m1', 'tenant-a');

      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.value.length, 3,
          'Must return all 3 snapshots');
      }

      conn.close();
    });

    it('rejection: fails for wrong tenant', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'tenant-m1', tenantId: 'tenant-a', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'tenant-m1', tenantId: 'tenant-a' });

      // Try to get snapshots for a different tenant
      const result = engine.getSnapshots(conn, 'tenant-m1', 'tenant-b');

      assert.equal(result.ok, false,
        'CATCHES: tenant-b must not see tenant-a missions');
      if (!result.ok) {
        assert.equal(result.error.code, 'MISSION_NOT_FOUND');
      }

      conn.close();
    });
  });

  describe('Tenant Isolation', () => {
    it('success: snapshot for tenant A not visible to tenant B (FM-10)', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      // Create missions for two tenants
      seedMission(conn, { id: 'iso-m1', tenantId: 'tenant-a', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'iso-m1', tenantId: 'tenant-a' });
      seedMission(conn, { id: 'iso-m2', tenantId: 'tenant-b', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'iso-m2', tenantId: 'tenant-b' });

      // Take snapshot for tenant-a
      engine.takeSnapshot(conn, 'iso-m1', 'tenant-a', 'mission_start', time);

      // Tenant B cannot see tenant A's snapshots
      const resultB = engine.getSnapshots(conn, 'iso-m1', 'tenant-b');
      assert.equal(resultB.ok, false,
        'CATCHES: cross-tenant snapshot access must be blocked');

      // Tenant B cannot take snapshots on tenant A's mission
      const snapB = engine.takeSnapshot(conn, 'iso-m1', 'tenant-b', 'checkpoint', time);
      assert.equal(snapB.ok, false,
        'CATCHES: cross-tenant snapshot creation must be blocked');

      conn.close();
    });
  });

  describe('Append-Only Enforcement', () => {
    it('success: INSERT into core_replay_snapshots succeeds', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'ao-m1', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'ao-m1', tenantId: 'tenant-a' });

      const result = engine.takeSnapshot(conn, 'ao-m1', 'tenant-a', 'mission_start', time);
      assert.equal(result.ok, true, 'INSERT must succeed');

      conn.close();
    });

    it('rejection: UPDATE on core_replay_snapshots blocked by trigger', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'ao-m2', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'ao-m2', tenantId: 'tenant-a' });

      const snapResult = engine.takeSnapshot(conn, 'ao-m2', 'tenant-a', 'mission_start', time);
      assert.equal(snapResult.ok, true);

      if (snapResult.ok) {
        // Attempt UPDATE — must be blocked by trigger
        assert.throws(() => {
          conn.run(
            `UPDATE core_replay_snapshots SET state_hash = 'tampered' WHERE id = ?`,
            [snapResult.value.id],
          );
        }, /append-only: UPDATE prohibited/,
          'CATCHES: UPDATE on append-only table must be blocked by trigger');
      }

      conn.close();
    });

    it('rejection: DELETE on core_replay_snapshots blocked by trigger', () => {
      const conn = createTestDatabase();
      const engine = createReplayEngine();

      seedMission(conn, { id: 'ao-m3', tenantId: 'tenant-a', state: 'CREATED' });
      seedResource(conn, { missionId: 'ao-m3', tenantId: 'tenant-a' });

      const snapResult = engine.takeSnapshot(conn, 'ao-m3', 'tenant-a', 'mission_start', time);
      assert.equal(snapResult.ok, true);

      if (snapResult.ok) {
        // Attempt DELETE — must be blocked by trigger
        assert.throws(() => {
          conn.run(
            `DELETE FROM core_replay_snapshots WHERE id = ?`,
            [snapResult.value.id],
          );
        }, /append-only: DELETE prohibited/,
          'CATCHES: DELETE on append-only table must be blocked by trigger');
      }

      conn.close();
    });
  });

  describe('LLM Log Immutability', () => {
    it('success: UPDATE pending LLM log entry to completed succeeds', () => {
      const conn = createTestDatabase();

      seedMission(conn, { id: 'llm-m1', tenantId: 'tenant-a', state: 'EXECUTING' });

      conn.run(
        `INSERT INTO core_llm_request_log
         (request_id, mission_id, task_id, tenant_id, provider_id, model_id, prompt_hash, request_body, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['req-001', 'llm-m1', 'task-1', 'tenant-a', 'mock-provider', 'mock-model', 'hash1', '{}', 'pending', '2026-01-01T00:00:00.000Z'],
      );

      // UPDATE pending -> completed must succeed
      conn.run(
        `UPDATE core_llm_request_log SET status = 'completed', response_body = '{"ok":true}' WHERE request_id = ? AND status = 'pending'`,
        ['req-001'],
      );

      const row = conn.get<{ status: string }>('SELECT status FROM core_llm_request_log WHERE request_id = ?', ['req-001']);
      assert.equal(row!.status, 'completed', 'Pending -> completed UPDATE must succeed');

      conn.close();
    });

    it('rejection: UPDATE completed LLM log entry blocked by trigger', () => {
      const conn = createTestDatabase();

      seedMission(conn, { id: 'llm-m2', tenantId: 'tenant-a', state: 'EXECUTING' });

      conn.run(
        `INSERT INTO core_llm_request_log
         (request_id, mission_id, task_id, tenant_id, provider_id, model_id, prompt_hash, request_body, status, response_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['req-002', 'llm-m2', 'task-1', 'tenant-a', 'mock-provider', 'mock-model', 'hash2', '{}', 'completed', '{"ok":true}', '2026-01-01T00:00:00.000Z'],
      );

      // Attempt to UPDATE completed entry — must be blocked by trigger
      assert.throws(() => {
        conn.run(
          `UPDATE core_llm_request_log SET response_body = '{"tampered":true}' WHERE request_id = ?`,
          ['req-002'],
        );
      }, /completed\/failed entries are immutable/,
        'CATCHES: completed LLM log entries must be immutable for replay integrity');

      conn.close();
    });

    it('rejection: DELETE on core_llm_request_log blocked by trigger (F-S4-002 fix)', () => {
      const conn = createTestDatabase();

      seedMission(conn, { id: 'llm-m3', tenantId: 'tenant-a', state: 'EXECUTING' });

      conn.run(
        `INSERT INTO core_llm_request_log
         (request_id, mission_id, task_id, tenant_id, provider_id, model_id, prompt_hash, request_body, status, response_body, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['req-003', 'llm-m3', 'task-1', 'tenant-a', 'mock-provider', 'mock-model', 'hash3', '{}', 'completed', '{"ok":true}', '2026-01-01T00:00:00.000Z'],
      );

      // Verify entry exists
      const before = conn.get<{ request_id: string }>(
        'SELECT request_id FROM core_llm_request_log WHERE request_id = ?', ['req-003'],
      );
      assert.ok(before, 'Entry must exist before delete attempt');

      // Attempt DELETE — must be blocked by trg_llm_log_no_delete trigger
      assert.throws(() => {
        conn.run(`DELETE FROM core_llm_request_log WHERE request_id = ?`, ['req-003']);
      }, /append-only: DELETE prohibited/,
        'CATCHES: DELETE on core_llm_request_log must be blocked by trigger (F-S4-002)');

      // Verify entry still exists after blocked delete
      const after = conn.get<{ request_id: string }>(
        'SELECT request_id FROM core_llm_request_log WHERE request_id = ?', ['req-003'],
      );
      assert.ok(after, 'Entry must still exist after blocked DELETE');

      conn.close();
    });
  });
});
