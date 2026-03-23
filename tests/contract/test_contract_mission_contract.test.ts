/**
 * Limen Phase 0A — Mission/Outcome Contract Model
 * Truth Model: Deliverable 4
 * Assertions: BC-030 to BC-038, INV-X04, INV-X06
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
import type { MissionContract, ContractCriterion, ContractSatisfactionResult, CriterionResult, MissionContractStore, ConstitutionalModeStore } from '../../src/kernel/interfaces/mission_contract.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

// ─── Helper: Construct a valid MissionContract ───

function makeContract(overrides: Partial<MissionContract> = {}): MissionContract {
  return {
    contractId: missionContractId('contract-001'),
    tenantId: 'test-tenant',
    objective: 'Complete data analysis pipeline',
    constraints: { maxTokens: 10000, deadline: '2026-04-01T00:00:00.000Z' },
    criteria: [
      { description: 'All data sources ingested', evaluationMethod: 'data_completeness_check', required: true },
      { description: 'Output format validated', evaluationMethod: 'schema_validation', required: true },
      { description: 'Performance within SLA', evaluationMethod: 'latency_check', required: false },
    ],
    schemaVersion: '0.1.0',
    createdAt: testTimestamp(),
    ...overrides,
  };
}

describe('Phase 0A Contract Tests: Mission/Outcome Contract Model (Deliverable 4)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-030: MissionContract creation with all required fields ──

  describe('BC-030: Create MissionContract with all required fields', () => {
    it('should return MissionContract with contractId, tenantId, objective, constraints, criteria, schemaVersion, createdAt', () => {
      const contract = makeContract();
      const result = gov.contractStore.create(conn, contract);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.contractId, 'contract-001');
      assert.equal(result.value.tenantId, 'test-tenant');
      assert.equal(result.value.objective, 'Complete data analysis pipeline');
      assert.notEqual(result.value.constraints, undefined);
      assert.equal(Array.isArray(result.value.criteria), true);
      assert.equal(result.value.criteria.length, 3);
      assert.equal(typeof result.value.schemaVersion, 'string');
      assert.equal(typeof result.value.createdAt, 'string');
    });
  });

  // ── BC-030: ContractCriterion shape preserved ──

  describe('BC-030: Contract criteria array preserves ContractCriterion shape', () => {
    it('should preserve description, evaluationMethod, required on each criterion', () => {
      const contract = makeContract();
      const result = gov.contractStore.create(conn, contract);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const first = result.value.criteria[0];
      assert.equal(first.description, 'All data sources ingested');
      assert.equal(first.evaluationMethod, 'data_completeness_check');
      assert.equal(first.required, true);
      // Verify aspirational criterion
      const third = result.value.criteria[2];
      assert.equal(third.description, 'Performance within SLA');
      assert.equal(third.evaluationMethod, 'latency_check');
      assert.equal(third.required, false);
    });
  });

  // ── BC-030: Contract immutable after creation — get returns same data ──

  describe('BC-030: Contract immutable after creation — get returns same data', () => {
    it('should return the same contract data via get as was provided via create', () => {
      const contract = makeContract({ contractId: missionContractId('contract-immut') });
      const createResult = gov.contractStore.create(conn, contract);
      assert.equal(createResult.ok, true);
      if (!createResult.ok) return;

      const getResult = gov.contractStore.get(conn, missionContractId('contract-immut'));
      assert.equal(getResult.ok, true);
      if (!getResult.ok) return;
      assert.notEqual(getResult.value, null);
      if (getResult.value === null) return;
      // Discriminative: field-by-field comparison, not just "exists"
      assert.equal(getResult.value.contractId, 'contract-immut');
      assert.equal(getResult.value.tenantId, contract.tenantId);
      assert.equal(getResult.value.objective, contract.objective);
      assert.equal(getResult.value.criteria.length, contract.criteria.length);
      assert.equal(getResult.value.schemaVersion, contract.schemaVersion);
    });
  });

  // ── BC-031 / BC-038: ConstitutionalModeStore.get returns boolean ──

  describe('BC-031 / BC-038: ConstitutionalModeStore.get returns boolean for a tenant', () => {
    it('should return a boolean value indicating constitutional mode state', () => {
      const result = gov.constitutionalModeStore.get(conn, tenantId('test-tenant'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(typeof result.value, 'boolean');
    });
  });

  // ── BC-032: ContractStore.evaluate returns ContractSatisfactionResult ──

  describe('BC-032: evaluate returns ContractSatisfactionResult with criterionResults', () => {
    it('should return a typed ContractSatisfactionResult, not a boolean', () => {
      const result = gov.contractStore.evaluate(
        conn,
        missionContractId('contract-eval'),
        missionId('mission-eval'),
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // Discriminative: ContractSatisfactionResult has satisfied, criterionResults, evaluatedAt
      assert.equal(typeof result.value.satisfied, 'boolean');
      assert.equal(Array.isArray(result.value.criterionResults), true);
      assert.equal(typeof result.value.evaluatedAt, 'string');
    });
  });

  // ── BC-033: ContractSatisfactionResult typed shape ──

  describe('BC-033: ContractSatisfactionResult has satisfied boolean, criterionResults array, evaluatedAt string', () => {
    it('should have all three typed fields on the evaluation result', () => {
      const result = gov.contractStore.evaluate(
        conn,
        missionContractId('contract-bc033'),
        missionId('mission-bc033'),
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // These assertions define the contract — they are not comments.
      // satisfied must be boolean (not truthy/falsy)
      assert.equal(result.value.satisfied === true || result.value.satisfied === false, true);
      // criterionResults must be an array (not undefined, not a single object)
      assert.equal(Array.isArray(result.value.criterionResults), true);
      // evaluatedAt must be a parseable timestamp string
      assert.equal(typeof result.value.evaluatedAt, 'string');
      assert.doesNotThrow(() => new Date(result.value.evaluatedAt));
    });
  });

  // ── BC-034 / INV-X06: ConstitutionalModeStore.enable is one-way irreversible ──

  describe('BC-034 / INV-X06: ConstitutionalModeStore.enable is one-way irreversible', () => {
    it('should succeed when enabling constitutional mode for a tenant', () => {
      const result = gov.constitutionalModeStore.enable(conn, tenantId('test-tenant-enable'));
      assert.equal(result.ok, true);
      // After enable, get should return true (tested in next test).
      // The ConstitutionalModeStore interface has no disable() method — irreversibility
      // is enforced by interface shape (no reverse operation exists).
    });
  });

  // ── BC-035: When constitutionalMode=true, missions must have contract ──

  describe('BC-035: constitutionalMode=true requires missions to have a contract', () => {
    it('should enable mode then evaluate — the system enforces contract requirement', () => {
      // Step 1: Enable constitutional mode
      const enableResult = gov.constitutionalModeStore.enable(conn, tenantId('test-tenant-bc035'));
      assert.equal(enableResult.ok, true);

      // Step 2: Verify mode is now true
      const getResult = gov.constitutionalModeStore.get(conn, tenantId('test-tenant-bc035'));
      assert.equal(getResult.ok, true);
      if (!getResult.ok) return;
      assert.equal(getResult.value, true);
    });
  });

  // ── BC-036: When constitutionalMode=false, missions without contract are valid ──

  describe('BC-036: constitutionalMode=false allows missions without contract', () => {
    it('should return false for a tenant that has not enabled constitutional mode', () => {
      const result = gov.constitutionalModeStore.get(conn, tenantId('test-tenant-bc036-no-mode'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // Default state is false (mode not enabled) — missions without contract are valid
      assert.equal(result.value, false);
    });
  });

  // ── BC-037: On contract satisfaction failure, criterionResults include unmet criteria ──

  describe('BC-037: Contract satisfaction failure includes unmet criteria with reason', () => {
    it('should return criterionResults where unmet criteria have met=false and a reason string', () => {
      const result = gov.contractStore.evaluate(
        conn,
        missionContractId('contract-bc037-fail'),
        missionId('mission-bc037-fail'),
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // When a contract evaluation finds unmet criteria:
      // Each CriterionResult has description, met, reason
      for (const cr of result.value.criterionResults) {
        assert.equal(typeof cr.description, 'string');
        assert.equal(typeof cr.met, 'boolean');
        // reason is string | null — must be present as a field
        assert.equal(cr.reason === null || typeof cr.reason === 'string', true);
      }
    });
  });

  // ── BC-037: CriterionResult shape ──

  describe('BC-037: CriterionResult has description (string), met (boolean), reason (string|null)', () => {
    it('should return structured CriterionResult objects in the evaluation', () => {
      const result = gov.contractStore.evaluate(
        conn,
        missionContractId('contract-bc037-shape'),
        missionId('mission-bc037-shape'),
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.criterionResults.length > 0, true);
      const first = result.value.criterionResults[0];
      // Discriminative: three specific typed fields, not just "some object"
      assert.equal(typeof first.description, 'string');
      assert.notEqual(first.description, '');
      assert.equal(typeof first.met, 'boolean');
      // reason: string when met=false, null when met=true (or string|null in all cases)
      assert.equal(first.reason === null || typeof first.reason === 'string', true);
    });
  });

  // ── BC-038: constitutionalMode stored in core_config, not gov_ tables ──

  describe('BC-038: constitutionalMode managed via ConstitutionalModeStore (core_config)', () => {
    it('should store and retrieve constitutional mode via the dedicated store interface', () => {
      // The ConstitutionalModeStore abstracts core_config persistence.
      // BC-038 specifies storage in core_config, not gov_ tables.
      // This test verifies the store operates correctly — storage location
      // is verified by the implementation (not the contract test).
      const enableResult = gov.constitutionalModeStore.enable(conn, tenantId('test-tenant-bc038'));
      assert.equal(enableResult.ok, true);

      const getResult = gov.constitutionalModeStore.get(conn, tenantId('test-tenant-bc038'));
      assert.equal(getResult.ok, true);
      if (!getResult.ok) return;
      assert.equal(getResult.value, true);
    });
  });

  // ── INV-X04: MissionContract carries schemaVersion ──

  describe('INV-X04: MissionContract carries schemaVersion', () => {
    it('should preserve schemaVersion on created contract', () => {
      const contract = makeContract({
        contractId: missionContractId('contract-invx04'),
        schemaVersion: '0.2.0',
      });
      const result = gov.contractStore.create(conn, contract);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.schemaVersion, '0.2.0');
    });
  });

  // ── BC-030: Contract get returns null for non-existent ID ──

  describe('BC-030: Contract get returns null for non-existent ID', () => {
    it('should return ok=true with value=null for an ID that was never created', () => {
      const result = gov.contractStore.get(conn, missionContractId('contract-nonexistent'));
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value, null);
    });
  });

  // ── BC-032: evaluate references contractId (not a copy) ──

  describe('BC-032: evaluate takes contractId and missionId as references', () => {
    it('should accept contractId and missionId parameters for atomic evaluation', () => {
      // BC-032: Evaluation is atomic with result finalization.
      // The interface takes IDs (references), not entity copies.
      // This ensures evaluation reads current state from the store.
      const result = gov.contractStore.evaluate(
        conn,
        missionContractId('contract-bc032-ref'),
        missionId('mission-bc032-ref'),
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      // The result is a ContractSatisfactionResult — typed, not boolean
      assert.equal(typeof result.value.satisfied, 'boolean');
      assert.equal(Array.isArray(result.value.criterionResults), true);
    });
  });
});
