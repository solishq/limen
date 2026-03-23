/**
 * BREAKER: Sprint 2 Trust Progression Attack Tests
 * Target: I-09 Trust State Machine (trust_progression.ts, agent_api.ts, migration v33)
 *
 * Attack vectors: TP-01 through TP-15
 * Classification: Tier 1 (governance, state transitions, authority)
 *
 * What we attack:
 *   - Self-promotion (agent promoting itself via matching agentId in context)
 *   - Skip-level promotion (untrusted->trusted, untrusted->admin)
 *   - Admin promotion without human actor
 *   - Promote retired agent
 *   - Promote non-existent agent
 *   - Double promotion (same level twice)
 *   - Demotion cascade correctness
 *   - Trust level CHECK constraint bypass (raw SQL)
 *   - Transition record immutability
 *   - Cross-tenant trust manipulation
 *   - Empty/null reason field
 *   - Large payload in criteria_snapshot JSON
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, createTestOperationContext } from '../helpers/test_database.js';
import type { DatabaseConnection, RateLimiter, RbacEngine } from '../../src/kernel/interfaces/index.js';
import { AgentApiImpl } from '../../src/api/agents/agent_api.js';
import {
  validatePromotion,
  checkSelfPromotion,
  getNextTrustLevel,
  getDemotionTarget,
} from '../../src/api/agents/trust_progression.js';

// ─── Test Helpers ───

function createMockRbac(): RbacEngine {
  return {
    checkPermission() { return { ok: true, value: true }; },
    grantPermission() { return { ok: true, value: undefined }; },
    revokePermission() { return { ok: true, value: undefined }; },
    listPermissions() { return { ok: true, value: [] }; },
  } as unknown as RbacEngine;
}

function createMockRateLimiter(): RateLimiter {
  return {
    checkAndConsume() { return { ok: true, value: true }; },
    getStatus() { return { ok: true, value: { currentTokens: 99, maxTokens: 100, refillRate: 1.67, lastRefillAt: '' } }; },
  };
}

function createTimeProvider() {
  return { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
}

function createApi(conn: DatabaseConnection, tenantId: string | null = 'test-tenant', agentId: string | null = null) {
  const ctx = createTestOperationContext({ tenantId, agentId });
  return new AgentApiImpl(
    createMockRbac(),
    createMockRateLimiter(),
    () => conn,
    () => ctx,
    createTimeProvider(),
  );
}

describe('BREAKER: Sprint 2 Trust Progression Attacks', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-01: Self-Promotion — Agent promoting itself
  // CATCHES: If checkSelfPromotion is bypassed or missing, an agent
  // could escalate its own privileges.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-01: Self-Promotion Prevention', () => {
    it('TP-01a: agent cannot promote itself via matching context agentId', async () => {
      const api = createApi(conn, null);
      const agent = await api.register({ name: 'self-promoter' });

      // Create API where the caller IS the same agent
      const selfApi = createApi(conn, null, agent.id);
      await assert.rejects(
        () => selfApi.promote('self-promoter'),
        (err: Error) => {
          assert.ok(err.message.includes('SELF_PROMOTION_BLOCKED'),
            `Expected SELF_PROMOTION_BLOCKED, got: ${err.message}`);
          return true;
        },
      );

      // CATCHES: Self-promotion bypass — trust level MUST remain unchanged
      const unchanged = await api.get('self-promoter');
      assert.equal(unchanged?.trustLevel, 'untrusted',
        'Trust level must remain untrusted after self-promotion attempt');
    });

    it('TP-01b: checkSelfPromotion with null context agentId allows promotion (non-agent caller)', () => {
      // CATCHES: null agentId should NOT block promotion (it means the caller is not an agent)
      const result = checkSelfPromotion(null, 'target-agent-id');
      assert.equal(result.allowed, true,
        'Null context agentId should allow promotion (non-agent caller)');
    });

    it('TP-01c: checkSelfPromotion with undefined context agentId allows promotion', () => {
      // CATCHES: undefined agentId should also allow (non-agent caller)
      const result = checkSelfPromotion(undefined, 'target-agent-id');
      assert.equal(result.allowed, true,
        'Undefined context agentId should allow promotion (non-agent caller)');
    });

    it('TP-01d: checkSelfPromotion with different agentId allows promotion', () => {
      // CATCHES: different agent IDs should be allowed (supervisor promoting subordinate)
      const result = checkSelfPromotion('supervisor-agent' as unknown as import('../../src/kernel/interfaces/index.js').AgentId, 'target-agent');
      assert.equal(result.allowed, true,
        'Different agentId should allow promotion');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-02: Skip-Level Promotion — Bypassing required progression stages
  // CATCHES: If validatePromotion allows jumps, the entire trust model is void.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-02: Skip-Level Promotion', () => {
    it('TP-02a: untrusted -> trusted REJECTED (must go through probationary)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'skip-agent' });

      await assert.rejects(
        () => api.promote('skip-agent', { targetLevel: 'trusted' }),
        (err: Error) => {
          assert.ok(err.message.includes('no skipping levels'),
            `Expected skip-level rejection, got: ${err.message}`);
          return true;
        },
      );

      const agent = await api.get('skip-agent');
      assert.equal(agent?.trustLevel, 'untrusted', 'Trust level must remain unchanged after skip attempt');
    });

    it('TP-02b: untrusted -> admin REJECTED even with human actor', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'skip-admin' });

      await assert.rejects(
        () => api.promote('skip-admin', { targetLevel: 'admin', actorType: 'human', actorId: 'root-user' }),
        (err: Error) => {
          assert.ok(err.message.includes('no skipping levels'),
            `Expected skip-level rejection, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-02c: probationary -> admin REJECTED even with human actor', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'skip-prob' });
      await api.promote('skip-prob'); // untrusted -> probationary

      await assert.rejects(
        () => api.promote('skip-prob', { targetLevel: 'admin', actorType: 'human', actorId: 'root-user' }),
        (err: Error) => {
          assert.ok(err.message.includes('no skipping levels'),
            `Expected skip-level rejection, got: ${err.message}`);
          return true;
        },
      );

      const agent = await api.get('skip-prob');
      assert.equal(agent?.trustLevel, 'probationary', 'Trust level must remain probationary');
    });

    it('TP-02d: validatePromotion function rejects all skip-level pairs', () => {
      // CATCHES: Exhaustive test of all invalid transitions
      const invalidPairs: Array<[string, string]> = [
        ['untrusted', 'trusted'],
        ['untrusted', 'admin'],
        ['probationary', 'admin'],
      ];

      for (const [from, to] of invalidPairs) {
        const result = validatePromotion(
          from as 'untrusted' | 'probationary' | 'trusted' | 'admin',
          to as 'untrusted' | 'probationary' | 'trusted' | 'admin',
          'human',
        );
        assert.equal(result.valid, false,
          `${from} -> ${to} must be rejected (no skipping levels)`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-03: Admin Promotion Authority
  // CATCHES: If human actor requirement is missing or bypassable, system
  // actors can escalate to admin without human oversight.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-03: Admin Promotion Without Human Actor', () => {
    it('TP-03a: system actor REJECTED for admin promotion', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'sys-admin' });
      await api.promote('sys-admin');
      await api.promote('sys-admin');

      await assert.rejects(
        () => api.promote('sys-admin', { actorType: 'system' }),
        (err: Error) => {
          assert.ok(err.message.includes('human actor'),
            `Expected human actor requirement, got: ${err.message}`);
          return true;
        },
      );

      const agent = await api.get('sys-admin');
      assert.equal(agent?.trustLevel, 'trusted', 'Trust level must remain trusted after rejected admin promotion');
    });

    it('TP-03b: default actorType (system) REJECTED for admin promotion', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'default-admin' });
      await api.promote('default-admin');
      await api.promote('default-admin');

      // No options means actorType defaults to 'system'
      await assert.rejects(
        () => api.promote('default-admin'),
        (err: Error) => {
          assert.ok(err.message.includes('human actor'),
            `Expected human actor requirement, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-03c: human actor SUCCEEDS for admin promotion (success path)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'human-admin' });
      await api.promote('human-admin');
      await api.promote('human-admin');

      const result = await api.promote('human-admin', {
        actorType: 'human',
        actorId: 'admin-001',
        reason: 'Approved after review',
      });
      assert.equal(result.trustLevel, 'admin', 'Admin promotion with human actor must succeed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-04: Retired Agent Promotion
  // CATCHES: If retired terminal state is not enforced, retired agents
  // can be brought back and escalated.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-04: Retired Agent Promotion', () => {
    it('TP-04a: promote retired agent REJECTED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'retired-agent' });
      await api.retire('retired-agent');

      await assert.rejects(
        () => api.promote('retired-agent'),
        (err: Error) => {
          assert.ok(err.message.includes('retired'),
            `Expected retired rejection, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-04b: retired agent trust level remains unchanged after failed promotion', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'retired-check' });
      await api.promote('retired-check'); // untrusted -> probationary
      await api.retire('retired-check');

      try {
        await api.promote('retired-check');
      } catch { /* expected */ }

      // Direct DB check to verify trust level
      const row = conn.get<{ trust_level: string }>(
        'SELECT trust_level FROM core_agents WHERE name = ?',
        ['retired-check'],
      );
      assert.equal(row?.trust_level, 'probationary',
        'Trust level must remain probationary after retired promotion attempt');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-05: Non-Existent Agent
  // CATCHES: Missing boundary check on agent lookup before promotion.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-05: Non-Existent Agent', () => {
    it('TP-05a: promote non-existent agent returns AGENT_NOT_FOUND', async () => {
      const api = createApi(conn, null);

      await assert.rejects(
        () => api.promote('ghost-agent'),
        (err: Error) => {
          assert.ok(err.message.includes('not found'),
            `Expected AGENT_NOT_FOUND, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-06: Double Promotion (same level twice)
  // CATCHES: If same-level transition is not rejected, duplicate transition
  // records are created without actual state change.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-06: Double Promotion', () => {
    it('TP-06a: cannot promote beyond admin (terminal forward state)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'admin-again' });
      await api.promote('admin-again');
      await api.promote('admin-again');
      await api.promote('admin-again', { actorType: 'human', actorId: 'admin-001' });

      await assert.rejects(
        () => api.promote('admin-again'),
        (err: Error) => {
          assert.ok(err.message.includes('already at admin'),
            `Expected already-at-admin, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-06b: explicit same-level target is REJECTED', () => {
      // CATCHES: attempting to promote to the same level should fail
      const result = validatePromotion('probationary', 'probationary', 'system');
      assert.equal(result.valid, false, 'Same-level promotion must be rejected');
      if (!result.valid) {
        assert.ok(result.reason.includes('Already at trust level'),
          `Expected same-level rejection reason, got: ${result.reason}`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-07: Demotion Cascade Correctness
  // CATCHES: Incorrect demotion target for any severity/level combination.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-07: Demotion Cascade Correctness', () => {
    it('TP-07a: getDemotionTarget covers all severity/level combinations', () => {
      // Exhaustive truth table for the demotion matrix
      const expectations: Array<{
        level: 'untrusted' | 'probationary' | 'trusted' | 'admin';
        severity: 'low' | 'medium' | 'high' | 'critical';
        expected: string | null;
      }> = [
        // Critical/High -> always untrusted (unless already untrusted)
        { level: 'admin', severity: 'critical', expected: 'untrusted' },
        { level: 'admin', severity: 'high', expected: 'untrusted' },
        { level: 'trusted', severity: 'critical', expected: 'untrusted' },
        { level: 'trusted', severity: 'high', expected: 'untrusted' },
        { level: 'probationary', severity: 'critical', expected: 'untrusted' },
        { level: 'probationary', severity: 'high', expected: 'untrusted' },
        { level: 'untrusted', severity: 'critical', expected: null },
        { level: 'untrusted', severity: 'high', expected: null },
        // Low/Medium -> drop one level
        { level: 'admin', severity: 'low', expected: 'trusted' },
        { level: 'admin', severity: 'medium', expected: 'trusted' },
        { level: 'trusted', severity: 'low', expected: 'probationary' },
        { level: 'trusted', severity: 'medium', expected: 'probationary' },
        { level: 'probationary', severity: 'low', expected: 'untrusted' },
        { level: 'probationary', severity: 'medium', expected: 'untrusted' },
        { level: 'untrusted', severity: 'low', expected: null },
        { level: 'untrusted', severity: 'medium', expected: null },
      ];

      for (const { level, severity, expected } of expectations) {
        const actual = getDemotionTarget(level, severity);
        assert.equal(actual, expected,
          `getDemotionTarget(${level}, ${severity}) should be ${expected}, got ${actual}`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-08: Trust Level CHECK Constraint — Raw SQL Bypass
  // CATCHES: If CHECK constraint is missing or incomplete, invalid trust
  // levels can be stored via direct SQL.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-08: Trust Level CHECK Constraint', () => {
    it('TP-08a: invalid trust level in core_trust_transitions rejected', () => {
      // Try to insert a transition with an invalid trust level
      assert.throws(
        () => conn.run(
          `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, reason, created_at)
           VALUES ('fake-id', NULL, 'agent-001', 'untrusted', 'superadmin', 'system', 'test', '2026-03-23T00:00:00Z')`,
        ),
        (err: Error) => {
          assert.ok(err.message.includes('CHECK constraint'),
            `Expected CHECK constraint failure, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-08b: invalid from_level in core_trust_transitions rejected', () => {
      assert.throws(
        () => conn.run(
          `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, reason, created_at)
           VALUES ('fake-id2', NULL, 'agent-001', 'unknown', 'trusted', 'system', 'test', '2026-03-23T00:00:00Z')`,
        ),
        (err: Error) => {
          assert.ok(err.message.includes('CHECK constraint'),
            `Expected CHECK constraint failure, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-08c: invalid actor_type in core_trust_transitions rejected', () => {
      assert.throws(
        () => conn.run(
          `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, reason, created_at)
           VALUES ('fake-id3', NULL, 'agent-001', 'untrusted', 'probationary', 'bot', 'test', '2026-03-23T00:00:00Z')`,
        ),
        (err: Error) => {
          assert.ok(err.message.includes('CHECK constraint'),
            `Expected CHECK constraint failure, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-09: Transition Record Immutability
  // CATCHES: If append-only triggers are missing, transition history
  // can be tampered with to hide evidence of demotion or fabricate promotions.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-09: Transition Record Immutability', () => {
    it('TP-09a: UPDATE on trust transitions BLOCKED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'immut-agent' });
      await api.promote('immut-agent');

      const rows = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions LIMIT 1');
      assert.ok(rows.length > 0, 'Transition record should exist');

      assert.throws(
        () => conn.run('UPDATE core_trust_transitions SET reason = ? WHERE id = ?', ['tampered', rows[0]!.id]),
        (err: Error) => {
          assert.ok(err.message.includes('TRUST_TRANSITION_IMMUTABLE'),
            `Expected immutability error, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-09b: DELETE on trust transitions BLOCKED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'nodelete-agent' });
      await api.promote('nodelete-agent');

      const rows = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('DELETE FROM core_trust_transitions WHERE id = ?', [rows[0]!.id]),
        (err: Error) => {
          assert.ok(err.message.includes('TRUST_TRANSITION_NO_DELETE'),
            `Expected no-delete error, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-09c: UPDATE actor_type on trust transitions BLOCKED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'actor-tamper' });
      await api.promote('actor-tamper');

      const rows = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('UPDATE core_trust_transitions SET actor_type = ? WHERE id = ?', ['human', rows[0]!.id]),
        (err: Error) => {
          assert.ok(err.message.includes('TRUST_TRANSITION_IMMUTABLE'),
            `Expected immutability error when tampering actor_type, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-10: Cross-Tenant Trust Manipulation
  // CATCHES: Tenant-A caller promoting tenant-B's agent.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-10: Cross-Tenant Trust Manipulation', () => {
    it('TP-10a: tenant-A cannot see or promote tenant-B agent by name', async () => {
      const apiA = createApi(conn, 'tenant-a');
      const apiB = createApi(conn, 'tenant-b');

      await apiA.register({ name: 'shared-name' });
      await apiB.register({ name: 'shared-name' });

      // Tenant-A promotes its own 'shared-name'
      await apiA.promote('shared-name');

      // Verify tenant-B's agent is unaffected
      const agentB = await apiB.get('shared-name');
      assert.equal(agentB?.trustLevel, 'untrusted',
        'Tenant-B agent must remain untrusted when tenant-A promotes its own');

      const agentA = await apiA.get('shared-name');
      assert.equal(agentA?.trustLevel, 'probationary',
        'Tenant-A agent should be promoted');
    });

    it('TP-10b: tenant-A cannot promote non-existent agent (tenant-B exclusive agent)', async () => {
      const apiA = createApi(conn, 'tenant-a');
      const apiB = createApi(conn, 'tenant-b');

      await apiB.register({ name: 'b-only-agent' });

      await assert.rejects(
        () => apiA.promote('b-only-agent'),
        (err: Error) => {
          assert.ok(err.message.includes('not found'),
            `Expected AGENT_NOT_FOUND for cross-tenant, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-11: State Machine Function Correctness
  // CATCHES: Any deviation in getNextTrustLevel from the spec.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-11: State Machine Function Correctness', () => {
    it('TP-11a: getNextTrustLevel returns correct next level for each', () => {
      assert.equal(getNextTrustLevel('untrusted'), 'probationary');
      assert.equal(getNextTrustLevel('probationary'), 'trusted');
      assert.equal(getNextTrustLevel('trusted'), 'admin');
      assert.equal(getNextTrustLevel('admin'), null, 'admin has no next level');
    });

    it('TP-11b: validatePromotion accepts all valid forward transitions', () => {
      const validTransitions: Array<{
        from: 'untrusted' | 'probationary' | 'trusted' | 'admin';
        to: 'untrusted' | 'probationary' | 'trusted' | 'admin';
        actor: 'system' | 'human';
      }> = [
        { from: 'untrusted', to: 'probationary', actor: 'system' },
        { from: 'probationary', to: 'trusted', actor: 'system' },
        { from: 'trusted', to: 'admin', actor: 'human' },
      ];

      for (const { from, to, actor } of validTransitions) {
        const result = validatePromotion(from, to, actor);
        assert.equal(result.valid, true, `${from} -> ${to} with ${actor} should be valid`);
      }
    });

    it('TP-11c: validatePromotion rejects backward/lateral transitions', () => {
      const invalidTransitions: Array<{
        from: 'untrusted' | 'probationary' | 'trusted' | 'admin';
        to: 'untrusted' | 'probationary' | 'trusted' | 'admin';
      }> = [
        { from: 'probationary', to: 'untrusted' },
        { from: 'trusted', to: 'probationary' },
        { from: 'trusted', to: 'untrusted' },
        { from: 'admin', to: 'trusted' },
        { from: 'admin', to: 'probationary' },
        { from: 'admin', to: 'untrusted' },
      ];

      for (const { from, to } of invalidTransitions) {
        const result = validatePromotion(from, to, 'human');
        assert.equal(result.valid, false,
          `${from} -> ${to} backward/lateral transition must be rejected`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-12: Empty/Null Reason Field
  // CATCHES: If reason field is required but empty reasons are accepted,
  // audit log is degraded.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-12: Reason Field Handling', () => {
    it('TP-12a: promotion without explicit reason uses default', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'noreason-agent' });
      await api.promote('noreason-agent');

      const rows = conn.query<{ reason: string }>('SELECT reason FROM core_trust_transitions');
      assert.equal(rows.length, 1);
      assert.ok(rows[0]!.reason.length > 0,
        'Default reason must be non-empty');
      assert.ok(rows[0]!.reason.includes('Promoted from'),
        `Default reason should describe the promotion, got: ${rows[0]!.reason}`);
    });

    it('TP-12b: promotion with custom reason preserves it', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'custom-reason' });
      await api.promote('custom-reason', { reason: 'Performance evaluation passed' });

      const rows = conn.query<{ reason: string }>('SELECT reason FROM core_trust_transitions');
      assert.equal(rows[0]!.reason, 'Performance evaluation passed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-13: Large Payload in criteria_snapshot
  // CATCHES: Unbounded JSON payload could cause storage or memory issues.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-13: Large Payload Handling', () => {
    it('TP-13a: large criteria_snapshot JSON does not crash', async () => {
      const api = createApi(conn, null);
      const agent = await api.register({ name: 'large-payload' });

      // The API currently stores '{}' as criteria_snapshot, but verify the
      // table can handle large JSON if needed
      const largeJson = JSON.stringify({ data: 'x'.repeat(100_000) });

      // Direct insert to test column handling — use the real agent ID for FK
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, ?, 'untrusted', 'probationary', 'system', 'test', ?, ?)`,
        [crypto.randomUUID(), agent.id, largeJson, new Date().toISOString()],
      );

      const row = conn.get<{ criteria_snapshot: string }>(
        'SELECT criteria_snapshot FROM core_trust_transitions WHERE agent_id = ?',
        [agent.id],
      );
      assert.ok(row);
      assert.equal(JSON.parse(row.criteria_snapshot).data.length, 100_000,
        'Large criteria_snapshot should be stored and retrieved correctly');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-14: Trust Transition Counts After Demotion + Re-Promotion
  // CATCHES: State machine should allow re-promotion after demotion,
  // and all transitions should be recorded in audit log.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-14: Demotion + Re-Promotion Cycle', () => {
    it('TP-14a: full cycle — promote, violate, re-promote records all transitions', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'cycle-agent' });

      // Promote untrusted -> probationary
      await api.promote('cycle-agent');
      // Promote probationary -> trusted
      await api.promote('cycle-agent');

      // Violate: trusted -> untrusted (critical)
      await api.recordViolation('cycle-agent', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Attack detected',
      });

      const afterViolation = await api.get('cycle-agent');
      assert.equal(afterViolation?.trustLevel, 'untrusted');

      // Re-promote: untrusted -> probationary
      await api.promote('cycle-agent');

      const afterRePromo = await api.get('cycle-agent');
      assert.equal(afterRePromo?.trustLevel, 'probationary');

      // Verify ALL transitions are recorded
      const transitions = conn.query<{ from_level: string; to_level: string; actor_type: string }>(
        'SELECT from_level, to_level, actor_type FROM core_trust_transitions ORDER BY created_at',
      );

      assert.equal(transitions.length, 4, 'Should have 4 transition records');
      assert.equal(transitions[0]!.from_level, 'untrusted');
      assert.equal(transitions[0]!.to_level, 'probationary');
      assert.equal(transitions[1]!.from_level, 'probationary');
      assert.equal(transitions[1]!.to_level, 'trusted');
      assert.equal(transitions[2]!.from_level, 'trusted');
      assert.equal(transitions[2]!.to_level, 'untrusted');
      assert.equal(transitions[2]!.actor_type, 'policy', 'Demotion should be policy actor');
      assert.equal(transitions[3]!.from_level, 'untrusted');
      assert.equal(transitions[3]!.to_level, 'probationary');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TP-15: Backward Transition via validatePromotion
  // CATCHES: validatePromotion should reject downward transitions
  // (those are only valid through demotion path).
  // ═══════════════════════════════════════════════════════════════════════════

  describe('TP-15: Backward Transitions via promote()', () => {
    it('TP-15a: trusted agent cannot be "promoted" to probationary', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'backward-agent' });
      await api.promote('backward-agent');
      await api.promote('backward-agent');

      await assert.rejects(
        () => api.promote('backward-agent', { targetLevel: 'probationary' }),
        (err: Error) => {
          assert.ok(err.message.includes('no skipping levels') || err.message.includes('Must advance'),
            `Expected rejection for backward promotion, got: ${err.message}`);
          return true;
        },
      );
    });

    it('TP-15b: admin agent cannot be "promoted" to untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'backward-admin' });
      await api.promote('backward-admin');
      await api.promote('backward-admin');
      await api.promote('backward-admin', { actorType: 'human', actorId: 'admin-001' });

      await assert.rejects(
        () => api.promote('backward-admin', { targetLevel: 'untrusted' as 'probationary' }),
        (err: Error) => {
          // Should reject because admin has no next level, or because target is not the next level
          return true;
        },
      );
    });
  });
});
