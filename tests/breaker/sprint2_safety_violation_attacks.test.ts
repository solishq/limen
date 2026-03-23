/**
 * BREAKER: Sprint 2 Safety Violation Attack Tests
 * Target: core_safety_violations table (migration v33), agent_api.ts recordViolation()
 *
 * Attack vectors: SV-01 through SV-08
 * Classification: Tier 1 (data integrity, state consistency, authority)
 *
 * What we attack:
 *   - Violation record immutability (UPDATE, DELETE)
 *   - Invalid violation_type (CHECK constraint)
 *   - Invalid severity (CHECK constraint)
 *   - Demotion applied flag correctness
 *   - Violation without demotion (already at lowest level)
 *   - Cross-tenant violation visibility
 *   - Large evidence_json payload
 *   - Multiple violations on same agent (cumulative demotion)
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

function createApi(conn: DatabaseConnection, tenantId: string | null = 'test-tenant') {
  const ctx = createTestOperationContext({ tenantId });
  return new AgentApiImpl(
    createMockRbac(),
    createMockRateLimiter(),
    () => conn,
    () => ctx,
    createTimeProvider(),
  );
}

describe('BREAKER: Sprint 2 Safety Violation Attacks', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-01: Violation Record Immutability
  // CATCHES: If append-only triggers are missing, violation records can be
  // tampered with to hide evidence of safety incidents.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-01: Violation Record Immutability', () => {
    it('SV-01a: UPDATE on safety violations BLOCKED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'viol-immut-agent' });
      await api.recordViolation('viol-immut-agent', {
        violationType: 'content_policy',
        severity: 'low',
        description: 'Original description',
      });

      const rows = conn.query<{ id: string }>('SELECT id FROM core_safety_violations LIMIT 1');
      assert.ok(rows.length > 0, 'Violation record should exist');

      assert.throws(
        () => conn.run('UPDATE core_safety_violations SET description = ? WHERE id = ?', ['tampered', rows[0]!.id]),
        (err: Error) => {
          assert.ok(err.message.includes('SAFETY_VIOLATION_IMMUTABLE'),
            `Expected immutability error, got: ${err.message}`);
          return true;
        },
      );
    });

    it('SV-01b: DELETE on safety violations BLOCKED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'viol-nodel-agent' });
      await api.recordViolation('viol-nodel-agent', {
        violationType: 'other',
        severity: 'low',
        description: 'Test violation',
      });

      const rows = conn.query<{ id: string }>('SELECT id FROM core_safety_violations LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('DELETE FROM core_safety_violations WHERE id = ?', [rows[0]!.id]),
        (err: Error) => {
          assert.ok(err.message.includes('SAFETY_VIOLATION_NO_DELETE'),
            `Expected no-delete error, got: ${err.message}`);
          return true;
        },
      );
    });

    it('SV-01c: UPDATE severity on safety violations BLOCKED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'sev-tamper-agent' });
      await api.recordViolation('sev-tamper-agent', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Critical violation',
      });

      const rows = conn.query<{ id: string }>('SELECT id FROM core_safety_violations LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('UPDATE core_safety_violations SET severity = ? WHERE id = ?', ['low', rows[0]!.id]),
        (err: Error) => {
          assert.ok(err.message.includes('SAFETY_VIOLATION_IMMUTABLE'),
            `Expected immutability error when tampering severity, got: ${err.message}`);
          return true;
        },
      );
    });

    it('SV-01d: UPDATE evidence_json on safety violations BLOCKED', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'evidence-tamper' });
      await api.recordViolation('evidence-tamper', {
        violationType: 'data_exfiltration',
        severity: 'high',
        description: 'Exfiltration attempt',
        evidence: { detectedAt: '2026-03-23' },
      });

      const rows = conn.query<{ id: string }>('SELECT id FROM core_safety_violations LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('UPDATE core_safety_violations SET evidence_json = ? WHERE id = ?', ['{}', rows[0]!.id]),
        (err: Error) => {
          assert.ok(err.message.includes('SAFETY_VIOLATION_IMMUTABLE'),
            `Expected immutability error when tampering evidence, got: ${err.message}`);
          return true;
        },
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-02: Invalid violation_type (CHECK constraint)
  // CATCHES: If CHECK constraint is missing, arbitrary violation types
  // can be stored, breaking the enum contract.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-02: Invalid violation_type', () => {
    it('SV-02a: invalid violation_type rejected by CHECK', () => {
      assert.throws(
        () => conn.run(
          `INSERT INTO core_safety_violations (id, tenant_id, agent_id, violation_type, severity, description, created_at)
           VALUES (?, NULL, 'agent-001', 'hacking', 'low', 'test', ?)`,
          [crypto.randomUUID(), new Date().toISOString()],
        ),
        (err: Error) => {
          assert.ok(err.message.includes('CHECK constraint'),
            `Expected CHECK constraint failure for invalid violation_type, got: ${err.message}`);
          return true;
        },
      );
    });

    it('SV-02b: all valid violation_types accepted', async () => {
      // Seed an agent so the FOREIGN KEY is satisfied
      const api = createApi(conn, null);
      const agent = await api.register({ name: 'check-types-agent' });

      const validTypes = ['content_policy', 'prompt_injection', 'data_exfiltration', 'unauthorized_access', 'rate_abuse', 'safety_bypass', 'other'];

      for (const vType of validTypes) {
        const id = crypto.randomUUID();
        assert.doesNotThrow(
          () => conn.run(
            `INSERT INTO core_safety_violations (id, tenant_id, agent_id, violation_type, severity, description, created_at)
             VALUES (?, NULL, ?, ?, 'low', 'test', ?)`,
            [id, agent.id, vType, new Date().toISOString()],
          ),
          `${vType} should be accepted as a valid violation_type`,
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-03: Invalid severity (CHECK constraint)
  // CATCHES: If CHECK constraint is missing, arbitrary severity values
  // can be stored.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-03: Invalid severity', () => {
    it('SV-03a: invalid severity rejected by CHECK', () => {
      assert.throws(
        () => conn.run(
          `INSERT INTO core_safety_violations (id, tenant_id, agent_id, violation_type, severity, description, created_at)
           VALUES (?, NULL, 'agent-001', 'other', 'extreme', 'test', ?)`,
          [crypto.randomUUID(), new Date().toISOString()],
        ),
        (err: Error) => {
          assert.ok(err.message.includes('CHECK constraint'),
            `Expected CHECK constraint failure for invalid severity, got: ${err.message}`);
          return true;
        },
      );
    });

    it('SV-03b: all valid severity values accepted', async () => {
      // Seed an agent so the FOREIGN KEY is satisfied
      const api = createApi(conn, null);
      const agent = await api.register({ name: 'check-sev-agent' });

      for (const sev of ['low', 'medium', 'high', 'critical']) {
        const id = crypto.randomUUID();
        assert.doesNotThrow(
          () => conn.run(
            `INSERT INTO core_safety_violations (id, tenant_id, agent_id, violation_type, severity, description, created_at)
             VALUES (?, NULL, ?, 'other', ?, 'test', ?)`,
            [id, agent.id, sev, new Date().toISOString()],
          ),
          `${sev} should be accepted as a valid severity`,
        );
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-04: Demotion Applied Flag Correctness
  // CATCHES: If demotion_applied flag is wrong, auditors cannot tell which
  // violations actually caused trust changes.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-04: Demotion Applied Flag', () => {
    it('SV-04a: demotion_applied = 1 when demotion occurs', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'flag-agent' });
      await api.promote('flag-agent'); // untrusted -> probationary

      await api.recordViolation('flag-agent', {
        violationType: 'content_policy',
        severity: 'high',
        description: 'Should cause demotion',
      });

      const rows = conn.query<{ demotion_applied: number }>(
        'SELECT demotion_applied FROM core_safety_violations',
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.demotion_applied, 1,
        'demotion_applied must be 1 when demotion occurs');
    });

    it('SV-04b: demotion_applied = 0 when already at lowest level', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'lowest-agent' });
      // Agent is at 'untrusted' (default)

      await api.recordViolation('lowest-agent', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Critical on untrusted',
      });

      const rows = conn.query<{ demotion_applied: number }>(
        'SELECT demotion_applied FROM core_safety_violations',
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.demotion_applied, 0,
        'demotion_applied must be 0 when already at lowest level');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-04c: Violation on retired agent — FINDING F-S2-001
  // CATCHES: recordViolation() does not check retired status. If the agent
  // is at a level where demotion would apply, the retired terminal trigger
  // blocks the UPDATE, and the entire transaction (including the violation
  // record INSERT) is rolled back. The violation is LOST.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-04c: Violation on Retired Agent (FINDING F-S2-001)', () => {
    it('SV-04c-a: violation on retired agent is recorded but demotion is skipped (F-S2-001 FIX)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'retired-viol' });
      await api.promote('retired-viol'); // untrusted -> probationary
      await api.retire('retired-viol');

      // F-S2-001 FIX: recordViolation on a retired agent records the violation
      // but skips the demotion path entirely. No transaction rollback, no lost record.
      const result = await api.recordViolation('retired-viol', {
        violationType: 'prompt_injection',
        severity: 'high',
        description: 'Violation on retired agent — recorded without demotion',
      });

      // Agent remains at probationary trust level (no demotion applied)
      assert.equal(result.trustLevel, 'probationary',
        'Retired agent trust level must not change');
      assert.equal(result.status, 'retired',
        'Agent must remain retired');

      // FIXED: The violation record is now preserved
      const violations = conn.query<{ id: string; demotion_applied: number }>(
        'SELECT id, demotion_applied FROM core_safety_violations',
      );
      assert.equal(violations.length, 1,
        'F-S2-001 FIX: Violation record must be preserved for retired agents');
      assert.equal(violations[0]!.demotion_applied, 0,
        'demotion_applied must be 0 for retired agents (demotion skipped)');

      // No trust transition record created (demotion was skipped)
      const transitions = conn.query<{ id: string }>(
        'SELECT id FROM core_trust_transitions WHERE agent_id = (SELECT id FROM core_agents WHERE name = ?)',
        ['retired-viol'],
      );
      // One transition from the promote (untrusted -> probationary), none from violation
      assert.equal(transitions.length, 1,
        'Only the promotion transition should exist, not a demotion transition');
    });

    it('SV-04c-b: violation on retired untrusted agent also fails (no demotion but still updates)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'retired-untrusted' });
      await api.retire('retired-untrusted');

      // Even though no demotion is needed (untrusted + low = null demotion target),
      // the violation INSERT should still work since no UPDATE is attempted.
      // But recordViolation() does not check retired status, so let's see...
      const result = await api.recordViolation('retired-untrusted', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Low violation on retired untrusted',
      });

      // This should succeed because no demotion UPDATE is attempted
      assert.equal(result.trustLevel, 'untrusted');

      const violations = conn.query<{ id: string }>('SELECT id FROM core_safety_violations');
      assert.equal(violations.length, 1,
        'Violation record should exist when no demotion is needed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-05: Violation Without Demotion
  // CATCHES: Violation record should be created even when no demotion applies.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-05: Violation Without Demotion', () => {
    it('SV-05a: violation recorded but no transition when untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'nodem-agent' });

      await api.recordViolation('nodem-agent', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Low violation on untrusted',
      });

      const violations = conn.query<{ id: string }>('SELECT id FROM core_safety_violations');
      assert.equal(violations.length, 1, 'Violation record must exist');

      const transitions = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions');
      assert.equal(transitions.length, 0, 'No transition should exist (no demotion possible)');

      // Trust level still untrusted
      const agent = await api.get('nodem-agent');
      assert.equal(agent?.trustLevel, 'untrusted');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-06: Cross-Tenant Violation Visibility
  // CATCHES: Tenant-A's violations should not be visible to tenant-B.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-06: Cross-Tenant Violation Visibility', () => {
    it('SV-06a: violations are tenant-scoped', async () => {
      const apiA = createApi(conn, 'tenant-a');
      const apiB = createApi(conn, 'tenant-b');

      await apiA.register({ name: 'shared-agent' });
      await apiB.register({ name: 'shared-agent' });

      await apiA.recordViolation('shared-agent', {
        violationType: 'content_policy',
        severity: 'low',
        description: 'Tenant-A violation',
      });

      // Tenant-A's violations should be recorded
      const violsA = conn.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM core_safety_violations WHERE tenant_id = ?`,
        ['tenant-a'],
      );
      assert.equal(violsA.length, 1);

      // Tenant-B should have no violations
      const violsB = conn.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM core_safety_violations WHERE tenant_id = ?`,
        ['tenant-b'],
      );
      assert.equal(violsB.length, 0, 'Tenant-B should have no violations');
    });

    it('SV-06b: violation on tenant-A agent does not affect tenant-B agent trust', async () => {
      const apiA = createApi(conn, 'tenant-a');
      const apiB = createApi(conn, 'tenant-b');

      await apiA.register({ name: 'iso-agent' });
      await apiB.register({ name: 'iso-agent' });

      await apiA.promote('iso-agent');
      await apiB.promote('iso-agent');

      // Critical violation on tenant-A
      await apiA.recordViolation('iso-agent', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Critical violation tenant-A',
      });

      const agentA = await apiA.get('iso-agent');
      assert.equal(agentA?.trustLevel, 'untrusted', 'Tenant-A agent should be demoted');

      const agentB = await apiB.get('iso-agent');
      assert.equal(agentB?.trustLevel, 'probationary', 'Tenant-B agent must be unaffected');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-07: Large Evidence JSON Payload
  // CATCHES: Unbounded evidence JSON could cause storage issues.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-07: Large Evidence JSON', () => {
    it('SV-07a: large evidence_json stored and retrieved correctly', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'big-evidence' });

      const largeEvidence = { data: 'z'.repeat(100_000), details: Array.from({ length: 1000 }, (_, i) => `item-${i}`) };

      await api.recordViolation('big-evidence', {
        violationType: 'data_exfiltration',
        severity: 'high',
        description: 'Large evidence test',
        evidence: largeEvidence,
      });

      const rows = conn.query<{ evidence_json: string }>('SELECT evidence_json FROM core_safety_violations');
      assert.equal(rows.length, 1);

      const parsed = JSON.parse(rows[0]!.evidence_json);
      assert.equal(parsed.data.length, 100_000, 'Large evidence data should be stored correctly');
      assert.equal(parsed.details.length, 1000, 'Large evidence array should be stored correctly');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SV-08: Multiple Violations on Same Agent
  // CATCHES: Cumulative violations — each one correctly records and demotes.
  // ═══════════════════════════════════════════════════════════════════════════

  describe('SV-08: Multiple Violations', () => {
    it('SV-08a: multiple low violations progressively demote', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'multi-viol' });
      await api.promote('multi-viol'); // untrusted -> probationary
      await api.promote('multi-viol'); // probationary -> trusted
      await api.promote('multi-viol', { actorType: 'human', actorId: 'admin-001' }); // trusted -> admin

      // Low violation on admin -> trusted
      const v1 = await api.recordViolation('multi-viol', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'First low violation',
      });
      assert.equal(v1.trustLevel, 'trusted');

      // Low violation on trusted -> probationary
      const v2 = await api.recordViolation('multi-viol', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Second low violation',
      });
      assert.equal(v2.trustLevel, 'probationary');

      // Low violation on probationary -> untrusted
      const v3 = await api.recordViolation('multi-viol', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Third low violation',
      });
      assert.equal(v3.trustLevel, 'untrusted');

      // Verify all 3 violation records exist
      const violations = conn.query<{ id: string }>('SELECT id FROM core_safety_violations');
      assert.equal(violations.length, 3, 'All three violations should be recorded');

      // Verify all demotion transitions exist (3 promotions + 3 demotions = 6 transitions)
      const transitions = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions');
      assert.equal(transitions.length, 6, '3 promotions + 3 demotions = 6 total transitions');
    });

    it('SV-08b: critical violation on untrusted records violation but no transition', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'crit-untrusted' });

      // Multiple critical violations on untrusted — all recorded, no transitions
      await api.recordViolation('crit-untrusted', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'First critical',
      });
      await api.recordViolation('crit-untrusted', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Second critical',
      });

      const violations = conn.query<{ id: string }>('SELECT id FROM core_safety_violations');
      assert.equal(violations.length, 2, 'Both violations should be recorded');

      const transitions = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions');
      assert.equal(transitions.length, 0, 'No transitions (already at untrusted)');
    });
  });
});
