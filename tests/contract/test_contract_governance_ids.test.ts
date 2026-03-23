/**
 * Limen Phase 0A — Governance Branded ID System + Structured Violation Model
 * Truth Model: Deliverable 1 (Branded IDs), Deliverable 7 (Error Model)
 * Assertions: BC-001 through BC-006, BC-080, BC-081, INV-X10
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
import {
  runId, attemptId, traceEventId, correlationId,
  missionContractId, supervisorDecisionId, evalCaseId,
  capabilityManifestId, suspensionRecordId, testTimestamp,
} from '../helpers/governance_test_helpers.js';
import type { LimenViolation, ViolationType } from '../../src/kernel/interfaces/governance_ids.js';
import type { Attempt, AttemptState, AttemptPinnedVersions, AttemptFailureRef } from '../../src/kernel/interfaces/run_identity.js';
import type { TraceEventInput } from '../../src/kernel/interfaces/trace.js';

let conn: DatabaseConnection;
let ctx: OperationContext;
let gov: GovernanceSystem;

async function setup(): Promise<void> {
  conn = createTestDatabase();
  ctx = createTestOperationContext();
  gov = createGovernanceSystem();
}

describe('Phase 0A Contract Tests: Governance IDs (Deliverable 1)', () => {
  beforeEach(async () => { await setup(); });

  // ── BC-001: Branded IDs accepted by governance stores ──

  describe('BC-001: RunId accepted by RunStore', () => {
    it('should accept a branded RunId for retrieval', () => {
      const result = gov.runStore.get(conn, runId('run-bc001'));
      assert.equal(result.ok, true);
      assert.equal(result.value, null);
    });
  });

  describe('BC-001: AttemptId accepted by AttemptStore', () => {
    it('should accept a branded AttemptId for retrieval', () => {
      const result = gov.attemptStore.get(conn, attemptId('attempt-bc001'));
      assert.equal(result.ok, true);
      assert.equal(result.value, null);
    });
  });

  describe('BC-001: MissionContractId accepted by ContractStore', () => {
    it('should accept a branded MissionContractId for retrieval', () => {
      const result = gov.contractStore.get(conn, missionContractId('contract-bc001'));
      assert.equal(result.ok, true);
      assert.equal(result.value, null);
    });
  });

  describe('BC-001: SupervisorDecisionId accepted by SupervisorDecisionStore', () => {
    it('should accept a branded SupervisorDecisionId for retrieval', () => {
      const result = gov.supervisorDecisionStore.get(conn, supervisorDecisionId('decision-bc001'));
      assert.equal(result.ok, true);
      assert.equal(result.value, null);
    });
  });

  describe('BC-001: EvalCaseId accepted by EvalCaseStore', () => {
    it('should accept a branded EvalCaseId for retrieval', () => {
      const result = gov.evalCaseStore.get(conn, evalCaseId('eval-bc001'));
      assert.equal(result.ok, true);
      assert.equal(result.value, null);
    });
  });

  describe('BC-001: CapabilityManifestId accepted by CapabilityManifestStore', () => {
    it('should accept a branded CapabilityManifestId for retrieval', () => {
      const result = gov.capabilityManifestStore.get(conn, capabilityManifestId('manifest-bc001'));
      assert.equal(result.ok, true);
      assert.equal(result.value, null);
    });
  });

  // ── BC-006 / INV-X10: CorrelationId links EventBus + TraceEmitter ──

  describe('BC-006/INV-X10: CorrelationId shared across trace systems', () => {
    it('should accept same CorrelationId in both traceEmitter.emit and traceEventStore.getByCorrelation', () => {
      const cid = correlationId('corr-bc006-shared');
      const input: TraceEventInput = {
        runId: runId('run-bc006'),
        correlationId: cid,
        type: 'mission.created',
        payload: {
          type: 'mission.created',
          missionId: missionId('mission-bc006'),
          agentId: agentId('agent-bc006'),
        },
      };
      const emitResult = gov.traceEmitter.emit(conn, ctx, input);
      assert.equal(emitResult.ok, true);
      assert.equal(typeof emitResult.value, 'string');

      const queryResult = gov.traceEventStore.getByCorrelation(conn, cid);
      assert.equal(queryResult.ok, true);
      assert.equal(Array.isArray(queryResult.value), true);
    });
  });

  // ── BC-080: LimenViolation with all 6 ViolationType values ──

  describe('BC-080: LimenViolation with all ViolationType values stored through Attempt', () => {
    it('should preserve violations with all 6 ViolationType values in Attempt.triggeringFailure', () => {
      const allTypes: ViolationType[] = ['INVARIANT', 'LIFECYCLE', 'AUTHORITY', 'BUDGET', 'CAPABILITY', 'POLICY'];
      const violations: LimenViolation[] = allTypes.map(t => ({
        type: t,
        code: `TEST_${t}`,
        message: `Test violation for ${t}`,
        spec: '§test',
      }));

      const failure: AttemptFailureRef = {
        priorAttemptId: attemptId('attempt-prior'),
        errorCode: 'TEST_ERROR',
        violations,
        summary: 'Test failure with all violation types',
      };

      const attempt: Attempt = {
        attemptId: attemptId('attempt-bc080'),
        taskId: taskId('task-bc080'),
        missionId: missionId('mission-bc080'),
        runId: runId('run-bc080'),
        state: 'started' as AttemptState,
        triggeringFailure: failure,
        pinnedVersions: {
          missionContractVersion: '1.0.0',
          traceGrammarVersion: '1.0.0',
          evalSchemaVersion: '1.0.0',
          capabilityManifestSchemaVersion: '1.0.0',
        },
        schemaVersion: '0.1.0',
        origin: 'runtime',
        createdAt: testTimestamp(),
      };

      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.triggeringFailure?.violations?.length, 6);
      assert.equal(result.value.triggeringFailure?.violations?.[0]?.type, 'INVARIANT');
      assert.equal(result.value.triggeringFailure?.violations?.[1]?.type, 'LIFECYCLE');
      assert.equal(result.value.triggeringFailure?.violations?.[2]?.type, 'AUTHORITY');
      assert.equal(result.value.triggeringFailure?.violations?.[3]?.type, 'BUDGET');
      assert.equal(result.value.triggeringFailure?.violations?.[4]?.type, 'CAPABILITY');
      assert.equal(result.value.triggeringFailure?.violations?.[5]?.type, 'POLICY');
    });
  });

  // ── BC-080: LimenViolation required fields ──

  describe('BC-080: LimenViolation required fields preserved', () => {
    it('should preserve type, code, message, spec, and optional context on LimenViolation', () => {
      const violation: LimenViolation = {
        type: 'INVARIANT',
        code: 'INV_VIOLATION_001',
        message: 'Schema version mismatch detected',
        spec: '§INV-X04',
        context: { expected: '1.0.0', actual: '0.9.0' },
      };

      const attempt: Attempt = {
        attemptId: attemptId('attempt-bc080-fields'),
        taskId: taskId('task-bc080-fields'),
        missionId: missionId('mission-bc080-fields'),
        runId: runId('run-bc080-fields'),
        state: 'started' as AttemptState,
        triggeringFailure: {
          priorAttemptId: attemptId('attempt-prior-fields'),
          errorCode: 'INV_VIOLATION_001',
          violations: [violation],
          summary: 'Schema version mismatch',
        },
        pinnedVersions: {
          missionContractVersion: '1.0.0',
          traceGrammarVersion: '1.0.0',
          evalSchemaVersion: '1.0.0',
          capabilityManifestSchemaVersion: '1.0.0',
        },
        schemaVersion: '0.1.0',
        origin: 'runtime',
        createdAt: testTimestamp(),
      };

      const result = gov.attemptStore.create(conn, attempt);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const v = result.value.triggeringFailure?.violations?.[0];
      assert.equal(v?.type, 'INVARIANT');
      assert.equal(v?.code, 'INV_VIOLATION_001');
      assert.equal(v?.message, 'Schema version mismatch detected');
      assert.equal(v?.spec, '§INV-X04');
      assert.deepStrictEqual(v?.context, { expected: '1.0.0', actual: '0.9.0' });
    });
  });
});
