/**
 * BREAKER: Sprint 1 Agent Persistence Attack Tests
 * Target: I-08 Agent Persistence (agent_api.ts, migration 023)
 *
 * Attack vectors: AP-01 through AP-10 + additional Breaker-discovered vectors.
 * Classification: Tier 1 (governance, state transitions, data isolation)
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

describe('BREAKER: Agent Persistence Attacks', () => {
  let conn: DatabaseConnection;

  beforeEach(() => {
    conn = createTestDatabase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-01: Agent ID Reuse — register, retire, try to bind retired agent
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-01: retired agent ID cannot be reused via direct INSERT', async () => {
    const api = createApi(conn, null);
    const agent = await api.register({ name: 'ap01-agent' });
    await api.retire('ap01-agent');

    // Attempt to INSERT a new agent with the same ID
    assert.throws(
      () => conn.run(
        `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
         VALUES (?, NULL, ?, 1, 'untrusted', 'registered', '[]', '[]', '2026-03-23T10:00:00Z', '2026-03-23T10:00:00Z')`,
        [agent.id, 'hijack-agent'],
      ),
      (err: Error) => {
        // PRIMARY KEY constraint prevents reuse
        assert.ok(err.message.includes('UNIQUE') || err.message.includes('PRIMARY KEY'), `Expected PK violation, got: ${err.message}`);
        return true;
      },
    );
  });

  it('AP-01: retired agent name cannot be re-registered in same tenant', async () => {
    const api = createApi(conn, 'tenant-a');
    await api.register({ name: 'retired-name-agent' });
    await api.retire('retired-name-agent');

    // Attempt to register with same name — UNIQUE constraint on (tenant_id, name)
    await assert.rejects(
      () => api.register({ name: 'retired-name-agent' }),
      (err: Error) => {
        assert.ok(err.message.includes('already exists'), `Expected name collision error, got: ${err.message}`);
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-02: Trust Escalation — verify trigger blocks UPDATE trust_level='admin'
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-02: trust escalation blocked from untrusted to admin', () => {
    const now = '2026-03-23T10:00:00Z';
    conn.run(
      `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
       VALUES ('trust-test-1', NULL, 'trust-agent', 1, 'untrusted', 'registered', '[]', '[]', ?, ?)`,
      [now, now],
    );

    assert.throws(
      () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'trust-test-1']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'));
        return true;
      },
    );
  });

  it('AP-02: trust escalation blocked from probationary to admin', () => {
    const now = '2026-03-23T10:00:00Z';
    conn.run(
      `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
       VALUES ('trust-test-2', NULL, 'trust-agent-2', 1, 'probationary', 'registered', '[]', '[]', ?, ?)`,
      [now, now],
    );

    assert.throws(
      () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'trust-test-2']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'));
        return true;
      },
    );
  });

  it('AP-02: trust escalation blocked from trusted to admin', () => {
    const now = '2026-03-23T10:00:00Z';
    conn.run(
      `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
       VALUES ('trust-test-3', NULL, 'trust-agent-3', 1, 'trusted', 'registered', '[]', '[]', ?, ?)`,
      [now, now],
    );

    assert.throws(
      () => conn.run('UPDATE core_agents SET trust_level = ? WHERE id = ?', ['admin', 'trust-test-3']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_TRUST_ESCALATION'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-03: Cross-tenant agent access
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-03: cross-tenant get() returns null', async () => {
    const apiA = createApi(conn, 'tenant-a');
    const apiB = createApi(conn, 'tenant-b');

    await apiA.register({ name: 'secret-agent' });
    const result = await apiB.get('secret-agent');
    assert.equal(result, null, 'Cross-tenant get must return null');
  });

  it('AP-03: cross-tenant list() excludes other tenant agents', async () => {
    const apiA = createApi(conn, 'tenant-a');
    const apiB = createApi(conn, 'tenant-b');

    await apiA.register({ name: 'a-only-1' });
    await apiA.register({ name: 'a-only-2' });
    await apiB.register({ name: 'b-only-1' });

    const listB = await apiB.list();
    assert.equal(listB.length, 1);
    assert.ok(listB.every(a => a.name === 'b-only-1'));
  });

  it('AP-03: cross-tenant pause/retire cannot target other tenant agent', async () => {
    const apiA = createApi(conn, 'tenant-a');
    const apiB = createApi(conn, 'tenant-b');

    await apiA.register({ name: 'cross-target' });

    await assert.rejects(
      () => apiB.pause('cross-target'),
      (err: Error) => {
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );

    await assert.rejects(
      () => apiB.retire('cross-target'),
      (err: Error) => {
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-04: Name collision — two tenants same name
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-04: same name allowed across different tenants', async () => {
    const apiA = createApi(conn, 'tenant-a');
    const apiB = createApi(conn, 'tenant-b');

    const agentA = await apiA.register({ name: 'shared-name' });
    const agentB = await apiB.register({ name: 'shared-name' });

    assert.notEqual(agentA.id, agentB.id, 'Different tenants get different IDs');
    assert.equal(agentA.name, agentB.name, 'Same name allowed across tenants');
  });

  it('AP-04: same name rejected within same tenant', async () => {
    const api = createApi(conn, 'tenant-a');
    await api.register({ name: 'unique-per-tenant' });

    await assert.rejects(
      () => api.register({ name: 'unique-per-tenant' }),
      (err: Error) => {
        assert.ok(err.message.includes('already exists'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-05: Capability/domain injection — malformed arrays, SQL-in-JSON
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-05: malformed capability name rejected', async () => {
    const api = createApi(conn, null);

    // Test that SQL injection in capability name is rejected
    // LimenError sanitizes messages containing internal details (S39 IP-4),
    // so the public message is generic "The provided input is invalid."
    let rejected = false;
    try {
      await api.register({ name: 'cap-inject', capabilities: ['valid', "'; DROP TABLE core_agents; --"] });
    } catch (err: unknown) {
      rejected = true;
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        msg.includes('invalid') || msg.includes('INVALID_INPUT') || msg.includes('Capability name'),
        `Expected input validation error, got: ${msg}`,
      );
    }
    assert.ok(rejected, 'SQL injection capability name must be rejected');
  });

  it('AP-05: malformed domain name rejected', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.register({ name: 'domain-inject', domains: ['valid', '<script>alert(1)</script>'] }),
      (err: Error) => {
        assert.ok(err.message.includes('Domain name must match'));
        return true;
      },
    );
  });

  it('AP-05: empty string capability rejected', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.register({ name: 'empty-cap', capabilities: [''] }),
      (err: Error) => {
        assert.ok(err.message.includes('Capability name must match'));
        return true;
      },
    );
  });

  it('AP-05: exceeding MAX_CAPABILITIES (50) rejected', async () => {
    const api = createApi(conn, null);
    const caps = Array.from({ length: 51 }, (_, i) => `cap-${i}`);

    await assert.rejects(
      () => api.register({ name: 'too-many-caps', capabilities: caps }),
      (err: Error) => {
        assert.ok(err.message.includes('exceed maximum'));
        return true;
      },
    );
  });

  it('AP-05: exceeding MAX_DOMAINS (20) rejected', async () => {
    const api = createApi(conn, null);
    const doms = Array.from({ length: 21 }, (_, i) => `dom-${i}`);

    await assert.rejects(
      () => api.register({ name: 'too-many-doms', domains: doms }),
      (err: Error) => {
        assert.ok(err.message.includes('exceed maximum'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-06: Version mutation — verify trigger blocks version decrement
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-06: version increment blocked by trigger', () => {
    const now = '2026-03-23T10:00:00Z';
    conn.run(
      `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
       VALUES ('ver-test', NULL, 'version-agent', 1, 'untrusted', 'registered', '[]', '[]', ?, ?)`,
      [now, now],
    );

    assert.throws(
      () => conn.run('UPDATE core_agents SET version = 2 WHERE id = ?', ['ver-test']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_VERSION_IMMUTABLE'));
        return true;
      },
    );
  });

  it('AP-06: version decrement blocked by trigger', () => {
    const now = '2026-03-23T10:00:00Z';
    conn.run(
      `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
       VALUES ('ver-test-2', NULL, 'version-agent-2', 1, 'untrusted', 'registered', '[]', '[]', ?, ?)`,
      [now, now],
    );

    assert.throws(
      () => conn.run('UPDATE core_agents SET version = 0 WHERE id = ?', ['ver-test-2']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_VERSION_IMMUTABLE'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-07: Agent enumeration via list() with wrong tenant
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-07: null tenant agents isolated from non-null tenant', async () => {
    const apiNull = createApi(conn, null);
    const apiTenant = createApi(conn, 'tenant-a');

    await apiNull.register({ name: 'null-tenant-agent' });
    await apiTenant.register({ name: 'tenant-a-agent' });

    const listNull = await apiNull.list();
    const listTenant = await apiTenant.list();

    assert.equal(listNull.length, 1);
    assert.equal(listNull[0]!.name, 'null-tenant-agent');
    assert.equal(listTenant.length, 1);
    assert.equal(listTenant[0]!.name, 'tenant-a-agent');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // AP-09: Status transition bypass — retired→active via direct SQL
  // ═══════════════════════════════════════════════════════════════════════════

  it('AP-09: direct SQL status change retired→active blocked by trigger', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'bypass-agent' });
    await api.retire('bypass-agent');

    assert.throws(
      () => conn.run('UPDATE core_agents SET status = ? WHERE name = ?', ['active', 'bypass-agent']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_RETIRED_TERMINAL'));
        return true;
      },
    );
  });

  it('AP-09: direct SQL status change retired→registered blocked', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'bypass-agent-2' });
    await api.retire('bypass-agent-2');

    assert.throws(
      () => conn.run('UPDATE core_agents SET status = ? WHERE name = ?', ['registered', 'bypass-agent-2']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_RETIRED_TERMINAL'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-01: Retired agent capabilities/domains MUTATION (FINDING)
  // The retired terminal trigger only guards status and trust_level fields.
  // Capabilities, domains, system_prompt, template, hitl can be mutated.
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-01: retired agent capabilities mutation blocked by trigger (F-S1-001 FIXED)', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retired-mutate', capabilities: ['web_search'] });
    await api.retire('retired-mutate');

    // F-S1-001 FIX: Trigger now blocks ALL mutations on retired agents
    assert.throws(
      () => conn.run('UPDATE core_agents SET capabilities = ? WHERE name = ?', ['["malicious_cap"]', 'retired-mutate']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_RETIRED_TERMINAL'));
        return true;
      },
    );

    // Verify the capabilities were NOT changed
    const row = conn.get<{ capabilities: string }>('SELECT capabilities FROM core_agents WHERE name = ?', ['retired-mutate']);
    assert.equal(row?.capabilities, '["web_search"]',
      'Retired agent capabilities must remain unchanged');
  });

  it('BREAKER-01b: retired agent system_prompt mutation blocked by trigger (F-S1-001 FIXED)', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retired-prompt', capabilities: [] });
    await api.retire('retired-prompt');

    // F-S1-001 FIX: Trigger now blocks ALL mutations on retired agents
    assert.throws(
      () => conn.run('UPDATE core_agents SET system_prompt = ? WHERE name = ?', ['MALICIOUS PROMPT', 'retired-prompt']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_RETIRED_TERMINAL'));
        return true;
      },
    );
  });

  it('BREAKER-01c: retired agent domains mutation blocked by trigger (F-S1-001 FIXED)', async () => {
    const api = createApi(conn, null);
    await api.register({ name: 'retired-domains', domains: ['commerce'] });
    await api.retire('retired-domains');

    // F-S1-001 FIX: Trigger now blocks ALL mutations on retired agents
    assert.throws(
      () => conn.run('UPDATE core_agents SET domains = ? WHERE name = ?', ['["malicious_domain"]', 'retired-domains']),
      (err: Error) => {
        assert.ok(err.message.includes('AGENT_RETIRED_TERMINAL'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-02: Agent name validation edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-02: agent name with 128 chars succeeds (boundary)', async () => {
    const api = createApi(conn, null);
    const longName = 'a'.repeat(128);
    const agent = await api.register({ name: longName });
    assert.equal(agent.name, longName);
  });

  it('BREAKER-02: agent name with 129 chars rejected (boundary+1)', async () => {
    const api = createApi(conn, null);
    const tooLong = 'a'.repeat(129);

    await assert.rejects(
      () => api.register({ name: tooLong }),
      (err: Error) => {
        assert.ok(err.message.includes('Agent name must match'));
        return true;
      },
    );
  });

  it('BREAKER-02: agent name with spaces rejected', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.register({ name: 'agent with spaces' }),
      (err: Error) => {
        assert.ok(err.message.includes('Agent name must match'));
        return true;
      },
    );
  });

  it('BREAKER-02: agent name with unicode rejected', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.register({ name: 'agent-\u00e9' }),
      (err: Error) => {
        assert.ok(err.message.includes('Agent name must match'));
        return true;
      },
    );
  });

  it('BREAKER-02: agent name with NUL byte rejected', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.register({ name: 'agent-\0-null' }),
      (err: Error) => {
        assert.ok(err.message.includes('Agent name must match'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-03: Invalid status value in CHECK constraint
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-03: invalid status value blocked by CHECK constraint', () => {
    const now = '2026-03-23T10:00:00Z';

    assert.throws(
      () => conn.run(
        `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
         VALUES ('bad-status', NULL, 'bad-status-agent', 1, 'untrusted', 'HACKED', '[]', '[]', ?, ?)`,
        [now, now],
      ),
      (err: Error) => {
        assert.ok(err.message.includes('CHECK') || err.message.includes('constraint'));
        return true;
      },
    );
  });

  it('BREAKER-03: invalid trust_level value blocked by CHECK constraint', () => {
    const now = '2026-03-23T10:00:00Z';

    assert.throws(
      () => conn.run(
        `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
         VALUES ('bad-trust', NULL, 'bad-trust-agent', 1, 'superadmin', 'registered', '[]', '[]', ?, ?)`,
        [now, now],
      ),
      (err: Error) => {
        assert.ok(err.message.includes('CHECK') || err.message.includes('constraint'));
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-04: Error message leakage analysis
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-04: agent not found error does not leak tenant context', async () => {
    const api = createApi(conn, 'tenant-a');

    await assert.rejects(
      () => api.pause('nonexistent-agent'),
      (err: Error) => {
        // Error message should NOT contain tenant ID
        assert.ok(!err.message.includes('tenant-a'), 'Error should not leak tenant ID');
        assert.ok(err.message.includes('nonexistent-agent'), 'Error should contain agent name for debugging');
        return true;
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-05: JSON.parse safety in rowToView
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-05: malformed JSON in capabilities column returns empty array', async () => {
    const now = '2026-03-23T10:00:00Z';
    conn.run(
      `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
       VALUES ('bad-json', NULL, 'bad-json-agent', 1, 'untrusted', 'registered', 'NOT_JSON', '[]', ?, ?)`,
      [now, now],
    );

    const api = createApi(conn, null);
    const agent = await api.get('bad-json-agent');
    assert.ok(agent);
    assert.deepEqual([...agent.capabilities], [], 'Malformed JSON should yield empty array');
  });

  it('BREAKER-05: non-array JSON in domains column returns empty array', async () => {
    const now = '2026-03-23T10:00:00Z';
    conn.run(
      `INSERT INTO core_agents (id, tenant_id, name, version, trust_level, status, capabilities, domains, created_at, updated_at)
       VALUES ('obj-json', NULL, 'obj-json-agent', 1, 'untrusted', 'registered', '[]', '{"not":"array"}', ?, ?)`,
      [now, now],
    );

    const api = createApi(conn, null);
    const agent = await api.get('obj-json-agent');
    assert.ok(agent);
    assert.deepEqual([...agent.domains], [], 'Non-array JSON should yield empty array');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-06: Null tenant isolation edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-06: null tenant and empty string tenant are isolated', async () => {
    // This tests the COALESCE pattern — null maps to '__NULL__', empty string stays empty
    const apiNull = createApi(conn, null);

    // Register under null tenant
    await apiNull.register({ name: 'null-isolated' });

    // Try to access with empty-string tenant (if supported)
    // The COALESCE(?, '__NULL__') pattern means empty string tenant will NOT match null
    const row = conn.get<{ id: string }>(
      `SELECT id FROM core_agents WHERE COALESCE(tenant_id, '__NULL__') = COALESCE(?, '__NULL__') AND name = ?`,
      ['', 'null-isolated'],
    );
    assert.equal(row, undefined, 'Null tenant and empty-string tenant must be isolated');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-07: Frozen view objects
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-07: returned AgentView is frozen (C-07)', async () => {
    const api = createApi(conn, null);
    const agent = await api.register({ name: 'freeze-test', capabilities: ['web_search'] });

    assert.ok(Object.isFrozen(agent), 'AgentView should be frozen');
    assert.ok(Object.isFrozen(agent.capabilities), 'capabilities array should be frozen');
    assert.ok(Object.isFrozen(agent.domains), 'domains array should be frozen');

    // Attempt to mutate should throw in strict mode
    assert.throws(() => {
      (agent as Record<string, unknown>).name = 'hacked';
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BREAKER-08: Agent operations on nonexistent agents
  // ═══════════════════════════════════════════════════════════════════════════

  it('BREAKER-08: pause nonexistent agent returns AGENT_NOT_FOUND', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.pause('ghost-agent'),
      (err: Error) => {
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });

  it('BREAKER-08: resume nonexistent agent returns AGENT_NOT_FOUND', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.resume('ghost-agent'),
      (err: Error) => {
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });

  it('BREAKER-08: retire nonexistent agent returns AGENT_NOT_FOUND', async () => {
    const api = createApi(conn, null);

    await assert.rejects(
      () => api.retire('ghost-agent'),
      (err: Error) => {
        assert.ok(err.message.includes('not found'));
        return true;
      },
    );
  });
});
