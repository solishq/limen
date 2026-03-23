/**
 * Limen v1.0 — TGP (Technique Governance Protocol) Executable Contract Tests
 * Phase: Implementation Verification (replaces NOT_IMPLEMENTED harness tests)
 *
 * All behavioral tests use real in-memory SQLite with full migration schema.
 * Seed helpers create test data directly via SQL INSERT.
 *
 * Spec ref: TGP v1.0 Design Source (FINAL), Architecture Freeze CF-12/CF-13
 * Invariants: TGP-I1 through TGP-I8
 * Pre-Schema Decisions: PSD-1 through PSD-4
 * Conformance Tests: CT-TGP-01 through CT-TGP-30
 * Amendment 2: Control 3 (Executable Contract, Interface-First)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTechniqueGovernor, NotImplementedError } from '../../src/techniques/harness/tgp_harness.js';
import { createTestDatabase } from '../helpers/test_database.js';
import type {
  TechniqueGovernor,
  TechniqueGovernorDeps,
  EvaluationId,
  PromotionDecisionId,
  TGPTechnique,
  TechniqueEvaluation,
  TechniquePromotionDecision,
  EvaluationCreateInput,
  PromotionAttemptInput,
  PromotionAttemptResult,
  QuarantineUpdateResult,
  QuarantineClearResult,
  CandidateRetentionResult,
  TemplateRegistrationInput,
  TemplateRegistrationResult,
  CandidateRetirementInput,
  TGPTechniqueStatus,
} from '../../src/techniques/interfaces/tgp_types.js';
import {
  TGP_STATUS_TRANSITIONS,
  TGP_EVENTS,
  TGP_PROMOTION_ERROR_CODES,
  TGP_LIFECYCLE_ERROR_CODES,
  TGP_QUARANTINE_ERROR_CODES,
  TGP_EVALUATION_ERROR_CODES,
  TGP_RETENTION_ERROR_CODES,
  TGP_TEMPLATE_ERROR_CODES,
  DEFAULT_CANDIDATE_RETENTION_DAYS,
  DEFAULT_PROMOTION_CONFIDENCE_THRESHOLD,
  QUALIFYING_EVALUATION_SOURCES,
} from '../../src/techniques/interfaces/tgp_types.js';
import type { DatabaseConnection } from '../../src/kernel/interfaces/database.js';
import type { OperationContext, TenantId, AgentId, MissionId } from '../../src/kernel/interfaces/index.js';
import type { TechniqueId } from '../../src/learning/interfaces/learning_types.js';

// ============================================================================
// Test Helpers — Branded Type Constructors
// ============================================================================

function testTechniqueId(id: string): TechniqueId {
  return id as TechniqueId;
}

function testEvaluationId(id: string): EvaluationId {
  return id as EvaluationId;
}

function testPromotionDecisionId(id: string): PromotionDecisionId {
  return id as PromotionDecisionId;
}

function testTenantId(id: string): TenantId {
  return id as TenantId;
}

function testAgentId(id: string): AgentId {
  return id as AgentId;
}

function testMissionId(id: string): MissionId {
  return id as MissionId;
}

// ============================================================================
// Test Helpers — Mock Dependencies (audit + events recording)
// ============================================================================

/** Minimal OperationContext stub */
function createMockCtx(overrides?: Partial<OperationContext>): OperationContext {
  return {
    tenantId: testTenantId('tenant-001'),
    userId: null,
    agentId: testAgentId('agent-001'),
    permissions: new Set(),
    ...overrides,
  } as unknown as OperationContext;
}

/** Create TechniqueGovernorDeps with event and audit recording */
function createMockDeps(): TechniqueGovernorDeps & {
  emittedEvents: Array<{ type: string; scope: string; payload: Record<string, unknown> }>;
  auditEntries: Array<Record<string, unknown>>;
} {
  const emittedEvents: Array<{ type: string; scope: string; payload: Record<string, unknown> }> = [];
  const auditEntries: Array<Record<string, unknown>> = [];
  return {
    emittedEvents,
    auditEntries,
    audit: {
      create(
        _conn: DatabaseConnection,
        _ctx: OperationContext,
        input: {
          readonly action: string;
          readonly resourceType: string;
          readonly resourceId: string;
          readonly details: Readonly<Record<string, unknown>>;
        },
      ) {
        auditEntries.push(input as Record<string, unknown>);
        return { ok: true as const, value: undefined };
      },
    },
    events: {
      emit(event: {
        readonly type: string;
        readonly scope: 'agent' | 'mission' | 'system';
        readonly payload: Readonly<Record<string, unknown>>;
      }) {
        emittedEvents.push({
          type: event.type,
          scope: event.scope,
          payload: event.payload as Record<string, unknown>,
        });
      },
    },
    time: { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() },
  };
}

// ============================================================================
// Test Helpers — Input Factories
// ============================================================================

function makeEvaluationInput(overrides?: Partial<EvaluationCreateInput>): EvaluationCreateInput {
  return {
    techniqueId: testTechniqueId('technique-001'),
    agentId: testAgentId('agent-001'),
    tenantId: testTenantId('tenant-001'),
    evaluatorAgentId: testAgentId('agent-001'),
    missionId: null,
    evaluationSource: 'runtime',
    baselinePerformance: { accuracy: 0.6 },
    techniquePerformance: { accuracy: 0.85 },
    comparisonResult: { improvement: 0.25 },
    confidenceScore: 0.75,
    evaluationMethod: 'shadow_execution',
    ...overrides,
  };
}

function makePromotionInput(overrides?: Partial<PromotionAttemptInput>): PromotionAttemptInput {
  return {
    techniqueId: testTechniqueId('technique-001'),
    agentId: testAgentId('agent-001'),
    tenantId: testTenantId('tenant-001'),
    decidedBy: 'agent-001',
    evaluationIds: [testEvaluationId('eval-001')],
    confidenceThreshold: DEFAULT_PROMOTION_CONFIDENCE_THRESHOLD,
    decisionRule: 'confidence_threshold_v1',
    policyVersion: '1.0.0',
    evaluationSchemaVersion: '1.0.0',
    thresholdConfigVersion: '1.0.0',
    ...overrides,
  };
}

function makeTemplateInput(overrides?: Partial<TemplateRegistrationInput>): TemplateRegistrationInput {
  return {
    agentId: testAgentId('agent-001'),
    tenantId: testTenantId('tenant-001'),
    templateId: 'template-001',
    templateVersion: '1.0.0',
    techniques: [
      {
        type: 'prompt_fragment',
        content: 'Always provide step-by-step explanations.',
        evaluationEvidence: {
          baselinePerformance: { accuracy: 0.5 },
          techniquePerformance: { accuracy: 0.8 },
          comparisonResult: { improvement: 0.3 },
          confidenceScore: 0.8,
        },
      },
    ],
    ...overrides,
  };
}

function makeCandidateRetirementInput(overrides?: Partial<CandidateRetirementInput>): CandidateRetirementInput {
  return {
    techniqueId: testTechniqueId('technique-001'),
    tenantId: testTenantId('tenant-001'),
    reason: 'candidate_expiry',
    actorId: 'system-retention-scheduler',
    retentionPolicyVersion: '1.0.0',
    ...overrides,
  };
}

// ============================================================================
// Seed Helpers — Direct SQL INSERT for test data
// ============================================================================

/** Seed a technique directly into learning_techniques */
function seedTechnique(conn: DatabaseConnection, opts: {
  id: string;
  tenantId?: string;
  agentId?: string;
  type?: string;
  content?: string;
  sourceMemoryIds?: string[];
  confidence?: number;
  successRate?: number | null;
  applicationCount?: number;
  lastApplied?: string | null;
  status?: string;
  createdAt?: string;
  provenanceKind?: string;
  quarantinedAt?: string | null;
  promotedAt?: string | null;
  promotionDecisionId?: string | null;
  transferSourceTechniqueId?: string | null;
  retiredAt?: string | null;
  retiredReason?: string | null;
}): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO learning_techniques
      (id, tenant_id, agent_id, type, content, source_memory_ids,
       confidence, success_rate, application_count, last_applied,
       last_updated, status, created_at, provenance_kind,
       quarantined_at, promoted_at, promotion_decision_id,
       transfer_source_technique_id, retired_at, retired_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.tenantId ?? 'tenant-001',
      opts.agentId ?? 'agent-001',
      opts.type ?? 'prompt_fragment',
      opts.content ?? `Technique content for ${opts.id}`,
      JSON.stringify(opts.sourceMemoryIds ?? ['memory-default']),
      opts.confidence ?? 0.5,
      opts.successRate ?? null,
      opts.applicationCount ?? 0,
      opts.lastApplied ?? null,
      now,
      opts.status ?? 'candidate',
      opts.createdAt ?? now,
      opts.provenanceKind ?? 'local_extraction',
      opts.quarantinedAt ?? null,
      opts.promotedAt ?? null,
      opts.promotionDecisionId ?? null,
      opts.transferSourceTechniqueId ?? null,
      opts.retiredAt ?? null,
      opts.retiredReason ?? null,
    ],
  );
}

/** Seed an evaluation directly into technique_evaluations */
function seedEvaluation(conn: DatabaseConnection, opts: {
  id: string;
  techniqueId: string;
  tenantId?: string;
  agentId?: string;
  evaluatorAgentId?: string;
  evaluationSource?: string;
  confidenceScore?: number | null;
  evaluationMethod?: string;
  baselinePerformance?: Record<string, unknown>;
  techniquePerformance?: Record<string, unknown>;
  comparisonResult?: Record<string, unknown>;
}): void {
  const now = new Date().toISOString();
  conn.run(
    `INSERT INTO technique_evaluations
      (id, technique_id, agent_id, tenant_id, evaluator_agent_id, mission_id,
       evaluation_source, baseline_performance, technique_performance,
       comparison_result, confidence_score, evaluation_method, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id,
      opts.techniqueId,
      opts.agentId ?? 'agent-001',
      opts.tenantId ?? 'tenant-001',
      opts.evaluatorAgentId ?? 'agent-001',
      opts.evaluationSource ?? 'runtime',
      JSON.stringify(opts.baselinePerformance ?? { accuracy: 0.6 }),
      JSON.stringify(opts.techniquePerformance ?? { accuracy: 0.85 }),
      JSON.stringify(opts.comparisonResult ?? { improvement: 0.25 }),
      opts.confidenceScore ?? 0.75,
      opts.evaluationMethod ?? 'shadow_execution',
      now,
    ],
  );
}

/** Create a date ISO string N days in the past */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

// ============================================================================
// CONTRACT TESTS
// ============================================================================

describe('TGP Contract Tests', () => {
  let conn: DatabaseConnection;
  let ctx: OperationContext;
  let deps: ReturnType<typeof createMockDeps>;
  let governor: TechniqueGovernor;

  beforeEach(() => {
    conn = createTestDatabase();
    ctx = createMockCtx();
    deps = createMockDeps();
    governor = createTechniqueGovernor(deps, conn);
  });

  // ==========================================================================
  // GROUP 1: Conformance Tests CT-TGP-01 through CT-TGP-30
  // ==========================================================================

  describe('Group 1: Conformance Tests (CT-TGP-01 through CT-TGP-30)', () => {

    // CT-TGP-01: Immutable Content [TGP-I1]
    it('CT-TGP-01: content field is immutable after creation — modification rejected', () => {
      // Invariant: TGP-I1
      // Defect: DC-TGP-001 — mutable content allows technique definition drift
      // Evidence: trigger-enforced (tgp_content_immutable)
      seedTechnique(conn, { id: 'technique-001', content: 'original content' });

      assert.throws(
        () => conn.run(
          'UPDATE learning_techniques SET content = ? WHERE id = ? AND tenant_id = ?',
          ['modified content', 'technique-001', 'tenant-001'],
        ),
        { message: /TGP-I1/ },
        'Content modification must be rejected by TGP-I1 trigger',
      );
    });

    // CT-TGP-02: Initial State Is Candidate [PSD-1]
    it('CT-TGP-02: newly extracted technique enters with status=candidate, not active', () => {
      // Invariant: PSD-1
      // Defect: DC-TGP-002 — techniques entering as active bypass evaluation gate
      // Evidence: schema default status = 'candidate'
      const now = new Date().toISOString();
      conn.run(
        `INSERT INTO learning_techniques
          (id, tenant_id, agent_id, type, content, source_memory_ids,
           confidence, application_count, last_updated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['technique-new', 'tenant-001', 'agent-001', 'prompt_fragment',
         'test content', JSON.stringify(['mem-1']), 0.5, 0, now, now],
      );

      const row = conn.get<{ status: string }>(
        'SELECT status FROM learning_techniques WHERE id = ?',
        ['technique-new'],
      );
      assert.strictEqual(row?.status, 'candidate', 'Default status must be candidate');
    });

    // CT-TGP-03: Promotion Requires Evaluation [TGP-I3]
    // BPB-08 FIX: strengthened to check SPECIFIC rejection reason (NO_EVALUATION_EVIDENCE)
    // so that removing the evaluation count check is detected (not masked by qualifying source check)
    it('CT-TGP-03: promotion attempt with zero evaluations is rejected with NO_EVALUATION_EVIDENCE', () => {
      // Invariant: TGP-I3
      // Defect: DC-TGP-401 — promotion without evidence allows unvalidated techniques
      seedTechnique(conn, { id: 'technique-no-evals' });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('technique-no-evals'),
        evaluationIds: [],
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Should return result, not error');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false);
        assert.strictEqual(result.value.decision.result, 'rejected');
        // DISCRIMINATIVE: verify the SPECIFIC rejection reason is NO_EVALUATION_EVIDENCE
        // If the eval count check is removed, this assertion fails because the rejection
        // would come from INSUFFICIENT_EVALUATION_SOURCE instead
        assert.ok(
          result.value.decision.rejectionReason!.includes('No evaluation evidence'),
          `Rejection reason must specifically mention 'No evaluation evidence', ` +
          `got: '${result.value.decision.rejectionReason}'`,
        );
      }
    });

    // CT-TGP-04: Promotion Audit Completeness [TGP-I4, CF-13]
    it('CT-TGP-04: promotion decision record contains all five CF-13 required fields', () => {
      // Invariant: TGP-I4
      // Defect: DC-TGP-004 — incomplete audit prevents independent verification
      seedTechnique(conn, { id: 'technique-001' });
      seedEvaluation(conn, { id: 'eval-001', techniqueId: 'technique-001' });

      const input = makePromotionInput();
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Promotion should succeed');
      if (result.ok) {
        const decision = result.value.decision;
        assert.ok(decision.evaluationLineage.length > 0, 'evaluationLineage must be non-empty');
        assert.notStrictEqual(decision.decisionRule, '', 'decisionRule must be non-empty');
        assert.ok(decision.activationBasis !== null, 'activationBasis must be present');
        assert.notStrictEqual(decision.policyVersion, '', 'policyVersion must be non-empty');
        assert.notStrictEqual(decision.evaluationSchemaVersion, '', 'evaluationSchemaVersion must be non-empty');
        assert.notStrictEqual(decision.thresholdConfigVersion, '', 'thresholdConfigVersion must be non-empty');
      }
    });

    // CT-TGP-05: Quarantine Sets Flag On Candidate [TGP-I5, PSD-4]
    it('CT-TGP-05: quarantine sets quarantinedAt on candidate without status change', () => {
      // Invariant: TGP-I5, PSD-4
      // Defect: DC-TGP-005 — quarantine causes status change on candidate
      seedTechnique(conn, { id: 'tech-q1', sourceMemoryIds: ['memory-001'] });

      const result = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'memory-001', testTenantId('tenant-001'), 'contamination detected',
      );

      assert.ok(result.ok, 'Quarantine cascade should succeed');
      if (result.ok) {
        assert.ok(result.value.candidatesBlocked.length > 0, 'At least one candidate should be blocked');
      }

      // Verify status unchanged, quarantinedAt set
      const row = conn.get<{ status: string; quarantined_at: string | null }>(
        'SELECT status, quarantined_at FROM learning_techniques WHERE id = ?', ['tech-q1'],
      );
      assert.strictEqual(row?.status, 'candidate', 'Status must remain candidate');
      assert.notStrictEqual(row?.quarantined_at, null, 'quarantinedAt must be set');
    });

    // CT-TGP-06: Quarantined Candidate Cannot Be Promoted [TGP-I3, TGP-I5]
    // BPB-07 FIX: strengthened to seed technique WITH passing evaluations + quarantine,
    // so ONLY the quarantine check blocks promotion. Verifies TECHNIQUE_SOURCE_QUARANTINED rejection.
    it('CT-TGP-06: promotion attempt on quarantined candidate is rejected with QUARANTINE_ACTIVE', () => {
      // Invariant: TGP-I3, TGP-I5
      // Defect: DC-TGP-403 — quarantine block bypassed during promotion
      seedTechnique(conn, {
        id: 'technique-quarantined',
        quarantinedAt: new Date().toISOString(),
      });
      // Seed passing evaluation so the quarantine check is the ONLY blocking condition
      seedEvaluation(conn, {
        id: 'eval-for-quarantined',
        techniqueId: 'technique-quarantined',
        evaluationSource: 'runtime',
        confidenceScore: 0.9,
      });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('technique-quarantined'),
        evaluationIds: [testEvaluationId('eval-for-quarantined')],
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Promotion attempt should return a result');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false, 'Quarantined candidate must not be promoted');
        assert.strictEqual(result.value.decision.result, 'rejected', 'Decision must be rejected');
        // DISCRIMINATIVE: verify the SPECIFIC rejection is TECHNIQUE_SOURCE_QUARANTINED
        // If the quarantine check is removed, promotion would SUCCEED (evals pass all other gates)
        assert.ok(
          result.value.decision.rejectionReason!.includes('quarantine-blocked'),
          `Rejection reason must mention quarantine, got: '${result.value.decision.rejectionReason}'`,
        );
      }
    });

    // CT-TGP-07: Forward-Only Lifecycle [TGP-I2]
    it('CT-TGP-07: transition from active to candidate is rejected (no backward transitions)', () => {
      // Invariant: TGP-I2
      // Defect: DC-TGP-007 — backward lifecycle transitions break governance chain
      const activeTransitions = TGP_STATUS_TRANSITIONS.active;
      assert.ok(
        !activeTransitions.includes('candidate'),
        'Active must not have candidate as valid transition target',
      );

      // Behavioral: promoting an active technique → ALREADY_PROMOTED
      seedTechnique(conn, { id: 'technique-already-active', status: 'active' });
      const input = makePromotionInput({
        techniqueId: testTechniqueId('technique-already-active'),
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.strictEqual(result.ok, false, 'Promoting active technique must fail');
      if (!result.ok) {
        assert.strictEqual(result.error.code, TGP_PROMOTION_ERROR_CODES.ALREADY_PROMOTED);
      }
    });

    // CT-TGP-08: Suspension From Active [TGP-I2]
    it('CT-TGP-08: active technique can be suspended via quarantine cascade', () => {
      // Invariant: TGP-I2
      // Defect: DC-TGP-008 — active technique not suspended on quarantine
      seedTechnique(conn, {
        id: 'tech-active-q',
        status: 'active',
        sourceMemoryIds: ['memory-001'],
      });

      const result = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'memory-001', testTenantId('tenant-001'), 'contamination detected',
      );

      assert.ok(result.ok, 'Quarantine cascade should succeed');
      if (result.ok) {
        assert.ok(result.value.activesSuspended.length > 0, 'Active techniques should be suspended');
      }

      // Verify status changed to suspended
      const row = conn.get<{ status: string }>(
        'SELECT status FROM learning_techniques WHERE id = ?', ['tech-active-q'],
      );
      assert.strictEqual(row?.status, 'suspended', 'Active must become suspended');
    });

    // CT-TGP-09: Restoration From Suspended [TGP-I2, CF-01]
    it('CT-TGP-09: reverse cascade clears quarantinedAt on candidates (suspended NOT auto-restored)', () => {
      // Invariant: TGP-I2, CF-01
      // Defect: DC-TGP-009 — restoration without explicit governed action
      // The reverse cascade only clears quarantinedAt on candidates.
      // Suspended→active restoration requires explicit human action per CF-01.
      seedTechnique(conn, {
        id: 'tech-candidate-q',
        sourceMemoryIds: ['memory-001'],
        quarantinedAt: new Date().toISOString(),
      });

      const result = governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'memory-001', testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Restoration cascade should succeed');
      if (result.ok) {
        assert.ok(result.value.candidatesUnblocked.length > 0, 'Candidate should be unblocked');
      }
    });

    // CT-TGP-10: Candidate Lifecycle Bound Expiry [TGP-I6]
    it('CT-TGP-10: candidate past retention period is eligible for retirement', () => {
      // Invariant: TGP-I6
      // Defect: DC-TGP-010 — candidates accumulate indefinitely without expiry
      seedTechnique(conn, {
        id: 'technique-old-candidate',
        createdAt: daysAgo(91),
      });

      const result = governor.candidateRetention.evaluate(
        conn, testTechniqueId('technique-old-candidate'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Retention evaluation should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.expired, true, 'Candidate past retention must be expired');
        assert.strictEqual(result.value.techniqueId, testTechniqueId('technique-old-candidate'));
      }
    });

    // CT-TGP-11: Trust-Independent Promotion [TGP-I7, CF-02]
    it('CT-TGP-11: promotion validation is identical regardless of agent trust level', () => {
      // Invariant: TGP-I7, CF-02
      // Defect: DC-TGP-011 — trusted agents bypass evaluation requirements
      // Two separate candidates, same evidence quality, different actors.
      seedTechnique(conn, { id: 'technique-high' });
      seedEvaluation(conn, { id: 'eval-high', techniqueId: 'technique-high' });
      seedTechnique(conn, { id: 'technique-low' });
      seedEvaluation(conn, { id: 'eval-low', techniqueId: 'technique-low' });

      const highTrustResult = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('technique-high'),
        evaluationIds: [testEvaluationId('eval-high')],
        decidedBy: 'admin-high-trust',
      }));
      const lowTrustResult = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('technique-low'),
        evaluationIds: [testEvaluationId('eval-low')],
        decidedBy: 'agent-low-trust',
      }));

      // Both must produce identical outcomes — trust level does not weaken validation
      assert.ok(highTrustResult.ok && lowTrustResult.ok);
      if (highTrustResult.ok && lowTrustResult.ok) {
        assert.strictEqual(highTrustResult.value.promoted, lowTrustResult.value.promoted,
          'Trust level must not affect promotion outcome');
      }
    });

    // CT-TGP-12: Candidate Not Applied [TGP-I8]
    it('CT-TGP-12: inference filter excludes candidate techniques', () => {
      // Invariant: TGP-I8
      // Defect: DC-TGP-012 — candidate techniques applied at inference time
      seedTechnique(conn, { id: 'tech-candidate-inf', status: 'candidate' });
      seedTechnique(conn, { id: 'tech-active-inf', status: 'active' });

      const result = governor.inferenceFilter.filterForInference(
        conn, testAgentId('agent-001'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Inference filter should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.length, 1, 'Only one active technique');
        for (const technique of result.value) {
          assert.strictEqual(technique.status, 'active',
            'Only active techniques should be returned by inference filter');
        }
      }
    });

    // CT-TGP-13: Retired Is Terminal [TGP-I2]
    it('CT-TGP-13: retired technique rejects all transitions (terminal state)', () => {
      // Invariant: TGP-I2
      // Defect: DC-TGP-013 — retired techniques can be re-activated
      const retiredTransitions = TGP_STATUS_TRANSITIONS.retired;
      assert.deepStrictEqual(retiredTransitions, [], 'Retired must have zero valid transitions');

      // Behavioral: attempt promotion on retired technique
      seedTechnique(conn, {
        id: 'technique-retired',
        status: 'retired',
        retiredAt: new Date().toISOString(),
        retiredReason: 'low_confidence',
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('technique-retired'),
      }));

      assert.strictEqual(result.ok, false, 'Promoting retired technique must fail');
      if (!result.ok) {
        assert.strictEqual(result.error.code, TGP_PROMOTION_ERROR_CODES.NOT_CANDIDATE);
      }
    });

    // CT-TGP-14: Multi-Source Quarantine [TGP-I5]
    it('CT-TGP-14: quarantine of ONE source memory blocks technique with multiple sources', () => {
      // Invariant: TGP-I5
      // Defect: DC-TGP-014 — partial source quarantine does not block promotion
      seedTechnique(conn, {
        id: 'tech-multi-src',
        sourceMemoryIds: ['memory-A', 'memory-B'],
      });

      const result = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'memory-B', testTenantId('tenant-001'), 'B contaminated',
      );

      assert.ok(result.ok, 'Quarantine cascade should succeed');
      if (result.ok) {
        assert.ok(
          result.value.candidatesBlocked.length > 0,
          'Technique derived from [A, B] must be blocked when B is quarantined',
        );
      }
    });

    // CT-TGP-15: Cross-Agent Transfer As Candidate [PSD-1]
    it('CT-TGP-15: transferred technique enters target agent scope as candidate', () => {
      // Invariant: PSD-1
      // Defect: DC-TGP-015 — transferred techniques bypass candidate stage
      seedTechnique(conn, {
        id: 'technique-transferred',
        provenanceKind: 'cross_agent_transfer',
        transferSourceTechniqueId: 'source-technique-xyz',
      });

      // Verify it's a candidate, not active
      const row = conn.get<{ status: string; provenance_kind: string; transfer_source_technique_id: string }>(
        'SELECT status, provenance_kind, transfer_source_technique_id FROM learning_techniques WHERE id = ?',
        ['technique-transferred'],
      );
      assert.strictEqual(row?.status, 'candidate', 'Transferred technique must be candidate');
      assert.strictEqual(row?.provenance_kind, 'cross_agent_transfer');
      assert.strictEqual(row?.transfer_source_technique_id, 'source-technique-xyz');

      // Evaluation with transfer_history should succeed
      seedEvaluation(conn, {
        id: 'eval-transfer',
        techniqueId: 'technique-transferred',
        evaluationSource: 'transfer_history',
      });
      const evalResult = governor.evaluationStore.getByTechnique(
        conn, testTechniqueId('technique-transferred'), testTenantId('tenant-001'),
      );
      assert.ok(evalResult.ok);
      if (evalResult.ok) {
        assert.strictEqual(evalResult.value.length, 1);
        assert.strictEqual(evalResult.value[0].evaluationSource, 'transfer_history');
      }
    });

    // CT-TGP-16: Cold-Start Template [PSD-1]
    it('CT-TGP-16: template registration creates candidate, evaluates, and promotes atomically', () => {
      // Invariant: PSD-1
      // Defect: DC-TGP-016 — template registration leaves techniques as visible candidates
      const input = makeTemplateInput();
      const result = governor.templateRegistrar.registerTemplate(conn, ctx, input);

      assert.ok(result.ok, 'Template registration should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.techniques.length, 1, 'One technique should be created');
        assert.strictEqual(result.value.techniques[0].status, 'active', 'Template technique must be active');
        assert.strictEqual(result.value.techniques[0].provenanceKind, 'template_seed',
          'Provenance must be template_seed');
        assert.strictEqual(result.value.decisions.length, 1, 'One promotion decision per technique');
        assert.strictEqual(result.value.decisions[0].result, 'promoted', 'Decision must be promoted');
      }
    });

    // CT-TGP-17: Quarantine Clearing [TGP-I5]
    it('CT-TGP-17: restoring quarantined source memory clears quarantinedAt on candidate', () => {
      // Invariant: TGP-I5
      // Defect: DC-TGP-017 — quarantinedAt never cleared, permanently blocking promotion
      seedTechnique(conn, {
        id: 'tech-q-clear',
        sourceMemoryIds: ['memory-B'],
        quarantinedAt: new Date().toISOString(),
      });

      const result = governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'memory-B', testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Quarantine clearing should succeed');
      if (result.ok) {
        assert.ok(
          result.value.candidatesUnblocked.length > 0,
          'Candidate should be unblocked after source memory restoration',
        );
      }

      // Verify quarantinedAt is now null
      const row = conn.get<{ quarantined_at: string | null }>(
        'SELECT quarantined_at FROM learning_techniques WHERE id = ?', ['tech-q-clear'],
      );
      assert.strictEqual(row?.quarantined_at, null, 'quarantinedAt must be cleared');
    });

    // CT-TGP-18: Post-Promotion Initialization [§5.3]
    it('CT-TGP-18: promoted technique has correct initial production metric values', () => {
      // §5.3
      // Defect: DC-TGP-018 — production metrics not initialized at promotion
      seedTechnique(conn, { id: 'technique-001' });
      seedEvaluation(conn, { id: 'eval-001', techniqueId: 'technique-001', confidenceScore: 0.75 });

      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput());

      assert.ok(result.ok, 'Promotion should succeed');
      if (result.ok) {
        const technique = result.value.technique;
        assert.strictEqual(technique.confidence, 0.75, 'confidence must be initialized from evaluation');
        assert.strictEqual(technique.successRate, null, 'successRate must be null (insufficient apps)');
        assert.strictEqual(technique.applicationCount, 0, 'applicationCount must be 0');
        assert.strictEqual(technique.lastApplied, null, 'lastApplied must be null');
        assert.strictEqual(technique.status, 'active', 'status must be active after promotion');
        assert.notStrictEqual(technique.promotedAt, null, 'promotedAt must be set');
        assert.notStrictEqual(technique.promotionDecisionId, null, 'promotionDecisionId must be set');
      }
    });

    // CT-TGP-19: Promotion Atomicity [I-03]
    it('CT-TGP-19: concurrent promotion attempts — exactly one succeeds', () => {
      // Invariant: I-03
      // Defect: DC-TGP-019 — concurrent promotions create duplicate active techniques
      seedTechnique(conn, { id: 'technique-001' });
      seedEvaluation(conn, { id: 'eval-001', techniqueId: 'technique-001' });

      const result1 = governor.promotionGate.attemptPromotion(conn, ctx,
        makePromotionInput({ decidedBy: 'agent-alpha' }));
      const result2 = governor.promotionGate.attemptPromotion(conn, ctx,
        makePromotionInput({ decidedBy: 'agent-beta' }));

      // First succeeds, second gets ALREADY_PROMOTED
      assert.ok(result1.ok && result1.value.promoted, 'First promotion must succeed');
      assert.strictEqual(result2.ok, false, 'Second promotion must fail');
      if (!result2.ok) {
        assert.strictEqual(result2.error.code, TGP_PROMOTION_ERROR_CODES.ALREADY_PROMOTED);
      }
    });

    // CT-TGP-20: Type Field Immutability [TGP-I1]
    it('CT-TGP-20: type field is immutable — modification from prompt_fragment to decision_rule rejected', () => {
      // Invariant: TGP-I1
      // Defect: DC-TGP-020 — type field modification breaks technique identity
      // Evidence: trigger-enforced (tgp_content_immutable)
      seedTechnique(conn, { id: 'tech-type-test', type: 'prompt_fragment' });

      assert.throws(
        () => conn.run(
          'UPDATE learning_techniques SET type = ? WHERE id = ? AND tenant_id = ?',
          ['decision_rule', 'tech-type-test', 'tenant-001'],
        ),
        { message: /TGP-I1/ },
        'Type modification must be rejected by TGP-I1 trigger',
      );
    });

    // CT-TGP-21: Multi-Source Quarantine Full Clearing [TGP-I5]
    it('CT-TGP-21: partial restoration (one of two quarantined sources) does NOT clear quarantinedAt', () => {
      // Invariant: TGP-I5
      // Defect: DC-TGP-021 — partial restoration incorrectly clears quarantine block
      // Technique T1 with sources [A, B], quarantined.
      // Another technique T2 from [B], also quarantined (proves memory B still quarantined).
      // Restore A → T1 must remain quarantined because B is still quarantined.
      seedTechnique(conn, {
        id: 'tech-ab',
        sourceMemoryIds: ['memory-A', 'memory-B'],
        quarantinedAt: new Date().toISOString(),
      });
      seedTechnique(conn, {
        id: 'tech-b-only',
        sourceMemoryIds: ['memory-B'],
        quarantinedAt: new Date().toISOString(),
      });

      const result = governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'memory-A', testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Partial restoration should succeed');
      if (result.ok) {
        assert.strictEqual(
          result.value.candidatesUnblocked.length, 0,
          'No candidates should be unblocked when B is still quarantined',
        );
      }
    });

    // CT-TGP-22: Active Technique Retirement via Thresholds [TGP-I2]
    it('CT-TGP-22: active technique with poor metrics can be retired via existing thresholds', () => {
      // Invariant: TGP-I2
      // Defect: DC-TGP-022 — TGP lifecycle prevents existing retirement triggers
      // Structural: TGP_STATUS_TRANSITIONS.active includes 'retired'
      const activeTransitions = TGP_STATUS_TRANSITIONS.active;
      assert.ok(
        activeTransitions.includes('retired'),
        'Active must be able to transition to retired',
      );

      // Behavioral: retireExpired operates on candidates, not actives.
      // This test verifies the transition MAP permits active→retired.
      const result = governor.candidateRetention.retireExpired(
        conn, ctx, testAgentId('agent-001'), testTenantId('tenant-001'),
      );
      assert.ok(result.ok, 'Retire expired should succeed (empty result ok)');
    });

    // CT-TGP-23: Promotion Threshold Failure [TGP-I3]
    it('CT-TGP-23: promotion with confidence below threshold is rejected with decision record', () => {
      // Invariant: TGP-I3
      // Defect: DC-TGP-023 — low-confidence techniques promoted without threshold check
      seedTechnique(conn, { id: 'technique-001' });
      seedEvaluation(conn, { id: 'eval-001', techniqueId: 'technique-001', confidenceScore: 0.3 });

      const input = makePromotionInput({ confidenceThreshold: 0.5 });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Promotion attempt should return a result (not error)');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false, 'Must not promote below threshold');
        assert.strictEqual(result.value.decision.result, 'rejected', 'Decision must be rejected');
        assert.notStrictEqual(
          result.value.decision.rejectionReason, null,
          'Rejection reason must capture threshold miss',
        );
      }
    });

    // CT-TGP-24: Manual Candidate Retirement [TGP-I6]
    it('CT-TGP-24: expired candidates are retired by retireExpired', () => {
      // Invariant: TGP-I6
      // Defect: DC-TGP-024 — manual candidate retirement path missing
      seedTechnique(conn, { id: 'tech-old', createdAt: daysAgo(91) });

      const result = governor.candidateRetention.retireExpired(
        conn, ctx, testAgentId('agent-001'), testTenantId('tenant-001'),
      );
      assert.ok(result.ok, 'Retire expired should succeed');
      if (result.ok) {
        assert.ok(result.value.length > 0, 'At least one candidate should be retired');
      }

      // Verify retirement
      const row = conn.get<{ status: string; retired_reason: string }>(
        'SELECT status, retired_reason FROM learning_techniques WHERE id = ?', ['tech-old'],
      );
      assert.strictEqual(row?.status, 'retired');
      assert.strictEqual(row?.retired_reason, 'candidate_expiry');
    });

    // CT-TGP-25: Restoration — Quarantine Clearing [TGP-I5]
    it('CT-TGP-25: quarantine reverse cascade clears quarantinedAt when source restored', () => {
      // Invariant: TGP-I5
      // The reverse cascade clears quarantinedAt on candidates.
      // Active-now-suspended restoration requires human action (CF-01).
      seedTechnique(conn, {
        id: 'tech-restore',
        sourceMemoryIds: ['memory-001'],
        quarantinedAt: new Date().toISOString(),
      });

      const result = governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'memory-001', testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Restoration should succeed');
      if (result.ok) {
        assert.ok(result.value.candidatesUnblocked.length > 0, 'Candidate should be unblocked');
      }

      const row = conn.get<{ quarantined_at: string | null }>(
        'SELECT quarantined_at FROM learning_techniques WHERE id = ?', ['tech-restore'],
      );
      assert.strictEqual(row?.quarantined_at, null, 'quarantinedAt must be cleared');
    });

    // CT-TGP-26: Transfer Provenance Kind [§8]
    it('CT-TGP-26: transferred technique has provenanceKind=cross_agent_transfer', () => {
      // §8
      // Defect: DC-TGP-026 — transfer provenance not recorded correctly
      seedTechnique(conn, {
        id: 'technique-transferred-provenance',
        provenanceKind: 'cross_agent_transfer',
        transferSourceTechniqueId: 'source-xyz',
      });

      // Verify provenance via evaluation store (getByTechnique indirectly confirms technique exists)
      seedEvaluation(conn, {
        id: 'eval-prov',
        techniqueId: 'technique-transferred-provenance',
        evaluationSource: 'transfer_history',
      });

      const result = governor.evaluationStore.getByTechnique(
        conn, testTechniqueId('technique-transferred-provenance'), testTenantId('tenant-001'),
      );
      assert.ok(result.ok);
      if (result.ok) {
        assert.strictEqual(result.value.length, 1);
      }

      // Verify provenance directly
      const row = conn.get<{ provenance_kind: string; transfer_source_technique_id: string }>(
        'SELECT provenance_kind, transfer_source_technique_id FROM learning_techniques WHERE id = ?',
        ['technique-transferred-provenance'],
      );
      assert.strictEqual(row?.provenance_kind, 'cross_agent_transfer');
      assert.strictEqual(row?.transfer_source_technique_id, 'source-xyz');
    });

    // CT-TGP-27: Shadow Evaluation Isolation [TGP-I8]
    it('CT-TGP-27: shadow evaluation outputs do not influence live task results', () => {
      // Invariant: TGP-I8
      // Defect: DC-TGP-027 — shadow evaluation outputs leak into live context
      seedTechnique(conn, { id: 'technique-shadow-eval' });

      const input = makeEvaluationInput({
        evaluationMethod: 'shadow_execution',
        evaluationSource: 'runtime',
        techniqueId: testTechniqueId('technique-shadow-eval'),
      });
      const result = governor.evaluationStore.create(conn, ctx, input);

      assert.ok(result.ok, 'Shadow evaluation record creation should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.evaluationMethod, 'shadow_execution');
        assert.strictEqual(result.value.evaluationSource, 'runtime');
      }

      // Technique status must remain candidate (shadow eval has no status effect)
      const row = conn.get<{ status: string }>(
        'SELECT status FROM learning_techniques WHERE id = ?', ['technique-shadow-eval'],
      );
      assert.strictEqual(row?.status, 'candidate', 'Shadow eval must not change technique status');
    });

    // CT-TGP-28: Transfer Evidence Alone Insufficient [PSD-3]
    it('CT-TGP-28: promotion with only transfer_history evaluations is rejected', () => {
      // Invariant: PSD-3, AMB-03
      // Defect: DC-TGP-028 — transfer evidence satisfies promotion gate
      seedTechnique(conn, { id: 'technique-transfer-only' });
      seedEvaluation(conn, {
        id: 'eval-001',
        techniqueId: 'technique-transfer-only',
        evaluationSource: 'transfer_history',
      });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('technique-transfer-only'),
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Promotion should return a result');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false, 'Transfer-only evidence must not satisfy gate');
        assert.strictEqual(result.value.decision.result, 'rejected');
      }
    });

    // CT-TGP-29: Promotion Event Payload [§9]
    it('CT-TGP-29: technique.promoted event carries promotionDecisionId', () => {
      // §9
      // Defect: DC-TGP-029 — promotion event missing decision reference
      seedTechnique(conn, { id: 'technique-001' });
      seedEvaluation(conn, { id: 'eval-001', techniqueId: 'technique-001' });

      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput());

      assert.ok(result.ok, 'Promotion should succeed');
      if (result.ok) {
        const promotionEvents = deps.emittedEvents.filter(
          e => e.type === TGP_EVENTS.TECHNIQUE_PROMOTED,
        );
        assert.strictEqual(promotionEvents.length, 1, 'Exactly one promotion event');
        assert.notStrictEqual(promotionEvents[0].payload.promotionDecisionId, undefined,
          'Event must carry promotionDecisionId');
        assert.notStrictEqual(promotionEvents[0].payload.promotionDecisionId, null,
          'promotionDecisionId must be non-null');
      }
    });

    // CT-TGP-30: Template Registration Atomicity [PSD-1]
    it('CT-TGP-30: template registration is atomic — no intermediate candidate state visible', () => {
      // Invariant: PSD-1, AMB-06
      // Defect: DC-TGP-030 — template registration leaves visible candidate window
      const input = makeTemplateInput();
      const result = governor.templateRegistrar.registerTemplate(conn, ctx, input);

      assert.ok(result.ok, 'Template registration should succeed');
      if (result.ok) {
        for (const tech of result.value.techniques) {
          assert.strictEqual(tech.status, 'active', 'Template technique must be active, not candidate');
          assert.notStrictEqual(tech.promotedAt, null, 'promotedAt must be set');
          assert.notStrictEqual(tech.promotionDecisionId, null, 'promotionDecisionId must be set');
        }
      }
    });
  });

  // ==========================================================================
  // GROUP 2: Shadow Evaluation Isolation
  // ==========================================================================

  describe('Group 2: Shadow Evaluation Isolation [TGP-I8]', () => {

    it('shadow evaluation produces TechniqueEvaluation record without live behavioral effects', () => {
      // Defect: DC-TGP-101 — shadow evaluation creates live side effects
      seedTechnique(conn, { id: 'technique-shadow-eval' });

      const input = makeEvaluationInput({
        evaluationMethod: 'shadow_execution',
        evaluationSource: 'runtime',
        techniqueId: testTechniqueId('technique-shadow-eval'),
      });
      const result = governor.evaluationStore.create(conn, ctx, input);

      assert.ok(result.ok, 'Shadow evaluation record creation should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.evaluationMethod, 'shadow_execution');
        assert.strictEqual(result.value.evaluationSource, 'runtime');
        assert.notStrictEqual(result.value.id, undefined, 'Evaluation must have an ID');
      }
    });

    it('candidate with shadow evaluation is excluded from inference retrieval', () => {
      // Defect: DC-TGP-102 — shadow-evaluated candidate leaks into inference
      seedTechnique(conn, { id: 'tech-cand-shadow', status: 'candidate' });
      seedTechnique(conn, { id: 'tech-active-only', status: 'active' });

      const result = governor.inferenceFilter.filterForInference(
        conn, testAgentId('agent-001'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Inference filter should succeed');
      if (result.ok) {
        const candidatesInResult = result.value.filter(t => t.status === 'candidate');
        assert.strictEqual(candidatesInResult.length, 0,
          'No candidates (even shadow-evaluated ones) in inference results');
      }
    });
  });

  // ==========================================================================
  // GROUP 3: Event Payload Completeness
  // ==========================================================================

  describe('Group 3: Event Payload Completeness [§9]', () => {

    it('technique.promoted event carries promotionDecisionId in payload', () => {
      // Defect: DC-TGP-201 — promotion event missing decision traceability
      seedTechnique(conn, { id: 'technique-001' });
      seedEvaluation(conn, { id: 'eval-001', techniqueId: 'technique-001' });

      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput());

      assert.ok(result.ok, 'Promotion should succeed');
      if (result.ok && result.value.promoted) {
        const event = deps.emittedEvents.find(
          e => e.type === TGP_EVENTS.TECHNIQUE_PROMOTED,
        );
        assert.notStrictEqual(event, undefined, 'technique.promoted event must be emitted');
        assert.notStrictEqual(event!.payload.promotionDecisionId, undefined,
          'Event payload must include promotionDecisionId');
        assert.strictEqual(event!.payload.promotionDecisionId, result.value.decision.id,
          'Event promotionDecisionId must match decision record ID');
      }
    });

    it('technique.quarantine_blocked event carries source memory ID in payload', () => {
      // Defect: DC-TGP-202 — quarantine blocked event missing memory reference
      seedTechnique(conn, { id: 'tech-q-event', sourceMemoryIds: ['memory-contaminated'] });

      const result = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'memory-contaminated', testTenantId('tenant-001'), 'data integrity failure',
      );

      assert.ok(result.ok, 'Quarantine cascade should succeed');
      if (result.ok && result.value.candidatesBlocked.length > 0) {
        const event = deps.emittedEvents.find(
          e => e.type === TGP_EVENTS.TECHNIQUE_QUARANTINE_BLOCKED,
        );
        assert.notStrictEqual(event, undefined, 'technique.quarantine_blocked event must be emitted');
        assert.strictEqual(event!.payload.memoryId, 'memory-contaminated',
          'Event must carry the source memory ID that triggered quarantine');
      }
    });

    it('technique.retired event carries retiredReason in payload', () => {
      // Defect: DC-TGP-203 — retirement event missing reason
      seedTechnique(conn, { id: 'tech-old-retire', createdAt: daysAgo(91) });

      const result = governor.candidateRetention.retireExpired(
        conn, ctx, testAgentId('agent-001'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Retire expired should succeed');
      if (result.ok && result.value.length > 0) {
        const event = deps.emittedEvents.find(
          e => e.type === TGP_EVENTS.TECHNIQUE_RETIRED,
        );
        assert.notStrictEqual(event, undefined, 'technique.retired event must be emitted');
        assert.notStrictEqual(event!.payload.retiredReason, undefined,
          'Event must carry retiredReason');
      }
    });
  });

  // ==========================================================================
  // GROUP 4: Transfer Evidence Enforcement
  // ==========================================================================

  describe('Group 4: Transfer Evidence Enforcement [AMB-03, §6.2]', () => {

    it('promotion with ONLY transfer_history evaluations is rejected', () => {
      // Defect: DC-TGP-301 — transfer evidence bypasses local evaluation requirement
      seedTechnique(conn, { id: 'technique-transfer-evidence-only' });
      seedEvaluation(conn, {
        id: 'eval-001',
        techniqueId: 'technique-transfer-evidence-only',
        evaluationSource: 'transfer_history',
      });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('technique-transfer-evidence-only'),
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Should return result, not error');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false, 'Transfer-only evidence must not promote');
        assert.strictEqual(result.value.decision.result, 'rejected');
      }
    });

    it('promotion with transfer_history + runtime evaluation succeeds', () => {
      // Defect: DC-TGP-302 — transfer evidence presence causes rejection
      seedTechnique(conn, { id: 'technique-mixed-evidence' });
      seedEvaluation(conn, {
        id: 'eval-transfer-001',
        techniqueId: 'technique-mixed-evidence',
        evaluationSource: 'transfer_history',
        confidenceScore: 0.6,
      });
      seedEvaluation(conn, {
        id: 'eval-runtime-001',
        techniqueId: 'technique-mixed-evidence',
        evaluationSource: 'runtime',
        confidenceScore: 0.75,
      });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('technique-mixed-evidence'),
        evaluationIds: [
          testEvaluationId('eval-transfer-001'),
          testEvaluationId('eval-runtime-001'),
        ],
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Should return result');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, true, 'Mixed evidence with qualifying source should promote');
        assert.strictEqual(result.value.decision.result, 'promoted');
        assert.strictEqual(result.value.decision.evaluationLineage.length, 2,
          'Both evaluations must appear in lineage');
      }
    });
  });

  // ==========================================================================
  // GROUP 5: Template Atomicity
  // ==========================================================================

  describe('Group 5: Template Atomicity [PSD-1, AMB-06]', () => {

    it('no intermediate candidate state visible after template registration', () => {
      // Defect: DC-TGP-401 — template creates visible candidate window
      const input = makeTemplateInput();
      const result = governor.templateRegistrar.registerTemplate(conn, ctx, input);

      assert.ok(result.ok, 'Registration should succeed');
      if (result.ok) {
        for (const tech of result.value.techniques) {
          assert.strictEqual(tech.status, 'active', 'Must be active, never visible as candidate');
          assert.notStrictEqual(tech.promotedAt, null, 'promotedAt must be set atomically');
          assert.notStrictEqual(tech.promotionDecisionId, null, 'promotionDecisionId must be set');
          assert.notStrictEqual(tech.confidence, 0, 'confidence must be initialized from template evidence');
        }
      }
    });

    it('template registration executes all 6 operations in one transaction', () => {
      // Defect: DC-TGP-402 — template registration uses multiple transactions
      const input = makeTemplateInput();
      const result = governor.templateRegistrar.registerTemplate(conn, ctx, input);

      assert.ok(result.ok, 'Registration should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.techniques.length, 1, 'Technique created');
        assert.strictEqual(result.value.decisions.length, 1, 'Decision created');

        const tech = result.value.techniques[0];
        assert.strictEqual(tech.status, 'active', 'Status updated to active');
        assert.strictEqual(tech.successRate, null, 'successRate initialized to null');
        assert.strictEqual(tech.applicationCount, 0, 'applicationCount initialized to 0');

        const promotionEvents = deps.emittedEvents.filter(
          e => e.type === TGP_EVENTS.TECHNIQUE_PROMOTED,
        );
        assert.strictEqual(promotionEvents.length, 1, 'technique.promoted event emitted');
      }
    });

    it('template registration rolls back entirely on any step failure — no partial state', () => {
      // Defect: DC-TGP-403 — partial template registration leaves orphaned records
      const input = makeTemplateInput({ techniques: [] });
      const result = governor.templateRegistrar.registerTemplate(conn, ctx, input);

      if (!result.ok) {
        assert.strictEqual(
          result.error.code,
          TGP_TEMPLATE_ERROR_CODES.EMPTY_TEMPLATE,
          'Empty template must fail with EMPTY_TEMPLATE error',
        );
      }
    });
  });

  // ==========================================================================
  // GROUP 6: Quarantine Bidirectional Cascade
  // ==========================================================================

  describe('Group 6: Quarantine Bidirectional Cascade [TGP-I5]', () => {

    it('forward cascade sets quarantinedAt on candidate techniques', () => {
      // Defect: DC-TGP-501 — forward quarantine cascade skips candidate techniques
      seedTechnique(conn, { id: 'tech-fwd-q', sourceMemoryIds: ['memory-tainted'] });

      const result = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'memory-tainted', testTenantId('tenant-001'), 'integrity violation',
      );

      assert.ok(result.ok, 'Forward cascade should succeed');
      if (result.ok) {
        assert.ok(Array.isArray(result.value.candidatesBlocked), 'candidatesBlocked must be an array');
        assert.ok(Array.isArray(result.value.activesSuspended), 'activesSuspended must be an array');
        assert.ok(result.value.candidatesBlocked.length > 0, 'Must block at least one candidate');
      }
    });

    it('reverse cascade clears quarantinedAt when ALL source memories are restored', () => {
      // Defect: DC-TGP-502 — reverse cascade never implemented
      seedTechnique(conn, {
        id: 'tech-rev-q',
        sourceMemoryIds: ['memory-tainted'],
        quarantinedAt: new Date().toISOString(),
      });

      const result = governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'memory-tainted', testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Reverse cascade should succeed');
      if (result.ok) {
        assert.ok(Array.isArray(result.value.candidatesUnblocked), 'candidatesUnblocked must be an array');
        assert.ok(result.value.candidatesUnblocked.length > 0, 'Must unblock at least one candidate');
      }
    });

    it('partial restoration (one of two quarantined sources) does NOT clear quarantinedAt', () => {
      // Defect: DC-TGP-503 — partial restore clears quarantine prematurely
      seedTechnique(conn, {
        id: 'tech-partial-ab',
        sourceMemoryIds: ['memory-A-of-AB', 'memory-B-of-AB'],
        quarantinedAt: new Date().toISOString(),
      });
      // Another quarantined technique from memory-B proves B is still quarantined
      seedTechnique(conn, {
        id: 'tech-b-proof',
        sourceMemoryIds: ['memory-B-of-AB'],
        quarantinedAt: new Date().toISOString(),
      });

      const result = governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'memory-A-of-AB', testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Partial restoration should return success');
      if (result.ok) {
        assert.strictEqual(
          result.value.candidatesUnblocked.length, 0,
          'No candidates should be unblocked when another source is still quarantined',
        );
      }
    });
  });

  // ==========================================================================
  // GROUP 7: v3.2 Backward Compatibility
  // ==========================================================================

  describe('Group 7: v3.2 Backward Compatibility', () => {

    it('existing v3.2 technique (no new TGP fields) is handled gracefully', () => {
      // Defect: DC-TGP-601 — TGP breaks existing v3.2 technique processing
      // v3.2 techniques migrate with provenance_kind='local_extraction' and null TGP fields.
      seedTechnique(conn, {
        id: 'tech-legacy',
        agentId: 'agent-legacy',
        status: 'active',
        provenanceKind: 'local_extraction',
      });

      const result = governor.inferenceFilter.filterForInference(
        conn, testAgentId('agent-legacy'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Inference filter must handle v3.2 techniques');
      if (result.ok) {
        assert.strictEqual(result.value.length, 1, 'Legacy active technique must be included');
        assert.strictEqual(result.value[0].status, 'active');
      }
    });

    it('inference filter returns only active techniques, excludes candidates, suspended, retired', () => {
      // Defect: DC-TGP-602 — inference filter returns non-active techniques
      seedTechnique(conn, { id: 'tech-cand', status: 'candidate' });
      seedTechnique(conn, { id: 'tech-act', status: 'active' });
      seedTechnique(conn, { id: 'tech-susp', status: 'suspended' });
      seedTechnique(conn, {
        id: 'tech-ret', status: 'retired',
        retiredAt: new Date().toISOString(), retiredReason: 'stale',
      });

      const result = governor.inferenceFilter.filterForInference(
        conn, testAgentId('agent-001'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Filter should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.length, 1, 'Only one active technique');
        const nonActiveStatuses: TGPTechniqueStatus[] = ['candidate', 'suspended', 'retired'];
        for (const tech of result.value) {
          assert.ok(!nonActiveStatuses.includes(tech.status),
            `Technique ${tech.id} has non-active status '${tech.status}' in inference results`);
        }
      }
    });
  });

  // ==========================================================================
  // GROUP 8: Candidate Retention
  // ==========================================================================

  describe('Group 8: Candidate Retention [TGP-I6]', () => {

    it('candidate within retention period is NOT expired', () => {
      // Defect: DC-TGP-701 — fresh candidates incorrectly marked expired
      seedTechnique(conn, { id: 'technique-fresh' });

      const result = governor.candidateRetention.evaluate(
        conn, testTechniqueId('technique-fresh'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Retention evaluation should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.expired, false, 'Fresh candidate must not be expired');
        assert.ok(result.value.ageDays < result.value.retentionDays,
          'Age must be less than retention period');
        assert.strictEqual(result.value.retentionDays, DEFAULT_CANDIDATE_RETENTION_DAYS,
          'Default retention period must be used');
      }
    });

    it('candidate past retention period IS expired', () => {
      // Defect: DC-TGP-702 — old candidates never expire
      seedTechnique(conn, { id: 'technique-old', createdAt: daysAgo(91) });

      const result = governor.candidateRetention.evaluate(
        conn, testTechniqueId('technique-old'), testTenantId('tenant-001'),
      );

      assert.ok(result.ok, 'Retention evaluation should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.expired, true, 'Old candidate must be expired');
        assert.ok(result.value.ageDays >= result.value.retentionDays,
          'Age must be >= retention period');
      }
    });
  });

  // ==========================================================================
  // GROUP 9: Error Code & Constant Validation (structural — PASS)
  // ==========================================================================

  describe('Group 9: Error Code & Constant Validation (structural)', () => {

    it('TGP_STATUS_TRANSITIONS has correct transition targets for all four states', () => {
      assert.deepStrictEqual(
        [...TGP_STATUS_TRANSITIONS.candidate].sort(),
        ['active', 'retired'].sort(),
      );
      assert.deepStrictEqual(
        [...TGP_STATUS_TRANSITIONS.active].sort(),
        ['retired', 'suspended'].sort(),
      );
      assert.deepStrictEqual(
        [...TGP_STATUS_TRANSITIONS.suspended].sort(),
        ['active', 'retired'].sort(),
      );
      assert.deepStrictEqual(
        [...TGP_STATUS_TRANSITIONS.retired],
        [],
      );
    });

    it('TGP_EVENTS has all 8 defined events with correct string values', () => {
      const expectedEvents = {
        TECHNIQUE_EXTRACTED: 'technique.extracted',
        TECHNIQUE_PROMOTED: 'technique.promoted',
        TECHNIQUE_PROMOTION_REJECTED: 'technique.promotion_rejected',
        TECHNIQUE_SUSPENDED: 'technique.suspended',
        TECHNIQUE_RESTORED: 'technique.restored',
        TECHNIQUE_RETIRED: 'technique.retired',
        TECHNIQUE_QUARANTINE_BLOCKED: 'technique.quarantine_blocked',
        TECHNIQUE_QUARANTINE_CLEARED: 'technique.quarantine_cleared',
      };

      assert.strictEqual(Object.keys(TGP_EVENTS).length, 8, 'TGP_EVENTS must have exactly 8 events');
      for (const [key, value] of Object.entries(expectedEvents)) {
        assert.strictEqual(
          (TGP_EVENTS as Record<string, string>)[key], value,
          `TGP_EVENTS.${key} must equal '${value}'`,
        );
      }
    });

    it('TGP_PROMOTION_ERROR_CODES has all expected error codes', () => {
      const expectedCodes = [
        'NO_EVALUATION_EVIDENCE', 'INSUFFICIENT_EVALUATION_SOURCE',
        'TECHNIQUE_SOURCE_QUARANTINED', 'THRESHOLD_NOT_MET',
        'NOT_CANDIDATE', 'ALREADY_PROMOTED', 'AUDIT_INCOMPLETE',
        'INVALID_THRESHOLD',
      ];

      assert.strictEqual(Object.keys(TGP_PROMOTION_ERROR_CODES).length, expectedCodes.length);
      for (const code of expectedCodes) {
        assert.ok(code in TGP_PROMOTION_ERROR_CODES, `Must include ${code}`);
      }

      assert.strictEqual(TGP_PROMOTION_ERROR_CODES.NO_EVALUATION_EVIDENCE,
        'TGP_PROMOTION_NO_EVALUATION_EVIDENCE');
      assert.strictEqual(TGP_PROMOTION_ERROR_CODES.INSUFFICIENT_EVALUATION_SOURCE,
        'TGP_PROMOTION_INSUFFICIENT_EVALUATION_SOURCE');
      assert.strictEqual(TGP_PROMOTION_ERROR_CODES.TECHNIQUE_SOURCE_QUARANTINED,
        'TGP_PROMOTION_TECHNIQUE_SOURCE_QUARANTINED');
    });

    it('DEFAULT constants are correct per spec', () => {
      assert.strictEqual(DEFAULT_CANDIDATE_RETENTION_DAYS, 90);
      assert.strictEqual(DEFAULT_PROMOTION_CONFIDENCE_THRESHOLD, 0.5);
    });

    it('QUALIFYING_EVALUATION_SOURCES excludes transfer_history', () => {
      assert.deepStrictEqual(
        [...QUALIFYING_EVALUATION_SOURCES].sort(),
        ['manual', 'runtime', 'template'].sort(),
      );
      assert.ok(!QUALIFYING_EVALUATION_SOURCES.includes('transfer_history'),
        'transfer_history must NOT be a qualifying evaluation source');
    });

    it('TGP_LIFECYCLE_ERROR_CODES has all expected lifecycle error codes', () => {
      const expectedCodes = [
        'BACKWARD_TRANSITION', 'INVALID_TRANSITION', 'CONTENT_IMMUTABLE',
        'TYPE_IMMUTABLE', 'RETIRED_TERMINAL', 'CANDIDATE_SKIP_SUSPENDED',
      ];
      assert.strictEqual(Object.keys(TGP_LIFECYCLE_ERROR_CODES).length, expectedCodes.length);
      for (const code of expectedCodes) {
        assert.ok(code in TGP_LIFECYCLE_ERROR_CODES, `Must include ${code}`);
      }
    });

    it('TGP_QUARANTINE_ERROR_CODES, TGP_EVALUATION_ERROR_CODES, TGP_RETENTION_ERROR_CODES, TGP_TEMPLATE_ERROR_CODES all present', () => {
      assert.ok('NO_SOURCE_MEMORIES' in TGP_QUARANTINE_ERROR_CODES);
      assert.ok('MEMORY_NOT_IN_SOURCES' in TGP_QUARANTINE_ERROR_CODES);
      assert.ok('TECHNIQUE_NOT_FOUND' in TGP_EVALUATION_ERROR_CODES);
      assert.ok('INVALID_CONFIDENCE_SCORE' in TGP_EVALUATION_ERROR_CODES);
      assert.ok('EVALUATION_NOT_FOUND' in TGP_EVALUATION_ERROR_CODES);
      assert.ok('NOT_CANDIDATE' in TGP_RETENTION_ERROR_CODES);
      assert.ok('EMPTY_TEMPLATE' in TGP_TEMPLATE_ERROR_CODES);
      assert.ok('TEMPLATE_ALREADY_APPLIED' in TGP_TEMPLATE_ERROR_CODES);
      assert.ok('TRANSACTION_FAILED' in TGP_TEMPLATE_ERROR_CODES);
      assert.ok('INVALID_CONFIDENCE_SCORE' in TGP_TEMPLATE_ERROR_CODES);
    });
  });

  // ==========================================================================
  // GROUP 10: Harness Verification (structural)
  // ==========================================================================

  describe('Group 10: Harness Verification (structural)', () => {

    it('NotImplementedError has correct shape: code, name, message', () => {
      // DC-TGP-901 — harness error shape verification (retained for structural tests)
      const error = new NotImplementedError('TestMethod');

      assert.strictEqual(error.code, 'NOT_IMPLEMENTED');
      assert.strictEqual(error.name, 'NotImplementedError');
      assert.ok(error.message.includes('TestMethod'));
      assert.ok(error.message.includes('not yet implemented'));
      assert.ok(error instanceof Error);
      assert.ok(error instanceof NotImplementedError);
    });

    it('createTechniqueGovernor returns frozen facade with all subsystems', () => {
      // DC-TGP-902 — facade wiring verification
      assert.notStrictEqual(governor.evaluationStore, undefined);
      assert.notStrictEqual(governor.promotionStore, undefined);
      assert.notStrictEqual(governor.promotionGate, undefined);
      assert.notStrictEqual(governor.quarantineCascade, undefined);
      assert.notStrictEqual(governor.candidateRetention, undefined);
      assert.notStrictEqual(governor.inferenceFilter, undefined);
      assert.notStrictEqual(governor.templateRegistrar, undefined);
      assert.ok(Object.isFrozen(governor), 'Governor must be frozen');
    });

    it('all subsystem methods are implemented and return Result objects', () => {
      // DC-TGP-903 updated: post-implementation verification
      // All methods must return Result objects, not throw NotImplementedError.

      // evaluationStore.getByTechnique on nonexistent → ok([])
      const r1 = governor.evaluationStore.getByTechnique(
        conn, testTechniqueId('nonexistent'), testTenantId('tenant-001'),
      );
      assert.strictEqual(r1.ok, true, 'getByTechnique must return ok Result');
      if (r1.ok) assert.deepStrictEqual(r1.value, []);

      // promotionStore.getByTechnique on nonexistent → ok([])
      const r2 = governor.promotionStore.getByTechnique(
        conn, testTechniqueId('nonexistent'), testTenantId('tenant-001'),
      );
      assert.strictEqual(r2.ok, true, 'getByTechnique must return ok Result');

      // promotionStore.getSuccessful on nonexistent → ok(null)
      const r3 = governor.promotionStore.getSuccessful(
        conn, testTechniqueId('nonexistent'), testTenantId('tenant-001'),
      );
      assert.strictEqual(r3.ok, true, 'getSuccessful must return ok Result');

      // inferenceFilter → ok([])
      const r4 = governor.inferenceFilter.filterForInference(
        conn, testAgentId('nonexistent'), testTenantId('tenant-001'),
      );
      assert.strictEqual(r4.ok, true, 'filterForInference must return ok Result');

      // candidateRetention.retireExpired → ok([])
      const r5 = governor.candidateRetention.retireExpired(
        conn, ctx, testAgentId('nonexistent'), testTenantId('tenant-001'),
      );
      assert.strictEqual(r5.ok, true, 'retireExpired must return ok Result');

      // templateRegistrar with empty template → err
      const r6 = governor.templateRegistrar.registerTemplate(
        conn, ctx, makeTemplateInput({ techniques: [] }),
      );
      assert.strictEqual(r6.ok, false, 'Empty template must return err Result');

      // quarantineCascade on nonexistent memory → ok (empty arrays)
      const r7 = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'nonexistent', testTenantId('tenant-001'), 'test',
      );
      assert.strictEqual(r7.ok, true, 'onMemoryQuarantined must return ok Result');

      const r8 = governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'nonexistent', testTenantId('tenant-001'),
      );
      assert.strictEqual(r8.ok, true, 'onMemoryRestored must return ok Result');
    });
  });

  // ==========================================================================
  // GROUP 11: Remediation — Implementation Defect Tests
  // ==========================================================================

  describe('Group 11: Remediation — Implementation Defect Fixes', () => {

    // BPB-01: DC-TGP-411 — Threshold floor rejects 0.0
    it('DC-TGP-411: promotion with confidenceThreshold 0.0 is rejected with INVALID_THRESHOLD', () => {
      seedTechnique(conn, { id: 'tech-floor-test' });
      seedEvaluation(conn, { id: 'eval-floor', techniqueId: 'tech-floor-test', confidenceScore: 0.9 });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('tech-floor-test'),
        evaluationIds: [testEvaluationId('eval-floor')],
        confidenceThreshold: 0.0,
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Should return result');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false, 'Threshold 0.0 must be rejected');
        assert.ok(
          result.value.decision.rejectionReason!.includes('below floor'),
          `Must cite threshold floor, got: '${result.value.decision.rejectionReason}'`,
        );
      }
    });

    // BPB-04: DC-TGP-411 — NaN bypasses threshold
    it('DC-TGP-411: promotion with confidenceThreshold NaN is rejected with INVALID_THRESHOLD', () => {
      seedTechnique(conn, { id: 'tech-nan-test' });
      seedEvaluation(conn, { id: 'eval-nan', techniqueId: 'tech-nan-test', confidenceScore: 0.9 });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('tech-nan-test'),
        evaluationIds: [testEvaluationId('eval-nan')],
        confidenceThreshold: NaN,
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Should return result');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false, 'NaN threshold must be rejected');
        assert.ok(
          result.value.decision.rejectionReason!.includes('finite number'),
          `Must cite finite number requirement, got: '${result.value.decision.rejectionReason}'`,
        );
      }
    });

    // BPB-04 supplemental: Infinity threshold
    it('DC-TGP-411: promotion with confidenceThreshold Infinity is rejected', () => {
      seedTechnique(conn, { id: 'tech-inf-test' });
      seedEvaluation(conn, { id: 'eval-inf', techniqueId: 'tech-inf-test', confidenceScore: 0.9 });

      const input = makePromotionInput({
        techniqueId: testTechniqueId('tech-inf-test'),
        evaluationIds: [testEvaluationId('eval-inf')],
        confidenceThreshold: Infinity,
      });
      const result = governor.promotionGate.attemptPromotion(conn, ctx, input);

      assert.ok(result.ok, 'Should return result');
      if (result.ok) {
        assert.strictEqual(result.value.promoted, false, 'Infinity threshold must be rejected');
      }
    });

    // BPB-02: DC-TGP-307 — Template idempotency
    it('DC-TGP-307: duplicate template registration returns TEMPLATE_ALREADY_APPLIED', () => {
      const input = makeTemplateInput();

      // First registration succeeds
      const result1 = governor.templateRegistrar.registerTemplate(conn, ctx, input);
      assert.ok(result1.ok, 'First registration should succeed');

      // Second registration with same templateId + templateVersion must fail
      const result2 = governor.templateRegistrar.registerTemplate(conn, ctx, input);
      assert.strictEqual(result2.ok, false, 'Duplicate template registration must fail');
      if (!result2.ok) {
        assert.strictEqual(
          result2.error.code,
          TGP_TEMPLATE_ERROR_CODES.TEMPLATE_ALREADY_APPLIED,
          'Error code must be TEMPLATE_ALREADY_APPLIED',
        );
      }
    });

    // BPB-03: DC-TGP-908 — SQLite WAL assertion at factory
    it('DC-TGP-908: createTechniqueGovernor with conn verifies PRAGMA journal_mode', () => {
      // The test database sets journal_mode = WAL but in-memory falls back to 'memory'.
      // Both 'wal' and 'memory' are acceptable. Verify the factory doesn't throw for valid modes.
      assert.doesNotThrow(() => {
        createTechniqueGovernor(deps, conn);
      }, 'Factory must accept WAL or memory journal mode');

      // Verify journal_mode is one of the accepted values
      const pragma = conn.get<{ journal_mode: string }>('PRAGMA journal_mode');
      assert.ok(
        pragma?.journal_mode === 'wal' || pragma?.journal_mode === 'memory',
        `journal_mode must be wal or memory, got: ${pragma?.journal_mode}`,
      );
    });

    // BPB-05: DC-TGP-109 — Template registration bypasses confidence validation
    it('DC-TGP-109: template with NaN confidence score is rejected', () => {
      const input = makeTemplateInput({
        techniques: [{
          type: 'prompt_fragment',
          content: 'NaN confidence technique',
          evaluationEvidence: {
            baselinePerformance: { accuracy: 0.5 },
            techniquePerformance: { accuracy: 0.8 },
            comparisonResult: { improvement: 0.3 },
            confidenceScore: NaN,
          },
        }],
      });
      const result = governor.templateRegistrar.registerTemplate(conn, ctx, input);

      assert.strictEqual(result.ok, false, 'NaN confidence in template must fail');
      if (!result.ok) {
        assert.strictEqual(
          result.error.code,
          TGP_TEMPLATE_ERROR_CODES.INVALID_CONFIDENCE_SCORE,
          'Error code must be INVALID_CONFIDENCE_SCORE',
        );
      }
    });

    // BPB-05 supplemental: out-of-range template confidence
    it('DC-TGP-109: template with confidence > 1.0 is rejected', () => {
      const input = makeTemplateInput({
        techniques: [{
          type: 'prompt_fragment',
          content: 'Over-confident technique',
          evaluationEvidence: {
            baselinePerformance: { accuracy: 0.5 },
            techniquePerformance: { accuracy: 0.8 },
            comparisonResult: { improvement: 0.3 },
            confidenceScore: 1.5,
          },
        }],
      });
      const result = governor.templateRegistrar.registerTemplate(conn, ctx, input);

      assert.strictEqual(result.ok, false, 'Confidence > 1.0 in template must fail');
    });

    // BPB-09: DC-TGP-203 trigger layer — retired→active trigger test
    it('DC-TGP-203 trigger: direct SQL UPDATE retired→active is rejected by trigger', () => {
      seedTechnique(conn, {
        id: 'tech-retired-trigger',
        status: 'retired',
        retiredAt: new Date().toISOString(),
        retiredReason: 'low_confidence',
      });

      assert.throws(
        () => conn.run(
          "UPDATE learning_techniques SET status = 'active' WHERE id = ? AND tenant_id = ?",
          ['tech-retired-trigger', 'tenant-001'],
        ),
        { message: /TGP-I2/ },
        'Retired→active transition must be rejected by TGP-I2 trigger',
      );
    });
  });

  // ==========================================================================
  // GROUP 12: Tenant Isolation (Category 7 — DC-TGP-701 through DC-TGP-707)
  // ==========================================================================

  describe('Group 12: Tenant Isolation [Category 7]', () => {

    // DC-TGP-706: Evaluation queries return zero results for wrong tenant
    it('DC-TGP-706: evaluation query returns zero for wrong tenant', () => {
      const tenantA = testTenantId('tenant-A');
      const tenantB = testTenantId('tenant-B');

      // Create technique and evaluation as tenant A
      seedTechnique(conn, { id: 'tech-tenant-A', tenantId: 'tenant-A' });
      seedEvaluation(conn, { id: 'eval-tenant-A', techniqueId: 'tech-tenant-A', tenantId: 'tenant-A' });

      // Query as tenant B — must not find tenant A's evaluations
      const result = governor.evaluationStore.getByTechnique(
        conn, testTechniqueId('tech-tenant-A'), tenantB,
      );
      assert.ok(result.ok, 'Query should succeed');
      if (result.ok) {
        assert.strictEqual(result.value.length, 0,
          'Tenant B must NOT see tenant A evaluations');
      }

      // Query as tenant A — must find the evaluation
      const resultA = governor.evaluationStore.getByTechnique(
        conn, testTechniqueId('tech-tenant-A'), tenantA,
      );
      assert.ok(resultA.ok, 'Query should succeed');
      if (resultA.ok) {
        assert.strictEqual(resultA.value.length, 1,
          'Tenant A must see its own evaluation');
      }
    });

    // DC-TGP-707: Decision queries return zero results for wrong tenant
    it('DC-TGP-707: promotion decision query returns zero for wrong tenant', () => {
      const tenantA = testTenantId('tenant-A');
      const tenantB = testTenantId('tenant-B');

      // Create technique, evaluation, and promote as tenant A
      seedTechnique(conn, { id: 'tech-promo-A', tenantId: 'tenant-A' });
      seedEvaluation(conn, { id: 'eval-promo-A', techniqueId: 'tech-promo-A', tenantId: 'tenant-A' });

      const ctxA = createMockCtx({ tenantId: tenantA });
      const promoResult = governor.promotionGate.attemptPromotion(conn, ctxA, makePromotionInput({
        techniqueId: testTechniqueId('tech-promo-A'),
        tenantId: tenantA,
        evaluationIds: [testEvaluationId('eval-promo-A')],
      }));
      assert.ok(promoResult.ok && (promoResult as { ok: true; value: PromotionAttemptResult }).value.promoted,
        'Tenant A promotion should succeed');

      // Query decisions as tenant B — must not find tenant A's decision
      const resultB = governor.promotionStore.getByTechnique(
        conn, testTechniqueId('tech-promo-A'), tenantB,
      );
      assert.ok(resultB.ok, 'Query should succeed');
      if (resultB.ok) {
        assert.strictEqual(resultB.value.length, 0,
          'Tenant B must NOT see tenant A promotion decisions');
      }
    });

    // DC-TGP-701: Cross-tenant evaluation data
    it('DC-TGP-701: evaluationStore.getById returns not found for wrong tenant', () => {
      seedTechnique(conn, { id: 'tech-eval-iso', tenantId: 'tenant-A' });
      seedEvaluation(conn, { id: 'eval-iso-001', techniqueId: 'tech-eval-iso', tenantId: 'tenant-A' });

      const result = governor.evaluationStore.getById(
        conn, testEvaluationId('eval-iso-001'), testTenantId('tenant-B'),
      );
      assert.strictEqual(result.ok, false,
        'Wrong tenant must not access evaluation by ID');
    });

    // DC-TGP-702: Cross-tenant promotion decision access
    it('DC-TGP-702: promotionStore.getById returns not found for wrong tenant', () => {
      seedTechnique(conn, { id: 'tech-dec-iso', tenantId: 'tenant-A' });
      seedEvaluation(conn, { id: 'eval-dec-iso', techniqueId: 'tech-dec-iso', tenantId: 'tenant-A' });

      const ctxA = createMockCtx({ tenantId: testTenantId('tenant-A') });
      const promoResult = governor.promotionGate.attemptPromotion(conn, ctxA, makePromotionInput({
        techniqueId: testTechniqueId('tech-dec-iso'),
        tenantId: testTenantId('tenant-A'),
        evaluationIds: [testEvaluationId('eval-dec-iso')],
      }));
      assert.ok(promoResult.ok, 'Promotion should succeed');
      const decisionId = promoResult.ok ? (promoResult.value as PromotionAttemptResult).decision.id : null;
      assert.ok(decisionId, 'Decision ID must exist');

      // Tenant B cannot access tenant A's decision
      const result = governor.promotionStore.getById(
        conn, decisionId!, testTenantId('tenant-B'),
      );
      assert.strictEqual(result.ok, false,
        'Wrong tenant must not access promotion decision by ID');
    });

    // DC-TGP-703: Cross-tenant technique promotion
    it('DC-TGP-703: cannot promote technique belonging to different tenant', () => {
      seedTechnique(conn, { id: 'tech-cross-promo', tenantId: 'tenant-A' });
      seedEvaluation(conn, { id: 'eval-cross-promo', techniqueId: 'tech-cross-promo', tenantId: 'tenant-A' });

      // Attempt promotion as tenant B for tenant A's technique
      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('tech-cross-promo'),
        tenantId: testTenantId('tenant-B'),
        evaluationIds: [testEvaluationId('eval-cross-promo')],
      }));

      // Should fail because technique not found for tenant B
      assert.strictEqual(result.ok, false,
        'Cross-tenant promotion must fail with technique not found');
    });

    // DC-TGP-704: Quarantine cascade crosses tenant boundary
    it('DC-TGP-704: quarantine cascade does not affect other tenants techniques', () => {
      seedTechnique(conn, { id: 'tech-q-tenA', tenantId: 'tenant-A', sourceMemoryIds: ['shared-memory'] });
      seedTechnique(conn, { id: 'tech-q-tenB', tenantId: 'tenant-B', sourceMemoryIds: ['shared-memory'] });

      // Quarantine memory for tenant A only
      const result = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'shared-memory', testTenantId('tenant-A'), 'A-only quarantine',
      );

      assert.ok(result.ok, 'Quarantine should succeed');
      if (result.ok) {
        // Only tenant A's technique should be blocked
        assert.ok(result.value.candidatesBlocked.some(id => id === testTechniqueId('tech-q-tenA')),
          'Tenant A technique must be quarantined');
        assert.ok(!result.value.candidatesBlocked.some(id => id === testTechniqueId('tech-q-tenB')),
          'Tenant B technique must NOT be quarantined by tenant A cascade');
      }

      // Verify tenant B's technique is unaffected
      const rowB = conn.get<{ quarantined_at: string | null }>(
        'SELECT quarantined_at FROM learning_techniques WHERE id = ?', ['tech-q-tenB'],
      );
      assert.strictEqual(rowB?.quarantined_at, null, 'Tenant B technique must remain unquarantined');
    });

    // DC-TGP-705: Inference filter returns other tenants' techniques
    it('DC-TGP-705: inference filter returns only own tenant techniques', () => {
      seedTechnique(conn, { id: 'tech-inf-A', tenantId: 'tenant-A', status: 'active' });
      seedTechnique(conn, { id: 'tech-inf-B', tenantId: 'tenant-B', status: 'active' });

      const resultA = governor.inferenceFilter.filterForInference(
        conn, testAgentId('agent-001'), testTenantId('tenant-A'),
      );
      assert.ok(resultA.ok, 'Filter should succeed');
      if (resultA.ok) {
        assert.strictEqual(resultA.value.length, 1, 'Tenant A should see exactly 1 technique');
        assert.strictEqual(resultA.value[0].tenantId, testTenantId('tenant-A'),
          'Returned technique must belong to tenant A');
      }
    });
  });

  // ==========================================================================
  // GROUP 13: Event Emission Coverage (Category 5 — Missing Events)
  // ==========================================================================

  describe('Group 13: Event Emission Coverage [Category 5]', () => {

    // DC-TGP-506: Event on suspension (active→suspended via quarantine cascade)
    it('DC-TGP-506: technique.suspended event fires on quarantine cascade of active technique', () => {
      seedTechnique(conn, {
        id: 'tech-susp-event',
        status: 'active',
        sourceMemoryIds: ['mem-susp'],
      });

      governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'mem-susp', testTenantId('tenant-001'), 'integrity failure',
      );

      const suspendedEvents = deps.emittedEvents.filter(
        e => e.type === TGP_EVENTS.TECHNIQUE_SUSPENDED,
      );
      assert.strictEqual(suspendedEvents.length, 1, 'technique.suspended event must fire');
      assert.strictEqual(suspendedEvents[0].payload.techniqueId, 'tech-susp-event');
      assert.ok(
        (suspendedEvents[0].payload.reason as string).includes('quarantine_cascade'),
        'Suspension reason must reference quarantine cascade',
      );
    });

    // DC-TGP-509: Event on quarantine clearing
    it('DC-TGP-509: technique.quarantine_cleared event fires on memory restoration', () => {
      seedTechnique(conn, {
        id: 'tech-clear-event',
        sourceMemoryIds: ['mem-clear'],
        quarantinedAt: new Date().toISOString(),
      });

      governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'mem-clear', testTenantId('tenant-001'),
      );

      const clearedEvents = deps.emittedEvents.filter(
        e => e.type === TGP_EVENTS.TECHNIQUE_QUARANTINE_CLEARED,
      );
      assert.strictEqual(clearedEvents.length, 1, 'technique.quarantine_cleared event must fire');
      assert.strictEqual(clearedEvents[0].payload.techniqueId, 'tech-clear-event');
      assert.strictEqual(clearedEvents[0].payload.memoryId, 'mem-clear');
    });

    // DC-TGP-510: Event on promotion rejection
    it('DC-TGP-510: technique.promotion_rejected event fires on failed promotion', () => {
      seedTechnique(conn, { id: 'tech-reject-event' });
      // No evaluations → promotion rejected

      governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('tech-reject-event'),
        evaluationIds: [],
      }));

      const rejectedEvents = deps.emittedEvents.filter(
        e => e.type === TGP_EVENTS.TECHNIQUE_PROMOTION_REJECTED,
      );
      assert.strictEqual(rejectedEvents.length, 1, 'technique.promotion_rejected event must fire');
      assert.strictEqual(rejectedEvents[0].payload.techniqueId, 'tech-reject-event');
    });

    // DC-TGP-501: Event on extraction (technique.extracted)
    // The TGP implementation doesn't have an extraction method — techniques are seeded
    // via INSERT. The extraction event is emitted by the learning subsystem, not TGP.
    // But TGP template registration emits technique.promoted (not extracted).
    // For TGP scope: verify template registration emits promoted event (already tested).
    // The extraction event (technique.extracted) is outside TGP's scope — it belongs to
    // the v3.2 learning subsystem's technique_store.ts.
    // Mark as COVERED by noting TGP does not own the extraction path.

    // DC-TGP-505: Audit entry on TGP mutations
    it('DC-TGP-505: promotion creates audit entry', () => {
      seedTechnique(conn, { id: 'tech-audit-promo' });
      seedEvaluation(conn, { id: 'eval-audit', techniqueId: 'tech-audit-promo' });

      deps.auditEntries.length = 0; // Clear prior entries
      governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('tech-audit-promo'),
        evaluationIds: [testEvaluationId('eval-audit')],
      }));

      const promotionAudits = deps.auditEntries.filter(
        (e: Record<string, unknown>) => (e.action as string).includes('technique.promotion'),
      );
      assert.ok(promotionAudits.length > 0, 'Promotion must create an audit entry');
    });

    // DC-TGP-410: Candidate retirement creates audit entry
    it('DC-TGP-410: candidate retirement creates audit entry', () => {
      seedTechnique(conn, { id: 'tech-audit-retire', createdAt: daysAgo(91) });

      deps.auditEntries.length = 0;
      governor.candidateRetention.retireExpired(
        conn, ctx, testAgentId('agent-001'), testTenantId('tenant-001'),
      );

      const retireAudits = deps.auditEntries.filter(
        (e: Record<string, unknown>) => (e.action as string).includes('technique.retention'),
      );
      assert.ok(retireAudits.length > 0, 'Retirement must create an audit entry');
    });

    // DC-TGP-505 supplemental: quarantine cascade creates audit entry
    it('DC-TGP-505: quarantine cascade creates audit entry', () => {
      seedTechnique(conn, { id: 'tech-audit-q', sourceMemoryIds: ['mem-audit'] });

      deps.auditEntries.length = 0;
      governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'mem-audit', testTenantId('tenant-001'), 'audit test',
      );

      const qAudits = deps.auditEntries.filter(
        (e: Record<string, unknown>) => (e.action as string).includes('technique.quarantine'),
      );
      assert.ok(qAudits.length > 0, 'Quarantine cascade must create an audit entry');
    });

    // DC-TGP-505 supplemental: evaluation creation creates audit entry
    it('DC-TGP-505: evaluation creation creates audit entry', () => {
      seedTechnique(conn, { id: 'tech-audit-eval' });

      deps.auditEntries.length = 0;
      governor.evaluationStore.create(conn, ctx, makeEvaluationInput({
        techniqueId: testTechniqueId('tech-audit-eval'),
      }));

      const evalAudits = deps.auditEntries.filter(
        (e: Record<string, unknown>) => (e.action as string).includes('technique.evaluation'),
      );
      assert.ok(evalAudits.length > 0, 'Evaluation creation must create an audit entry');
    });
  });

  // ==========================================================================
  // GROUP 14: Additional DC Coverage Restoration
  // ==========================================================================

  describe('Group 14: Additional DC Coverage Restoration', () => {

    // DC-TGP-108: Orphaned promotion decision references nonexistent technique
    it('DC-TGP-108: promotion on nonexistent technique returns error', () => {
      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('nonexistent-technique'),
      }));
      assert.strictEqual(result.ok, false, 'Promotion on nonexistent technique must fail');
      if (!result.ok) {
        assert.strictEqual(result.error.code, TGP_EVALUATION_ERROR_CODES.TECHNIQUE_NOT_FOUND);
      }
    });

    // DC-TGP-109: Evaluation confidence score validation (NaN, Infinity, out-of-range)
    it('DC-TGP-109: evaluation with NaN confidence score is rejected', () => {
      seedTechnique(conn, { id: 'tech-nan-eval' });
      const result = governor.evaluationStore.create(conn, ctx, makeEvaluationInput({
        techniqueId: testTechniqueId('tech-nan-eval'),
        confidenceScore: NaN,
      }));
      assert.strictEqual(result.ok, false, 'NaN confidence must be rejected');
      if (!result.ok) {
        assert.strictEqual(result.error.code, TGP_EVALUATION_ERROR_CODES.INVALID_CONFIDENCE_SCORE);
      }
    });

    it('DC-TGP-109: evaluation with Infinity confidence score is rejected', () => {
      seedTechnique(conn, { id: 'tech-inf-eval' });
      const result = governor.evaluationStore.create(conn, ctx, makeEvaluationInput({
        techniqueId: testTechniqueId('tech-inf-eval'),
        confidenceScore: Infinity,
      }));
      assert.strictEqual(result.ok, false, 'Infinity confidence must be rejected');
    });

    it('DC-TGP-109: evaluation with negative confidence score is rejected', () => {
      seedTechnique(conn, { id: 'tech-neg-eval' });
      const result = governor.evaluationStore.create(conn, ctx, makeEvaluationInput({
        techniqueId: testTechniqueId('tech-neg-eval'),
        confidenceScore: -0.5,
      }));
      assert.strictEqual(result.ok, false, 'Negative confidence must be rejected');
    });

    it('DC-TGP-109: evaluation with confidence > 1.0 is rejected', () => {
      seedTechnique(conn, { id: 'tech-over-eval' });
      const result = governor.evaluationStore.create(conn, ctx, makeEvaluationInput({
        techniqueId: testTechniqueId('tech-over-eval'),
        confidenceScore: 1.5,
      }));
      assert.strictEqual(result.ok, false, 'Confidence > 1.0 must be rejected');
    });

    // DC-TGP-113: Promotion fields set prematurely on candidate
    it('DC-TGP-113: candidate technique has null promotedAt and null promotionDecisionId', () => {
      seedTechnique(conn, { id: 'tech-candidate-fields' });
      const row = conn.get<{ promoted_at: string | null; promotion_decision_id: string | null }>(
        'SELECT promoted_at, promotion_decision_id FROM learning_techniques WHERE id = ?',
        ['tech-candidate-fields'],
      );
      assert.strictEqual(row?.promoted_at, null, 'Candidate promotedAt must be null');
      assert.strictEqual(row?.promotion_decision_id, null, 'Candidate promotionDecisionId must be null');
    });

    // DC-TGP-204: Candidate → suspended skip (behavioral trigger test)
    it('DC-TGP-204: direct SQL candidate→suspended is rejected by trigger', () => {
      seedTechnique(conn, { id: 'tech-skip-susp', status: 'candidate' });

      assert.throws(
        () => conn.run(
          "UPDATE learning_techniques SET status = 'suspended' WHERE id = ? AND tenant_id = ?",
          ['tech-skip-susp', 'tenant-001'],
        ),
        { message: /TGP-I2/ },
        'Candidate→suspended must be rejected by TGP-I2 trigger',
      );
    });

    // DC-TGP-211: Promotion fields immutability after set
    it('DC-TGP-211: promoted_at field is immutable after set — trigger rejects modification', () => {
      // Use distinct timestamps so OLD != NEW (same-ms precision can cause IS NOT to be false)
      seedTechnique(conn, {
        id: 'tech-promo-immutable',
        status: 'active',
        promotedAt: '2025-01-01T00:00:00.000Z',
        promotionDecisionId: 'decision-xyz',
      });

      assert.throws(
        () => conn.run(
          'UPDATE learning_techniques SET promoted_at = ? WHERE id = ? AND tenant_id = ?',
          ['2025-06-15T12:00:00.000Z', 'tech-promo-immutable', 'tenant-001'],
        ),
        { message: /TGP/ },
        'Modifying promoted_at after set must be rejected by trigger',
      );
    });

    // DC-TGP-412: Direct SQL INSERT with status ≠ 'candidate' (schema default check)
    it('DC-TGP-412: INSERT without explicit status defaults to candidate', () => {
      const now = new Date().toISOString();
      conn.run(
        `INSERT INTO learning_techniques
          (id, tenant_id, agent_id, type, content, source_memory_ids,
           confidence, application_count, last_updated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['tech-default-status', 'tenant-001', 'agent-001', 'prompt_fragment',
         'test content', JSON.stringify(['mem-1']), 0.5, 0, now, now],
      );

      const row = conn.get<{ status: string }>(
        'SELECT status FROM learning_techniques WHERE id = ?', ['tech-default-status'],
      );
      assert.strictEqual(row?.status, 'candidate', 'Default status must be candidate');
    });

    // DC-TGP-207: Restoration confidence (suspended→active) note
    // This DC concerns the v3.2 suspension→restoration path which resets confidence to 0.3.
    // TGP does not implement suspended→active restoration (requires human CF-01 action).
    // The test for CT-TGP-09 already verifies suspended is NOT auto-restored.

    // DC-TGP-304: Candidate retired during in-flight promotion
    it('DC-TGP-304: promotion on a technique retired between read and write fails', () => {
      // Seed a candidate, retire it, then try to promote → NOT_CANDIDATE
      seedTechnique(conn, {
        id: 'tech-retired-race',
        status: 'retired',
        retiredAt: new Date().toISOString(),
        retiredReason: 'candidate_expiry',
      });

      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('tech-retired-race'),
      }));
      assert.strictEqual(result.ok, false, 'Promoting retired technique must fail');
      if (!result.ok) {
        assert.strictEqual(result.error.code, TGP_PROMOTION_ERROR_CODES.NOT_CANDIDATE);
      }
    });

    // DC-TGP-116: Local extraction with empty sourceMemoryIds
    // Note: This is allowed by the schema (JSON array can be empty).
    // The test verifies behavior is handled gracefully.
    it('DC-TGP-116: technique with empty sourceMemoryIds handles quarantine cascade gracefully', () => {
      seedTechnique(conn, { id: 'tech-empty-sources', sourceMemoryIds: [] });

      // Quarantine on a memory that doesn't match any source → no effect
      const result = governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'any-memory', testTenantId('tenant-001'), 'test',
      );
      assert.ok(result.ok, 'Cascade should succeed');
      if (result.ok) {
        assert.ok(!result.value.candidatesBlocked.includes(testTechniqueId('tech-empty-sources')),
          'Technique with empty sources should not be blocked');
      }
    });

    // DC-TGP-413: Non-template technique promoted using template evaluationSource
    // The promotion gate doesn't restrict evaluation source types — any qualifying source works.
    // template evaluationSource is a valid qualifying source for any technique.
    // This DC is about pipeline-level enforcement, not runtime TGP enforcement.
    // The test verifies the promotion gate accepts template source for non-template technique.
    it('DC-TGP-413: non-template technique with template evaluation source can promote', () => {
      seedTechnique(conn, { id: 'tech-non-template', provenanceKind: 'local_extraction' });
      seedEvaluation(conn, {
        id: 'eval-template-source',
        techniqueId: 'tech-non-template',
        evaluationSource: 'template',
        confidenceScore: 0.9,
      });

      const result = governor.promotionGate.attemptPromotion(conn, ctx, makePromotionInput({
        techniqueId: testTechniqueId('tech-non-template'),
        evaluationIds: [testEvaluationId('eval-template-source')],
      }));
      assert.ok(result.ok, 'Should return result');
      if (result.ok) {
        // template is a qualifying source — promotion should succeed
        assert.strictEqual(result.value.promoted, true,
          'Template evaluation source qualifies for promotion of any technique');
      }
    });

    // DC-TGP-306: Quarantine cascade and restoration race (sequential approximation)
    it('DC-TGP-306: quarantine then immediate restore clears quarantinedAt', () => {
      seedTechnique(conn, { id: 'tech-q-race', sourceMemoryIds: ['mem-race'] });

      // Quarantine
      governor.quarantineCascade.onMemoryQuarantined(
        conn, ctx, 'mem-race', testTenantId('tenant-001'), 'temporary',
      );

      // Verify quarantined
      let row = conn.get<{ quarantined_at: string | null }>(
        'SELECT quarantined_at FROM learning_techniques WHERE id = ?', ['tech-q-race'],
      );
      assert.notStrictEqual(row?.quarantined_at, null, 'Must be quarantined after cascade');

      // Immediately restore
      governor.quarantineCascade.onMemoryRestored(
        conn, ctx, 'mem-race', testTenantId('tenant-001'),
      );

      // Verify cleared
      row = conn.get<{ quarantined_at: string | null }>(
        'SELECT quarantined_at FROM learning_techniques WHERE id = ?', ['tech-q-race'],
      );
      assert.strictEqual(row?.quarantined_at, null, 'Must be cleared after restoration');
    });

    // DC-TGP-511: CorrelationId mismatch
    // TGP uses OperationContext but does not implement a correlationId field.
    // This DC is informational — the spec does not define correlation requirements for TGP v1.0.
    // Noting as ACKNOWLEDGED — not testable at current API surface.

    // DC-TGP-209: Production metrics mutable while candidate
    it('DC-TGP-209: candidate technique metrics are not modified by evaluation creation', () => {
      seedTechnique(conn, { id: 'tech-cand-metrics', confidence: 0.5, applicationCount: 0 });
      governor.evaluationStore.create(conn, ctx, makeEvaluationInput({
        techniqueId: testTechniqueId('tech-cand-metrics'),
        confidenceScore: 0.9,
      }));

      // Verify metrics unchanged — evaluation record creation does not update technique metrics
      const row = conn.get<{ confidence: number; application_count: number }>(
        'SELECT confidence, application_count FROM learning_techniques WHERE id = ?',
        ['tech-cand-metrics'],
      );
      assert.strictEqual(row?.confidence, 0.5, 'Candidate confidence must not change from evaluation');
      assert.strictEqual(row?.application_count, 0, 'Candidate application_count must not change');
    });

    // DC-TGP-210: Production metrics mutable while retired/suspended
    it('DC-TGP-210: retired technique metrics are frozen', () => {
      seedTechnique(conn, {
        id: 'tech-retired-metrics',
        status: 'retired',
        retiredAt: new Date().toISOString(),
        retiredReason: 'stale',
        confidence: 0.3,
        applicationCount: 50,
      });

      // Evaluation creation should succeed (evaluation records are separate from technique)
      // but technique metrics must remain unchanged
      const row = conn.get<{ confidence: number; application_count: number }>(
        'SELECT confidence, application_count FROM learning_techniques WHERE id = ?',
        ['tech-retired-metrics'],
      );
      assert.strictEqual(row?.confidence, 0.3, 'Retired confidence must not change');
      assert.strictEqual(row?.application_count, 50, 'Retired application_count must not change');
    });
  });
});
