/**
 * Limen Phase 0A — Capability Manifest + Retry/Replay Matrix Contract Tests
 * Truth Model: Deliverable 9 (Capability Manifest Schema), Deliverable 10 (Retry/Replay Safety Matrix)
 * Assertions: BC-100 to BC-104, BC-110, BC-111, INV-X04
 *
 * Phase: 0A (Foundation)
 * Gate: Store tests FAIL with NotImplementedError before implementation.
 * Note: Tests 7-9 (RETRY_REPLAY_CLASSIFICATION) test static const data and PASS immediately.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createTestDatabase, createTestOperationContext, tenantId, missionId, taskId, agentId } from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import { runId, attemptId, traceEventId, correlationId, missionContractId, supervisorDecisionId, suspensionRecordId, handoffId, evalCaseId, capabilityManifestId, testTimestamp } from '../helpers/governance_test_helpers.js';
import type { CapabilityManifest, ExecutionTrustTier, SideEffectClass, RetryClassification } from '../../src/kernel/interfaces/capability_manifest.js';
import { RETRY_REPLAY_CLASSIFICATION } from '../../src/kernel/interfaces/capability_manifest.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

function makeManifest(overrides: Partial<CapabilityManifest> = {}): CapabilityManifest {
  return {
    manifestId: capabilityManifestId('manifest-001'),
    capabilityType: 'web_search',
    trustTier: 'sandboxed-local' as ExecutionTrustTier,
    sideEffectClass: 'none' as SideEffectClass,
    secretRequirements: [],
    schemaVersion: '0.1.0',
    createdAt: testTimestamp(),
    ...overrides,
  };
}

describe('Phase 0A Contract Tests: Capability Manifest (Deliverable 9) + Retry/Replay (Deliverable 10)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-100: CapabilityManifest creation preserves all fields ──

  describe('BC-100: CapabilityManifest creation preserves all fields', () => {
    it('should return manifest with manifestId, capabilityType, trustTier, sideEffectClass, secretRequirements, schemaVersion, createdAt', () => {
      const manifest = makeManifest();
      const result = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.manifestId, 'manifest-001');
      assert.equal(result.value.capabilityType, 'web_search');
      assert.equal(result.value.trustTier, 'sandboxed-local');
      assert.equal(result.value.sideEffectClass, 'none');
      assert.equal(Array.isArray(result.value.secretRequirements), true);
      assert.equal(result.value.secretRequirements.length, 0);
      assert.equal(result.value.schemaVersion, '0.1.0');
      assert.equal(typeof result.value.createdAt, 'string');
    });
  });

  // ── BC-101: ExecutionTrustTier accepts all 5 values ──

  describe('BC-101: ExecutionTrustTier accepts all 5 values', () => {
    const tiers: ExecutionTrustTier[] = [
      'deterministic-local',
      'sandboxed-local',
      'remote-tenant',
      'remote-third-party',
      'human-mediated',
    ];

    for (const tier of tiers) {
      it(`should accept trust tier '${tier}'`, () => {
        const manifest = makeManifest({
          manifestId: capabilityManifestId(`manifest-tier-${tier}`),
          capabilityType: `cap-${tier}`,
          trustTier: tier,
        });
        const result = gov.capabilityManifestStore.register(conn, manifest);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.value.trustTier, tier);
      });
    }
  });

  // ── BC-102: Secret requirements are references, never plaintext ──

  describe('BC-102: Secret requirements are references (string array), never plaintext', () => {
    it('should preserve vault key references in secretRequirements', () => {
      const manifest = makeManifest({
        manifestId: capabilityManifestId('manifest-secrets'),
        capabilityType: 'external_api',
        secretRequirements: ['vault/api-key-ref', 'vault/oauth-token-ref'],
      });
      const result = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.secretRequirements.length, 2);
      assert.equal(result.value.secretRequirements[0], 'vault/api-key-ref');
      assert.equal(result.value.secretRequirements[1], 'vault/oauth-token-ref');
    });
  });

  // ── BC-103: Manifest immutable after registration — register then get, verify identical ──

  describe('BC-103: Manifest immutable after registration — get returns identical', () => {
    it('should return identical manifest via get after register', () => {
      const manifest = makeManifest({
        manifestId: capabilityManifestId('manifest-immutable'),
        capabilityType: 'code_execute',
        trustTier: 'remote-tenant',
        sideEffectClass: 'reversible',
      });
      const regResult = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(regResult.ok, true);
      if (!regResult.ok) return;

      const getResult = gov.capabilityManifestStore.get(conn, capabilityManifestId('manifest-immutable'));
      assert.equal(getResult.ok, true);
      if (!getResult.ok) return;
      assert.notEqual(getResult.value, null);
      assert.equal(getResult.value!.manifestId, 'manifest-immutable');
      assert.equal(getResult.value!.capabilityType, 'code_execute');
      assert.equal(getResult.value!.trustTier, 'remote-tenant');
      assert.equal(getResult.value!.sideEffectClass, 'reversible');
    });
  });

  // ── BC-103: getByType returns manifest for a capability type ──

  describe('BC-103: getByType returns manifest for a capability type', () => {
    it('should retrieve manifest by capabilityType string', () => {
      const manifest = makeManifest({
        manifestId: capabilityManifestId('manifest-bytype'),
        capabilityType: 'file_write',
      });
      const regResult = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(regResult.ok, true);

      const result = gov.capabilityManifestStore.getByType(conn, 'file_write');
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.notEqual(result.value, null);
      assert.equal(result.value!.capabilityType, 'file_write');
      assert.equal(result.value!.manifestId, 'manifest-bytype');
    });
  });

  // ── BC-104: SideEffectClass accepts all 4 values ──

  describe('BC-104: SideEffectClass accepts all 4 values', () => {
    const classes: SideEffectClass[] = ['none', 'idempotent', 'reversible', 'irreversible'];

    for (const cls of classes) {
      it(`should accept side effect class '${cls}'`, () => {
        const manifest = makeManifest({
          manifestId: capabilityManifestId(`manifest-se-${cls}`),
          capabilityType: `cap-se-${cls}`,
          sideEffectClass: cls,
        });
        const result = gov.capabilityManifestStore.register(conn, manifest);
        assert.equal(result.ok, true);
        if (!result.ok) return;
        assert.equal(result.value.sideEffectClass, cls);
      });
    }
  });

  // ── BC-110/BC-111: RETRY_REPLAY_CLASSIFICATION has 13 entries ──
  // STATIC DATA TEST — passes before implementation. Verified: const export correctness.

  describe('BC-110/BC-111: RETRY_REPLAY_CLASSIFICATION has 13 entries', () => {
    it('should have exactly 13 system call classifications', () => {
      // STATIC DATA TEST — passes before implementation. Verified: const export correctness.
      assert.equal(RETRY_REPLAY_CLASSIFICATION.length, 13);
    });
  });

  // ── BC-111: SC-5 is autoRetryable=true ──
  // STATIC DATA TEST — passes before implementation. Verified: const export correctness.

  describe('BC-111: SC-5 is autoRetryable=true', () => {
    it('should classify SC-5 as auto-retryable', () => {
      // STATIC DATA TEST — passes before implementation. Verified: const export correctness.
      const sc5 = RETRY_REPLAY_CLASSIFICATION.find(r => r.syscallId === 'SC-5');
      assert.notEqual(sc5, undefined);
      assert.equal(sc5!.autoRetryable, true);
      assert.equal(sc5!.sameRequestIdRequired, false);
    });
  });

  // ── BC-111: SC-7 has verifyPriorStateRequired=true ──
  // STATIC DATA TEST — passes before implementation. Verified: const export correctness.

  describe('BC-111: SC-7 has verifyPriorStateRequired=true', () => {
    it('should classify SC-7 as requiring prior state verification', () => {
      // STATIC DATA TEST — passes before implementation. Verified: const export correctness.
      const sc7 = RETRY_REPLAY_CLASSIFICATION.find(r => r.syscallId === 'SC-7');
      assert.notEqual(sc7, undefined);
      assert.equal(sc7!.verifyPriorStateRequired, true);
      assert.equal(sc7!.autoRetryable, false);
    });
  });

  // ── BC-100: get returns null for non-existent manifestId ──

  describe('BC-100: get returns null for non-existent manifestId', () => {
    it('should return null when manifestId does not exist', () => {
      const result = gov.capabilityManifestStore.get(conn, capabilityManifestId('manifest-nonexistent-999'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value, null);
    });
  });

  // ── INV-X04: CapabilityManifest carries schemaVersion ──

  describe('INV-X04: CapabilityManifest carries schemaVersion', () => {
    it('should preserve schemaVersion on registered manifest', () => {
      const manifest = makeManifest({
        manifestId: capabilityManifestId('manifest-inv-x04'),
        capabilityType: 'cap-inv-x04',
        schemaVersion: '0.5.0',
      });
      const result = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.schemaVersion, '0.5.0');
    });
  });

  // ── BC-101: Create manifest with 'human-mediated' trust tier — highest restriction ──

  describe('BC-101: human-mediated trust tier — highest restriction', () => {
    it('should register manifest with human-mediated tier requiring supervisor always', () => {
      const manifest = makeManifest({
        manifestId: capabilityManifestId('manifest-human'),
        capabilityType: 'destructive_action',
        trustTier: 'human-mediated',
        sideEffectClass: 'irreversible',
      });
      const result = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.trustTier, 'human-mediated');
      assert.equal(result.value.sideEffectClass, 'irreversible');
    });
  });

  // ── BC-104: Create manifest with 'irreversible' side effect — highest risk ──

  describe('BC-104: irreversible side effect — highest risk classification', () => {
    it('should register manifest with irreversible side effect class', () => {
      const manifest = makeManifest({
        manifestId: capabilityManifestId('manifest-irreversible'),
        capabilityType: 'database_drop',
        sideEffectClass: 'irreversible',
        trustTier: 'remote-third-party',
      });
      const result = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.sideEffectClass, 'irreversible');
    });
  });

  // ── BC-102: Empty secretRequirements array is valid ──

  describe('BC-102: Empty secretRequirements array is valid', () => {
    it('should accept manifest with zero secret requirements', () => {
      const manifest = makeManifest({
        manifestId: capabilityManifestId('manifest-no-secrets'),
        capabilityType: 'pure_compute',
        secretRequirements: [],
      });
      const result = gov.capabilityManifestStore.register(conn, manifest);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.secretRequirements.length, 0);
    });
  });

  // ── BC-100: capabilityType is unique — register two with same type, second should conflict ──

  describe('BC-100: capabilityType uniqueness — duplicate type should error', () => {
    it('should reject second manifest registration with the same capabilityType', () => {
      const manifest1 = makeManifest({
        manifestId: capabilityManifestId('manifest-dup-1'),
        capabilityType: 'web_search_unique',
      });
      const manifest2 = makeManifest({
        manifestId: capabilityManifestId('manifest-dup-2'),
        capabilityType: 'web_search_unique',
      });
      const first = gov.capabilityManifestStore.register(conn, manifest1);
      assert.equal(first.ok, true);

      const second = gov.capabilityManifestStore.register(conn, manifest2);
      assert.equal(second.ok, false);
    });
  });
});
