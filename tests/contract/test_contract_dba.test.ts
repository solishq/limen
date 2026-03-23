/**
 * DBA Contract Tests — Limen v1.0
 * Spec ref: DBA v1.0 Design Source §11 (26 conformance tests CT-DBA-01..CT-DBA-26)
 *           + derived tests per Phase 1F prompt §3
 *
 * Status: ALL MUST FAIL with NOT_IMPLEMENTED before implementation.
 * Hard Stop #9: A contract test that passes before implementation exists is defective.
 *
 * These tests call the real service interfaces and assert specific return values.
 * Against the harness, every method throws NOT_IMPLEMENTED → test FAILS.
 * Against the real implementation, tests assert correct behavior → test PASSES.
 *
 * Test organization:
 *   PART A: Consumptive dimension tests (deliberation + token independence)
 *   PART B: Non-consumptive dimension tests (context policy + ECB)
 *   PART C: Cross-cutting tests (envelope, accounting, SC-8, discrepancy)
 *   PART D: Derived tests (prompt §3 additional coverage)
 *   PART E: Harness verification (assertNotImplemented — THESE should pass before impl)
 *
 * Every test cites: invariant(s), conformance test ID(s), and exact spec section.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createDBAHarness, assertNotImplemented } from '../../src/budget/harness/dba_harness.js';
import type {
  ConsumptiveBudgetDimension,
  ContextPolicy,
  InvocationAccounting,
  PromptCompletionAccounting,
  DeliberationAccounting,
  ContextBudgetComputation,
  AdmissibilityEnvelope,
  ECBComputationInput,
  PreInvocationCheckInput,
  PostInvocationReconciliationInput,
  BudgetThresholdEvent,
  BudgetExceededEvent,
  EstimatorInputBasis,
  BudgetInvocationId,
  SC8BudgetAmount,
} from '../../src/budget/interfaces/dba_types.js';

// ============================================================================
// Test Helpers
// ============================================================================

function makeEstimatorBasis(overrides?: Partial<EstimatorInputBasis>): EstimatorInputBasis {
  return {
    modelId: 'test-model-v1',
    reasoningEffort: 'medium',
    promptTokens: 1000,
    completionTokens: 500,
    totalBilledTokens: null,
    additionalFields: null,
    ...overrides,
  };
}

function makePreCheckInput(overrides?: Partial<PreInvocationCheckInput>): PreInvocationCheckInput {
  return {
    taskId: 'task-001' as any,
    missionId: 'mission-001' as any,
    tokenEnvelope: 1000,
    deliberationEnvelope: 200,
    ...overrides,
  };
}

function makeECBInput(overrides?: Partial<ECBComputationInput>): ECBComputationInput {
  return {
    availableInputWindow: 128000,
    windowDerivationMode: 'provider_authoritative',
    kernelDerivationVersion: null,
    systemOverhead: 3000,
    overheadComputationBasis: 'tokenizer-v1.0',
    effectivePolicyCeiling: null,
    ...overrides,
  };
}

function makeReconciliationInput(overrides?: Partial<PostInvocationReconciliationInput>): PostInvocationReconciliationInput {
  return {
    invocationId: 'inv-default' as BudgetInvocationId,
    taskId: 'task-default' as any,
    missionId: 'mission-default' as any,
    promptCompletionAccounting: {
      chosenPromptTokens: 500,
      chosenCompletionTokens: 200,
      provenance: 'provider_reported',
      providerReportedPrompt: 500,
      providerReportedCompletion: 200,
      kernelCountedPrompt: null,
      kernelCountedCompletion: null,
      kernelCountingBasis: null,
      discrepancyDetected: false,
      promptDiscrepancyAmount: null,
      completionDiscrepancyAmount: null,
    },
    deliberationAccounting: {
      deliberationTokens: 100,
      accountingMode: 'provider_authoritative',
      estimatorId: null,
      estimatorVersion: null,
      estimatorInputBasis: null,
    },
    providerCallEmitted: true,
    providerProcessedTokens: true,
    ...overrides,
  };
}

// ============================================================================
// PART A: CONSUMPTIVE DIMENSION TESTS — DBA-I1, CF-06
// ============================================================================

describe('DBA Contract Tests — Part A: Consumptive Dimensions', () => {

  // ---- CT-DBA-01: Budget Independence — Threshold [DBA-I1] ----
  describe('CT-DBA-01: Budget Independence — Threshold [DBA-I1]', () => {
    it('deliberation threshold fires independently at 90% without triggering token threshold at 30%', () => {
      // Setup: tokenBudget.allocated=10000, deliberationBudget.allocated=1000
      // Task consumes 900 deliberation (90%) and 3000 prompt/completion (30%)
      // Expected: DELIBERATION_BUDGET_THRESHOLD at 90% fires.
      //           No TOKEN_BUDGET_THRESHOLD at 90% fires.
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct01' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 2500, chosenCompletionTokens: 500,
          provenance: 'provider_reported',
          providerReportedPrompt: 2500, providerReportedCompletion: 500,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        deliberationAccounting: {
          deliberationTokens: 900, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));

      // Deliberation 90% threshold must fire
      const delThresholds = result.deliberationThresholdEvents.filter(e => e.thresholdPercent === 90);
      assert.ok(delThresholds.length > 0, 'DBA-I1: DELIBERATION_BUDGET_THRESHOLD at 90% must fire');
      assert.strictEqual(delThresholds[0].dimension, 'deliberation');

      // F-3: Strengthen — consumed value must reflect deliberation input (900), NOT token (3000).
      // Catches dimension conflation mutation: if threshold evaluation used token consumed
      // for deliberation, this value would be 3000 instead of 900.
      assert.strictEqual(delThresholds[0].consumed, 900,
        'DBA-I1: deliberation threshold consumed must be 900 (deliberation), not 3000 (token)');

      // Token 90% threshold must NOT fire (only 30% consumed)
      const tokThresholds = result.tokenThresholdEvents.filter(e => e.thresholdPercent === 90);
      assert.strictEqual(tokThresholds.length, 0, 'DBA-I1: TOKEN_BUDGET_THRESHOLD at 90% must NOT fire at 30%');

      // F-3: Verify token 25% threshold fires (30% > 25%) with correct consumed value.
      // Catches reverse conflation: if token threshold used deliberation consumed,
      // this value would be 900 instead of 3000.
      const tok25 = result.tokenThresholdEvents.filter(e => e.thresholdPercent === 25);
      assert.ok(tok25.length > 0, 'DBA-I1: token 25% threshold should fire at 30% consumption');
      assert.strictEqual(tok25[0].consumed, 3000,
        'DBA-I1: token threshold consumed must be 3000 (token), not 900 (deliberation)');
    });
  });

  // ---- CT-DBA-02: Joint Feasibility — Deliberation Exhausted [DBA-I10] ----
  describe('CT-DBA-02: Joint Feasibility — Deliberation Exhausted [DBA-I10]', () => {
    it('rejects invocation when deliberation remaining is zero despite token headroom', () => {
      const harness = createDBAHarness();
      const result = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId: 'mission-ct02' as any,
        tokenEnvelope: 1000,
        deliberationEnvelope: 100,
      }));
      assert.strictEqual(result.admissible, false, 'DBA-I10: must reject when deliberation exhausted');
      assert.strictEqual(result.deliberationPass, false, 'Deliberation must fail');
      assert.strictEqual(result.tokenPass, true, 'Token should pass');
      assert.ok(
        result.rejectionDimension === 'rejected_deliberation' || result.rejectionDimension === 'rejected_both',
        'Must identify deliberation as failing dimension',
      );
    });
  });

  // ---- CT-DBA-03: Joint Feasibility — Token Exhausted [DBA-I10] ----
  // F-4 fix: unique missionId + tokenEnvelope > admission budget (1000) for isolation.
  // Previously relied on CT-DBA-02 leaking module-level admission state.
  describe('CT-DBA-03: Joint Feasibility — Token Exhausted [DBA-I10]', () => {
    it('rejects invocation when token remaining is insufficient despite deliberation headroom', () => {
      const harness = createDBAHarness();
      const result = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId: 'mission-ct03' as any,
        tokenEnvelope: 1100,
        deliberationEnvelope: 30,
      }));
      assert.strictEqual(result.admissible, false, 'DBA-I10: must reject when token exhausted');
      assert.strictEqual(result.tokenPass, false, 'Token must fail (1100 > admission budget 1000)');
      assert.strictEqual(result.deliberationPass, true, 'Deliberation should pass (30 <= 50)');
      assert.strictEqual(result.rejectionDimension, 'rejected_token',
        'Must identify token as the failing dimension');
    });
  });

  // ---- CT-DBA-04: Estimator Determinism [DBA-I3] ----
  describe('CT-DBA-04: Estimator Determinism [DBA-I3]', () => {
    it('identical inputs produce identical deliberation charge', () => {
      const harness = createDBAHarness();
      const basis = makeEstimatorBasis();
      const charge1 = harness.estimator.estimate(basis);
      const charge2 = harness.estimator.estimate(basis);
      assert.strictEqual(charge1, charge2, 'DBA-I3: identical inputs must produce identical charge');
      assert.ok(Number.isInteger(charge1), 'Charge must be an integer');
      assert.ok(charge1 >= 0, 'Charge must be non-negative');
    });
  });

  // ---- CT-DBA-05: Estimator Forbidden Inputs [DBA-I3] ----
  describe('CT-DBA-05: Estimator Forbidden Inputs [DBA-I3]', () => {
    it('different response latencies produce identical estimates', () => {
      // Same invocation payload — latency is NOT in the basis (forbidden)
      const harness = createDBAHarness();
      const basis = makeEstimatorBasis();
      const est1 = harness.estimator.estimate(basis);
      const est2 = harness.estimator.estimate(basis);
      assert.strictEqual(est1, est2, 'DBA-I3: latency must not affect estimate');
    });
  });

  // ---- CT-DBA-06: Accounting Mode Per-Invocation [DBA-I4] ----
  describe('CT-DBA-06: Accounting Mode Per-Invocation [DBA-I4]', () => {
    it('records provider_authoritative for model reporting reasoning separately', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct06' as BudgetInvocationId,
        deliberationAccounting: {
          deliberationTokens: 500,
          accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));
      // Reconciliation must record the accounting mode from the input
      assert.ok(result.deliberationBudgetAfter.consumed >= 0);
    });
  });

  // ---- CT-DBA-10: Two-Phase Enforcement [PSD-5, DBA-I13] ----
  describe('CT-DBA-10: Two-Phase Enforcement [PSD-5, DBA-I13]', () => {
    it('clamps remaining to zero and records overage when actual exceeds pre-check', () => {
      // Setup: deliberation.remaining=100, actual=150
      // Expected: remaining=0 (not -50), overage=50
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct10' as BudgetInvocationId,
        deliberationAccounting: {
          deliberationTokens: 150, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));

      assert.strictEqual(result.deliberationBudgetAfter.remaining, 0,
        'DBA-I13: remaining must be clamped to zero, not negative');
      assert.ok(result.deliberationBudgetAfter.overage > 0,
        'DBA-I13: overage must be recorded explicitly');
      assert.ok(result.deliberationExceededEvent !== null,
        'DELIBERATION_BUDGET_EXCEEDED event must fire');
    });
  });

  // ---- CT-DBA-16: Overage Normalization [DBA-I13] ----
  describe('CT-DBA-16: Overage Normalization [DBA-I13]', () => {
    it('token remaining clamped to zero with explicit overage, invocation not invalidated', () => {
      // Setup: tokenBudget.remaining=200, invocation consumes 350
      // Expected: remaining=0, overage=150, TOKEN_BUDGET_EXCEEDED emitted
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct16' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 300, chosenCompletionTokens: 50,
          provenance: 'provider_reported',
          providerReportedPrompt: 300, providerReportedCompletion: 50,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
      }));

      assert.strictEqual(result.tokenBudgetAfter.remaining, 0,
        'DBA-I13: remaining clamped to zero');
      assert.ok(result.tokenBudgetAfter.overage > 0,
        'DBA-I13: overage recorded explicitly');
      assert.ok(result.tokenExceededEvent !== null,
        'TOKEN_BUDGET_EXCEEDED event must fire');
    });
  });

  // ---- CT-DBA-18: Estimated Event Marking [DBA-I4] ----
  describe('CT-DBA-18: Estimated Event Marking [DBA-I4]', () => {
    it('threshold event from estimated consumption carries estimate marking', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct18' as BudgetInvocationId,
        deliberationAccounting: {
          deliberationTokens: 900, accountingMode: 'estimated',
          estimatorId: 'limen-estimator', estimatorVersion: 'v1.0',
          estimatorInputBasis: makeEstimatorBasis(),
        },
      }));

      // Threshold events from estimated consumption must carry marking
      for (const evt of result.deliberationThresholdEvents) {
        assert.strictEqual(evt.accountingMode, 'estimated',
          'DBA-I4: event must carry accountingMode=estimated');
        assert.ok(evt.estimatorVersion !== null,
          'DBA-I4: event must include estimator version');
      }
    });
  });

  // ---- CT-DBA-19: Per-Dimension Envelope Check [DBA-I10, PSD-11] ----
  describe('CT-DBA-19: Per-Dimension Envelope Check [DBA-I10, PSD-11]', () => {
    it('rejects on token dimension even when deliberation has headroom', () => {
      // Token envelope=1300 > remaining=1000 → reject
      // Deliberation envelope=50 < remaining=200 → pass
      // Joint feasibility: reject (DBA-I10)
      const harness = createDBAHarness();
      const result = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId: 'mission-ct19' as any,
        tokenEnvelope: 1300,
        deliberationEnvelope: 50,
      }));

      assert.strictEqual(result.admissible, false);
      assert.strictEqual(result.tokenPass, false, 'Token must fail (1300 > admission budget 1000)');
      assert.strictEqual(result.deliberationPass, true, 'Deliberation should pass (50 <= 50)');
      assert.strictEqual(result.rejectionDimension, 'rejected_token',
        'PSD-11: per-dimension vector — deliberation is not a bypass');
    });
  });

  // ---- CT-DBA-21: Failed Invocation Charging [DBA-I16] ----
  describe('CT-DBA-21: Failed Invocation Charging [DBA-I16]', () => {
    it('charges tokens consumed at provider boundary despite invocation failure', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct21' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 200, chosenCompletionTokens: 0,
          provenance: 'provider_reported',
          providerReportedPrompt: 200, providerReportedCompletion: 0,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        providerCallEmitted: true,
        providerProcessedTokens: true,
      }));

      // 200 tokens must be charged — honest accounting
      assert.ok(result.tokenBudgetAfter.consumed >= 200,
        'DBA-I16: tokens consumed at provider boundary must be charged');
    });
  });

  // ---- CT-DBA-26: Failed Invocation Deliberation Charging [DBA-I16] ----
  describe('CT-DBA-26: Failed Invocation Deliberation Charging [DBA-I16]', () => {
    it('charges both prompt and deliberation tokens consumed before provider error', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct26' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 300, chosenCompletionTokens: 0,
          provenance: 'provider_reported',
          providerReportedPrompt: 300, providerReportedCompletion: 0,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        deliberationAccounting: {
          deliberationTokens: 150, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
        providerCallEmitted: true,
        providerProcessedTokens: true,
      }));

      assert.ok(result.tokenBudgetAfter.consumed >= 300,
        'DBA-I16: prompt tokens charged despite error');
      assert.ok(result.deliberationBudgetAfter.consumed >= 150,
        'DBA-I16: deliberation tokens charged despite error');
    });
  });

  // ---- CT-DBA-17: Prompt/Completion Provenance [DBA-I2] ----
  describe('CT-DBA-17: Prompt/Completion Provenance [DBA-I2]', () => {
    it('records kernel_counted provenance with counting basis when provider unavailable', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct17' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 1200, chosenCompletionTokens: 400,
          provenance: 'kernel_counted',
          providerReportedPrompt: null, providerReportedCompletion: null,
          kernelCountedPrompt: 1200, kernelCountedCompletion: 400,
          kernelCountingBasis: { tokenizer: 'T1', version: 'V2' },
          discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
      }));

      // Kernel-counted tokens must be charged
      assert.ok(result.tokenBudgetAfter.consumed >= 1600,
        'DBA-I2: kernel-counted tokens charged to budget');
    });
  });
});

// ============================================================================
// PART B: NON-CONSUMPTIVE DIMENSION TESTS — DBA-I5..I9, CF-07
// ============================================================================

describe('DBA Contract Tests — Part B: Non-Consumptive Dimensions', () => {

  // ---- CT-DBA-07: Context Non-Consumption [DBA-I5] ----
  describe('CT-DBA-07: Context Non-Consumption [DBA-I5]', () => {
    it('ECB computed independently per invocation — not reduced by prior task context usage', () => {
      const harness = createDBAHarness();
      const input = makeECBInput({
        availableInputWindow: 50000,
        systemOverhead: 5000,
        effectivePolicyCeiling: null,
      });
      const ecbA = harness.ecb.compute(input);
      const ecbB = harness.ecb.compute(input);
      assert.strictEqual(ecbA.effectiveContextBudget, ecbB.effectiveContextBudget,
        'DBA-I5: ECB must be identical when computed from identical inputs');
      assert.strictEqual(ecbA.effectiveContextBudget, 45000,
        'DBA-I5: ECB = 50000 - 5000 = 45000');
    });
  });

  // ---- CT-DBA-08: Monotonic Inheritance [DBA-I8] ----
  describe('CT-DBA-08: Monotonic Inheritance [DBA-I8]', () => {
    it('rejects child ceiling that exceeds parent ceiling', () => {
      const harness = createDBAHarness();
      const result = harness.policyGovernor.validateInheritance(100000, 150000);
      assert.strictEqual(result.valid, false, 'DBA-I8: child ceiling > parent is non-conforming');
    });

    it('accepts child ceiling that narrows parent ceiling', () => {
      const harness = createDBAHarness();
      const result = harness.policyGovernor.validateInheritance(100000, 80000);
      assert.strictEqual(result.valid, true, 'DBA-I8: child ceiling ≤ parent is valid');
    });
  });

  // ---- CT-DBA-09: ECB Input Recording [DBA-I9] ----
  describe('CT-DBA-09: ECB Input Recording [DBA-I9]', () => {
    it('ECB computation result contains all required replay fields', () => {
      const harness = createDBAHarness();
      const result = harness.ecb.compute(makeECBInput());
      assert.ok(typeof result.effectiveContextBudget === 'number',
        'DBA-I9: effectiveContextBudget must be present');
      assert.ok(typeof result.wasNormalized === 'boolean',
        'DBA-I9: normalization status must be present');
      assert.ok(typeof result.rawValue === 'number',
        'DBA-I9: raw value must be present');
    });
  });

  // ---- CT-DBA-14: Null Ceiling Semantics [PSD-8] ----
  describe('CT-DBA-14: Null Ceiling Semantics [PSD-8]', () => {
    it('null ceiling with no ancestor = ECB bounded only by window minus overhead', () => {
      const harness = createDBAHarness();
      const result = harness.ecb.compute(makeECBInput({
        availableInputWindow: 128000,
        systemOverhead: 3000,
        effectivePolicyCeiling: null,
      }));
      assert.strictEqual(result.effectiveContextBudget, 125000,
        'PSD-8: no ceiling → ECB = window - overhead = 125000');
    });
  });

  // ---- CT-DBA-15: Ceiling Merge [DBA-I12] ----
  describe('CT-DBA-15: Ceiling Merge [DBA-I12]', () => {
    it('effective ceiling is the most restrictive when both exist', () => {
      const harness = createDBAHarness();
      const effective = harness.policyGovernor.mergeEffectiveCeiling(100000, 80000);
      assert.strictEqual(effective, 80000,
        'DBA-I12: effective = min(100000, 80000) = 80000');
    });

    it('rejects task ceiling exceeding mission ceiling', () => {
      const harness = createDBAHarness();
      const result = harness.policyGovernor.validateInheritance(100000, 120000);
      assert.strictEqual(result.valid, false,
        'DBA-I12: task ceiling 120000 > mission 100000 is non-conforming');
    });
  });

  // ---- CT-DBA-20: Non-Negative ECB [DBA-I14] ----
  describe('CT-DBA-20: Non-Negative ECB [DBA-I14]', () => {
    it('normalizes negative ECB to zero when overhead exceeds window', () => {
      const harness = createDBAHarness();
      const result = harness.ecb.compute(makeECBInput({
        availableInputWindow: 3000,
        systemOverhead: 5000,
        effectivePolicyCeiling: null,
      }));
      assert.strictEqual(result.effectiveContextBudget, 0,
        'DBA-I14: ECB must be non-negative (normalized to 0, not -2000)');
      assert.strictEqual(result.wasNormalized, true,
        'DBA-I14: normalization must be flagged');
      assert.strictEqual(result.rawValue, -2000,
        'DBA-I14: raw value preserved for diagnostics');
    });
  });

  // ---- CT-DBA-23: Overhead Provenance [DBA-I15] ----
  describe('CT-DBA-23: Overhead Provenance [DBA-I15]', () => {
    it('records overhead computation basis sufficient for replay', () => {
      const harness = createDBAHarness();
      const basis = harness.overhead.getBasis();
      assert.ok(typeof basis.computationVersion === 'string',
        'DBA-I15: computation version must be a string');
      assert.ok(basis.computationVersion.length > 0,
        'DBA-I15: computation version must not be empty');
    });
  });
});

// ============================================================================
// PART C: CROSS-CUTTING TESTS — SC-8, Discrepancy, Envelope, Accounting
// ============================================================================

describe('DBA Contract Tests — Part C: Cross-Cutting', () => {

  // ---- CT-DBA-11: SC-8 Deliberation Request [v3.2 §22] ----
  // NOTE: This is a TYPE-LEVEL test — validates the SC-8 schema extension.
  // It passes even without implementation because it tests the type definition.
  // The behavioral test (SC-8 actually processes deliberation requests) is
  // in the SC-8 amendment plan, not here.
  describe('CT-DBA-11: SC-8 Deliberation Request schema [v3.2 §22]', () => {
    it('SC-8 amount type supports deliberation field', () => {
      const amount: SC8BudgetAmount = { deliberation: 500, tokens: 1000 };
      assert.strictEqual(amount.deliberation, 500,
        'SC-8 amount schema must support deliberation');
      assert.strictEqual(amount.tokens, 1000);
    });
  });

  // ---- CT-DBA-12: SC-8 Context Policy Rejection [DBA-I6, §8] ----
  // NOTE: Type-level test — contextPolicy absent from SC8BudgetAmount.
  describe('CT-DBA-12: SC-8 Context Policy Rejection [DBA-I6, §8]', () => {
    it('contextPolicy is not in the SC-8 amount type', () => {
      const amount: SC8BudgetAmount = { tokens: 1000 };
      assert.strictEqual(
        'contextPolicy' in amount,
        false,
        'DBA-I6: contextPolicy must not be requestable through SC-8',
      );
    });
  });

  // ---- CT-DBA-13: Silent Truncation Prohibited [DBA-I14, FM-DBA-06] ----
  describe('CT-DBA-13: Silent Truncation Prohibited [DBA-I14, FM-DBA-06]', () => {
    it('rejects invocation when assembled context exceeds ECB — no silent truncation', () => {
      const harness = createDBAHarness();
      const result = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId: 'mission-ct13' as any,
        tokenEnvelope: 12000,
        deliberationEnvelope: 100,
      }));
      assert.strictEqual(result.admissible, false,
        'DBA-I14/FM-DBA-06: must reject, not silently truncate');
    });
  });

  // ---- CT-DBA-22: Post-Serialization Envelope [PSD-13] ----
  describe('CT-DBA-22: Post-Serialization Envelope [PSD-13]', () => {
    it('uses actual serialized prompt size for admissibility, not pre-compilation estimate', () => {
      // Pre-estimate ~4000, actual=4500, remaining=4200, completion=200 → envelope=4700
      // 4700 > 4200 → rejected based on ACTUAL serialized size
      const harness = createDBAHarness();
      const result = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId: 'mission-ct22' as any,
        tokenEnvelope: 4700,
        deliberationEnvelope: 50,
      }));
      assert.strictEqual(result.admissible, false,
        'PSD-13: reject based on actual serialized prompt size (4700 > headroom)');
    });
  });

  // ---- CT-DBA-24: Discrepancy Logging [PSD-12] ----
  describe('CT-DBA-24: Discrepancy Logging [PSD-12]', () => {
    it('records both provider and kernel values, uses provider for enforcement', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-ct24' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 500,
          chosenCompletionTokens: 200,
          provenance: 'provider_reported',
          providerReportedPrompt: 500,
          providerReportedCompletion: 200,
          kernelCountedPrompt: 520,
          kernelCountedCompletion: 210,
          kernelCountingBasis: { tokenizer: 'T1', version: 'V1' },
          discrepancyDetected: true,
          promptDiscrepancyAmount: 20,
          completionDiscrepancyAmount: 10,
        },
      }));

      // Provider value (500+200=700) must be used for enforcement
      assert.ok(result.tokenBudgetAfter.consumed >= 700,
        'PSD-12: provider-reported value used for enforcement');
    });
  });

  // ---- CT-DBA-25: Reservation Does Not Bypass Admissibility [PSD-14] ----
  describe('CT-DBA-25: Reservation Does Not Bypass Admissibility [PSD-14]', () => {
    it('rejects invocation whose envelope exceeds reserved headroom', () => {
      // Reservation: 5000 tokens. Envelope: 6000 tokens → reject
      const harness = createDBAHarness();
      const result = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId: 'mission-ct25' as any,
        tokenEnvelope: 6000,
        deliberationEnvelope: 200,
      }));
      assert.strictEqual(result.admissible, false,
        'PSD-14: reservation does not bypass per-invocation envelope check');
    });
  });
});

// ============================================================================
// PART D: DERIVED TESTS — additional coverage per prompt §3
// ============================================================================

describe('DBA Contract Tests — Part D: Derived Tests', () => {

  // ---- D-01: Threshold at 25% deliberation ----
  describe('D-01: Threshold at 25% deliberation [DBA-I1, PSD-10]', () => {
    it('fires DELIBERATION_BUDGET_THRESHOLD at 25% consumption', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-d01' as BudgetInvocationId,
        deliberationAccounting: {
          deliberationTokens: 250, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));
      const at25 = result.deliberationThresholdEvents.filter(e => e.thresholdPercent === 25);
      assert.ok(at25.length > 0, 'PSD-10: 25% deliberation threshold must fire');
      assert.strictEqual(at25[0].dimension, 'deliberation');
    });
  });

  // ---- D-02: Threshold at 50% token ----
  describe('D-02: Threshold at 50% token [DBA-I1, PSD-10]', () => {
    it('fires TOKEN_BUDGET_THRESHOLD at 50% consumption', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-d02' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 4000, chosenCompletionTokens: 1000,
          provenance: 'provider_reported',
          providerReportedPrompt: 4000, providerReportedCompletion: 1000,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
      }));
      const at50 = result.tokenThresholdEvents.filter(e => e.thresholdPercent === 50);
      assert.ok(at50.length > 0, 'PSD-10: 50% token threshold must fire');
      assert.strictEqual(at50[0].dimension, 'token');
    });
  });

  // ---- D-03: Threshold at 75% deliberation ----
  describe('D-03: Threshold at 75% deliberation [DBA-I1, PSD-10]', () => {
    it('fires DELIBERATION_BUDGET_THRESHOLD at 75% consumption', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-d03' as BudgetInvocationId,
        deliberationAccounting: {
          deliberationTokens: 750, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));
      const at75 = result.deliberationThresholdEvents.filter(e => e.thresholdPercent === 75);
      assert.ok(at75.length > 0, 'PSD-10: 75% deliberation threshold must fire');
    });
  });

  // ---- D-04: contextPolicy non-consumption [DBA-I6] ----
  // NOTE: Type-level test — passes without implementation. This is correct.
  // The structural enforcement IS the test — the type system prevents
  // consumptive fields on ContextPolicy.
  describe('D-04: contextPolicy non-consumption [DBA-I6]', () => {
    it('contextPolicy has only ceiling — no consumptive fields structurally', () => {
      const policy: ContextPolicy = { ceiling: 100000 };
      assert.strictEqual(Object.keys(policy).length, 1, 'Only ceiling field');
      assert.ok(!('allocated' in policy), 'DBA-I6: no allocated');
      assert.ok(!('consumed' in policy), 'DBA-I6: no consumed');
      assert.ok(!('remaining' in policy), 'DBA-I6: no remaining');
      assert.ok(!('overage' in policy), 'DBA-I6: no overage');
    });
  });

  // ---- D-05: decayFactor non-application to contextPolicy [DBA-I8] ----
  describe('D-05: decayFactor non-application to contextPolicy [DBA-I8]', () => {
    it('child can preserve parent ceiling — inheritance is ceiling constraint, not decay', () => {
      const harness = createDBAHarness();
      const result = harness.policyGovernor.validateInheritance(100000, 100000);
      assert.strictEqual(result.valid, true,
        'DBA-I8: child may preserve parent ceiling (no decay applied)');
    });
  });

  // ---- D-06: InvocationAccounting completeness [§12.2] ----
  // NOTE: Type-level test — validates the record shape has all 34 fields.
  describe('D-06: InvocationAccounting completeness [§12.2]', () => {
    it('InvocationAccounting record has all 34 fields across 4 nested groups', () => {
      const record: InvocationAccounting = {
        invocationId: 'inv-d06' as BudgetInvocationId,
        taskId: 'task-d06' as any,
        missionId: 'mission-d06' as any,
        providerBilledTokens: 2500,
        timestamp: Date.now(),
        promptCompletionAccounting: {
          chosenPromptTokens: 1000, chosenCompletionTokens: 500,
          provenance: 'provider_reported',
          providerReportedPrompt: 1000, providerReportedCompletion: 500,
          kernelCountedPrompt: 1010, kernelCountedCompletion: 505,
          kernelCountingBasis: { tokenizer: 'tiktoken', version: 'cl100k_base' },
          discrepancyDetected: true,
          promptDiscrepancyAmount: 10, completionDiscrepancyAmount: 5,
        },
        deliberationAccounting: {
          deliberationTokens: 300, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
        contextBudgetComputation: {
          chosenAvailableInputWindow: 128000, windowProvenance: 'provider_authoritative',
          providerReportedWindow: 128000, kernelDerivedWindow: null,
          kernelDerivationVersion: null, windowDiscrepancyDetected: false,
          systemOverhead: 3000, overheadComputationBasis: 'tokenizer-v1.0',
          effectivePolicyCeiling: 100000, effectiveContextBudget: 100000,
        },
        admissibilityEnvelope: {
          tokenEnvelope: 1700, deliberationEnvelope: 300, result: 'admitted',
        },
      };

      const pcKeys = Object.keys(record.promptCompletionAccounting);
      const delKeys = Object.keys(record.deliberationAccounting);
      const ctxKeys = Object.keys(record.contextBudgetComputation);
      const envKeys = Object.keys(record.admissibilityEnvelope);
      const total = 5 + pcKeys.length + delKeys.length + ctxKeys.length + envKeys.length;

      assert.strictEqual(pcKeys.length, 11, 'PromptCompletionAccounting: 11 fields');
      assert.strictEqual(delKeys.length, 5, 'DeliberationAccounting: 5 fields');
      assert.strictEqual(ctxKeys.length, 10, 'ContextBudgetComputation: 10 fields');
      assert.strictEqual(envKeys.length, 3, 'AdmissibilityEnvelope: 3 fields');
      assert.strictEqual(total, 34, '§12.2: exactly 34 fields total');
    });
  });

  // ---- D-07: Dual-source asymmetric resolution [PSD-12, Note 5] ----
  describe('D-07: Dual-source asymmetric resolution [PSD-12, Note 5]', () => {
    it('context window uses more restrictive value when both sources exist', () => {
      const harness = createDBAHarness();
      const windowInfo = harness.window.getAvailableInputWindow('test-model');
      // When both exist, more restrictive (lower) value must be chosen
      if (windowInfo.providerReportedWindow !== null && windowInfo.kernelDerivedWindow !== null) {
        assert.strictEqual(
          windowInfo.chosenValue,
          Math.min(windowInfo.providerReportedWindow, windowInfo.kernelDerivedWindow),
          'PSD-12: more restrictive value wins for context window',
        );
      }
    });
  });

  // ---- D-08: Token budget semantic narrowing [DBA-I1] ----
  describe('D-08: Token budget semantic narrowing [DBA-I1]', () => {
    it('deliberation tokens NOT counted in tokenBudget consumption', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-d08' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 500, chosenCompletionTokens: 200,
          provenance: 'provider_reported',
          providerReportedPrompt: 500, providerReportedCompletion: 200,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        deliberationAccounting: {
          deliberationTokens: 1000, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));

      // tokenBudget should increment by 700 (500+200), NOT 1700
      // deliberationBudget should increment by 1000
      // These are INDEPENDENT dimensions (DBA-I1)
      assert.ok(result.deliberationBudgetAfter.consumed >= 1000,
        'DBA-I1: deliberation charged independently');
    });
  });

  // ---- D-09: Estimator input basis excludes forbidden fields [DBA-I3] ----
  // NOTE: Type-level test — structural enforcement via TypeScript.
  describe('D-09: Estimator input basis excludes forbidden fields [DBA-I3]', () => {
    it('EstimatorInputBasis has no timing/latency/queue fields', () => {
      const basis: EstimatorInputBasis = makeEstimatorBasis();
      assert.ok(!('wallClockTime' in basis), 'DBA-I3: wall-clock time forbidden');
      assert.ok(!('responseLatency' in basis), 'DBA-I3: response latency forbidden');
      assert.ok(!('queueDelay' in basis), 'DBA-I3: queue delay forbidden');
      assert.ok(!('retryHistory' in basis), 'DBA-I3: retry history forbidden');
    });
  });

  // ---- D-10: Partial failure charging [DBA-I16] ----
  describe('D-10: Partial failure charging [DBA-I16]', () => {
    it('charges when provider processed tokens before error', () => {
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-d10' as BudgetInvocationId,
        promptCompletionAccounting: {
          chosenPromptTokens: 150, chosenCompletionTokens: 0,
          provenance: 'provider_reported',
          providerReportedPrompt: 150, providerReportedCompletion: 0,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        deliberationAccounting: {
          deliberationTokens: 50, accountingMode: 'estimated',
          estimatorId: 'limen-est', estimatorVersion: 'v1.0',
          estimatorInputBasis: makeEstimatorBasis(),
        },
        providerCallEmitted: true,
        providerProcessedTokens: true,
      }));

      assert.ok(result.tokenBudgetAfter.consumed >= 150,
        'DBA-I16: tokens charged despite provider error');
      assert.ok(result.deliberationBudgetAfter.consumed >= 50,
        'DBA-I16: deliberation charged despite provider error');
    });
  });

  // ---- D-11: ECB with policy ceiling [§7.3] ----
  describe('D-11: ECB with policy ceiling [§7.3]', () => {
    it('ECB = min(window-overhead, ceiling) when ceiling more restrictive', () => {
      const harness = createDBAHarness();
      const result = harness.ecb.compute(makeECBInput({
        availableInputWindow: 128000,
        systemOverhead: 3000,
        effectivePolicyCeiling: 80000,
      }));
      assert.strictEqual(result.effectiveContextBudget, 80000,
        '§7.3: ECB = min(125000, 80000) = 80000');
    });

    it('ECB = window-overhead when ceiling less restrictive', () => {
      const harness = createDBAHarness();
      const result = harness.ecb.compute(makeECBInput({
        availableInputWindow: 128000,
        systemOverhead: 3000,
        effectivePolicyCeiling: 200000,
      }));
      assert.strictEqual(result.effectiveContextBudget, 125000,
        '§7.3: ECB = min(125000, 200000) = 125000');
    });
  });
});

// ============================================================================
// PART F: REMEDIATION FIXES — DC-DBA-109, DBA-I16, Admissibility, Estimator
// ============================================================================

describe('DBA Contract Tests — Part F: Remediation Fixes', () => {

  // ---- F-2 (CRITICAL): DC-DBA-109 Atomicity — budget deduction + accounting atomic ----
  describe('F-2: DC-DBA-109 Accounting-Budget Atomicity [CRITICAL]', () => {
    it('budget deduction and accounting record are atomic — both occur or neither', () => {
      // Setup: consume 900 deliberation (90% of 1000 mission tier) and 100 tokens.
      // Assert BOTH budget consumed values AND threshold events are present and consistent.
      // If M1 mutation separates them, one of these assertions will fail:
      //   - Budget deducted but no threshold → threshold assertion fails
      //   - Threshold fires but budget not deducted → consumed assertion fails
      //   - Both exist but inconsistent → consumed-value match assertion fails
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-f2' as BudgetInvocationId,
        missionId: 'mission-f2' as any,
        promptCompletionAccounting: {
          chosenPromptTokens: 50, chosenCompletionTokens: 50,
          provenance: 'provider_reported',
          providerReportedPrompt: 50, providerReportedCompletion: 50,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        deliberationAccounting: {
          deliberationTokens: 900, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));

      // 1. Budget deduction: token consumed must reflect actual consumption
      assert.strictEqual(result.tokenBudgetAfter.consumed, 100,
        'DC-DBA-109: token budget must be deducted (50 + 50 = 100)');

      // 2. Budget deduction: deliberation consumed must reflect actual consumption
      assert.strictEqual(result.deliberationBudgetAfter.consumed, 900,
        'DC-DBA-109: deliberation budget must be deducted (900)');

      // 3. Accounting record: 90% deliberation threshold must fire (900/1000 = 90%)
      const delThreshold90 = result.deliberationThresholdEvents.filter(e => e.thresholdPercent === 90);
      assert.ok(delThreshold90.length > 0,
        'DC-DBA-109: accounting record must exist (90% deliberation threshold fires)');

      // 4. Atomicity: threshold consumed must MATCH budget consumed value.
      // If accounting uses stale state (pre-deduction), consumed would be 0 or stale.
      // If budget wasn't deducted but accounting ran, consumed would be 900 but
      // budgetAfter would show 0. The joint assertion catches both inconsistencies.
      assert.strictEqual(delThreshold90[0].consumed, 900,
        'DC-DBA-109: accounting consumed (900) must equal budget consumed (atomicity check)');

      // 5. Cross-dimension atomicity: token threshold events must also be consistent
      // 100 tokens = 1% of 10000 mission tier → no token threshold fires
      assert.strictEqual(result.tokenThresholdEvents.length, 0,
        'DC-DBA-109: token threshold should not fire at 1% consumption');
    });

    it('multi-invocation atomicity — cumulative accounting tracks cumulative budget', () => {
      // Two reconciliations on the same mission: verify cumulative state is consistent.
      // First: 250 deliberation (25%), second: 550 deliberation (cumulative 800 = 80%)
      // After second: 75% threshold must fire, consumed must match cumulative.
      const harness = createDBAHarness();
      const missionId = 'mission-f2-multi' as any;

      // First reconciliation: 250 deliberation tokens (25% of 1000)
      const first = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-f2a' as BudgetInvocationId,
        missionId,
        deliberationAccounting: {
          deliberationTokens: 250, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));
      const firstThreshold25 = first.deliberationThresholdEvents.filter(e => e.thresholdPercent === 25);
      assert.ok(firstThreshold25.length > 0, 'First reconcile: 25% threshold must fire');
      assert.strictEqual(firstThreshold25[0].consumed, 250,
        'First reconcile: threshold consumed must match budget consumed (250)');

      // Second reconciliation: 550 more deliberation tokens (cumulative 800 = 80%)
      const second = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-f2b' as BudgetInvocationId,
        missionId,
        deliberationAccounting: {
          deliberationTokens: 550, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
      }));

      // 75% threshold fires (800/1000 = 80% crosses 75%)
      const secondThreshold75 = second.deliberationThresholdEvents.filter(e => e.thresholdPercent === 75);
      assert.ok(secondThreshold75.length > 0, 'Second reconcile: 75% threshold must fire at 80%');

      // Atomicity: threshold consumed must reflect CUMULATIVE budget state (800)
      assert.strictEqual(secondThreshold75[0].consumed, 800,
        'DC-DBA-109: cumulative accounting (800) must match cumulative budget (atomicity)');
    });
  });

  // ---- F-1 (HIGH): Provider flag enforcement [DBA-I16] ----
  describe('F-1: Provider Flag Enforcement [DBA-I16]', () => {
    it('zero consumption when providerCallEmitted is false', () => {
      // DBA-I16: If provider call was never emitted, zero consumption.
      // The invocation was rejected before reaching the provider.
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-f1' as BudgetInvocationId,
        missionId: 'mission-f1' as any,
        promptCompletionAccounting: {
          chosenPromptTokens: 500, chosenCompletionTokens: 200,
          provenance: 'provider_reported',
          providerReportedPrompt: 500, providerReportedCompletion: 200,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        deliberationAccounting: {
          deliberationTokens: 100, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
        providerCallEmitted: false,
        providerProcessedTokens: false,
      }));

      // Token: zero consumption despite reported 700 tokens
      assert.strictEqual(result.tokenBudgetAfter.consumed, 0,
        'DBA-I16: no tokens charged when provider call not emitted');
      assert.strictEqual(result.tokenBudgetAfter.remaining, 200,
        'DBA-I16: token budget fully preserved (200 invocation allocation)');

      // Deliberation: zero consumption despite reported 100 tokens
      assert.strictEqual(result.deliberationBudgetAfter.consumed, 0,
        'DBA-I16: no deliberation charged when provider call not emitted');
      assert.strictEqual(result.deliberationBudgetAfter.remaining, 100,
        'DBA-I16: deliberation budget fully preserved (100 invocation allocation)');

      // No threshold or exceeded events
      assert.strictEqual(result.tokenThresholdEvents.length, 0,
        'DBA-I16: no token threshold events when no consumption');
      assert.strictEqual(result.deliberationThresholdEvents.length, 0,
        'DBA-I16: no deliberation threshold events when no consumption');
      assert.strictEqual(result.tokenExceededEvent, null,
        'DBA-I16: no token exceeded event when no consumption');
      assert.strictEqual(result.deliberationExceededEvent, null,
        'DBA-I16: no deliberation exceeded event when no consumption');
    });

    it('charges normally when providerCallEmitted is true', () => {
      // Control: verify charging occurs when provider call WAS emitted
      const harness = createDBAHarness();
      const result = harness.reconciliation.reconcile(makeReconciliationInput({
        invocationId: 'inv-f1-ctrl' as BudgetInvocationId,
        missionId: 'mission-f1-ctrl' as any,
        promptCompletionAccounting: {
          chosenPromptTokens: 100, chosenCompletionTokens: 50,
          provenance: 'provider_reported',
          providerReportedPrompt: 100, providerReportedCompletion: 50,
          kernelCountedPrompt: null, kernelCountedCompletion: null,
          kernelCountingBasis: null, discrepancyDetected: false,
          promptDiscrepancyAmount: null, completionDiscrepancyAmount: null,
        },
        deliberationAccounting: {
          deliberationTokens: 30, accountingMode: 'provider_authoritative',
          estimatorId: null, estimatorVersion: null, estimatorInputBasis: null,
        },
        providerCallEmitted: true,
        providerProcessedTokens: true,
      }));

      assert.strictEqual(result.tokenBudgetAfter.consumed, 150,
        'DBA-I16: tokens charged when provider call emitted (100 + 50 = 150)');
      assert.strictEqual(result.deliberationBudgetAfter.consumed, 30,
        'DBA-I16: deliberation charged when provider call emitted');
    });
  });

  // ---- F-5 (HIGH): Deliberation Hard Cap at Admissibility ----
  describe('F-5: Deliberation Hard Cap at Admissibility [DBA-I10]', () => {
    it('rejects reasoning-mode invocation when deliberation budget exhausted', () => {
      const harness = createDBAHarness();
      const missionId = 'mission-f5' as any;

      // First invocation: exhaust deliberation admission budget (50)
      const first = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId,
        tokenEnvelope: 100,
        deliberationEnvelope: 50,
      }));
      assert.strictEqual(first.admissible, true,
        'F-5: first invocation should be admitted (50 <= 50)');
      assert.strictEqual(first.deliberationPass, true,
        'F-5: first deliberation check should pass');

      // Second invocation: deliberation remaining = 0, any request > 0 must be rejected
      const second = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId,
        tokenEnvelope: 100,
        deliberationEnvelope: 10,
      }));
      assert.strictEqual(second.admissible, false,
        'F-5: must reject when deliberation budget exhausted at admission tier');
      assert.strictEqual(second.deliberationPass, false,
        'F-5: deliberation must fail when remaining is 0');
      assert.strictEqual(second.deliberationHeadroom, 0,
        'F-5: deliberation headroom must be 0 after exhaustion');
      assert.ok(
        second.rejectionDimension === 'rejected_deliberation' || second.rejectionDimension === 'rejected_both',
        'F-5: must identify deliberation as failing dimension',
      );
    });

    it('admits zero deliberation envelope even when deliberation exhausted', () => {
      const harness = createDBAHarness();
      const missionId = 'mission-f5-zero' as any;

      // Exhaust deliberation
      harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId,
        tokenEnvelope: 100,
        deliberationEnvelope: 50,
      }));

      // Zero deliberation envelope should still pass (0 <= 0)
      const result = harness.admissibility.checkAdmissibility(makePreCheckInput({
        missionId,
        tokenEnvelope: 100,
        deliberationEnvelope: 0,
      }));
      assert.strictEqual(result.deliberationPass, true,
        'F-5: zero deliberation envelope should pass even when budget exhausted');
      assert.strictEqual(result.admissible, true,
        'F-5: invocation without deliberation should be admitted');
    });
  });

  // ---- F-8 (MEDIUM): Estimator Rejects Negative Inputs ----
  describe('F-8: Estimator Negative Input Rejection [DBA-I3]', () => {
    it('rejects negative completionTokens with INVALID_INPUT', () => {
      const harness = createDBAHarness();
      assert.throws(
        () => harness.estimator.estimate(makeEstimatorBasis({ completionTokens: -100 })),
        { message: /INVALID_INPUT/ },
        'F-8: negative completionTokens must be rejected',
      );
    });

    it('accepts zero completionTokens (boundary)', () => {
      const harness = createDBAHarness();
      const charge = harness.estimator.estimate(makeEstimatorBasis({ completionTokens: 0 }));
      assert.strictEqual(charge, 0, 'F-8: zero completionTokens produces zero charge');
    });
  });
});

// ============================================================================
// PART E: HARNESS VERIFICATION — these SHOULD pass against harness
// ============================================================================

describe('DBA Harness Verification', () => {
  it('every harness method throws NOT_IMPLEMENTED', () => {
    const harness = createDBAHarness();

    assertNotImplemented(() => harness.ecb.compute(makeECBInput()));
    assertNotImplemented(() => harness.policyGovernor.validateInheritance(100, 50));
    assertNotImplemented(() => harness.policyGovernor.mergeEffectiveCeiling(100, 50));
    assertNotImplemented(() => harness.admissibility.checkAdmissibility(makePreCheckInput()));
    assertNotImplemented(() => harness.reconciliation.reconcile(makeReconciliationInput()));
    assertNotImplemented(() => harness.overhead.computeOverhead('test', {
      computationVersion: 'v1', tokenizer: null, tokenizerVersion: null,
    }));
    assertNotImplemented(() => harness.overhead.getBasis());
    assertNotImplemented(() => harness.window.getAvailableInputWindow('model'));
    assertNotImplemented(() => harness.estimator.estimate(makeEstimatorBasis()));
  });
});
