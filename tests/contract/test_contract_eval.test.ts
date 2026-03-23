/**
 * Limen Phase 0A — EvalCase Schema Contract Tests
 * Truth Model: Deliverable 8 (Eval Schema)
 * Assertions: BC-090 to BC-095, EDGE-091, INV-X04
 *
 * Phase: 0A (Foundation)
 * Gate: All tests FAIL with NotImplementedError before implementation.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createGovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import type { GovernanceSystem } from '../../src/governance/harness/governance_harness.js';
import { createTestDatabase, createTestOperationContext, tenantId, missionId, taskId, agentId } from '../helpers/test_database.js';
import type { DatabaseConnection, OperationContext } from '../../src/kernel/interfaces/index.js';
import { runId, attemptId, traceEventId, correlationId, missionContractId, supervisorDecisionId, suspensionRecordId, handoffId, evalCaseId, capabilityManifestId, testTimestamp } from '../helpers/governance_test_helpers.js';
import type { EvalCase, EvalDimension, EvalProvenance, EvalPinnedVersions } from '../../src/kernel/interfaces/eval.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

function makeEvalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    evalCaseId: evalCaseId('eval-001'),
    tenantId: 'test-tenant',
    attemptId: attemptId('attempt-001'),
    contractId: missionContractId('contract-001'),
    dimensions: [{ name: 'accuracy', score: 8, maxScore: 10 }, { name: 'completeness', score: 9, maxScore: 10 }],
    provenance: { evalSchemaVersion: '1.0.0', agentVersion: '3.3.0' },
    pinnedVersions: { traceGrammarVersion: '1.0.0', evalSchemaVersion: '1.0.0', missionContractVersion: '1.0.0' },
    contractSatisfaction: true,
    schemaVersion: '0.1.0',
    createdAt: testTimestamp(),
    ...overrides,
  };
}

describe('Phase 0A Contract Tests: Eval Schema (Deliverable 8)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-090: EvalCase creation preserves all fields ──

  describe('BC-090: EvalCase creation preserves all fields', () => {
    it('should return EvalCase with evalCaseId, tenantId, attemptId, dimensions, provenance, pinnedVersions, schemaVersion, createdAt', () => {
      const evalCase = makeEvalCase();
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.evalCaseId, 'eval-001');
      assert.equal(result.value.tenantId, 'test-tenant');
      assert.equal(result.value.attemptId, 'attempt-001');
      assert.equal(result.value.contractId, 'contract-001');
      assert.equal(result.value.contractSatisfaction, true);
      assert.equal(result.value.schemaVersion, '0.1.0');
      assert.equal(typeof result.value.createdAt, 'string');
      assert.equal(result.value.dimensions.length, 2);
      assert.equal(result.value.provenance.evalSchemaVersion, '1.0.0');
      assert.equal(result.value.pinnedVersions.traceGrammarVersion, '1.0.0');
    });
  });

  // ── BC-090: EvalCase dimensions array preserves EvalDimension shape ──

  describe('BC-090: EvalCase dimensions preserve EvalDimension shape', () => {
    it('should preserve name, score, maxScore, and optional rationale on each dimension', () => {
      const dims: readonly EvalDimension[] = [
        { name: 'accuracy', score: 8, maxScore: 10, rationale: 'Good precision on factual queries' },
        { name: 'completeness', score: 9, maxScore: 10 },
      ];
      const evalCase = makeEvalCase({ dimensions: dims });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.dimensions[0].name, 'accuracy');
      assert.equal(result.value.dimensions[0].score, 8);
      assert.equal(result.value.dimensions[0].maxScore, 10);
      assert.equal(result.value.dimensions[0].rationale, 'Good precision on factual queries');
      assert.equal(result.value.dimensions[1].name, 'completeness');
      assert.equal(result.value.dimensions[1].score, 9);
      assert.equal(result.value.dimensions[1].maxScore, 10);
      assert.equal(result.value.dimensions[1].rationale, undefined);
    });
  });

  // ── BC-091: EvalCase.create returns immutable record — get returns identical data ──

  describe('BC-091: EvalCase.create returns immutable record — get returns identical data', () => {
    it('should create then retrieve an identical EvalCase via get', () => {
      const evalCase = makeEvalCase();
      const createResult = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      const getResult = gov.evalCaseStore.get(conn, evalCaseId('eval-001'));
      assert.equal(getResult.ok, true);
      if (!getResult.ok) return;
      assert.notEqual(getResult.value, null);
      assert.equal(getResult.value!.evalCaseId, 'eval-001');
      assert.equal(getResult.value!.tenantId, 'test-tenant');
      assert.equal(getResult.value!.attemptId, 'attempt-001');
      assert.equal(getResult.value!.contractId, 'contract-001');
      assert.equal(getResult.value!.contractSatisfaction, true);
      assert.equal(getResult.value!.schemaVersion, '0.1.0');
      assert.equal(getResult.value!.dimensions.length, 2);
    });
  });

  // ── BC-092: EvalCase references contractId (MissionContractId), not a copy ──

  describe('BC-092: EvalCase references contractId, not a contract copy', () => {
    it('should store contractId as a MissionContractId reference string', () => {
      const evalCase = makeEvalCase({ contractId: missionContractId('contract-ref-092') });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.contractId, 'contract-ref-092');
      assert.equal(typeof result.value.contractId, 'string');
    });
  });

  // ── BC-093: EvalCase carries pinnedVersions ──

  describe('BC-093: EvalCase carries pinnedVersions for replay stability', () => {
    it('should preserve traceGrammarVersion, evalSchemaVersion, missionContractVersion', () => {
      const pinned: EvalPinnedVersions = {
        traceGrammarVersion: '2.0.0',
        evalSchemaVersion: '1.5.0',
        missionContractVersion: '3.0.0',
      };
      const evalCase = makeEvalCase({ pinnedVersions: pinned });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.pinnedVersions.traceGrammarVersion, '2.0.0');
      assert.equal(result.value.pinnedVersions.evalSchemaVersion, '1.5.0');
      assert.equal(result.value.pinnedVersions.missionContractVersion, '3.0.0');
    });
  });

  // ── BC-094: EvalProvenance has evalSchemaVersion (MUST), agentVersion, capabilitySnapshot, promptVersion (SHOULD) ──

  describe('BC-094: EvalProvenance has evalSchemaVersion (MUST) and optional SHOULD fields', () => {
    it('should preserve all provenance fields including optional SHOULD fields', () => {
      const prov: EvalProvenance = {
        evalSchemaVersion: '1.0.0',
        agentVersion: '3.3.0',
        capabilitySnapshot: 'snap-abc',
        promptVersion: 'prompt-v2',
      };
      const evalCase = makeEvalCase({ provenance: prov });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.provenance.evalSchemaVersion, '1.0.0');
      assert.equal(result.value.provenance.agentVersion, '3.3.0');
      assert.equal(result.value.provenance.capabilitySnapshot, 'snap-abc');
      assert.equal(result.value.provenance.promptVersion, 'prompt-v2');
    });
  });

  // ── BC-095: getByAttempt returns EvalCase for a given attemptId ──

  describe('BC-095: getByAttempt returns EvalCase for a given attemptId', () => {
    it('should retrieve the eval case linked to a specific attempt', () => {
      const evalCase = makeEvalCase({ attemptId: attemptId('attempt-095') });
      const createResult = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      const result = gov.evalCaseStore.getByAttempt(conn, attemptId('attempt-095'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.notEqual(result.value, null);
      assert.equal(result.value!.attemptId, 'attempt-095');
    });
  });

  // ── BC-095: getByContract returns array of EvalCases for a contractId ──

  describe('BC-095: getByContract returns array of EvalCases for a contractId', () => {
    it('should return an array of EvalCases linked to a contract', () => {
      const evalCase1 = makeEvalCase({
        evalCaseId: evalCaseId('eval-bycontract-1'),
        contractId: missionContractId('contract-095'),
        attemptId: attemptId('attempt-095-a'),
      });
      const evalCase2 = makeEvalCase({
        evalCaseId: evalCaseId('eval-bycontract-2'),
        contractId: missionContractId('contract-095'),
        attemptId: attemptId('attempt-095-b'),
      });
      const create1 = gov.evalCaseStore.create(conn, evalCase1);
      assert.equal(create1.ok, true);
      const create2 = gov.evalCaseStore.create(conn, evalCase2);
      assert.equal(create2.ok, true);

      const result = gov.evalCaseStore.getByContract(conn, missionContractId('contract-095'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(Array.isArray(result.value), true);
      assert.equal(result.value.length, 2);
    });
  });

  // ── EDGE-091: Legacy mode — contractSatisfaction=null when constitutionalMode=false ──

  describe('EDGE-091: Legacy mode — contractSatisfaction=null when contractId=null', () => {
    it('should allow EvalCase with contractSatisfaction=null and contractId=null', () => {
      const evalCase = makeEvalCase({
        evalCaseId: evalCaseId('eval-legacy'),
        contractId: null,
        contractSatisfaction: null,
      });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.contractSatisfaction, null);
      assert.equal(result.value.contractId, null);
    });
  });

  // ── EDGE-091: Constitutional mode — contractSatisfaction is boolean, contractId is set ──

  describe('EDGE-091: Constitutional mode — contractSatisfaction is boolean, contractId is set', () => {
    it('should allow EvalCase with contractSatisfaction=true and contractId set', () => {
      const evalCase = makeEvalCase({
        evalCaseId: evalCaseId('eval-constitutional-true'),
        contractId: missionContractId('contract-const-001'),
        contractSatisfaction: true,
      });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.contractSatisfaction, true);
      assert.equal(result.value.contractId, 'contract-const-001');
    });

    it('should allow EvalCase with contractSatisfaction=false and contractId set', () => {
      const evalCase = makeEvalCase({
        evalCaseId: evalCaseId('eval-constitutional-false'),
        contractId: missionContractId('contract-const-002'),
        contractSatisfaction: false,
      });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.contractSatisfaction, false);
      assert.equal(result.value.contractId, 'contract-const-002');
    });
  });

  // ── INV-X04: EvalCase carries schemaVersion ──

  describe('INV-X04: EvalCase carries schemaVersion', () => {
    it('should preserve schemaVersion on created EvalCase', () => {
      const evalCase = makeEvalCase({ schemaVersion: '0.3.0' });
      const result = gov.evalCaseStore.create(conn, evalCase);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.schemaVersion, '0.3.0');
    });
  });

  // ── BC-090: get returns null for non-existent evalCaseId ──

  describe('BC-090: get returns null for non-existent evalCaseId', () => {
    it('should return null when evalCaseId does not exist', () => {
      const result = gov.evalCaseStore.get(conn, evalCaseId('eval-nonexistent-999'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value, null);
    });
  });
});
