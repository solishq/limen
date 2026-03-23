/**
 * BREAKER: Sprint 2 Admin Guard Trigger v2 Attack Tests
 * Target: trg_core_agents_trust_admin_guard_v2 (migration v33)
 *
 * Attack vectors: AG-01 through AG-07
 * Classification: Tier 1 (governance, authority boundary)
 *
 * The v2 admin guard trigger verifies:
 *   1. A transition record exists in core_trust_transitions
 *   2. The transition record is for the same agent (agent_id = OLD.id)
 *   3. The transition record has to_level = 'admin'
 *   4. The transition record has actor_type = 'human'
 *   5. The transition record was created within 5 seconds (datetime('now', '-5 seconds')) — F-S2-004 widened from 2s
 *
 * What we attack:
 *   - Direct UPDATE trust_level to admin WITHOUT transition record -> BLOCKED
 *   - Direct UPDATE with transition record -> ALLOWED
 *   - Transition record from different agent -> BLOCKED
 *   - Transition record with actor_type='system' -> BLOCKED
 *   - Transition record with correct human + agent + timing -> ALLOWED
 *   - Non-admin trust level changes bypass the trigger (by design)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, createTestOperationContext } from '../helpers/test_database.js';
import type { DatabaseConnection, RateLimiter, RbacEngine } from '../../src/kernel/interfaces/index.js';
import { AgentApiImpl } from '../../src/api/agents/agent_api.js';

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

function createApi(conn: DatabaseConnection, tenantId: string | null = null) {
  const ctx = createTestOperationContext({ tenantId });
  return new AgentApiImpl(
    createMockRbac(),
    createMockRateLimiter(),
    () => conn,
    () => ctx,
    createTimeProvider(),
  );
}

/**
 * Seed an agent at a given trust level directly in the database.
 * Bypasses the state machine for test setup.
 */
function seedAgentAtLevel(
  conn: DatabaseConnection,
  agentId: string,
  tenantId: string | null,
  name: string,
  trustLevel: string,
): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, 'registered', '[]', '[]', ?, ?)`,
    [agentId, tenantId, name, trustLevel, now, now],
  );
}

describe('BREAKER: Sprint 2 Admin Guard Trigger v2 Attacks', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AG-01: Direct SQL UPDATE to admin WITHOUT transition record
  // CATCHES: If the trigger is missing, any direct SQL can escalate
  // an agent to admin without human approval.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AG-01: Direct Admin Escalation Without Transition Record', () => {
    it('AG-01a: UPDATE trust_level to admin WITHOUT transition record -> BLOCKED', () => {
      seedAgentAtLevel(conn, 'agent-001', null, 'direct-escalate', 'trusted');

      assert.throws(
        () => conn.run(
          'UPDATE core_agents SET trust_level = ? WHERE id = ?',
          ['admin', 'agent-001'],
        ),
        (err: Error) => {
          assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'),
            `Expected admin guard trigger error, got: ${err.message}`);
          return true;
        },
      );

      // Verify trust level unchanged
      const row = conn.get<{ trust_level: string }>('SELECT trust_level FROM core_agents WHERE id = ?', ['agent-001']);
      assert.equal(row?.trust_level, 'trusted', 'Trust level must remain trusted');
    });

    it('AG-01b: UPDATE from untrusted to admin WITHOUT transition record -> BLOCKED', () => {
      seedAgentAtLevel(conn, 'agent-002', null, 'raw-escalate', 'untrusted');

      assert.throws(
        () => conn.run(
          'UPDATE core_agents SET trust_level = ? WHERE id = ?',
          ['admin', 'agent-002'],
        ),
        (err: Error) => {
          assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'),
            `Expected admin guard trigger error, got: ${err.message}`);
          return true;
        },
      );
    });

    it('AG-01c: UPDATE from probationary to admin WITHOUT transition record -> BLOCKED', () => {
      seedAgentAtLevel(conn, 'agent-003', null, 'prob-escalate', 'probationary');

      assert.throws(
        () => conn.run(
          'UPDATE core_agents SET trust_level = ? WHERE id = ?',
          ['admin', 'agent-003'],
        ),
        (err: Error) => {
          assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'),
            `Expected admin guard trigger error, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AG-02: Direct SQL UPDATE with valid transition record -> ALLOWED
  // CATCHES: The trigger should allow admin promotion when a valid human
  // transition record exists within the 2-second window.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AG-02: Admin Promotion With Valid Transition Record', () => {
    it('AG-02a: admin promotion with human transition record within 5s -> ALLOWED', () => {
      seedAgentAtLevel(conn, 'agent-ok', null, 'valid-promote', 'trusted');

      const now = new Date().toISOString();
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, 'agent-ok', 'trusted', 'admin', 'human', 'admin-user', 'Approved', '{}', ?)`,
        [crypto.randomUUID(), now],
      );

      // This should succeed because the transition record matches all criteria
      assert.doesNotThrow(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'agent-ok']),
        'Admin promotion with valid human transition record should succeed',
      );

      const row = conn.get<{ trust_level: string }>('SELECT trust_level FROM core_agents WHERE id = ?', ['agent-ok']);
      assert.equal(row?.trust_level, 'admin', 'Agent should now be admin');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AG-03: Transition record from DIFFERENT agent -> BLOCKED
  // CATCHES: If the trigger doesn't check agent_id, agent-X's transition
  // record could be used to promote agent-Y.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AG-03: Wrong Agent Transition Record', () => {
    it('AG-03a: transition record for different agent cannot authorize admin promotion', () => {
      seedAgentAtLevel(conn, 'target-agent', null, 'target', 'trusted');
      seedAgentAtLevel(conn, 'other-agent', null, 'other', 'trusted');

      const now = new Date().toISOString();
      // Create a human transition record for OTHER-agent, not target-agent
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, 'other-agent', 'trusted', 'admin', 'human', 'admin-user', 'Approved', '{}', ?)`,
        [crypto.randomUUID(), now],
      );

      // Try to promote target-agent to admin using other-agent's transition
      assert.throws(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'target-agent']),
        (err: Error) => {
          assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'),
            `Expected admin guard to block cross-agent transition, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AG-04: Transition record with actor_type='system' -> BLOCKED
  // CATCHES: If the trigger doesn't check actor_type, system actors can
  // create transition records to bypass the human requirement.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AG-04: System Actor Transition Record', () => {
    it('AG-04a: system actor_type transition record cannot authorize admin promotion', () => {
      seedAgentAtLevel(conn, 'sys-agent', null, 'sys-promote', 'trusted');

      const now = new Date().toISOString();
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, 'sys-agent', 'trusted', 'admin', 'system', 'auto-system', 'Auto-promote', '{}', ?)`,
        [crypto.randomUUID(), now],
      );

      assert.throws(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'sys-agent']),
        (err: Error) => {
          assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'),
            `Expected admin guard to block system actor transition, got: ${err.message}`);
          return true;
        },
      );
    });

    it('AG-04b: policy actor_type transition record cannot authorize admin promotion', () => {
      seedAgentAtLevel(conn, 'policy-agent', null, 'policy-promote', 'trusted');

      const now = new Date().toISOString();
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, 'policy-agent', 'trusted', 'admin', 'policy', 'auto-policy', 'Policy-promote', '{}', ?)`,
        [crypto.randomUUID(), now],
      );

      assert.throws(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'policy-agent']),
        (err: Error) => {
          assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'),
            `Expected admin guard to block policy actor transition, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AG-05: Non-Admin Trust Changes Bypass Trigger (by design)
  // CATCHES: The trigger should ONLY fire when NEW.trust_level = 'admin'
  // and OLD.trust_level != 'admin'. Other changes should pass through.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AG-05: Non-Admin Changes Bypass Trigger', () => {
    it('AG-05a: untrusted -> probationary does NOT require transition record', () => {
      seedAgentAtLevel(conn, 'non-admin-1', null, 'normal-promote', 'untrusted');

      // Direct SQL update without transition record should succeed for non-admin
      assert.doesNotThrow(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['probationary', 'non-admin-1']),
        'Non-admin promotion should not be blocked by admin guard trigger',
      );

      const row = conn.get<{ trust_level: string }>('SELECT trust_level FROM core_agents WHERE id = ?', ['non-admin-1']);
      assert.equal(row?.trust_level, 'probationary');
    });

    it('AG-05b: probationary -> trusted does NOT require transition record', () => {
      seedAgentAtLevel(conn, 'non-admin-2', null, 'normal-promote-2', 'probationary');

      assert.doesNotThrow(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['trusted', 'non-admin-2']),
        'trusted promotion should not be blocked by admin guard trigger',
      );

      const row = conn.get<{ trust_level: string }>('SELECT trust_level FROM core_agents WHERE id = ?', ['non-admin-2']);
      assert.equal(row?.trust_level, 'trusted');
    });

    it('AG-05c: admin -> trusted demotion does NOT require transition record', () => {
      // First, create an admin agent the proper way via the API
      const api = createApi(conn, null);

      seedAgentAtLevel(conn, 'admin-demote', null, 'admin-to-demote', 'trusted');

      // Create proper admin transition record
      const now = new Date().toISOString();
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, 'admin-demote', 'trusted', 'admin', 'human', 'admin-user', 'Approved', '{}', ?)`,
        [crypto.randomUUID(), now],
      );
      conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'admin-demote']);

      // Now demote admin -> trusted (this should NOT trigger the admin guard)
      assert.doesNotThrow(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['trusted', 'admin-demote']),
        'Demotion from admin should not be blocked by admin guard trigger',
      );

      const row = conn.get<{ trust_level: string }>('SELECT trust_level FROM core_agents WHERE id = ?', ['admin-demote']);
      assert.equal(row?.trust_level, 'trusted');
    });

    it('AG-05d: admin -> admin (no change) does NOT fire trigger', () => {
      seedAgentAtLevel(conn, 'admin-same', null, 'admin-no-change', 'trusted');

      const now = new Date().toISOString();
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, 'admin-same', 'trusted', 'admin', 'human', 'admin-user', 'Approved', '{}', ?)`,
        [crypto.randomUUID(), now],
      );
      conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'admin-same']);

      // Update admin -> admin (same value) — trigger has WHEN OLD.trust_level != 'admin'
      assert.doesNotThrow(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'admin-same']),
        'admin -> admin (no change) should not fire the trigger',
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AG-06: Full API Flow Verification
  // CATCHES: Verify the complete promote() API path works end-to-end
  // with the v2 trigger, combining application-level and trigger-level checks.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AG-06: Full API Promotion Flow', () => {
    it('AG-06a: full promote() flow with admin trigger passes', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'full-flow' });
      await api.promote('full-flow');
      await api.promote('full-flow');

      const result = await api.promote('full-flow', {
        actorType: 'human',
        actorId: 'senior-admin',
        reason: 'Annual review passed',
      });

      assert.equal(result.trustLevel, 'admin');

      // Verify transition record exists with correct actor info
      const transitions = conn.query<{
        from_level: string; to_level: string; actor_type: string; actor_id: string; reason: string;
      }>(
        `SELECT from_level, to_level, actor_type, actor_id, reason FROM core_trust_transitions
         WHERE to_level = 'admin'`,
      );
      assert.equal(transitions.length, 1);
      assert.equal(transitions[0]!.actor_type, 'human');
      assert.equal(transitions[0]!.actor_id, 'senior-admin');
      assert.equal(transitions[0]!.reason, 'Annual review passed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AG-07: Transition Record with to_level != 'admin'
  // CATCHES: Transition record exists but for a different to_level —
  // trigger should not match.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('AG-07: Wrong to_level in Transition Record', () => {
    it('AG-07a: human transition to "trusted" cannot authorize admin promotion', () => {
      seedAgentAtLevel(conn, 'wrong-level', null, 'wrong-level-agent', 'trusted');

      const now = new Date().toISOString();
      // Create a human transition record but for to_level='trusted', not 'admin'
      conn.run(
        `INSERT INTO core_trust_transitions (id, tenant_id, agent_id, from_level, to_level, actor_type, actor_id, reason, criteria_snapshot, created_at)
         VALUES (?, NULL, 'wrong-level', 'probationary', 'trusted', 'human', 'admin-user', 'Approved', '{}', ?)`,
        [crypto.randomUUID(), now],
      );

      assert.throws(
        () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'wrong-level']),
        (err: Error) => {
          assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'),
            `Expected admin guard to block when transition to_level != admin, got: ${err.message}`);
          return true;
        },
      );
    });
  });
});
