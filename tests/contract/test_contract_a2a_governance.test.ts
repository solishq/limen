/**
 * FR-002: A2A Governance Contract Tests.
 *
 * Verifies the A2A governance system end-to-end through the createLimen() API surface,
 * testing schema validation, storage, recall, and rejection paths.
 *
 * Amendment 21: Every enforcement DC has BOTH success AND rejection tests.
 *
 * Spec ref: v4.0.0 Phase 7 FR-002
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { createLimen } from '../../src/api/index.js';
import type { Limen } from '../../src/api/index.js';

// ── Helpers ──

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'limen-a2a-gov-'));
}

function makeKey(): Buffer {
  return randomBytes(32);
}

const dirsToClean: string[] = [];
const instancesToShutdown: Limen[] = [];

function trackDir(dir: string): string {
  dirsToClean.push(dir);
  return dir;
}

function trackInstance(limen: Limen): Limen {
  instancesToShutdown.push(limen);
  return limen;
}

afterEach(async () => {
  for (const instance of instancesToShutdown) {
    try { await instance.shutdown(); } catch { /* already shut down */ }
  }
  instancesToShutdown.length = 0;
  for (const dir of dirsToClean) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  dirsToClean.length = 0;
});

describe('FR-002: A2A Governance', () => {

  // DC-A2A-01 [SUCCESS]: setGovernanceBlock stores and getGovernanceBlock retrieves
  it('DC-A2A-01 [SUCCESS]: setGovernanceBlock stores and getGovernanceBlock retrieves', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const block = {
      provider: 'limen' as const,
      version: '4.0.0',
      dataResidency: ['us-east-1', 'eu-west-1'],
      piiHandling: 'masked' as const,
      auditTrail: true,
      compliance: ['SOC2', 'GDPR'],
      maxConfidence: 0.85,
    };

    const setResult = limen.a2aGovernance.setGovernanceBlock(block);
    assert.equal(setResult.ok, true, 'setGovernanceBlock must succeed');

    const getResult = limen.a2aGovernance.getGovernanceBlock();
    assert.equal(getResult.ok, true, 'getGovernanceBlock must succeed');
    if (!getResult.ok) return;
    assert.ok(getResult.value !== null, 'governance block must be non-null');
    assert.equal(getResult.value!.provider, 'limen');
    assert.equal(getResult.value!.version, '4.0.0');
    assert.deepEqual(getResult.value!.dataResidency, ['us-east-1', 'eu-west-1']);
    assert.equal(getResult.value!.piiHandling, 'masked');
    assert.equal(getResult.value!.auditTrail, true);
    assert.deepEqual(getResult.value!.compliance, ['SOC2', 'GDPR']);
    assert.equal(getResult.value!.maxConfidence, 0.85);
  });

  // DC-A2A-02 [REJECTION]: malformed governance block rejected
  it('DC-A2A-02 [REJECTION]: malformed governance block rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Missing required fields — version and dataResidency missing
    const malformedBlock = {
      provider: 'limen',
      piiHandling: 'masked',
      auditTrail: true,
      compliance: [],
      maxConfidence: 0.7,
      // version: missing
      // dataResidency: missing
    };

    const result = limen.a2aGovernance.setGovernanceBlock(malformedBlock);
    assert.equal(result.ok, false, 'must reject malformed block');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_GOVERNANCE_BLOCK');

    // Verify state DID NOT CHANGE — no governance block stored
    const getResult = limen.a2aGovernance.getGovernanceBlock();
    assert.equal(getResult.ok, true);
    if (!getResult.ok) return;
    assert.equal(getResult.value, null, 'governance block must remain null after rejection');
  });

  // DC-A2A-03 [SUCCESS]: registerProactiveRule stores rule as claim
  it('DC-A2A-03 [SUCCESS]: registerProactiveRule stores rule as claim', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const rule = {
      id: 'rule-001',
      condition: 'cost_rate > 0.1',
      targetAgent: 'budget-monitor',
      action: 'alert',
      governance: {
        dataShared: ['cost_rate', 'model'],
        dataProhibited: ['user_input'],
      },
      costCeiling: 0.50,
      cooldownSeconds: 300,
      approvedBy: 'admin@solishq.com',
      status: 'active' as const,
    };

    const result = limen.a2aGovernance.registerProactiveRule(rule);
    assert.equal(result.ok, true, 'registerProactiveRule must succeed');
    if (!result.ok) return;
    assert.ok(result.value.claimId, 'must return a claimId');

    // List and verify
    const listResult = limen.a2aGovernance.listProactiveRules();
    assert.equal(listResult.ok, true, 'listProactiveRules must succeed');
    if (!listResult.ok) return;
    assert.ok(listResult.value.length >= 1, 'must find at least one rule');

    const stored = listResult.value[0]!;
    const parsed = JSON.parse(stored.value);
    assert.equal(parsed.id, 'rule-001');
    assert.equal(parsed.targetAgent, 'budget-monitor');
    assert.equal(parsed.approvedBy, 'admin@solishq.com');
    assert.equal(parsed.status, 'active');
  });

  // DC-A2A-04 [REJECTION]: proactive rule without approvedBy rejected
  it('DC-A2A-04 [REJECTION]: proactive rule without approvedBy rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const ruleWithoutApproval = {
      id: 'rule-bad',
      condition: 'always',
      targetAgent: 'target',
      action: 'fire',
      governance: {
        dataShared: [],
        dataProhibited: [],
      },
      costCeiling: 1.0,
      cooldownSeconds: 60,
      // approvedBy: missing — this is required
      status: 'active',
    };

    const result = limen.a2aGovernance.registerProactiveRule(ruleWithoutApproval);
    assert.equal(result.ok, false, 'must reject rule without approvedBy');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_PROACTIVE_RULE');
    assert.ok(result.error.message.includes('approvedBy'), 'error message must mention approvedBy');

    // Verify state DID NOT CHANGE
    const listResult = limen.a2aGovernance.listProactiveRules();
    assert.equal(listResult.ok, true);
    if (!listResult.ok) return;
    assert.equal(listResult.value.length, 0, 'no rules should be stored after rejection');
  });

  // DC-A2A-05 [SUCCESS]: listProactiveRules returns registered rules
  it('DC-A2A-05 [SUCCESS]: listProactiveRules returns registered rules', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    // Register two rules with different statuses
    const activeRule = {
      id: 'rule-active',
      condition: 'always',
      targetAgent: 'agent-a',
      action: 'notify',
      governance: { dataShared: ['x'], dataProhibited: [] },
      costCeiling: 1.0,
      cooldownSeconds: 60,
      approvedBy: 'admin',
      status: 'active' as const,
    };

    const suspendedRule = {
      id: 'rule-suspended',
      condition: 'never',
      targetAgent: 'agent-b',
      action: 'pause',
      governance: { dataShared: [], dataProhibited: ['y'] },
      costCeiling: 0.5,
      cooldownSeconds: 120,
      approvedBy: 'admin',
      status: 'suspended' as const,
    };

    const r1 = limen.a2aGovernance.registerProactiveRule(activeRule);
    assert.equal(r1.ok, true);
    const r2 = limen.a2aGovernance.registerProactiveRule(suspendedRule);
    assert.equal(r2.ok, true);

    // List all — should get both
    const allResult = limen.a2aGovernance.listProactiveRules();
    assert.equal(allResult.ok, true);
    if (!allResult.ok) return;
    assert.equal(allResult.value.length, 2, 'must find both rules');

    // List active only
    const activeResult = limen.a2aGovernance.listProactiveRules('active');
    assert.equal(activeResult.ok, true);
    if (!activeResult.ok) return;
    assert.equal(activeResult.value.length, 1, 'must find only active rule');
    const activeParsed = JSON.parse(activeResult.value[0]!.value);
    assert.equal(activeParsed.id, 'rule-active');

    // List suspended only
    const suspResult = limen.a2aGovernance.listProactiveRules('suspended');
    assert.equal(suspResult.ok, true);
    if (!suspResult.ok) return;
    assert.equal(suspResult.value.length, 1, 'must find only suspended rule');
    const suspParsed = JSON.parse(suspResult.value[0]!.value);
    assert.equal(suspParsed.id, 'rule-suspended');
  });

  // DC-A2A-06 [REJECTION]: proactive rule with invalid status rejected
  it('DC-A2A-06 [REJECTION]: proactive rule with invalid status rejected', async () => {
    const dir = trackDir(makeTempDir());
    const limen = trackInstance(await createLimen({ dataDir: dir, masterKey: makeKey() }));

    const ruleWithBadStatus = {
      id: 'rule-bad-status',
      condition: 'always',
      targetAgent: 'target',
      action: 'fire',
      governance: {
        dataShared: [],
        dataProhibited: [],
      },
      costCeiling: 1.0,
      cooldownSeconds: 60,
      approvedBy: 'admin',
      status: 'INVALID_STATUS',  // Not in 'active' | 'suspended' | 'retired'
    };

    const result = limen.a2aGovernance.registerProactiveRule(ruleWithBadStatus);
    assert.equal(result.ok, false, 'must reject rule with invalid status');
    if (result.ok) return;
    assert.equal(result.error.code, 'INVALID_PROACTIVE_RULE');

    // Verify state DID NOT CHANGE
    const listResult = limen.a2aGovernance.listProactiveRules();
    assert.equal(listResult.ok, true);
    if (!listResult.ok) return;
    assert.equal(listResult.value.length, 0, 'no rules should be stored after rejection');
  });
});
