/**
 * Contract tests for I-08 Agent Persistence (Sprint 1 Foundation Layer).
 * Validates SQLite-backed agent registry replacing ephemeral in-memory Map.
 *
 * Phase: Sprint 1 (Foundation Layer)
 * Spec ref: I-08 (Agent Identity Persistence), CF-014 (max agents),
 *           FM-10 (tenant isolation), CF-028 (name validation)
 *
 * Tests: 17 contract tests covering:
 *   - Register + persist verification
 *   - Cross-restart persistence (new AgentApiImpl with same DB)
 *   - CF-014 enforcement at 1,000 agents
 *   - Tenant isolation (tenant-A invisible to tenant-B)
 *   - Version immutability trigger
 *   - Name immutability trigger
 *   - ID immutability trigger
 *   - Retired terminal trigger
 *   - Status transitions (registered→paused, paused→registered, registered→retired, paused→retired)
 *   - Invalid transitions rejected
 *   - Duplicate name registration returns error
 *   - Agent with capabilities/domains stored and retrieved correctly
 *   - List returns only tenant-scoped agents
 *   - Trust escalation to admin blocked
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
  return { nowISO: () => '2026-03-23T10:00:00.000Z', nowMs: () => 1711184400000 };
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

describe('I-08 Agent Persistence — Contract Tests', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ─── Registration + Persistence ───

  it('register agent — verify persisted in core_agents table', async () => {
    const api = createApi(conn, null);
    const agent = await api.register({ name: 'agent-alpha', capabilities: ['web_search'], domains: ['commerce'] });

    assert.ok(agent.id, 'Agent should have an ID');
    assert.equal(agent.name, 'agent-alpha');
    assert.equal(agent.version, 1);
    assert.equal(agent.trustLevel, 'untrusted');
    assert.equal(agent.status, 'registered');
    assert.deepEqual([...agent.capabilities], ['web_search']);
    assert.deepEqual([...agent.domains], ['commerce']);

    // Verify in database directly
    const row = conn.get<{ id: string; name: string }>('SELECT id, name FROM core_agents WHERE name = ?', ['agent-alpha']);
    assert.ok(row);
    assert.equal(row.name, 'agent-alpha');
    assert.equal(row.id, agent.id);
  });

  it('register + shutdown (new AgentApiImpl with same DB) = same agent', async () => {
    const api1 = createApi(conn, null);
    const registered = await api1.register({ name: 'restart-agent', capabilities: ['code_execute'] });

    // Simulate engine restart — new AgentApiImpl, same connection
    const api2 = createApi(conn, null);
    const retrieved = await api2.get('restart-agent');

    assert.ok(retrieved, 'Agent must survive restart');
    assert.equal(retrieved.id, registered.id);
    assert.equal(retrieved.name, registered.name);
    assert.equal(retrieved.version, registered.version);
    assert.equal(retrieved.status, registered.status);
    assert.deepEqual([...retrieved.capabilities], ['code_execute']);
  });

  // ─── CF-014: Max Agents ───

  it('CF-014: enforcement at 1,000 agents — rejects 1,001st registration', async () => {
    const api = createApi(conn, null);

    // Bulk insert 1,000 agents directly for speed
    const now = '2026-03-23T10:00:00.000Z';
    conn.transaction(() => {
      for (let i = 0; i < 1_000; i++) {
        conn.run(
          `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
           VALUES (?, NULL, ?, 1, 'untrusted', 'registered', '[]', '[]', ?, ?)`,
          [`id-${i}`, `bulk-agent-${i}`, now, now],
        );
      }
    });

    // 1,001st should be rejected
    await assert.rejects(
      () => api.register({ name: 'agent-1001' }),
      (err: Error) => {
        assert.ok(err.message.includes('Maximum registered agents'));
        return true;
      },
    );
  });

  // ─── Tenant Isolation ───

  it('tenant isolation — tenant-A agent invisible to tenant-B', async () => {
    const apiA = createApi(conn, 'tenant-a');
    const apiB = createApi(conn, 'tenant-b');

    await apiA.register({ name: 'shared-name-agent' });

    // tenant-B cannot see tenant-A's agent
    const result = await apiB.get('shared-name-agent');
    assert.equal(result, null, 'Agent from tenant-A must not be visible to tenant-B');

    // tenant-B can register an agent with the same name
    const agentB = await apiB.register({ name: 'shared-name-agent' });
    assert.ok(agentB.id);
    assert.equal(agentB.name, 'shared-name-agent');
  });

  it('list returns only tenant-scoped agents', async () => {
    const apiA = createApi(conn, 'tenant-a');
    const apiB = createApi(conn, 'tenant-b');

    await apiA.register({ name: 'a-agent-1' });
    await apiA.register({ name: 'a-agent-2' });
    await apiB.register({ name: 'b-agent-1' });

    const listA = await apiA.list();
    const listB = await apiB.list();

    assert.equal(listA.length, 2, 'Tenant A should see 2 agents');
    assert.equal(listB.length, 1, 'Tenant B should see 1 agent');
    assert.ok(listA.every(a => a.name.startsWith('a-agent')));
    assert.equal(listB[0]!.name, 'b-agent-1');
  });

  // ─── Immutability Triggers ───

  it('version immutability — trigger fires on version change', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'version-test' });

    assert.throws(
      () => conn.run('UPDATE core_agents SET version = 2 WHERE name = ?', ['version-test']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_VERSION_IMMUTABLE'));
        return true;
      },
    );
  });

  it('name immutability — trigger fires on name change', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'name-test' });

    assert.throws(
      () => conn.run('UPDATE core_agents SET name = ? WHERE name = ?', ['new-name', 'name-test']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_NAME_IMMUTABLE'));
        return true;
      },
    );
  });

  it('ID immutability — trigger fires on id change', async () => {
    const api = createApi(conn, null);
    const agent = await api.register({ name: 'id-test' });

    assert.throws(
      () => conn.run('UPDATE core_agents SET id = ? WHERE id = ?', ['new-id', agent.id]),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_ID_IMMUTABLE'));
        return true;
      },
    );
  });

  it('retired terminal — trigger fires when modifying retired agent status', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retired-test' });
    await api.retire('retired-test');

    // Attempt to change status directly
    assert.throws(
      () => conn.run('UPDATE core_agents SET status = ? WHERE name = ?', ['active', 'retired-test']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_RETIRED_TERMINAL'));
        return true;
      },
    );
  });

  it('retired terminal — trigger fires when modifying retired agent trust', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retired-trust-test' });
    await api.retire('retired-trust-test');

    assert.throws(
      () => conn.run('UPDATE core_agents SET trust_level = ? WHERE name = ?', ['trusted', 'retired-trust-test']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_RETIRED_TERMINAL'));
        return true;
      },
    );
  });

  it('trust escalation to admin blocked by trigger', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'trust-escalation-test' });

    assert.throws(
      () => conn.run('UPDATE core_agents SET trust_level = ? WHERE name = ?', ['admin', 'trust-escalation-test']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'));
        return true;
      },
    );
  });

  // ─── Status Transitions ───

  it('status transition: registered → paused → registered', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'transition-agent' });

    let agent = await api.get('transition-agent');
    assert.equal(agent!.status, 'registered');

    await api.pause('transition-agent');
    agent = await api.get('transition-agent');
    assert.equal(agent!.status, 'paused');

    await api.resume('transition-agent');
    agent = await api.get('transition-agent');
    assert.equal(agent!.status, 'registered');
  });

  it('status transition: registered → retired (terminal)', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retire-from-registered' });
    await api.retire('retire-from-registered');

    const agent = await api.get('retire-from-registered');
    assert.equal(agent!.status, 'retired');
  });

  it('status transition: paused → retired (terminal)', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retire-from-paused' });
    await api.pause('retire-from-paused');
    await api.retire('retire-from-paused');

    const agent = await api.get('retire-from-paused');
    assert.equal(agent!.status, 'retired');
  });

  // ─── Invalid Transitions ───

  it('resume rejects non-paused agent', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'non-paused' });

    await assert.rejects(
      () => api.resume('non-paused'),
      (err: Error) => {
        assert.ok(err.message.includes('not paused'));
        return true;
      },
    );
  });

  it('pause rejects retired agent', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retired-pause' });
    await api.retire('retired-pause');

    await assert.rejects(
      () => api.pause('retired-pause'),
      (err: Error) => {
        assert.ok(err.message.includes('retired'));
        return true;
      },
    );
  });

  it('retire rejects already-retired agent', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'double-retire' });
    await api.retire('double-retire');

    await assert.rejects(
      () => api.retire('double-retire'),
      (err: Error) => {
        assert.ok(err.message.includes('already retired'));
        return true;
      },
    );
  });

  // ─── Duplicate Name ───

  it('duplicate name registration returns error', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'unique-agent' });

    await assert.rejects(
      () => api.register({ name: 'unique-agent' }),
      (err: Error) => {
        assert.ok(err.message.includes('already exists'));
        return true;
      },
    );
  });

  // ─── Capabilities + Domains ───

  it('agent with capabilities/domains stored and retrieved correctly', async () => {
    const api = createApi(conn, null);
    const agent = await api.register({
      name: 'cap-domain-agent',
      capabilities: ['web_search', 'code_execute', 'file_read'],
      domains: ['commerce', 'analytics'],
    });

    assert.deepEqual([...agent.capabilities], ['web_search', 'code_execute', 'file_read']);
    assert.deepEqual([...agent.domains], ['commerce', 'analytics']);

    // Verify via get()
    const retrieved = await api.get('cap-domain-agent');
    assert.ok(retrieved);
    assert.deepEqual([...retrieved.capabilities], ['web_search', 'code_execute', 'file_read']);
    assert.deepEqual([...retrieved.domains], ['commerce', 'analytics']);
  });
});
