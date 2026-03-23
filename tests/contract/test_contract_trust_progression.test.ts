/**
 * Contract tests for I-09 Trust Progression (Sprint 2 Trust & Learning).
 * Validates trust state machine, safety demotion, append-only audit, and tenant isolation.
 *
 * Phase: Sprint 2 (Trust & Learning)
 * Spec ref: I-09 (Trust is Earned), FM-10 (Tenant Isolation)
 *
 * Tests: ~35 contract tests covering:
 *   - Forward progression: untrusted->probationary, probationary->trusted, trusted->admin (human only)
 *   - Rejection: skip levels, self-promotion, retired agent, admin without human actor
 *   - Demotion: critical->untrusted, high->untrusted, medium->probationary, low->probationary
 *   - Append-only: trust transitions immutable, safety violations immutable
 *   - Tenant isolation on trust transitions and violations
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

describe('I-09 Trust Progression — Contract Tests', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ─── Forward Progression ───

  describe('Forward Progression', () => {
    it('untrusted -> probationary (default next level)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-a' });

      const result = await api.promote('agent-a');
      assert.equal(result.trustLevel, 'probationary');
    });

    it('probationary -> trusted (default next level)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-b' });
      await api.promote('agent-b');

      const result = await api.promote('agent-b');
      assert.equal(result.trustLevel, 'trusted');
    });

    it('trusted -> admin with human actor', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-c' });
      await api.promote('agent-c');
      await api.promote('agent-c');

      const result = await api.promote('agent-c', {
        actorType: 'human',
        actorId: 'admin-user',
        reason: 'Approved after review',
      });
      assert.equal(result.trustLevel, 'admin');
    });

    it('explicit targetLevel matches next level', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-d' });

      const result = await api.promote('agent-d', { targetLevel: 'probationary' });
      assert.equal(result.trustLevel, 'probationary');
    });

    it('full progression chain: untrusted -> probationary -> trusted -> admin', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-full' });

      const p1 = await api.promote('agent-full');
      assert.equal(p1.trustLevel, 'probationary');

      const p2 = await api.promote('agent-full');
      assert.equal(p2.trustLevel, 'trusted');

      const p3 = await api.promote('agent-full', { actorType: 'human', actorId: 'admin-001' });
      assert.equal(p3.trustLevel, 'admin');
    });
  });

  // ─── Rejection Cases ───

  describe('Rejection Cases', () => {
    it('skip levels: untrusted -> trusted is INVALID', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-skip' });

      await assert.rejects(
        () => api.promote('agent-skip', { targetLevel: 'trusted' }),
        (err: Error) => err.message.includes('no skipping levels'),
        'Must reject level skipping',
      );

      // Verify trust level unchanged
      const agent = await api.get('agent-skip');
      assert.equal(agent?.trustLevel, 'untrusted');
    });

    it('skip levels: untrusted -> admin is INVALID', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-skip2' });

      await assert.rejects(
        () => api.promote('agent-skip2', { targetLevel: 'admin', actorType: 'human' }),
        (err: Error) => err.message.includes('no skipping levels'),
      );
    });

    it('skip levels: probationary -> admin is INVALID', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-skip3' });
      await api.promote('agent-skip3');

      await assert.rejects(
        () => api.promote('agent-skip3', { targetLevel: 'admin', actorType: 'human' }),
        (err: Error) => err.message.includes('no skipping levels'),
      );
    });

    it('self-promotion blocked', async () => {
      const api = createApi(conn, null);
      const agent = await api.register({ name: 'agent-self' });

      // Create API with the agent's own ID as the context agentId
      const selfApi = createApi(conn, null, agent.id);
      await assert.rejects(
        () => selfApi.promote('agent-self'),
        (err: Error) => err.message.includes('SELF_PROMOTION_BLOCKED'),
        'Agents cannot promote themselves',
      );
    });

    it('retired agent cannot be promoted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-retired' });
      await api.retire('agent-retired');

      await assert.rejects(
        () => api.promote('agent-retired'),
        (err: Error) => err.message.includes('retired'),
        'Retired agents cannot be promoted',
      );
    });

    it('admin promotion without human actor is rejected', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-nohuman' });
      await api.promote('agent-nohuman');
      await api.promote('agent-nohuman');

      // Default actorType is 'system'
      await assert.rejects(
        () => api.promote('agent-nohuman'),
        (err: Error) => err.message.includes('human actor'),
        'Admin requires human actor',
      );
    });

    it('admin promotion with explicit system actorType is rejected', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-explicit' });
      await api.promote('agent-explicit');
      await api.promote('agent-explicit');

      await assert.rejects(
        () => api.promote('agent-explicit', { actorType: 'system' }),
        (err: Error) => err.message.includes('human actor'),
      );
    });

    it('promoting nonexistent agent returns AGENT_NOT_FOUND', async () => {
      const api = createApi(conn, null);

      await assert.rejects(
        () => api.promote('nonexistent'),
        (err: Error) => err.message.includes('not found'),
      );
    });

    it('cannot promote beyond admin', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-max' });
      await api.promote('agent-max');
      await api.promote('agent-max');
      await api.promote('agent-max', { actorType: 'human', actorId: 'admin-001' });

      await assert.rejects(
        () => api.promote('agent-max'),
        (err: Error) => err.message.includes('already at admin'),
      );
    });
  });

  // ─── Demotion on Safety Violation ───

  describe('Demotion on Safety Violation', () => {
    it('critical severity on trusted -> untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-crit' });
      await api.promote('agent-crit');
      await api.promote('agent-crit');

      const result = await api.recordViolation('agent-crit', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Critical prompt injection attempt',
      });
      assert.equal(result.trustLevel, 'untrusted');
    });

    it('high severity on trusted -> untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-high' });
      await api.promote('agent-high');
      await api.promote('agent-high');

      const result = await api.recordViolation('agent-high', {
        violationType: 'data_exfiltration',
        severity: 'high',
        description: 'High severity violation',
      });
      assert.equal(result.trustLevel, 'untrusted');
    });

    it('critical severity on probationary -> untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-prob-crit' });
      await api.promote('agent-prob-crit');

      const result = await api.recordViolation('agent-prob-crit', {
        violationType: 'safety_bypass',
        severity: 'critical',
        description: 'Critical violation on probationary',
      });
      assert.equal(result.trustLevel, 'untrusted');
    });

    it('critical severity on admin -> untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-admin-crit' });
      await api.promote('agent-admin-crit');
      await api.promote('agent-admin-crit');
      await api.promote('agent-admin-crit', { actorType: 'human', actorId: 'admin-001' });

      const result = await api.recordViolation('agent-admin-crit', {
        violationType: 'unauthorized_access',
        severity: 'critical',
        description: 'Critical admin violation',
      });
      assert.equal(result.trustLevel, 'untrusted');
    });

    it('medium severity on trusted -> probationary', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-med' });
      await api.promote('agent-med');
      await api.promote('agent-med');

      const result = await api.recordViolation('agent-med', {
        violationType: 'content_policy',
        severity: 'medium',
        description: 'Medium content policy violation',
      });
      assert.equal(result.trustLevel, 'probationary');
    });

    it('low severity on trusted -> probationary', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-low' });
      await api.promote('agent-low');
      await api.promote('agent-low');

      const result = await api.recordViolation('agent-low', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Low rate abuse',
      });
      assert.equal(result.trustLevel, 'probationary');
    });

    it('medium severity on probationary -> untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-prob-med' });
      await api.promote('agent-prob-med');

      const result = await api.recordViolation('agent-prob-med', {
        violationType: 'content_policy',
        severity: 'medium',
        description: 'Medium violation on probationary',
      });
      assert.equal(result.trustLevel, 'untrusted');
    });

    it('low severity on probationary -> untrusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-prob-low' });
      await api.promote('agent-prob-low');

      const result = await api.recordViolation('agent-prob-low', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Low violation on probationary',
      });
      assert.equal(result.trustLevel, 'untrusted');
    });

    it('low severity on admin -> trusted', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-admin-low' });
      await api.promote('agent-admin-low');
      await api.promote('agent-admin-low');
      await api.promote('agent-admin-low', { actorType: 'human', actorId: 'admin-001' });

      const result = await api.recordViolation('agent-admin-low', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Low violation on admin',
      });
      assert.equal(result.trustLevel, 'trusted');
    });

    it('any severity on untrusted -> no demotion (already lowest)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-already-low' });

      const result = await api.recordViolation('agent-already-low', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Critical on untrusted',
      });
      assert.equal(result.trustLevel, 'untrusted', 'Already at lowest — no change');
    });

    it('violation on nonexistent agent returns AGENT_NOT_FOUND', async () => {
      const api = createApi(conn, null);

      await assert.rejects(
        () => api.recordViolation('ghost-agent', {
          violationType: 'other',
          severity: 'low',
          description: 'Ghost violation',
        }),
        (err: Error) => err.message.includes('not found'),
      );
    });
  });

  // ─── Append-Only Enforcement ───

  describe('Append-Only Enforcement', () => {
    it('core_trust_transitions: UPDATE is blocked', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-immutable' });
      await api.promote('agent-immutable');

      // Get the transition record
      const rows = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions LIMIT 1');
      assert.ok(rows.length > 0, 'Transition record should exist');

      // Try to update it
      assert.throws(
        () => conn.run('UPDATE core_trust_transitions SET reason = ? WHERE id = ?', ['hacked', rows[0]!.id]),
        (err: Error) => err.message.includes('TRUST_TRANSITION_IMMUTABLE'),
        'Trust transitions must be append-only',
      );
    });

    it('core_trust_transitions: DELETE is blocked', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-nodelete' });
      await api.promote('agent-nodelete');

      const rows = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('DELETE FROM core_trust_transitions WHERE id = ?', [rows[0]!.id]),
        (err: Error) => err.message.includes('TRUST_TRANSITION_NO_DELETE'),
        'Trust transitions cannot be deleted',
      );
    });

    it('core_safety_violations: UPDATE is blocked', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-viol-immut' });
      await api.recordViolation('agent-viol-immut', {
        violationType: 'other',
        severity: 'low',
        description: 'Test violation',
      });

      const rows = conn.query<{ id: string }>('SELECT id FROM core_safety_violations LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('UPDATE core_safety_violations SET description = ? WHERE id = ?', ['hacked', rows[0]!.id]),
        (err: Error) => err.message.includes('SAFETY_VIOLATION_IMMUTABLE'),
        'Safety violations must be append-only',
      );
    });

    it('core_safety_violations: DELETE is blocked', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-viol-nodel' });
      await api.recordViolation('agent-viol-nodel', {
        violationType: 'other',
        severity: 'low',
        description: 'Test violation',
      });

      const rows = conn.query<{ id: string }>('SELECT id FROM core_safety_violations LIMIT 1');
      assert.ok(rows.length > 0);

      assert.throws(
        () => conn.run('DELETE FROM core_safety_violations WHERE id = ?', [rows[0]!.id]),
        (err: Error) => err.message.includes('SAFETY_VIOLATION_NO_DELETE'),
        'Safety violations cannot be deleted',
      );
    });
  });

  // ─── Transition Audit Log ───

  describe('Transition Audit Log', () => {
    it('promote creates a transition record with correct fields', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-audit' });
      await api.promote('agent-audit', { reason: 'Passed evaluation', actorId: 'eval-system' });

      const rows = conn.query<{
        agent_id: string; from_level: string; to_level: string;
        actor_type: string; actor_id: string; reason: string;
      }>('SELECT agent_id, from_level, to_level, actor_type, actor_id, reason FROM core_trust_transitions');

      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.from_level, 'untrusted');
      assert.equal(rows[0]!.to_level, 'probationary');
      assert.equal(rows[0]!.actor_type, 'system');
      assert.equal(rows[0]!.actor_id, 'eval-system');
      assert.equal(rows[0]!.reason, 'Passed evaluation');
    });

    it('demotion creates a transition record with policy actor', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-dem-audit' });
      await api.promote('agent-dem-audit');

      await api.recordViolation('agent-dem-audit', {
        violationType: 'content_policy',
        severity: 'high',
        description: 'Policy violation',
      });

      const rows = conn.query<{
        from_level: string; to_level: string; actor_type: string;
      }>('SELECT from_level, to_level, actor_type FROM core_trust_transitions ORDER BY created_at');

      // First: promotion from untrusted to probationary
      assert.equal(rows[0]!.from_level, 'untrusted');
      assert.equal(rows[0]!.to_level, 'probationary');
      assert.equal(rows[0]!.actor_type, 'system');

      // Second: demotion from probationary to untrusted
      assert.equal(rows[1]!.from_level, 'probationary');
      assert.equal(rows[1]!.to_level, 'untrusted');
      assert.equal(rows[1]!.actor_type, 'policy');
    });

    it('violation without demotion still records violation but no transition', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-nodem' });

      // Untrusted agent, low violation -> no demotion possible
      await api.recordViolation('agent-nodem', {
        violationType: 'rate_abuse',
        severity: 'low',
        description: 'Low violation on untrusted',
      });

      const violations = conn.query<{ id: string }>('SELECT id FROM core_safety_violations');
      assert.equal(violations.length, 1, 'Violation record should exist');

      const transitions = conn.query<{ id: string }>('SELECT id FROM core_trust_transitions');
      assert.equal(transitions.length, 0, 'No transition should exist (no demotion)');
    });
  });

  // ─── Tenant Isolation ───

  describe('Tenant Isolation', () => {
    it('tenant-A trust transitions invisible to tenant-B', async () => {
      const apiA = createApi(conn, 'tenant-a');
      const apiB = createApi(conn, 'tenant-b');

      await apiA.register({ name: 'shared-name' });
      await apiB.register({ name: 'shared-name' });

      await apiA.promote('shared-name');

      // Tenant-A's agent should be promoted
      const agentA = await apiA.get('shared-name');
      assert.equal(agentA?.trustLevel, 'probationary');

      // Tenant-B's agent should still be untrusted
      const agentB = await apiB.get('shared-name');
      assert.equal(agentB?.trustLevel, 'untrusted');
    });

    it('tenant-A violations do not affect tenant-B agents', async () => {
      const apiA = createApi(conn, 'tenant-a');
      const apiB = createApi(conn, 'tenant-b');

      await apiA.register({ name: 'agent-iso' });
      await apiB.register({ name: 'agent-iso' });

      // Promote both
      await apiA.promote('agent-iso');
      await apiB.promote('agent-iso');

      // Violate tenant-A
      await apiA.recordViolation('agent-iso', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Tenant-A violation',
      });

      // Tenant-A demoted
      const agentA = await apiA.get('agent-iso');
      assert.equal(agentA?.trustLevel, 'untrusted');

      // Tenant-B unaffected
      const agentB = await apiB.get('agent-iso');
      assert.equal(agentB?.trustLevel, 'probationary');
    });
  });
});
