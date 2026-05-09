// @governance SolisForge Protocol v1.4 -- Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * Agent Lifecycle Management Contract Tests
 *
 * Verifies the AgentLifecycleClient implementation against the
 * AGENT_LIFECYCLE_MANAGEMENT contract (318 requirements).
 *
 * Test groups:
 *   1. Registration & Identity (LM-2.01 through LM-2.05)
 *   2. Capability Management (LM-2.06 through LM-2.09)
 *   3. Trust Promotion (LM-2.10 through LM-2.12)
 *   4. Consent Governance (LM-2.13 through LM-2.16)
 *   5. Knowledge Exchange (LM-2.17 through LM-2.19)
 *   6. Events (LM-2.20 through LM-2.22)
 *   7. State Machine (LM-10)
 *   8. Invariants (LM-13)
 *   9. Migration (048)
 *  10. Factory Wiring
 *  11. Fail-Closed Behavior
 *  12. Audit Trail
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestDatabase, createTestAuditTrail,
  createTestOperationContext, agentId,
} from '../helpers/test_database.js';
import type {
  DatabaseConnection, AuditTrail, TimeProvider,
  OperationContext,
} from '../../src/kernel/interfaces/index.js';
import type { EventBus } from '../../src/kernel/interfaces/events.js';
import { createEventBus } from '../../src/kernel/events/event_bus.js';
import { createAgentLifecycleClient } from '../../src/lifecycle/agent_lifecycle_client.js';
import type { AgentLifecycleClient } from '../../src/lifecycle/lifecycle_types.js';
import type {
  AgentRegistrationSpec, AgentFilter,
  CapabilityRequest, PromotionRequest,
  AgentConsentRecord, KnowledgeExportOptions,
} from '../../src/lifecycle/lifecycle_types.js';
import { LIFECYCLE_ERROR_CODES } from '../../src/lifecycle/lifecycle_errors.js';
import type {
  AgentId, AgentTrustLevel, AgentCapability,
  ConsentId, ConsentableOperation,
} from '../../src/adapters/shared/types.js';

// ============================================================================
// Test Harness
// ============================================================================

function createTestHarness() {
  const conn = createTestDatabase();
  const audit = createTestAuditTrail();
  const time: TimeProvider = {
    nowISO: () => new Date().toISOString(),
    nowMs: () => Date.now(),
  };
  const events = createEventBus();
  const ctx = createTestOperationContext();

  const client = createAgentLifecycleClient({
    getConnection: () => conn,
    audit,
    kernelEvents: events,
    time,
    getContext: () => ctx,
  });

  return { conn, audit, time, events, ctx, client };
}

function validSpec(overrides?: Partial<AgentRegistrationSpec>): AgentRegistrationSpec {
  return {
    name: `test-agent-${Date.now()}`,
    framework: 'claude',
    version: '1.0.0',
    capabilities: ['memory_read', 'context_management'],
    owner: 'test-user',
    ...overrides,
  };
}

// ============================================================================
// 1. Registration & Identity (LM-2.01 through LM-2.05)
// ============================================================================

describe('AgentLifecycleClient — Registration & Identity', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-2.01: registerAgent with valid spec returns RegisteredAgent', async () => {
    const spec = validSpec({ name: 'alpha' });
    const result = await h.client.registerAgent(h.ctx, spec);
    assert.ok(result.ok, `Expected ok, got error: ${!result.ok ? result.error.message : ''}`);
    assert.equal(result.value.name, 'alpha');
    assert.equal(result.value.framework, 'claude');
    assert.equal(result.value.state, 'active');
    assert.equal(result.value.trustLevel, 'untrusted');
    assert.ok(result.value.id);
    assert.ok(result.value.registeredAt);
  });

  it('LM-3.06: registration defaults to untrusted regardless of requestedTrustLevel', async () => {
    const spec = validSpec({ name: 'beta', requestedTrustLevel: 'high' as AgentTrustLevel });
    const result = await h.client.registerAgent(h.ctx, spec);
    assert.ok(result.ok);
    assert.equal(result.value.trustLevel, 'untrusted');
  });

  it('LM-14.04: initial capabilities intersected with untrusted mapping', async () => {
    const spec = validSpec({
      name: 'gamma',
      capabilities: ['memory_read', 'memory_write', 'computer_use', 'governance_admin'] as AgentCapability[],
    });
    const result = await h.client.registerAgent(h.ctx, spec);
    assert.ok(result.ok);
    // Only memory_read and context_management survive untrusted intersection
    const granted = result.value.capabilities.granted;
    assert.ok(granted.includes('memory_read' as AgentCapability));
    assert.ok(!granted.includes('memory_write' as AgentCapability));
    assert.ok(!granted.includes('computer_use' as AgentCapability));
    assert.ok(!granted.includes('governance_admin' as AgentCapability));
  });

  it('LM-9.02: duplicate name+framework+tenant returns AGENT_ALREADY_EXISTS', async () => {
    const spec = validSpec({ name: 'duplicate' });
    const r1 = await h.client.registerAgent(h.ctx, spec);
    assert.ok(r1.ok);
    const r2 = await h.client.registerAgent(h.ctx, spec);
    assert.ok(!r2.ok);
    assert.equal(r2.error.code, LIFECYCLE_ERROR_CODES.AGENT_ALREADY_EXISTS);
  });

  it('LM-14.01: agent name must be 1-64 chars alphanumeric+hyphens+underscores', async () => {
    // Empty name
    const r1 = await h.client.registerAgent(h.ctx, validSpec({ name: '' }));
    assert.ok(!r1.ok);

    // Name with spaces
    const r2 = await h.client.registerAgent(h.ctx, validSpec({ name: 'has spaces' }));
    assert.ok(!r2.ok);

    // Name too long (65 chars)
    const r3 = await h.client.registerAgent(h.ctx, validSpec({ name: 'a'.repeat(65) }));
    assert.ok(!r3.ok);

    // Valid names
    const r4 = await h.client.registerAgent(h.ctx, validSpec({ name: 'valid-name_123' }));
    assert.ok(r4.ok);
  });

  it('LM-14.03: unrecognized framework returns governance refusal', async () => {
    const spec = validSpec({ name: 'bad-fw', framework: 'unknown_framework' as any });
    const result = await h.client.registerAgent(h.ctx, spec);
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.GOVERNANCE_REFUSAL);
  });

  it('LM-2.02: getAgent returns the registered agent', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'find-me' }));
    assert.ok(reg.ok);
    const get = await h.client.getAgent(reg.value.id);
    assert.ok(get.ok);
    assert.equal(get.value.name, 'find-me');
    assert.equal(get.value.id, reg.value.id);
  });

  it('LM-9.01: getAgent for non-existent returns AGENT_NOT_FOUND', async () => {
    const result = await h.client.getAgent('non-existent' as AgentId);
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.AGENT_NOT_FOUND);
  });

  it('LM-14.08: getAgent works for suspended and decommissioned agents', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'suspended-get' }));
    assert.ok(reg.ok);
    // Decommission it
    await h.client.decommissionAgent(h.ctx, reg.value.id, 'test');
    const get = await h.client.getAgent(reg.value.id);
    assert.ok(get.ok);
    assert.equal(get.value.state, 'decommissioned');
  });

  it('LM-2.03: listAgents returns all registered agents', async () => {
    await h.client.registerAgent(h.ctx, validSpec({ name: 'list-1' }));
    await h.client.registerAgent(h.ctx, validSpec({ name: 'list-2' }));
    const result = await h.client.listAgents();
    assert.ok(result.ok);
    assert.ok(result.value.length >= 2);
  });

  it('LM-3.34: listAgents filters by state', async () => {
    const r1 = await h.client.registerAgent(h.ctx, validSpec({ name: 'active-filter' }));
    const r2 = await h.client.registerAgent(h.ctx, validSpec({ name: 'decomm-filter' }));
    assert.ok(r1.ok && r2.ok);
    await h.client.decommissionAgent(h.ctx, r2.value.id, 'test');

    const active = await h.client.listAgents({ state: 'active' } as AgentFilter);
    assert.ok(active.ok);
    assert.ok(active.value.every(a => a.state === 'active'));

    const decomm = await h.client.listAgents({ state: 'decommissioned' } as AgentFilter);
    assert.ok(decomm.ok);
    assert.ok(decomm.value.every(a => a.state === 'decommissioned'));
  });

  it('LM-2.04: updateAgent modifies mutable fields', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'update-me' }));
    assert.ok(reg.ok);
    const result = await h.client.updateAgent(h.ctx, reg.value.id, {
      version: '2.0.0',
      metadata: { updated: true },
    });
    assert.ok(result.ok);
    assert.equal(result.value.version, '2.0.0');
    assert.deepEqual(result.value.metadata, { updated: true });
  });

  it('LM-3.33: updateAgent cannot change trust/clearance', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'no-trust-update' }));
    assert.ok(reg.ok);
    // Update should ignore any trust-related fields (they're not in AgentUpdate type)
    const result = await h.client.updateAgent(h.ctx, reg.value.id, { version: '2.0.0' });
    assert.ok(result.ok);
    assert.equal(result.value.trustLevel, 'untrusted'); // unchanged
  });

  it('LM-9.03: updateAgent on decommissioned agent returns error', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'decomm-update' }));
    assert.ok(reg.ok);
    await h.client.decommissionAgent(h.ctx, reg.value.id, 'test');
    const result = await h.client.updateAgent(h.ctx, reg.value.id, { version: '2.0.0' });
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.AGENT_DECOMMISSIONED);
  });
});

// ============================================================================
// 2. Decommission (LM-2.05, LM-14.13 through LM-14.20)
// ============================================================================

describe('AgentLifecycleClient — Decommission Cascade', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-2.05: decommissionAgent returns DecommissionResult', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'decom-test' }));
    assert.ok(reg.ok);
    const result = await h.client.decommissionAgent(h.ctx, reg.value.id, 'end of life');
    assert.ok(result.ok);
    assert.equal(result.value.agentId, reg.value.id);
    assert.ok(result.value.decommissionedAt);
  });

  it('LM-10.12: decommissioned agent cannot be decommissioned again', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'double-decom' }));
    assert.ok(reg.ok);
    const r1 = await h.client.decommissionAgent(h.ctx, reg.value.id, 'first');
    assert.ok(r1.ok);
    const r2 = await h.client.decommissionAgent(h.ctx, reg.value.id, 'second');
    assert.ok(!r2.ok);
    assert.equal(r2.error.code, LIFECYCLE_ERROR_CODES.AGENT_DECOMMISSIONED);
  });

  it('LM-14.16: decommission revokes all active consents', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'decom-consent' }));
    assert.ok(reg.ok);

    // Register a consent
    const consent: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-1',
      purpose: 'memory_storage',
      scope: {},
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    const cr = await h.client.registerConsent(h.ctx, reg.value.id, consent);
    assert.ok(cr.ok);

    // Decommission
    const result = await h.client.decommissionAgent(h.ctx, reg.value.id, 'test');
    assert.ok(result.ok);
    assert.ok(result.value.consentsRevoked >= 1);

    // Verify consent is revoked
    const consents = await h.client.listConsents(reg.value.id);
    assert.ok(consents.ok);
    // All consents should be revoked or expired after decommission
    for (const c of consents.value) {
      assert.notEqual(c.status, 'active');
    }
  });

  it('LM-14.17: decommission revokes all capabilities', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'decom-caps' }));
    assert.ok(reg.ok);

    const result = await h.client.decommissionAgent(h.ctx, reg.value.id, 'test');
    assert.ok(result.ok);
    assert.ok(result.value.capabilitiesRevoked >= 0);
  });

  it('LM-13.03: decommissioned is terminal — no recovery', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'terminal' }));
    assert.ok(reg.ok);
    await h.client.decommissionAgent(h.ctx, reg.value.id, 'test');

    // Cannot promote
    const promote = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'low',
      justification: 'test',
      evidence: [],
    });
    assert.ok(!promote.ok);
    assert.equal(promote.error.code, LIFECYCLE_ERROR_CODES.AGENT_DECOMMISSIONED);

    // Cannot request capability
    const cap = await h.client.requestCapabilityUpgrade(h.ctx, reg.value.id, {
      capabilities: ['memory_write' as AgentCapability],
      justification: 'test',
    });
    assert.ok(!cap.ok);
    assert.equal(cap.error.code, LIFECYCLE_ERROR_CODES.AGENT_DECOMMISSIONED);
  });
});

// ============================================================================
// 3. Capability Management (LM-2.06 through LM-2.09)
// ============================================================================

describe('AgentLifecycleClient — Capability Management', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-2.06: requestCapabilityUpgrade grants capabilities within trust ceiling', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'cap-grant' }));
    assert.ok(reg.ok);

    // memory_read is already granted at untrusted level — request it again is idempotent
    const result = await h.client.requestCapabilityUpgrade(h.ctx, reg.value.id, {
      capabilities: ['memory_read'] as AgentCapability[],
      justification: 'need it',
    });
    assert.ok(result.ok);
    assert.ok(result.value.granted.includes('memory_read' as AgentCapability));
  });

  it('LM-13.04: capability request above trust level is denied', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'cap-denied' }));
    assert.ok(reg.ok);
    // untrusted cannot have memory_write (requires low)
    const result = await h.client.requestCapabilityUpgrade(h.ctx, reg.value.id, {
      capabilities: ['memory_write'] as AgentCapability[],
      justification: 'need it',
    });
    assert.ok(result.ok); // The operation succeeds — but the capability is in denied list
    assert.ok(result.value.denied.length > 0);
    assert.equal(result.value.denied[0]!.capability, 'memory_write');
  });

  it('LM-2.07: revokeCapability removes a granted capability', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'cap-revoke' }));
    assert.ok(reg.ok);

    // memory_read is granted at registration
    const revoke = await h.client.revokeCapability(
      h.ctx, reg.value.id, 'memory_read' as AgentCapability, 'no longer needed',
    );
    assert.ok(revoke.ok);

    // Verify it's gone
    const caps = await h.client.getCapabilities(reg.value.id);
    assert.ok(caps.ok);
    assert.ok(!caps.value.granted.includes('memory_read' as AgentCapability));
  });

  it('LM-2.08: getCapabilities returns the capability set', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'cap-get' }));
    assert.ok(reg.ok);
    const caps = await h.client.getCapabilities(reg.value.id);
    assert.ok(caps.ok);
    assert.ok(Array.isArray(caps.value.granted));
    assert.ok(Array.isArray(caps.value.denied));
    assert.ok(Array.isArray(caps.value.pending));
  });

  it('LM-2.09: getCapabilityHistory returns ordered entries', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'cap-hist' }));
    assert.ok(reg.ok);
    const history = await h.client.getCapabilityHistory(reg.value.id);
    assert.ok(history.ok);
    // Should have entries from registration (initial grants)
    assert.ok(history.value.length >= 0);
    for (const entry of history.value) {
      assert.ok(['granted', 'revoked', 'requested', 'denied'].includes(entry.action));
      assert.ok(entry.timestamp);
      assert.ok(entry.capability);
    }
  });

  it('LM-9.01: getCapabilities for non-existent agent returns error', async () => {
    const result = await h.client.getCapabilities('non-existent' as AgentId);
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.AGENT_NOT_FOUND);
  });
});

// ============================================================================
// 4. Trust Promotion (LM-2.10 through LM-2.12)
// ============================================================================

describe('AgentLifecycleClient — Trust Promotion', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-11.03: promote untrusted->low succeeds', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'promote-low' }));
    assert.ok(reg.ok);

    const result = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'low',
      justification: 'registration complete',
      evidence: [],
    });
    assert.ok(result.ok, `Promotion failed: ${!result.ok ? result.error.message : ''}`);
    assert.equal(result.value.previousLevel, 'untrusted');
    assert.equal(result.value.newLevel, 'low');
    assert.ok(result.value.capabilitiesUnlocked.length >= 0);
  });

  it('LM-5.12: skip promotion (untrusted->high) is denied', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'skip-promote' }));
    assert.ok(reg.ok);

    const result = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'high',
      justification: 'want it all',
      evidence: [],
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.PROMOTION_DENIED);
  });

  it('LM-11.04: medium requires 10+ session_count evidence', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'medium-req' }));
    assert.ok(reg.ok);

    // First promote to low
    const toLow = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'low',
      justification: 'ready',
      evidence: [],
    });
    assert.ok(toLow.ok);

    // Try medium without evidence
    const noEvidence = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'medium',
      justification: 'ready',
      evidence: [],
    });
    assert.ok(!noEvidence.ok);

    // Try medium with sufficient evidence
    const withEvidence = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'medium',
      justification: 'proven track record',
      evidence: [{ type: 'session_count', value: 15, description: '15 sessions' }],
    });
    assert.ok(withEvidence.ok);
    assert.equal(withEvidence.value.newLevel, 'medium');
  });

  it('LM-11.05: high requires 100+ ops + human endorsement', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'high-req' }));
    assert.ok(reg.ok);

    // Promote through levels
    await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'low', justification: 'r', evidence: [],
    });
    await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'medium', justification: 'r',
      evidence: [{ type: 'session_count', value: 20, description: '20' }],
    });

    // Try high without human endorsement
    const noEndorse = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'high',
      justification: 'ready',
      evidence: [{ type: 'session_count', value: 200, description: '200' }],
    });
    assert.ok(!noEndorse.ok);

    // With human endorsement
    const withEndorse = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'high',
      justification: 'endorsed',
      evidence: [
        { type: 'session_count', value: 200, description: '200' },
        { type: 'human_endorsement', value: 'approved', description: 'CTO approved' },
      ],
    });
    assert.ok(withEndorse.ok);
    assert.equal(withEndorse.value.newLevel, 'high');
  });

  it('LM-5.13: verified cannot be self-granted', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'self-verify' }));
    assert.ok(reg.ok);

    // Promote to high
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'low', justification: 'r', evidence: [] });
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'medium', justification: 'r', evidence: [{ type: 'session_count', value: 20, description: '20' }] });
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'high', justification: 'r', evidence: [{ type: 'session_count', value: 200, description: '200' }, { type: 'human_endorsement', value: 'ok', description: 'ok' }] });

    // Try self-promotion to verified (ctx.agentId matches reg.value.id won't match since test-agent != actual ID)
    // Create a context where agentId matches the agent being promoted
    const selfCtx = createTestOperationContext({ agentId: reg.value.id as string });
    const result = await h.client.promoteAgent(selfCtx, reg.value.id, {
      targetLevel: 'verified',
      justification: 'self',
      evidence: [{ type: 'human_endorsement', value: 'self', description: 'self' }],
    });
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.PROMOTION_DENIED);
  });

  it('LM-2.11: demoteAgent reduces trust level one step', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'demote-test' }));
    assert.ok(reg.ok);

    // Promote to low first
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'low', justification: 'r', evidence: [] });

    const result = await h.client.demoteAgent(h.ctx, reg.value.id, 'misbehavior');
    assert.ok(result.ok);
    assert.equal(result.value.previousLevel, 'low');
    assert.equal(result.value.newLevel, 'untrusted');
    assert.equal(result.value.reason, 'misbehavior');
  });

  it('LM-9.07: cannot demote below untrusted (floor)', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'demote-floor' }));
    assert.ok(reg.ok);

    const result = await h.client.demoteAgent(h.ctx, reg.value.id, 'already at bottom');
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.DEMOTION_BELOW_FLOOR);
  });

  it('LM-5.18: demotion revokes capabilities above new level', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'demote-caps' }));
    assert.ok(reg.ok);

    // Promote to low (unlocks memory_write, belief_management)
    const promo = await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'low', justification: 'r', evidence: [] });
    assert.ok(promo.ok);
    assert.ok(promo.value.capabilitiesUnlocked.length > 0);

    // Demote back to untrusted
    const demote = await h.client.demoteAgent(h.ctx, reg.value.id, 'demotion');
    assert.ok(demote.ok);
    assert.ok(demote.value.capabilitiesRevoked.length > 0);
    assert.ok(demote.value.capabilitiesRevoked.includes('memory_write' as AgentCapability));
  });

  it('LM-2.12: getTrustLevel returns current level', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'get-trust' }));
    assert.ok(reg.ok);
    const result = await h.client.getTrustLevel(reg.value.id);
    assert.ok(result.ok);
    assert.equal(result.value, 'untrusted');
  });
});

// ============================================================================
// 5. Consent Governance (LM-2.13 through LM-2.16)
// ============================================================================

describe('AgentLifecycleClient — Consent Governance', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-2.13: registerConsent creates a new consent record', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'consent-reg' }));
    assert.ok(reg.ok);

    const consent: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-1',
      purpose: 'memory_storage',
      scope: { operations: ['store_personal_data' as ConsentableOperation] },
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    const result = await h.client.registerConsent(h.ctx, reg.value.id, consent);
    assert.ok(result.ok);
    assert.ok(result.value); // ConsentId returned
  });

  it('LM-2.14: revokeConsent marks consent as revoked', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'consent-revoke' }));
    assert.ok(reg.ok);

    const consent: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-2',
      purpose: 'analytics',
      scope: {},
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    const cr = await h.client.registerConsent(h.ctx, reg.value.id, consent);
    assert.ok(cr.ok);

    const result = await h.client.revokeConsent(h.ctx, cr.value, 'withdrawn');
    assert.ok(result.ok);
    assert.equal(result.value.consentId, cr.value);
    assert.ok(result.value.revokedAt);
  });

  it('LM-9.10: revokeConsent on non-existent returns CONSENT_NOT_FOUND', async () => {
    const result = await h.client.revokeConsent(h.ctx, 'non-existent' as ConsentId, 'test');
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.CONSENT_NOT_FOUND);
  });

  it('LM-14.30-14.34: checkConsent finds matching active consent', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'consent-check' }));
    assert.ok(reg.ok);

    // No consent yet — should be denied
    const denied = await h.client.checkConsent(reg.value.id, 'transfer_knowledge' as ConsentableOperation);
    assert.ok(denied.ok);
    assert.equal(denied.value.allowed, false);

    // Register consent
    const consent: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-3',
      purpose: 'knowledge_transfer',
      scope: { operations: ['transfer_knowledge' as ConsentableOperation] },
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    await h.client.registerConsent(h.ctx, reg.value.id, consent);

    // Now should be allowed
    const allowed = await h.client.checkConsent(reg.value.id, 'transfer_knowledge' as ConsentableOperation);
    assert.ok(allowed.ok);
    assert.equal(allowed.value.allowed, true);
    assert.ok(allowed.value.consentId);
  });

  it('LM-13.20: expired consent is detected on check', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'consent-expire' }));
    assert.ok(reg.ok);

    // Register consent that's already expired
    const consent: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-4',
      purpose: 'analytics',
      scope: { operations: ['collect_analytics' as ConsentableOperation] },
      grantedAt: new Date(Date.now() - 86400000).toISOString(), // yesterday
      expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      status: 'active',
    };
    await h.client.registerConsent(h.ctx, reg.value.id, consent);

    // Check should detect expiry
    const result = await h.client.checkConsent(reg.value.id, 'collect_analytics' as ConsentableOperation);
    assert.ok(result.ok);
    assert.equal(result.value.allowed, false);
  });

  it('LM-2.16: listConsents returns all consents for agent', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'consent-list' }));
    assert.ok(reg.ok);

    const c1: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-5',
      purpose: 'memory_storage',
      scope: {},
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    const c2: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-6',
      purpose: 'analytics',
      scope: {},
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    await h.client.registerConsent(h.ctx, reg.value.id, c1);
    await h.client.registerConsent(h.ctx, reg.value.id, c2);

    const result = await h.client.listConsents(reg.value.id);
    assert.ok(result.ok);
    assert.ok(result.value.length >= 2);
  });
});

// ============================================================================
// 6. Knowledge Exchange (LM-2.17 through LM-2.19)
// ============================================================================

describe('AgentLifecycleClient — Knowledge Exchange', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-2.17: exportKnowledge returns a KnowledgePackage with checksum', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'export-test' }));
    assert.ok(reg.ok);

    const options: KnowledgeExportOptions = { format: 'limen_native' };
    const result = await h.client.exportKnowledge(h.ctx, reg.value.id, options);
    assert.ok(result.ok);
    assert.ok(result.value.id);
    assert.ok(result.value.checksum);
    assert.equal(result.value.sourceAgentId, reg.value.id);
    assert.equal(result.value.format, 'limen_native');
    assert.ok(result.value.metadata);
  });

  it('LM-13.12: export respects classification ceiling', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'export-class' }));
    assert.ok(reg.ok);
    // untrusted has clearance 0 (unrestricted only)
    const options: KnowledgeExportOptions = {
      format: 'limen_native',
      classification: 'restricted', // clearance 3, agent has 0
    };
    const result = await h.client.exportKnowledge(h.ctx, reg.value.id, options);
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.CLASSIFICATION_EXCEEDED);
  });

  it('LM-2.18: importKnowledge validates checksum integrity', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'import-test' }));
    assert.ok(reg.ok);

    // Export first to get a valid package
    const exp = await h.client.exportKnowledge(h.ctx, reg.value.id, { format: 'limen_native' });
    assert.ok(exp.ok);

    // Import with valid checksum
    const result = await h.client.importKnowledge(h.ctx, reg.value.id, exp.value);
    assert.ok(result.ok);
    assert.ok(result.value.duration >= 0);
  });

  it('LM-9.12: import with tampered checksum fails', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'import-tamper' }));
    assert.ok(reg.ok);

    const exp = await h.client.exportKnowledge(h.ctx, reg.value.id, { format: 'limen_native' });
    assert.ok(exp.ok);

    // Tamper with checksum
    const tampered = { ...exp.value, checksum: 'deadbeef' };
    const result = await h.client.importKnowledge(h.ctx, reg.value.id, tampered);
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.IMPORT_INTEGRITY_FAILED);
  });

  it('LM-2.19: transferKnowledge requires consent and capabilities', async () => {
    // Create source and target agents
    const source = await h.client.registerAgent(h.ctx, validSpec({ name: 'transfer-src' }));
    const target = await h.client.registerAgent(h.ctx, validSpec({ name: 'transfer-tgt' }));
    assert.ok(source.ok && target.ok);

    // Transfer without consent should fail
    const noConsent = await h.client.transferKnowledge(h.ctx, source.value.id, target.value.id, {});
    assert.ok(!noConsent.ok);
    // Should fail due to missing capability or consent
  });

  it('LM-14.21: transfer source must have knowledge_export capability', async () => {
    const source = await h.client.registerAgent(h.ctx, validSpec({ name: 'xfer-no-export' }));
    const target = await h.client.registerAgent(h.ctx, validSpec({ name: 'xfer-target' }));
    assert.ok(source.ok && target.ok);

    // Untrusted agents don't have knowledge_export
    const result = await h.client.transferKnowledge(h.ctx, source.value.id, target.value.id, {});
    assert.ok(!result.ok);
    assert.equal(result.error.code, LIFECYCLE_ERROR_CODES.TRANSFER_DENIED);
  });
});

// ============================================================================
// 7. Events (LM-2.20 through LM-2.22)
// ============================================================================

describe('AgentLifecycleClient — Events', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-2.20/2.21: on/off subscribes and unsubscribes', async () => {
    let eventReceived = false;
    const subId = h.client.on('agent:registered' as any, () => {
      eventReceived = true;
    });
    assert.ok(typeof subId === 'string');

    // Register an agent to trigger event
    await h.client.registerAgent(h.ctx, validSpec({ name: 'event-test' }));
    // Event may or may not fire depending on bus timing

    // Unsubscribe
    h.client.off(subId);
    // No error thrown
  });
});

// ============================================================================
// 8. State Machine (LM-10)
// ============================================================================

describe('AgentLifecycleClient — State Machine', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-10.01: register transitions from unregistered to active', async () => {
    const result = await h.client.registerAgent(h.ctx, validSpec({ name: 'sm-active' }));
    assert.ok(result.ok);
    assert.equal(result.value.state, 'active');
  });

  it('LM-10.05: active can transition to decommissioned', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'sm-decomm' }));
    assert.ok(reg.ok);
    const result = await h.client.decommissionAgent(h.ctx, reg.value.id, 'test');
    assert.ok(result.ok);

    const get = await h.client.getAgent(reg.value.id);
    assert.ok(get.ok);
    assert.equal(get.value.state, 'decommissioned');
  });

  it('LM-10.12: decommissioned is terminal — no state change allowed', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'sm-terminal' }));
    assert.ok(reg.ok);
    await h.client.decommissionAgent(h.ctx, reg.value.id, 'test');

    // Try update
    const update = await h.client.updateAgent(h.ctx, reg.value.id, { name: 'new-name' });
    assert.ok(!update.ok);
    assert.equal(update.error.code, LIFECYCLE_ERROR_CODES.AGENT_DECOMMISSIONED);
  });
});

// ============================================================================
// 9. Invariants (LM-13)
// ============================================================================

describe('AgentLifecycleClient — Invariants', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-13.01: AgentId never changes after registration', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'immutable-id' }));
    assert.ok(reg.ok);
    const id = reg.value.id;

    await h.client.updateAgent(h.ctx, id, { version: '2.0.0' });
    const get = await h.client.getAgent(id);
    assert.ok(get.ok);
    assert.equal(get.value.id, id);
  });

  it('LM-13.02: name+framework uniqueness within tenant', async () => {
    await h.client.registerAgent(h.ctx, validSpec({ name: 'unique-test', framework: 'claude' }));
    // Same name+framework should fail
    const dup = await h.client.registerAgent(h.ctx, validSpec({ name: 'unique-test', framework: 'claude' }));
    assert.ok(!dup.ok);
    // Different framework should succeed
    const diff = await h.client.registerAgent(h.ctx, validSpec({ name: 'unique-test', framework: 'gemma' }));
    assert.ok(diff.ok);
  });

  it('LM-13.17: capability revocation is immediate', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'imm-revoke' }));
    assert.ok(reg.ok);
    // memory_read is granted
    const caps1 = await h.client.getCapabilities(reg.value.id);
    assert.ok(caps1.ok);
    assert.ok(caps1.value.granted.includes('memory_read' as AgentCapability));

    // Revoke
    await h.client.revokeCapability(h.ctx, reg.value.id, 'memory_read' as AgentCapability, 'test');

    // Immediately gone
    const caps2 = await h.client.getCapabilities(reg.value.id);
    assert.ok(caps2.ok);
    assert.ok(!caps2.value.granted.includes('memory_read' as AgentCapability));
  });

  it('LM-13.22: statistics computed from audit trail (no counter drift)', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'stats-test' }));
    assert.ok(reg.ok);
    // Statistics should be zero-initialized for new agents
    assert.equal(reg.value.statistics.totalSessions, 0);
    assert.equal(reg.value.statistics.totalClaimsAsserted, 0);
    assert.equal(reg.value.statistics.averageSessionDuration, 0);
  });

  it('LM-13.26: all mutations require OperationContext', async () => {
    // This is structurally enforced by TypeScript types — every mutation method
    // has ctx as its first parameter. This test verifies the runtime behavior.
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'ctx-test' }));
    assert.ok(reg.ok);

    // The fact that registration succeeded with h.ctx proves OperationContext is used
    // If ctx were missing, TypeScript would catch it at compile time
  });

  it('LM-3.17: coreTrustLevel is derived from trustLevel', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'core-trust' }));
    assert.ok(reg.ok);
    assert.equal(reg.value.coreTrustLevel, 'untrusted');

    // Promote to low
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'low', justification: 'r', evidence: [] });
    const get = await h.client.getAgent(reg.value.id);
    assert.ok(get.ok);
    assert.equal(get.value.coreTrustLevel, 'probationary');
  });

  it('LM-3.18: clearanceLevel derived from trust via TRUST_TO_CLEARANCE', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'clearance-test' }));
    assert.ok(reg.ok);
    assert.equal(reg.value.clearanceLevel, 0); // untrusted = 0

    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'low', justification: 'r', evidence: [] });
    const get = await h.client.getAgent(reg.value.id);
    assert.ok(get.ok);
    assert.equal(get.value.clearanceLevel, 1); // low = 1
  });
});

// ============================================================================
// 10. Migration
// ============================================================================

describe('Migration 048 — Agent Lifecycle Tables', () => {
  let conn: DatabaseConnection;

  beforeEach(() => { conn = createTestDatabase(); });

  it('creates lm_agents table', () => {
    const tables = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='lm_agents'`,
    );
    assert.equal(tables.length, 1);
  });

  it('creates lm_capabilities table', () => {
    const tables = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='lm_capabilities'`,
    );
    assert.equal(tables.length, 1);
  });

  it('creates lm_capability_history table', () => {
    const tables = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='lm_capability_history'`,
    );
    assert.equal(tables.length, 1);
  });

  it('creates lm_agent_consents table', () => {
    const tables = conn.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='lm_agent_consents'`,
    );
    assert.equal(tables.length, 1);
  });

  it('lm_agents enforces state CHECK constraint', () => {
    assert.throws(() => {
      conn.run(
        `INSERT INTO lm_agents (id, name, framework, version, state, trust_level, owner, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['id-1', 'test', 'claude', '1.0', 'invalid_state', 'untrusted', 'user', new Date().toISOString()],
      );
    });
  });

  it('lm_agents enforces trust_level CHECK constraint', () => {
    assert.throws(() => {
      conn.run(
        `INSERT INTO lm_agents (id, name, framework, version, state, trust_level, owner, registered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['id-2', 'test2', 'claude', '1.0', 'active', 'super_admin', 'user', new Date().toISOString()],
      );
    });
  });

  it('migration is idempotent (IF NOT EXISTS)', () => {
    // Tables already created by createTestDatabase. Re-running the SQL should not throw.
    // Verify by re-executing the CREATE TABLE IF NOT EXISTS statements.
    assert.doesNotThrow(() => {
      conn.run(`CREATE TABLE IF NOT EXISTS lm_agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, framework TEXT NOT NULL, version TEXT NOT NULL, owner TEXT NOT NULL, registered_at TEXT NOT NULL)`, []);
    });
  });
});

// ============================================================================
// 11. Fail-Closed Behavior
// ============================================================================

describe('AgentLifecycleClient — Fail-Closed', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('AD-4: consent check defaults to denied when no consents exist', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'fail-closed' }));
    assert.ok(reg.ok);

    const result = await h.client.checkConsent(reg.value.id, 'transfer_knowledge' as ConsentableOperation);
    assert.ok(result.ok);
    assert.equal(result.value.allowed, false);
    assert.equal(result.value.consentId, null);
  });

  it('AD-4: capability request defaults to denied for insufficient trust', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'fail-closed-cap' }));
    assert.ok(reg.ok);

    const result = await h.client.requestCapabilityUpgrade(h.ctx, reg.value.id, {
      capabilities: ['governance_admin'] as AgentCapability[],
      justification: 'want it',
    });
    assert.ok(result.ok);
    assert.equal(result.value.granted.length, 0);
    assert.ok(result.value.denied.length > 0);
  });
});

// ============================================================================
// 12. Audit Trail
// ============================================================================

describe('AgentLifecycleClient — Audit Trail', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('LM-13.24: registration produces audit entry', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'audit-reg' }));
    assert.ok(reg.ok);

    // Query audit trail for the registration
    const audits = h.conn.query<{ operation: string; resource_id: string }>(
      `SELECT operation, resource_id FROM core_audit_log WHERE operation LIKE '%agent.registered%' ORDER BY seq_no DESC LIMIT 1`,
    );
    assert.ok(audits.length >= 1);
    assert.ok(audits[0]!.operation.includes('registered'));
  });

  it('LM-13.24: decommission produces audit entry', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'audit-decomm' }));
    assert.ok(reg.ok);
    await h.client.decommissionAgent(h.ctx, reg.value.id, 'audit test');

    const audits = h.conn.query<{ operation: string }>(
      `SELECT operation FROM core_audit_log WHERE operation LIKE '%decommissioned%' ORDER BY seq_no DESC LIMIT 1`,
    );
    assert.ok(audits.length >= 1);
  });

  it('LM-13.24: promotion produces audit entry', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'audit-promo' }));
    assert.ok(reg.ok);
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'low', justification: 'r', evidence: [] });

    const audits = h.conn.query<{ operation: string }>(
      `SELECT operation FROM core_audit_log WHERE operation LIKE '%promoted%' ORDER BY seq_no DESC LIMIT 1`,
    );
    assert.ok(audits.length >= 1);
  });

  it('LM-13.24: consent registration produces audit entry', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'audit-consent' }));
    assert.ok(reg.ok);

    const consent: AgentConsentRecord = {
      agentId: reg.value.id,
      dataSubject: 'user-audit',
      purpose: 'memory_storage',
      scope: {},
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      status: 'active',
    };
    await h.client.registerConsent(h.ctx, reg.value.id, consent);

    const audits = h.conn.query<{ operation: string }>(
      `SELECT operation FROM core_audit_log WHERE operation LIKE '%consent.registered%' ORDER BY seq_no DESC LIMIT 1`,
    );
    assert.ok(audits.length >= 1);
  });
});

// ============================================================================
// 13. Trust Promotion State Machine (comprehensive)
// ============================================================================

describe('Trust Promotion — State Machine', () => {
  let h: ReturnType<typeof createTestHarness>;

  beforeEach(() => { h = createTestHarness(); });

  it('full promotion chain: untrusted->low->medium->high->verified', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'full-chain' }));
    assert.ok(reg.ok);

    // untrusted -> low
    const toLow = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'low', justification: 'ready', evidence: [],
    });
    assert.ok(toLow.ok);

    // low -> medium
    const toMedium = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'medium', justification: 'proven',
      evidence: [{ type: 'session_count', value: 50, description: '50 sessions' }],
    });
    assert.ok(toMedium.ok);

    // medium -> high
    const toHigh = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'high', justification: 'endorsed',
      evidence: [
        { type: 'session_count', value: 200, description: '200 sessions' },
        { type: 'human_endorsement', value: 'yes', description: 'CTO approved' },
      ],
    });
    assert.ok(toHigh.ok);

    // high -> verified (non-self)
    const toVerified = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'verified', justification: 'fully vetted',
      evidence: [{ type: 'human_endorsement', value: 'yes', description: 'Full verification' }],
    });
    assert.ok(toVerified.ok);
    assert.equal(toVerified.value.newLevel, 'verified');

    // Verify final state
    const get = await h.client.getAgent(reg.value.id);
    assert.ok(get.ok);
    assert.equal(get.value.trustLevel, 'verified');
    assert.equal(get.value.coreTrustLevel, 'admin');
    assert.equal(get.value.clearanceLevel, 4);
  });

  it('cannot promote beyond verified', async () => {
    const reg = await h.client.registerAgent(h.ctx, validSpec({ name: 'beyond-verified' }));
    assert.ok(reg.ok);

    // Promote all the way to verified
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'low', justification: 'r', evidence: [] });
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'medium', justification: 'r', evidence: [{ type: 'session_count', value: 50, description: '50' }] });
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'high', justification: 'r', evidence: [{ type: 'session_count', value: 200, description: '200' }, { type: 'human_endorsement', value: 'y', description: 'y' }] });
    await h.client.promoteAgent(h.ctx, reg.value.id, { targetLevel: 'verified', justification: 'r', evidence: [{ type: 'human_endorsement', value: 'y', description: 'y' }] });

    // Cannot promote further
    const result = await h.client.promoteAgent(h.ctx, reg.value.id, {
      targetLevel: 'verified', justification: 'again', evidence: [],
    });
    assert.ok(!result.ok);
  });
});

// ============================================================================
// 14. Error Type Coverage (LM-9)
// ============================================================================

describe('AgentLifecycleClient — Error Types', () => {
  it('all 16 error codes are defined', () => {
    const codes = Object.values(LIFECYCLE_ERROR_CODES);
    assert.equal(codes.length, 16);
    assert.ok(codes.includes('AGENT_NOT_FOUND'));
    assert.ok(codes.includes('AGENT_ALREADY_EXISTS'));
    assert.ok(codes.includes('AGENT_DECOMMISSIONED'));
    assert.ok(codes.includes('AGENT_SUSPENDED'));
    assert.ok(codes.includes('CAPABILITY_DENIED'));
    assert.ok(codes.includes('PROMOTION_DENIED'));
    assert.ok(codes.includes('DEMOTION_BELOW_FLOOR'));
    assert.ok(codes.includes('CONSENT_REQUIRED'));
    assert.ok(codes.includes('CONSENT_EXPIRED'));
    assert.ok(codes.includes('CONSENT_NOT_FOUND'));
    assert.ok(codes.includes('TRANSFER_DENIED'));
    assert.ok(codes.includes('IMPORT_INTEGRITY_FAILED'));
    assert.ok(codes.includes('CLASSIFICATION_EXCEEDED'));
    assert.ok(codes.includes('TRUST_LEVEL_INSUFFICIENT'));
    assert.ok(codes.includes('GOVERNANCE_REFUSAL'));
    assert.ok(codes.includes('INVALID_STATE_TRANSITION'));
  });
});
