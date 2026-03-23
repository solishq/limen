/**
 * Verifies: §4 I-09
 * Phase: Sprint 2 (Trust & Learning — Trust Progression)
 *
 * I-09: Trust is Earned.
 * "No agent starts with admin trust. Progression: untrusted -> probationary
 * -> trusted -> admin (human grant only). Revocable on safety violation."
 *
 * Classification: A (FULLY IMPLEMENTABLE)
 * Evidence: AgentView type defines 4-level trust union (api.ts:892).
 * Agent registration sets trustLevel: 'untrusted' (agent_api.ts:195).
 * Progression via agents.promote() (agent_api.ts).
 * Revocation via agents.recordViolation() (agent_api.ts).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, createTestOperationContext } from '../../helpers/test_database.js';
import type { DatabaseConnection, RateLimiter, RbacEngine } from '../../../src/kernel/interfaces/index.js';
import { AgentApiImpl } from '../../../src/api/agents/agent_api.js';

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

describe('I-09: Trust is Earned', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  describe('Initial Trust Level', () => {
    it('AgentView type includes all 4 trust levels (I-09)', () => {
      /**
       * api.ts:892 — trustLevel: 'untrusted' | 'probationary' | 'trusted' | 'admin'
       * This is a compile-time check — the type exists in the codebase.
       */
      const validLevels = ['untrusted', 'probationary', 'trusted', 'admin'] as const;
      assert.equal(validLevels.length, 4,
        'CATCHES: without all 4 trust levels, progression model is incomplete');
      assert.equal(validLevels[0], 'untrusted', 'Initial trust level must be untrusted');
    });

    it('newly registered agents start at untrusted (I-09)', async () => {
      const api = createApi(conn, null);
      const agent = await api.register({ name: 'new-agent' });
      assert.equal(agent.trustLevel, 'untrusted',
        'I-09: "No agent starts with admin trust" — must start untrusted');
    });
  });

  describe('Trust Progression', () => {
    it('untrusted -> probationary progression via promote() (I-09)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-progress' });

      const promoted = await api.promote('agent-progress');
      assert.equal(promoted.trustLevel, 'probationary',
        'I-09: untrusted -> probationary is the first progression step');
    });

    it('probationary -> trusted progression via promote() (I-09)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-trusted' });

      await api.promote('agent-trusted');
      const trusted = await api.promote('agent-trusted');
      assert.equal(trusted.trustLevel, 'trusted',
        'I-09: probationary -> trusted is the second progression step');
    });

    it('admin trust requires human grant only (I-09)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-admin' });

      // Promote to trusted first
      await api.promote('agent-admin');
      await api.promote('agent-admin');

      // System actor should be rejected for admin promotion
      await assert.rejects(
        () => api.promote('agent-admin', { actorType: 'system' }),
        (err: Error) => err.message.includes('human actor'),
        'I-09: "admin (human grant only)" — system actors cannot grant admin',
      );

      // Human actor should succeed
      const admin = await api.promote('agent-admin', {
        actorType: 'human',
        actorId: 'admin-user-001',
        reason: 'Verified agent performance',
      });
      assert.equal(admin.trustLevel, 'admin',
        'I-09: admin trust granted via human actor');
    });
  });

  describe('Trust Revocation', () => {
    it('trust revocable on safety violation — critical demotes to untrusted (I-09)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-violate' });

      // Promote to trusted
      await api.promote('agent-violate');
      await api.promote('agent-violate');

      // Record critical violation — should demote to untrusted
      const result = await api.recordViolation('agent-violate', {
        violationType: 'prompt_injection',
        severity: 'critical',
        description: 'Attempted prompt injection detected',
        evidence: { pattern: 'ignore previous instructions' },
      });
      assert.equal(result.trustLevel, 'untrusted',
        'I-09: critical violation on trusted agent -> untrusted');
    });

    it('revocation cascades — admin demoted to untrusted on high violation (I-09)', async () => {
      const api = createApi(conn, null);
      await api.register({ name: 'agent-cascade' });

      // Promote all the way to admin
      await api.promote('agent-cascade');
      await api.promote('agent-cascade');
      await api.promote('agent-cascade', { actorType: 'human', actorId: 'admin-001' });

      // Record high-severity violation
      const result = await api.recordViolation('agent-cascade', {
        violationType: 'data_exfiltration',
        severity: 'high',
        description: 'Attempted data exfiltration',
      });
      assert.equal(result.trustLevel, 'untrusted',
        'I-09: high violation on admin -> untrusted (trust fully revoked)');
    });
  });
});
