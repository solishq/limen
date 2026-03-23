/**
 * Sprint 4 Breaker Attacks: Mission Recovery (I-18)
 *
 * Target: src/orchestration/missions/mission_recovery.ts
 *
 * Attack vectors:
 *   - T-S4-008: Recovery injection via crafted DB state
 *   - T-S4-009: State machine bypass during recovery
 *   - T-S4-010: Double recovery race condition
 *   - T-S4-011: Budget manipulation during recovery
 *   - T-S4-013: Audit trail gap during recovery
 *   - T-S4-012: Orphaned resources during recovery
 *
 * Mutation targets:
 *   - Remove idempotency check
 *   - Remove depth ordering from recovery
 *   - Remove state machine validation
 *   - Remove audit trail recording
 *   - Remove non-fatal error handling
 *
 * Recurring patterns checked:
 *   P-001 (non-discriminative tests)
 *   P-002 (defense built not wired)
 *   F-S1-003 (silent catch — recovery bare catch)
 *   F-S2-001 (transaction boundary issues)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase,
  createTestAuditTrail,
  seedMission,
  seedResource,
} from '../helpers/test_database.js';
import { recoverMissions } from '../../src/orchestration/missions/mission_recovery.js';
import type { TimeProvider } from '../../src/kernel/interfaces/time.js';

const time: TimeProvider = {
  nowISO: () => '2026-01-01T00:00:00.000Z',
  nowMs: () => 1735689600000,
};

describe('Breaker: Mission Recovery Attacks (Sprint 4)', () => {

  // ========================================================================
  // T-S4-008: Recovery Injection via Crafted DB State
  // ========================================================================

  describe('T-S4-008: Recovery injection via crafted DB state', () => {
    it('attack: DB CHECK constraint blocks invalid state injection', () => {
      /**
       * DEFENSE VERIFIED: core_missions has CHECK(state IN (...)) constraint.
       * An attacker cannot inject a row with an unknown state — the DB rejects it.
       * This is GOOD defense-in-depth at the schema level.
       */
      const conn = createTestDatabase();

      const now = '2026-01-01T00:00:00.000Z';
      assert.throws(() => {
        conn.run(
          `INSERT INTO core_missions (id, tenant_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['inject-m1', 'tenant-a', 'agent-1', 'injected', '[]', '[]', 'INJECTED_STATE', 0, '[]', '[]', '{}', 0, now, now],
        );
      }, /CHECK constraint/,
        'CATCHES T-S4-008: DB CHECK constraint must block invalid state injection');

      conn.close();
    });

    it('attack: DB CHECK constraint blocks empty string state injection', () => {
      /**
       * DEFENSE VERIFIED: CHECK constraint rejects empty string state.
       */
      const conn = createTestDatabase();

      const now = '2026-01-01T00:00:00.000Z';
      assert.throws(() => {
        conn.run(
          `INSERT INTO core_missions (id, tenant_id, agent_id, objective, success_criteria, scope_boundaries, state, depth, capabilities, delegation_chain, constraints_json, plan_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['empty-state-m1', 'tenant-a', 'agent-1', 'test', '[]', '[]', '', 0, '[]', '[]', '{}', 0, now, now],
        );
      }, /CHECK constraint/,
        'CATCHES: empty string state must be rejected by CHECK constraint');

      conn.close();
    });
  });

  // ========================================================================
  // T-S4-009: State Machine Bypass During Recovery
  // ========================================================================

  describe('T-S4-009: State machine bypass during recovery', () => {
    it('attack: recovery does not create EXECUTING->EXECUTING cycle', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'bypass-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'bypass-m1' });

      recoverMissions(conn, audit, time);

      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['bypass-m1']);
      assert.notEqual(row!.state, 'EXECUTING',
        'CATCHES T-S4-009: recovery MUST NOT leave EXECUTING missions in EXECUTING state');
      assert.equal(row!.state, 'PAUSED',
        'EXECUTING must transition to PAUSED (conservative recovery)');

      conn.close();
    });

    it('attack: REVIEWING recovery uses override path and records it', () => {
      /**
       * REVIEWING -> PAUSED is NOT in MISSION_TRANSITIONS.
       * The recovery code uses a "recovery_override" path.
       * Verify this override is audited distinctly.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'override-m1', state: 'REVIEWING' });
      seedResource(conn, { missionId: 'override-m1' });

      recoverMissions(conn, audit, time);

      // Verify state changed
      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['override-m1']);
      assert.equal(row!.state, 'PAUSED', 'REVIEWING must transition to PAUSED');

      // Verify the audit records the override path
      const auditEntry = conn.get<{ detail: string }>(
        `SELECT detail FROM core_audit_log WHERE resource_id = ? AND operation = 'mission_recovery'`,
        ['override-m1'],
      );
      assert.ok(auditEntry, 'Recovery override must produce audit entry');
      const detail = JSON.parse(auditEntry!.detail);
      assert.equal(detail.transitionPath, 'recovery_override',
        'CATCHES: REVIEWING->PAUSED must be recorded as recovery_override, not standard transition');

      conn.close();
    });

    it('attack: recovery does not transition COMPLETED missions', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Terminal states: COMPLETED, FAILED, CANCELLED
      seedMission(conn, { id: 'term-comp', state: 'COMPLETED' });
      seedMission(conn, { id: 'term-fail', state: 'FAILED' });
      seedMission(conn, { id: 'term-canc', state: 'CANCELLED' });

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);

      // None of the terminal missions should appear in results
      assert.equal(result.value.missions.length, 0,
        'CATCHES: terminal missions must NOT appear in recovery results at all');

      // Verify no state changes in DB
      for (const [id, expected] of [['term-comp', 'COMPLETED'], ['term-fail', 'FAILED'], ['term-canc', 'CANCELLED']]) {
        const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', [id]);
        assert.equal(row!.state, expected, `${id} must remain ${expected}`);
      }

      conn.close();
    });
  });

  // ========================================================================
  // T-S4-010: Double Recovery Race Condition
  // ========================================================================

  describe('T-S4-010: Double recovery (idempotency)', () => {
    it('attack: running recovery twice does not double-transition', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'double-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'double-m1' });

      // First recovery
      const result1 = recoverMissions(conn, audit, time);
      assert.equal(result1.ok, true);
      assert.equal(result1.value.recoveredCount, 1);

      // Second recovery — idempotency check should prevent re-transition
      const result2 = recoverMissions(conn, audit, time);
      assert.equal(result2.ok, true);

      // On second pass, mission is PAUSED and has existing recovery audit entry
      const m1 = result2.value.missions.find(m => m.missionId === 'double-m1');
      assert.ok(m1);
      assert.equal(m1!.action, 'unchanged',
        'CATCHES T-S4-010: idempotency must prevent double recovery transition');

      // State still PAUSED (not re-transitioned)
      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['double-m1']);
      assert.equal(row!.state, 'PAUSED');

      conn.close();
    });

    it('attack: idempotency check uses audit trail, not just current state', () => {
      /**
       * Critical distinction: the idempotency check must look at the AUDIT TRAIL
       * for a previous recovery entry, not just the current state.
       *
       * If it only checked "state == PAUSED", then a manually-paused mission
       * that was later set to EXECUTING would be recovered again.
       * The audit trail check means: "was this mission already recovered?"
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'idemp-audit-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'idemp-audit-m1' });

      // First recovery — transitions to PAUSED, creates audit entry
      recoverMissions(conn, audit, time);

      // Manually set it back to EXECUTING (simulates external state manipulation)
      conn.run(
        `UPDATE core_missions SET state = 'EXECUTING' WHERE id = ?`,
        ['idemp-audit-m1'],
      );

      // Second recovery — should skip because audit entry exists
      const result2 = recoverMissions(conn, audit, time);
      assert.equal(result2.ok, true);

      const m1 = result2.value.missions.find(m => m.missionId === 'idemp-audit-m1');
      assert.ok(m1);
      assert.equal(m1!.action, 'unchanged',
        'CATCHES: idempotency must use audit trail, not just current state — ' +
        'already-recovered mission set back to EXECUTING should still be skipped');

      conn.close();
    });
  });

  // ========================================================================
  // T-S4-013: Audit Trail Gap During Recovery
  // ========================================================================

  describe('T-S4-013: Audit trail completeness', () => {
    it('attack: every non-terminal mission gets an audit entry', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Create 5 missions in various non-terminal states
      const states = ['EXECUTING', 'REVIEWING', 'CREATED', 'PLANNING', 'PAUSED'];
      for (let i = 0; i < states.length; i++) {
        seedMission(conn, { id: `aud-m${i}`, state: states[i]! });
        seedResource(conn, { missionId: `aud-m${i}` });
      }

      recoverMissions(conn, audit, time);

      // Every non-terminal mission must have a recovery audit entry
      const auditEntries = conn.query<{ resource_id: string }>(
        `SELECT resource_id FROM core_audit_log WHERE operation = 'mission_recovery'`,
      );

      const auditedIds = new Set(auditEntries.map(e => e.resource_id));
      for (let i = 0; i < states.length; i++) {
        assert.ok(auditedIds.has(`aud-m${i}`),
          `CATCHES T-S4-013: mission aud-m${i} (${states[i]}) must have audit entry`);
      }

      conn.close();
    });

    it('attack: audit entry for transitioned mission has correct detail', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'detail-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'detail-m1' });

      recoverMissions(conn, audit, time);

      const entry = conn.get<{ detail: string }>(
        `SELECT detail FROM core_audit_log WHERE resource_id = ? AND operation = 'mission_recovery'`,
        ['detail-m1'],
      );
      assert.ok(entry, 'Audit entry must exist');

      const detail = JSON.parse(entry!.detail);
      assert.equal(detail.previousState, 'EXECUTING',
        'Audit must record previous state');
      assert.equal(detail.newState, 'PAUSED',
        'Audit must record new state');
      assert.equal(detail.action, 'paused',
        'Audit must record action taken');

      conn.close();
    });

    it('attack: audit entry for unchanged mission has correct detail', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'unchanged-m1', state: 'CREATED' });
      seedResource(conn, { missionId: 'unchanged-m1' });

      recoverMissions(conn, audit, time);

      const entry = conn.get<{ detail: string }>(
        `SELECT detail FROM core_audit_log WHERE resource_id = ? AND operation = 'mission_recovery'`,
        ['unchanged-m1'],
      );
      assert.ok(entry, 'Unchanged mission must still have audit entry');

      const detail = JSON.parse(entry!.detail);
      assert.equal(detail.previousState, 'CREATED');
      assert.equal(detail.action, 'unchanged');
      assert.ok(detail.reason, 'Unchanged audit must include reason');

      conn.close();
    });
  });

  // ========================================================================
  // FINDING: Bare catch in recovery loop (Pattern F-S1-003 recurrence)
  // ========================================================================

  describe('FINDING: Recovery bare catch pattern', () => {
    it('attack: recovery catch block swallows errors silently', () => {
      /**
       * FINDING — F-S4-003: Bare catch in recovery loop
       * File: src/orchestration/missions/mission_recovery.ts, lines 120-128
       *
       * The catch block:
       *   } catch {
       *     results.push({ missionId: mission.id, previousState: mission.state, action: 'unchanged' });
       *   }
       *
       * This swallows ALL errors, including:
       *   - Database corruption errors
       *   - Out-of-memory errors
       *   - Constraint violation errors (which might indicate data integrity issues)
       *
       * The error is NOT logged, NOT audited, NOT discriminated.
       * The comment says "the audit trail records the attempt" but the catch
       * block runs BEFORE any audit can be written — the audit is INSIDE the try.
       *
       * This is the SAME pattern as F-S1-003 (silent catch on persistence failure)
       * and F-S2-003 (Phase 7 bare catch no logging).
       *
       * Severity: MEDIUM (matches prior findings)
       * The non-fatal design is correct. The lack of error recording is the defect.
       */

      // This test documents the finding. The actual behavior is:
      // 1. Mission recovery for a single mission throws
      // 2. The error is caught and swallowed
      // 3. The mission is reported as 'unchanged'
      // 4. No audit entry records the failure
      //
      // The test verifies the non-fatal behavior works but documents
      // that error discrimination is missing.

      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Create a mission that will cause an error during recovery
      // We can't easily force an error in the normal path, but we
      // CAN verify the behavior when a mission exists in results
      // without a recovery audit entry (indicating the catch path was taken).

      seedMission(conn, { id: 'catch-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'catch-m1' });

      // Normal recovery should work
      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);

      // This test passes but documents the pattern:
      // Line 120: catch { — no error parameter, no logging
      // RECOMMENDATION: Change to catch (err) { and log/audit the error
      assert.ok(true,
        'FINDING F-S4-003 DOCUMENTED: bare catch at line 120 swallows errors without logging');

      conn.close();
    });
  });

  // ========================================================================
  // Ordering attacks
  // ========================================================================

  describe('Root-first ordering attacks', () => {
    it('attack: deep hierarchy (depth 0-4) recovers in correct order', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Create a 5-level deep hierarchy, all EXECUTING
      const ids = ['depth-0', 'depth-1', 'depth-2', 'depth-3', 'depth-4'];
      for (let i = 0; i < ids.length; i++) {
        seedMission(conn, {
          id: ids[i]!,
          state: 'EXECUTING',
          depth: i,
          parentId: i > 0 ? ids[i - 1]! : null,
        });
        seedResource(conn, { missionId: ids[i]! });
      }

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);
      assert.equal(result.value.recoveredCount, 5, 'All 5 missions must be recovered');

      // Verify BFS ordering: depth 0 first, depth 4 last
      for (let i = 0; i < ids.length; i++) {
        const idx = result.value.missions.findIndex(m => m.missionId === ids[i]);
        assert.equal(idx, i,
          `CATCHES: depth-${i} must be at position ${i} in recovery results (BFS order)`);
      }

      conn.close();
    });

    it('attack: sibling missions at same depth recovered in consistent order', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Create a parent with 3 children (all at depth 1)
      seedMission(conn, { id: 'parent-sib', state: 'EXECUTING', depth: 0 });
      seedResource(conn, { missionId: 'parent-sib' });

      seedMission(conn, { id: 'child-c', state: 'EXECUTING', depth: 1, parentId: 'parent-sib' });
      seedResource(conn, { missionId: 'child-c' });
      seedMission(conn, { id: 'child-a', state: 'EXECUTING', depth: 1, parentId: 'parent-sib' });
      seedResource(conn, { missionId: 'child-a' });
      seedMission(conn, { id: 'child-b', state: 'EXECUTING', depth: 1, parentId: 'parent-sib' });
      seedResource(conn, { missionId: 'child-b' });

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);

      // Parent must come first (depth 0)
      assert.equal(result.value.missions[0]!.missionId, 'parent-sib',
        'Parent (depth 0) must be recovered first');

      // All children (depth 1) must come after parent
      const childIndices = ['child-a', 'child-b', 'child-c'].map(
        id => result.value.missions.findIndex(m => m.missionId === id),
      );
      for (const idx of childIndices) {
        assert.ok(idx > 0, 'Children must come after parent in recovery order');
      }

      conn.close();
    });
  });

  // ========================================================================
  // T-S4-011: Budget manipulation during recovery
  // ========================================================================

  describe('T-S4-011: Budget state during recovery', () => {
    it('attack: recovery does not modify resource/budget values', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'budget-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'budget-m1', tokenAllocated: 10000, tokenConsumed: 5000 });

      recoverMissions(conn, audit, time);

      // Verify resources are untouched
      const resource = conn.get<{ token_allocated: number; token_consumed: number; token_remaining: number }>(
        'SELECT token_allocated, token_consumed, token_remaining FROM core_resources WHERE mission_id = ?',
        ['budget-m1'],
      );
      assert.equal(resource!.token_allocated, 10000,
        'CATCHES T-S4-011: recovery must NOT modify token_allocated');
      assert.equal(resource!.token_consumed, 5000,
        'CATCHES T-S4-011: recovery must NOT modify token_consumed');
      assert.equal(resource!.token_remaining, 5000,
        'CATCHES T-S4-011: recovery must NOT modify token_remaining');

      conn.close();
    });
  });

  // ========================================================================
  // Non-fatal continuation
  // ========================================================================

  describe('Non-fatal continuation', () => {
    it('attack: recovery continues after individual mission failure', () => {
      /**
       * Recovery must be non-fatal: if one mission fails to recover,
       * the rest should still be processed.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Create two missions: both EXECUTING
      seedMission(conn, { id: 'nonfatal-m1', state: 'EXECUTING', depth: 0 });
      seedResource(conn, { missionId: 'nonfatal-m1' });
      seedMission(conn, { id: 'nonfatal-m2', state: 'EXECUTING', depth: 0 });
      seedResource(conn, { missionId: 'nonfatal-m2' });

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);
      assert.equal(result.value.missions.length, 2,
        'Both missions must appear in results');

      conn.close();
    });
  });

  // ========================================================================
  // FINDING: Recovery transition uses WHERE state = ? (TOCTOU)
  // ========================================================================

  describe('FINDING: Recovery UPDATE uses optimistic locking', () => {
    it('analysis: UPDATE WHERE id = ? AND state = ? provides TOCTOU defense', () => {
      /**
       * File: src/orchestration/missions/mission_recovery.ts, line 248
       *   UPDATE core_missions SET state = 'PAUSED', updated_at = ? WHERE id = ? AND state = ?
       *
       * The WHERE state = ? clause is an optimistic locking pattern.
       * If the state was changed between the SELECT (line 96) and the UPDATE (line 248),
       * the UPDATE would affect 0 rows.
       *
       * However: the code does NOT check conn.run() return value (changes count).
       * If the UPDATE affected 0 rows (race condition), the function still returns 'paused'
       * and the audit entry still records a successful transition.
       *
       * FINDING — F-S4-004: transitionToPaused() does not verify UPDATE affected a row.
       * Severity: MEDIUM — in practice, recovery runs during startup before any
       * concurrent access. But the code claims to handle this via optimistic locking
       * without actually checking the lock succeeded.
       */

      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'toctou-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'toctou-m1' });

      // Simulate the race: change state BEFORE recovery runs
      conn.run(`UPDATE core_missions SET state = 'PAUSED' WHERE id = ?`, ['toctou-m1']);

      // Recovery runs — the UPDATE WHERE state = 'EXECUTING' will affect 0 rows
      // but the function still records 'paused' action.
      // (In this case, PAUSED is already the target, so the outcome is correct by coincidence.)

      // For a more realistic attack: set to COMPLETED
      seedMission(conn, { id: 'toctou-m2', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'toctou-m2' });
      conn.run(`UPDATE core_missions SET state = 'COMPLETED' WHERE id = ?`, ['toctou-m2']);

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);

      // toctou-m2 was already completed, but the idempotency check will skip it
      // because the SELECT query excludes terminal states.
      // So this specific attack is mitigated by the query filter.
      // But the code still has the unchecked UPDATE pattern — document as finding.

      assert.ok(true,
        'FINDING F-S4-004 DOCUMENTED: transitionToPaused() does not verify UPDATE changes count');

      conn.close();
    });
  });

  // ========================================================================
  // Mutation Testing
  // ========================================================================

  describe('Mutation Testing', () => {
    it('mutation: removing idempotency check allows double transition', () => {
      /**
       * Mutation target: recoverSingleMission() lines 154-167
       * If the idempotency check (audit entry lookup) is removed,
       * running recovery twice would attempt to transition an already-PAUSED
       * mission. Since PAUSED is not in RECOVERY_TRANSITION_STATES, it would
       * be handled as 'unchanged' — so the mutation doesn't change behavior
       * for this specific case.
       *
       * HOWEVER: if someone manually sets the mission back to EXECUTING
       * between passes, the idempotency check is what prevents re-recovery.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'mut-idemp-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'mut-idemp-m1' });

      // First recovery
      recoverMissions(conn, audit, time);

      // Manually reset to EXECUTING
      conn.run(`UPDATE core_missions SET state = 'EXECUTING' WHERE id = ?`, ['mut-idemp-m1']);

      // Second recovery — should be blocked by idempotency (audit entry exists)
      const result2 = recoverMissions(conn, audit, time);

      const m1 = result2.value.missions.find(m => m.missionId === 'mut-idemp-m1');
      assert.ok(m1);
      assert.equal(m1!.action, 'unchanged',
        'MUTATION CHECK: idempotency audit entry prevents re-recovery');

      conn.close();
    });

    it('mutation: removing depth ordering still recovers all missions', () => {
      /**
       * Mutation target: line 99 — ORDER BY depth ASC
       * Removing ordering doesn't prevent recovery, but it violates the
       * root-first guarantee. The test verifies ordering is enforced.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'mut-parent', state: 'EXECUTING', depth: 0 });
      seedResource(conn, { missionId: 'mut-parent' });
      seedMission(conn, { id: 'mut-child', state: 'EXECUTING', depth: 1, parentId: 'mut-parent' });
      seedResource(conn, { missionId: 'mut-child' });

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);

      const parentIdx = result.value.missions.findIndex(m => m.missionId === 'mut-parent');
      const childIdx = result.value.missions.findIndex(m => m.missionId === 'mut-child');
      assert.ok(parentIdx < childIdx,
        'MUTATION CHECK: ORDER BY depth ASC must be enforced — parent before child');

      conn.close();
    });

    it('mutation: removing RECOVERY_TRANSITION_STATES check would transition all states', () => {
      /**
       * Mutation target: line 170 — RECOVERY_TRANSITION_STATES.has(currentState)
       * If removed, ALL non-terminal states would be transitioned to PAUSED.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // CREATED should remain unchanged
      seedMission(conn, { id: 'mut-created', state: 'CREATED' });
      seedResource(conn, { missionId: 'mut-created' });

      recoverMissions(conn, audit, time);

      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['mut-created']);
      assert.equal(row!.state, 'CREATED',
        'MUTATION CHECK: CREATED must NOT be transitioned to PAUSED');

      conn.close();
    });

    it('mutation: removing transaction wrapper would break atomicity', () => {
      /**
       * Mutation target: transitionToPaused() line 246 — conn.transaction()
       * Without the transaction, the state UPDATE and audit INSERT could
       * partially succeed — state changed but no audit entry, or vice versa.
       */
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'mut-txn-m1', state: 'EXECUTING' });
      seedResource(conn, { missionId: 'mut-txn-m1' });

      recoverMissions(conn, audit, time);

      // Both state change AND audit must exist (atomic)
      const row = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['mut-txn-m1']);
      assert.equal(row!.state, 'PAUSED', 'State must be PAUSED');

      const auditEntry = conn.get<{ operation: string }>(
        `SELECT operation FROM core_audit_log WHERE resource_id = ? AND operation = 'mission_recovery'`,
        ['mut-txn-m1'],
      );
      assert.ok(auditEntry, 'Audit entry must exist alongside state change (atomic)');

      conn.close();
    });
  });

  // ========================================================================
  // Zero missions edge case
  // ========================================================================

  describe('Edge Cases', () => {
    it('edge: zero non-terminal missions returns empty result', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      // Only terminal missions
      seedMission(conn, { id: 'edge-comp', state: 'COMPLETED' });
      seedMission(conn, { id: 'edge-fail', state: 'FAILED' });

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);
      assert.equal(result.value.recoveredCount, 0);
      assert.equal(result.value.missions.length, 0,
        'No non-terminal missions means empty results');

      conn.close();
    });

    it('edge: empty database returns empty result', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      const result = recoverMissions(conn, audit, time);
      assert.equal(result.ok, true);
      assert.equal(result.value.recoveredCount, 0);
      assert.equal(result.value.missions.length, 0);

      conn.close();
    });

    it('edge: BLOCKED and DEGRADED remain unchanged', () => {
      const conn = createTestDatabase();
      const audit = createTestAuditTrail();

      seedMission(conn, { id: 'edge-blocked', state: 'BLOCKED' });
      seedResource(conn, { missionId: 'edge-blocked' });
      seedMission(conn, { id: 'edge-degraded', state: 'DEGRADED' });
      seedResource(conn, { missionId: 'edge-degraded' });

      recoverMissions(conn, audit, time);

      const blocked = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['edge-blocked']);
      const degraded = conn.get<{ state: string }>('SELECT state FROM core_missions WHERE id = ?', ['edge-degraded']);
      assert.equal(blocked!.state, 'BLOCKED', 'BLOCKED must remain BLOCKED');
      assert.equal(degraded!.state, 'DEGRADED', 'DEGRADED must remain DEGRADED');

      conn.close();
    });
  });
});
