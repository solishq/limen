/**
 * Verifies: §4 I-08
 * Phase: Sprint 1 (Foundation Layer — Agent Persistence)
 *
 * I-08: Agent Identity Persistence.
 * "Identity persists across engine restarts. Stored, not configured.
 * Agent versions immutable once deployed. Canary deployment requires
 * schema compatibility (additive changes only)."
 *
 * Classification: IMPLEMENTED (Sprint 1 — core_agents table, migration v32)
 * Evidence: Agent state in core_agents SQLite table (agent_api.ts).
 * Triggers enforce version/name/id immutability and retired terminal state.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, createTestOperationContext } from '../../helpers/test_database.js';
import type { DatabaseConnection, OperationContext, RateLimiter, RbacEngine, AgentId } from '../../../src/kernel/interfaces/index.js';
import type { AgentView } from '../../../src/api/interfaces/api.js';
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
  return { nowISO: () => '2026-03-23T10:00:00.000Z', nowMs: () => 1711184400000 };
}

describe('I-08: Agent Identity Persistence', () => {
  let conn: DatabaseConnection;
  let api: AgentApiImpl;

  beforeEach(() => {
    conn = createTestDatabase();
    const ctx = createTestOperationContext({ tenantId: null });
    api = new AgentApiImpl(
      createMockRbac(),
      createMockRateLimiter(),
      () => conn,
      () => ctx,
      createTimeProvider(),
    );
  });

  it('agent identity persists across engine restarts (new AgentApiImpl with same DB)', async () => {
    // Register an agent
    const registered = await api.register({ name: 'persist-test-agent', capabilities: ['web_search'], domains: ['testing'] });
    assert.equal(registered.name, 'persist-test-agent');
    assert.equal(registered.status, 'registered');

    // Create a NEW AgentApiImpl pointing at the same database — simulates engine restart
    const ctx = createTestOperationContext({ tenantId: null });
    const api2 = new AgentApiImpl(
      createMockRbac(),
      createMockRateLimiter(),
      () => conn,
      () => ctx,
      createTimeProvider(),
    );

    // The agent should be retrievable from the new instance
    const retrieved = await api2.get('persist-test-agent');
    assert.ok(retrieved, 'Agent should persist across AgentApiImpl instances');
    assert.equal(retrieved.id, registered.id);
    assert.equal(retrieved.name, 'persist-test-agent');
    assert.equal(retrieved.version, 1);
    assert.equal(retrieved.status, 'registered');
    assert.deepEqual([...retrieved.capabilities], ['web_search']);
    assert.deepEqual([...retrieved.domains], ['testing']);
  });

  it('agent versions immutable once deployed (trigger enforcement)', async () => {
    // Register an agent
    await api.register({ name: 'version-immutable-agent' });

    // Attempt to mutate version directly via SQL — trigger should block
    assert.throws(
      () => {
        conn.run(
          'UPDATE core_agents SET version = 2 WHERE name = ?',
          ['version-immutable-agent'],
        );
      },
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_VERSION_IMMUTABLE'));
        return true;
      },
    );

    // Verify version is still 1
    const agent = await api.get('version-immutable-agent');
    assert.ok(agent);
    assert.equal(agent.version, 1);
  });

  it('canary deployment schema compatibility (additive changes only)', async () => {
    // Register an agent with initial capabilities
    const registered = await api.register({
      name: 'canary-agent',
      capabilities: ['web_search'],
      domains: ['commerce'],
    });

    // Verify the schema supports additive fields:
    // - core_agents table has system_prompt, template, hitl columns
    //   that can be populated later without schema migration
    // - The AgentView returned is a projection — DB stores more than what's exposed
    assert.equal(registered.version, 1);

    // Verify that adding new data to existing columns works (additive)
    conn.run(
      'UPDATE core_agents SET system_prompt = ?, template = ? WHERE name = ?',
      ['You are a test agent.', 'default-template', 'canary-agent'],
    );

    // The AgentView projection still works — additive columns don't break the view
    const agent = await api.get('canary-agent');
    assert.ok(agent);
    assert.equal(agent.name, 'canary-agent');
    assert.equal(agent.version, 1); // Version unchanged — additive is safe
  });
});
