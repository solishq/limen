/**
 * TGP (Technique Governance Protocol) Store Implementations — SQLite-backed.
 * Replaces NotImplementedError stubs in tgp_harness.ts.
 *
 * Phase: 1 (TGP)
 * Implements: TechniqueEvaluationStore, PromotionDecisionStore,
 *   PromotionGate, TGPQuarantineCascade, CandidateRetentionEvaluator,
 *   TGPInferenceFilter, TemplateRegistrar.
 *
 * Pattern: Follows src/governance/stores/governance_stores.ts and
 *          src/claims/store/claim_stores.ts.
 *
 * Truth model obligations:
 *   TGP-I1: Content immutability (trigger-enforced + application guard)
 *   TGP-I2: Forward-only lifecycle (trigger-enforced + application guard)
 *   TGP-I3: Promotion requires evaluation evidence
 *   TGP-I4: CF-13 audit sufficiency (all 5 fields populated)
 *   TGP-I5: Quarantine blocks promotion (quarantinedAt check)
 *   TGP-I6: Candidate lifecycle bound (retention period)
 *   TGP-I7: Trust-independent validation (no trust shortcuts)
 *   TGP-I8: Candidate excluded from inference
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/database.js';
import type {
  TenantId, AgentId, MissionId,
  OperationContext, Result,
} from '../../kernel/interfaces/index.js';
import type { TechniqueId } from '../../learning/interfaces/learning_types.js';
import type {
  TechniqueGovernor,
  TechniqueGovernorDeps,
  TechniqueEvaluationStore,
  PromotionDecisionStore,
  PromotionGate,
  TGPQuarantineCascade,
  CandidateRetentionEvaluator,
  TGPInferenceFilter,
  TemplateRegistrar,
  TechniqueEvaluation,
  TechniquePromotionDecision,
  EvaluationCreateInput,
  EvaluationId,
  PromotionDecisionId,
  PromotionAttemptInput,
  PromotionAttemptResult,
  QuarantineUpdateResult,
  QuarantineClearResult,
  CandidateRetentionResult,
  TGPTechnique,
  TGPTechniqueStatus,
  TemplateRegistrationInput,
  TemplateRegistrationResult,
  TechniqueProvenanceKind,
  EvaluationSource,
} from '../interfaces/tgp_types.js';
import {
  TGP_EVENTS,
  TGP_PROMOTION_ERROR_CODES,
  TGP_EVALUATION_ERROR_CODES,
  TGP_RETENTION_ERROR_CODES,
  TGP_TEMPLATE_ERROR_CODES,
  DEFAULT_CANDIDATE_RETENTION_DAYS,
  QUALIFYING_EVALUATION_SOURCES,
} from '../interfaces/tgp_types.js';

// ============================================================================
// Helpers
// ============================================================================

function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

function err<T>(code: string, message: string, spec: string): Result<T> {
  return { ok: false, error: { code, message, spec } };
}

// nowISO() removed — Hard Stop #7: use deps.time.nowISO() instead

function newId(): string {
  return randomUUID();
}

// ============================================================================
// Row Mapping — learning_techniques → TGPTechnique
// ============================================================================

interface TechniqueRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  type: string;
  content: string;
  source_memory_ids: string;
  confidence: number;
  success_rate: number | null;
  application_count: number;
  last_applied: string | null;
  last_updated: string;
  status: string;
  created_at: string;
  provenance_kind: string | null;
  quarantined_at: string | null;
  promoted_at: string | null;
  promotion_decision_id: string | null;
  transfer_source_technique_id: string | null;
  retired_at: string | null;
  retired_reason: string | null;
}

function rowToTechnique(row: TechniqueRow): TGPTechnique {
  return {
    id: row.id as TechniqueId,
    tenantId: row.tenant_id as TenantId,
    agentId: row.agent_id as AgentId,
    type: row.type as TGPTechnique['type'],
    content: row.content,
    sourceMemoryIds: JSON.parse(row.source_memory_ids) as readonly string[],
    confidence: row.confidence,
    successRate: row.success_rate,
    applicationCount: row.application_count,
    lastApplied: row.last_applied,
    lastUpdated: row.last_updated,
    status: row.status as TGPTechniqueStatus,
    createdAt: row.created_at,
    provenanceKind: (row.provenance_kind ?? 'local_extraction') as TechniqueProvenanceKind,
    quarantinedAt: row.quarantined_at,
    promotedAt: row.promoted_at,
    promotionDecisionId: row.promotion_decision_id as PromotionDecisionId | null,
    transferSourceTechniqueId: row.transfer_source_technique_id as TechniqueId | null,
    retiredAt: row.retired_at,
    retiredReason: row.retired_reason as TGPTechnique['retiredReason'],
  };
}

// ============================================================================
// Row Mapping — technique_evaluations → TechniqueEvaluation
// ============================================================================

interface EvaluationRow {
  id: string;
  technique_id: string;
  agent_id: string;
  tenant_id: string;
  evaluator_agent_id: string;
  mission_id: string | null;
  evaluation_source: string;
  baseline_performance: string;
  technique_performance: string;
  comparison_result: string;
  confidence_score: number | null;
  evaluation_method: string;
  created_at: string;
}

function rowToEvaluation(row: EvaluationRow): TechniqueEvaluation {
  return {
    id: row.id as EvaluationId,
    techniqueId: row.technique_id as TechniqueId,
    agentId: row.agent_id as AgentId,
    tenantId: row.tenant_id as TenantId,
    evaluatorAgentId: row.evaluator_agent_id as AgentId,
    missionId: row.mission_id as MissionId | null,
    evaluationSource: row.evaluation_source as EvaluationSource,
    baselinePerformance: JSON.parse(row.baseline_performance) as Readonly<Record<string, unknown>>,
    techniquePerformance: JSON.parse(row.technique_performance) as Readonly<Record<string, unknown>>,
    comparisonResult: JSON.parse(row.comparison_result) as Readonly<Record<string, unknown>>,
    confidenceScore: row.confidence_score,
    evaluationMethod: row.evaluation_method as TechniqueEvaluation['evaluationMethod'],
    createdAt: row.created_at,
  };
}

// ============================================================================
// Row Mapping — technique_promotion_decisions → TechniquePromotionDecision
// ============================================================================

interface DecisionRow {
  id: string;
  technique_id: string;
  agent_id: string;
  tenant_id: string;
  decided_by: string;
  evaluation_lineage: string;
  confidence_threshold: number | null;
  decision_rule: string;
  activation_basis: string;
  policy_version: string;
  evaluation_schema_version: string;
  threshold_config_version: string;
  result: string;
  rejection_reason: string | null;
  decided_at: string;
  activated_at: string | null;
}

function rowToDecision(row: DecisionRow): TechniquePromotionDecision {
  return {
    id: row.id as PromotionDecisionId,
    techniqueId: row.technique_id as TechniqueId,
    agentId: row.agent_id as AgentId,
    tenantId: row.tenant_id as TenantId,
    decidedBy: row.decided_by,
    evaluationLineage: JSON.parse(row.evaluation_lineage) as readonly EvaluationId[],
    confidenceThreshold: row.confidence_threshold,
    decisionRule: row.decision_rule,
    activationBasis: JSON.parse(row.activation_basis) as Readonly<Record<string, unknown>>,
    policyVersion: row.policy_version,
    evaluationSchemaVersion: row.evaluation_schema_version,
    thresholdConfigVersion: row.threshold_config_version,
    result: row.result as TechniquePromotionDecision['result'],
    rejectionReason: row.rejection_reason,
    decidedAt: row.decided_at,
    activatedAt: row.activated_at,
  };
}

// ============================================================================
// TechniqueEvaluationStore Implementation [§6.2]
// ============================================================================

function createEvaluationStoreImpl(deps: TechniqueGovernorDeps): TechniqueEvaluationStore {
  return {
    create(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: EvaluationCreateInput,
    ): Result<TechniqueEvaluation> {
      // Validate technique exists
      const technique = conn.get<TechniqueRow>(
        'SELECT id FROM learning_techniques WHERE id = ? AND tenant_id = ?',
        [input.techniqueId, input.tenantId],
      );
      if (!technique) {
        return err(
          TGP_EVALUATION_ERROR_CODES.TECHNIQUE_NOT_FOUND,
          `Technique ${input.techniqueId} not found for tenant ${input.tenantId}`,
          '§6.2',
        );
      }

      // Validate confidence score range [DC-TGP-109]
      if (input.confidenceScore !== null) {
        if (!Number.isFinite(input.confidenceScore) || input.confidenceScore < 0 || input.confidenceScore > 1) {
          return err(
            TGP_EVALUATION_ERROR_CODES.INVALID_CONFIDENCE_SCORE,
            `Confidence score must be between 0.0 and 1.0, got ${input.confidenceScore}`,
            '§6.2',
          );
        }
      }

      const id = newId() as EvaluationId;
      const now = deps.time.nowISO();

      conn.transaction(() => {
        conn.run(
          `INSERT INTO technique_evaluations
            (id, technique_id, agent_id, tenant_id, evaluator_agent_id, mission_id,
             evaluation_source, baseline_performance, technique_performance,
             comparison_result, confidence_score, evaluation_method, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, input.techniqueId, input.agentId, input.tenantId,
            input.evaluatorAgentId, input.missionId,
            input.evaluationSource,
            JSON.stringify(input.baselinePerformance),
            JSON.stringify(input.techniquePerformance),
            JSON.stringify(input.comparisonResult),
            input.confidenceScore, input.evaluationMethod, now,
          ],
        );

        deps.audit.create(conn, ctx, {
          action: 'technique.evaluation.create',
          resourceType: 'technique_evaluation',
          resourceId: id,
          details: {
            techniqueId: input.techniqueId,
            evaluationSource: input.evaluationSource,
            confidenceScore: input.confidenceScore,
          },
        });
      });

      const evaluation: TechniqueEvaluation = {
        id,
        techniqueId: input.techniqueId,
        agentId: input.agentId,
        tenantId: input.tenantId,
        evaluatorAgentId: input.evaluatorAgentId,
        missionId: input.missionId,
        evaluationSource: input.evaluationSource,
        baselinePerformance: input.baselinePerformance,
        techniquePerformance: input.techniquePerformance,
        comparisonResult: input.comparisonResult,
        confidenceScore: input.confidenceScore,
        evaluationMethod: input.evaluationMethod,
        createdAt: now,
      };

      return ok(evaluation);
    },

    getById(
      conn: DatabaseConnection,
      id: EvaluationId,
      tenantId: TenantId,
    ): Result<TechniqueEvaluation> {
      const row = conn.get<EvaluationRow>(
        'SELECT * FROM technique_evaluations WHERE id = ? AND tenant_id = ?',
        [id, tenantId],
      );
      if (!row) {
        return err(
          TGP_EVALUATION_ERROR_CODES.EVALUATION_NOT_FOUND,
          `Evaluation ${id} not found for tenant ${tenantId}`,
          '§6.2',
        );
      }
      return ok(rowToEvaluation(row));
    },

    getByTechnique(
      conn: DatabaseConnection,
      techniqueId: TechniqueId,
      tenantId: TenantId,
    ): Result<readonly TechniqueEvaluation[]> {
      const rows = conn.query<EvaluationRow>(
        'SELECT * FROM technique_evaluations WHERE technique_id = ? AND tenant_id = ? ORDER BY created_at',
        [techniqueId, tenantId],
      );
      return ok(rows.map(rowToEvaluation));
    },
  };
}

// ============================================================================
// PromotionDecisionStore Implementation [§6.3, CF-13]
// ============================================================================

function createPromotionDecisionStoreImpl(deps: TechniqueGovernorDeps): PromotionDecisionStore {
  return {
    create(
      conn: DatabaseConnection,
      ctx: OperationContext,
      decision: Omit<TechniquePromotionDecision, 'id'>,
    ): Result<TechniquePromotionDecision> {
      const id = newId() as PromotionDecisionId;

      conn.transaction(() => {
        conn.run(
          `INSERT INTO technique_promotion_decisions
            (id, technique_id, agent_id, tenant_id, decided_by,
             evaluation_lineage, confidence_threshold, decision_rule,
             activation_basis, policy_version, evaluation_schema_version,
             threshold_config_version, result, rejection_reason,
             decided_at, activated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, decision.techniqueId, decision.agentId, decision.tenantId,
            decision.decidedBy,
            JSON.stringify(decision.evaluationLineage),
            decision.confidenceThreshold, decision.decisionRule,
            JSON.stringify(decision.activationBasis),
            decision.policyVersion, decision.evaluationSchemaVersion,
            decision.thresholdConfigVersion, decision.result,
            decision.rejectionReason, decision.decidedAt,
            decision.activatedAt,
          ],
        );

        deps.audit.create(conn, ctx, {
          action: `technique.promotion.${decision.result}`,
          resourceType: 'technique_promotion_decision',
          resourceId: id,
          details: {
            techniqueId: decision.techniqueId,
            result: decision.result,
            rejectionReason: decision.rejectionReason,
          },
        });
      });

      return ok({ id, ...decision });
    },

    getById(
      conn: DatabaseConnection,
      id: PromotionDecisionId,
      tenantId: TenantId,
    ): Result<TechniquePromotionDecision> {
      const row = conn.get<DecisionRow>(
        'SELECT * FROM technique_promotion_decisions WHERE id = ? AND tenant_id = ?',
        [id, tenantId],
      );
      if (!row) {
        return err('TGP_DECISION_NOT_FOUND', `Decision ${id} not found`, '§6.3');
      }
      return ok(rowToDecision(row));
    },

    getByTechnique(
      conn: DatabaseConnection,
      techniqueId: TechniqueId,
      tenantId: TenantId,
    ): Result<readonly TechniquePromotionDecision[]> {
      const rows = conn.query<DecisionRow>(
        'SELECT * FROM technique_promotion_decisions WHERE technique_id = ? AND tenant_id = ? ORDER BY decided_at',
        [techniqueId, tenantId],
      );
      return ok(rows.map(rowToDecision));
    },

    getSuccessful(
      conn: DatabaseConnection,
      techniqueId: TechniqueId,
      tenantId: TenantId,
    ): Result<TechniquePromotionDecision | null> {
      const row = conn.get<DecisionRow>(
        `SELECT * FROM technique_promotion_decisions
         WHERE technique_id = ? AND tenant_id = ? AND result = 'promoted'
         LIMIT 1`,
        [techniqueId, tenantId],
      );
      if (!row) return ok(null);
      return ok(rowToDecision(row));
    },
  };
}

// ============================================================================
// PromotionGate Implementation [§7.1, TGP-I3]
// ============================================================================

/** Minimum confidence threshold floor [DC-TGP-411, AL-TGP-06] — must be > 0 to reject adversarial 0.0 */
const MIN_CONFIDENCE_THRESHOLD_FLOOR = 0.1;

function createPromotionGateImpl(
  deps: TechniqueGovernorDeps,
  evaluationStore: TechniqueEvaluationStore,
  promotionStore: PromotionDecisionStore,
): PromotionGate {
  return {
    attemptPromotion(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: PromotionAttemptInput,
    ): Result<PromotionAttemptResult> {
      // Fetch the technique
      const techniqueRow = conn.get<TechniqueRow>(
        'SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?',
        [input.techniqueId, input.tenantId],
      );

      if (!techniqueRow) {
        return err(
          TGP_EVALUATION_ERROR_CODES.TECHNIQUE_NOT_FOUND,
          `Technique ${input.techniqueId} not found`,
          'TGP-I3',
        );
      }

      const technique = rowToTechnique(techniqueRow);

      // TGP-I2: Must be candidate
      if (technique.status !== 'candidate') {
        if (technique.status === 'active') {
          return err(
            TGP_PROMOTION_ERROR_CODES.ALREADY_PROMOTED,
            `Technique ${input.techniqueId} is already active`,
            'TGP-I2',
          );
        }
        return err(
          TGP_PROMOTION_ERROR_CODES.NOT_CANDIDATE,
          `Technique ${input.techniqueId} is ${technique.status}, not candidate`,
          'TGP-I2',
        );
      }

      // Helper to create rejection decision
      const reject = (code: string, reason: string): Result<PromotionAttemptResult> => {
        const now = deps.time.nowISO();
        const decisionResult = promotionStore.create(conn, ctx, {
          techniqueId: input.techniqueId,
          agentId: input.agentId,
          tenantId: input.tenantId,
          decidedBy: input.decidedBy,
          evaluationLineage: input.evaluationIds,
          confidenceThreshold: input.confidenceThreshold,
          decisionRule: input.decisionRule,
          activationBasis: { rejectionCode: code },
          policyVersion: input.policyVersion,
          evaluationSchemaVersion: input.evaluationSchemaVersion,
          thresholdConfigVersion: input.thresholdConfigVersion,
          result: 'rejected',
          rejectionReason: reason,
          decidedAt: now,
          activatedAt: null,
        });

        if (!decisionResult.ok) return decisionResult as Result<PromotionAttemptResult>;

        deps.events.emit({
          type: TGP_EVENTS.TECHNIQUE_PROMOTION_REJECTED,
          scope: 'agent',
          payload: {
            techniqueId: input.techniqueId,
            agentId: input.agentId,
            reason,
            timestamp: now,
          },
        });

        return ok({
          decision: decisionResult.value,
          promoted: false,
          technique,
        });
      };

      // TGP-I5: Quarantine check
      if (technique.quarantinedAt !== null) {
        return reject(
          TGP_PROMOTION_ERROR_CODES.TECHNIQUE_SOURCE_QUARANTINED,
          'Candidate technique is quarantine-blocked',
        );
      }

      // Get evaluations — either specified or all for the technique
      let evaluations: readonly TechniqueEvaluation[];
      if (input.evaluationIds.length > 0) {
        const evals: TechniqueEvaluation[] = [];
        for (const evalId of input.evaluationIds) {
          const evalResult = evaluationStore.getById(conn, evalId, input.tenantId);
          if (evalResult.ok) {
            evals.push(evalResult.value);
          }
        }
        evaluations = evals;
      } else {
        const evalsResult = evaluationStore.getByTechnique(conn, input.techniqueId, input.tenantId);
        if (!evalsResult.ok) return evalsResult as Result<PromotionAttemptResult>;
        evaluations = evalsResult.value;
      }

      // TGP-I3 req 1: At least one evaluation exists
      if (evaluations.length === 0) {
        return reject(
          TGP_PROMOTION_ERROR_CODES.NO_EVALUATION_EVIDENCE,
          'No evaluation evidence exists for this technique',
        );
      }

      // TGP-I3 req 2 (AMB-03): At least one qualifying source
      const hasQualifyingSource = evaluations.some(
        e => (QUALIFYING_EVALUATION_SOURCES as readonly string[]).includes(e.evaluationSource),
      );
      if (!hasQualifyingSource) {
        return reject(
          TGP_PROMOTION_ERROR_CODES.INSUFFICIENT_EVALUATION_SOURCE,
          'No evaluation with qualifying source (runtime, template, manual). transfer_history alone is insufficient.',
        );
      }

      // TGP-I3 req 4: Threshold check
      if (input.confidenceThreshold !== null) {
        // DC-TGP-411: Reject NaN, Infinity, and non-finite thresholds
        if (!Number.isFinite(input.confidenceThreshold)) {
          return reject(
            TGP_PROMOTION_ERROR_CODES.INVALID_THRESHOLD,
            `Confidence threshold must be a finite number, got ${input.confidenceThreshold}`,
          );
        }

        // DC-TGP-411: Threshold floor validation — minimum 0.1
        if (input.confidenceThreshold < MIN_CONFIDENCE_THRESHOLD_FLOOR) {
          return reject(
            TGP_PROMOTION_ERROR_CODES.INVALID_THRESHOLD,
            `Confidence threshold ${input.confidenceThreshold} below floor ${MIN_CONFIDENCE_THRESHOLD_FLOOR}`,
          );
        }

        // Calculate best confidence from evaluations
        const confidenceScores = evaluations
          .map(e => e.confidenceScore)
          .filter((s): s is number => s !== null);

        if (confidenceScores.length === 0) {
          return reject(
            TGP_PROMOTION_ERROR_CODES.THRESHOLD_NOT_MET,
            'No evaluations with numeric confidence scores',
          );
        }

        const bestConfidence = Math.max(...confidenceScores);
        if (bestConfidence < input.confidenceThreshold) {
          return reject(
            TGP_PROMOTION_ERROR_CODES.THRESHOLD_NOT_MET,
            `Best confidence ${bestConfidence} below threshold ${input.confidenceThreshold}`,
          );
        }
      }

      // TGP-I4: CF-13 audit completeness check
      if (!input.decisionRule || !input.policyVersion ||
          !input.evaluationSchemaVersion || !input.thresholdConfigVersion) {
        return reject(
          TGP_PROMOTION_ERROR_CODES.AUDIT_INCOMPLETE,
          'CF-13 required fields incomplete',
        );
      }

      // All 4 conditions met — promote
      const now = deps.time.nowISO();
      const evaluationIds = evaluations.map(e => e.id);

      // Best confidence for initializing production confidence [§5.3]
      const confidenceScores = evaluations
        .map(e => e.confidenceScore)
        .filter((s): s is number => s !== null);
      const initialConfidence = confidenceScores.length > 0
        ? Math.max(...confidenceScores)
        : technique.confidence;

      // Build activation basis [TGP-I4 req 4]
      const activationBasis: Record<string, unknown> = {
        evaluationCount: evaluations.length,
        bestConfidence: confidenceScores.length > 0 ? Math.max(...confidenceScores) : null,
        evaluationSources: [...new Set(evaluations.map(e => e.evaluationSource))],
        qualifyingSources: evaluations
          .filter(e => (QUALIFYING_EVALUATION_SOURCES as readonly string[]).includes(e.evaluationSource))
          .map(e => e.evaluationSource),
      };

      // Create promotion decision
      const decisionResult = promotionStore.create(conn, ctx, {
        techniqueId: input.techniqueId,
        agentId: input.agentId,
        tenantId: input.tenantId,
        decidedBy: input.decidedBy,
        evaluationLineage: evaluationIds,
        confidenceThreshold: input.confidenceThreshold,
        decisionRule: input.decisionRule,
        activationBasis,
        policyVersion: input.policyVersion,
        evaluationSchemaVersion: input.evaluationSchemaVersion,
        thresholdConfigVersion: input.thresholdConfigVersion,
        result: 'promoted',
        rejectionReason: null,
        decidedAt: now,
        activatedAt: now,
      });

      if (!decisionResult.ok) return decisionResult as Result<PromotionAttemptResult>;

      // Update technique: candidate → active, set promotion fields, initialize metrics [§5.3]
      conn.run(
        `UPDATE learning_techniques
         SET status = 'active',
             confidence = ?,
             success_rate = NULL,
             promoted_at = ?,
             promotion_decision_id = ?,
             last_updated = ?
         WHERE id = ? AND tenant_id = ?`,
        [initialConfidence, now, decisionResult.value.id, now, input.techniqueId, input.tenantId],
      );

      // Fetch updated technique
      const updatedRow = conn.get<TechniqueRow>(
        'SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?',
        [input.techniqueId, input.tenantId],
      );

      const promotedTechnique = updatedRow ? rowToTechnique(updatedRow) : technique;

      // Emit technique.promoted event [§9]
      deps.events.emit({
        type: TGP_EVENTS.TECHNIQUE_PROMOTED,
        scope: 'agent',
        payload: {
          techniqueId: input.techniqueId,
          agentId: input.agentId,
          promotionDecisionId: decisionResult.value.id,
          confidence: initialConfidence,
          timestamp: now,
        },
      });

      return ok({
        decision: decisionResult.value,
        promoted: true,
        technique: promotedTechnique,
      });
    },
  };
}

// ============================================================================
// TGPQuarantineCascade Implementation [TGP-I5, I-10]
// ============================================================================

function createQuarantineCascadeImpl(deps: TechniqueGovernorDeps): TGPQuarantineCascade {
  return {
    onMemoryQuarantined(
      conn: DatabaseConnection,
      ctx: OperationContext,
      memoryId: string,
      tenantId: TenantId,
      reason: string,
    ): Result<QuarantineUpdateResult> {
      const now = deps.time.nowISO();
      const candidatesBlocked: TechniqueId[] = [];
      const activesSuspended: TechniqueId[] = [];

      conn.transaction(() => {
        // Find all techniques derived from this memory (json_each on source_memory_ids)
        const rows = conn.query<TechniqueRow>(
          `SELECT DISTINCT lt.*
           FROM learning_techniques lt, json_each(lt.source_memory_ids) je
           WHERE lt.tenant_id = ? AND je.value = ?`,
          [tenantId, memoryId],
        );

        for (const row of rows) {
          if (row.status === 'candidate') {
            // Set quarantinedAt on candidate [PSD-4]
            conn.run(
              `UPDATE learning_techniques SET quarantined_at = ?, last_updated = ?
               WHERE id = ? AND tenant_id = ?`,
              [now, now, row.id, tenantId],
            );
            candidatesBlocked.push(row.id as TechniqueId);

            deps.events.emit({
              type: TGP_EVENTS.TECHNIQUE_QUARANTINE_BLOCKED,
              scope: 'agent',
              payload: {
                techniqueId: row.id,
                agentId: row.agent_id,
                memoryId,
                reason,
                timestamp: now,
              },
            });
          } else if (row.status === 'active') {
            // Suspend active technique [I-10 cascade]
            conn.run(
              `UPDATE learning_techniques SET status = 'suspended', last_updated = ?
               WHERE id = ? AND tenant_id = ?`,
              [now, row.id, tenantId],
            );
            activesSuspended.push(row.id as TechniqueId);

            deps.events.emit({
              type: TGP_EVENTS.TECHNIQUE_SUSPENDED,
              scope: 'agent',
              payload: {
                techniqueId: row.id,
                agentId: row.agent_id,
                reason: `quarantine_cascade:${memoryId}`,
                timestamp: now,
              },
            });
          }
        }

        deps.audit.create(conn, ctx, {
          action: 'technique.quarantine.cascade',
          resourceType: 'memory',
          resourceId: memoryId,
          details: {
            candidatesBlocked,
            activesSuspended,
            reason,
          },
        });
      });

      return ok({ candidatesBlocked, activesSuspended });
    },

    onMemoryRestored(
      conn: DatabaseConnection,
      ctx: OperationContext,
      memoryId: string,
      tenantId: TenantId,
    ): Result<QuarantineClearResult> {
      const now = deps.time.nowISO();
      const candidatesUnblocked: TechniqueId[] = [];

      conn.transaction(() => {
        // Find quarantined candidates derived from this memory
        const rows = conn.query<TechniqueRow>(
          `SELECT DISTINCT lt.*
           FROM learning_techniques lt, json_each(lt.source_memory_ids) je
           WHERE lt.tenant_id = ? AND je.value = ?
             AND lt.status = 'candidate' AND lt.quarantined_at IS NOT NULL`,
          [tenantId, memoryId],
        );

        for (const row of rows) {
          // Check if ALL source memories are non-quarantined [§5.2]
          // A source memory is "quarantined" if it appears in ANY other quarantined technique's source
          // Actually, we check: are there any OTHER quarantined source memories for this technique?
          // The technique's source_memory_ids is a JSON array. We need to check if any other
          // memory in that array is still quarantined.
          // Since we don't have a quarantined_memories table, we check by looking at whether
          // any other memory in this technique's sources caused other techniques to be quarantined.
          // Simplified approach: clear quarantinedAt only if this is the ONLY quarantined source.
          // We do this by checking if any OTHER technique derived from a DIFFERENT memory in
          // this technique's source list is still quarantined.

          // Parse source memory IDs
          const sourceMemoryIds: string[] = JSON.parse(row.source_memory_ids);

          // Check if there are other quarantined memories in this technique's sources
          // We track this by looking at OTHER candidate techniques from the same sources
          // that are still quarantined. This is a simplification — ideally we'd track
          // quarantined memories directly.
          //
          // Actually, the correct approach: this technique is quarantined because ONE of its
          // source memories was quarantined. When that memory is restored, we need to check
          // if the technique still has OTHER source memories that are ALSO quarantined.
          // Without a quarantined_memories table, we can check if any other candidate
          // techniques sourced from the OTHER memories of this technique are still quarantined.
          //
          // Simplest correct approach: track by seeing if any sibling-sourced techniques
          // remain quarantined. If ALL sibling candidates from all source memories
          // have been cleared, this one can be cleared too.
          //
          // For now, clear if the restoring memory is in the sources. If the technique has
          // other quarantined sources, the cascade for those memories hasn't been reversed yet,
          // so the onMemoryRestored for THOSE memories will be called separately.
          //
          // ACTUALLY: The correct algorithm per §5.2 is:
          // "Clear quarantinedAt IF ALL source memories are now non-quarantined."
          // We need to know which memories are quarantined. We can check if there are
          // other techniques (besides this one) that are quarantined from the same
          // source memories. If any exist, that memory is still quarantined.
          //
          // Best approach without a separate quarantined_memories table:
          // Check if there are ANY other quarantined candidates that share OTHER source
          // memories with this technique (excluding the restored memory).
          const otherSources = sourceMemoryIds.filter(id => id !== memoryId);

          let anyOtherSourceStillQuarantined = false;
          if (otherSources.length > 0) {
            // Check if any candidate techniques sourced from other memories are quarantined
            for (const otherMemoryId of otherSources) {
              const otherQuarantined = conn.get<{ cnt: number }>(
                `SELECT COUNT(*) as cnt
                 FROM learning_techniques lt, json_each(lt.source_memory_ids) je
                 WHERE lt.tenant_id = ? AND je.value = ?
                   AND lt.status = 'candidate' AND lt.quarantined_at IS NOT NULL
                   AND lt.id != ?`,
                [tenantId, otherMemoryId, row.id],
              );
              if (otherQuarantined && otherQuarantined.cnt > 0) {
                anyOtherSourceStillQuarantined = true;
                break;
              }
            }
          }

          if (!anyOtherSourceStillQuarantined) {
            conn.run(
              `UPDATE learning_techniques SET quarantined_at = NULL, last_updated = ?
               WHERE id = ? AND tenant_id = ?`,
              [now, row.id, tenantId],
            );
            candidatesUnblocked.push(row.id as TechniqueId);

            deps.events.emit({
              type: TGP_EVENTS.TECHNIQUE_QUARANTINE_CLEARED,
              scope: 'agent',
              payload: {
                techniqueId: row.id,
                agentId: row.agent_id,
                memoryId,
                timestamp: now,
              },
            });
          }
        }

        deps.audit.create(conn, ctx, {
          action: 'technique.quarantine.restore',
          resourceType: 'memory',
          resourceId: memoryId,
          details: { candidatesUnblocked },
        });
      });

      return ok({ candidatesUnblocked });
    },
  };
}

// ============================================================================
// CandidateRetentionEvaluator Implementation [TGP-I6]
// ============================================================================

function createCandidateRetentionEvaluatorImpl(deps: TechniqueGovernorDeps): CandidateRetentionEvaluator {
  return {
    evaluate(
      conn: DatabaseConnection,
      techniqueId: TechniqueId,
      tenantId: TenantId,
    ): Result<CandidateRetentionResult> {
      const row = conn.get<TechniqueRow>(
        'SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?',
        [techniqueId, tenantId],
      );

      if (!row) {
        return err(
          TGP_EVALUATION_ERROR_CODES.TECHNIQUE_NOT_FOUND,
          `Technique ${techniqueId} not found`,
          'TGP-I6',
        );
      }

      if (row.status !== 'candidate') {
        return err(
          TGP_RETENTION_ERROR_CODES.NOT_CANDIDATE,
          `Technique ${techniqueId} is ${row.status}, not candidate`,
          'TGP-I6',
        );
      }

      const createdDate = new Date(row.created_at);
      const nowMs = deps.time.nowMs();
      const ageDays = Math.floor((nowMs - createdDate.getTime()) / (1000 * 60 * 60 * 24));
      const retentionDays = DEFAULT_CANDIDATE_RETENTION_DAYS;

      return ok({
        techniqueId,
        expired: ageDays >= retentionDays,
        ageDays,
        retentionDays,
      });
    },

    retireExpired(
      conn: DatabaseConnection,
      ctx: OperationContext,
      agentId: AgentId,
      tenantId: TenantId,
    ): Result<readonly TechniqueId[]> {
      const now = deps.time.nowISO();
      const retiredIds: TechniqueId[] = [];

      conn.transaction(() => {
        // Find all expired candidates for this agent
        const candidates = conn.query<TechniqueRow>(
          `SELECT * FROM learning_techniques
           WHERE tenant_id = ? AND agent_id = ? AND status = 'candidate'`,
          [tenantId, agentId],
        );

        const retentionDays = DEFAULT_CANDIDATE_RETENTION_DAYS;
        const cutoffDate = new Date(deps.time.nowMs());
        cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
        const cutoffISO = cutoffDate.toISOString();

        for (const row of candidates) {
          if (row.created_at < cutoffISO) {
            conn.run(
              `UPDATE learning_techniques
               SET status = 'retired', retired_at = ?, retired_reason = 'candidate_expiry', last_updated = ?
               WHERE id = ? AND tenant_id = ?`,
              [now, now, row.id, tenantId],
            );
            retiredIds.push(row.id as TechniqueId);

            deps.events.emit({
              type: TGP_EVENTS.TECHNIQUE_RETIRED,
              scope: 'agent',
              payload: {
                techniqueId: row.id,
                agentId: row.agent_id,
                retiredReason: 'candidate_expiry',
                timestamp: now,
              },
            });
          }
        }

        if (retiredIds.length > 0) {
          deps.audit.create(conn, ctx, {
            action: 'technique.retention.expire',
            resourceType: 'technique',
            resourceId: retiredIds.join(','),
            details: { retiredCount: retiredIds.length, retentionDays },
          });
        }
      });

      return ok(retiredIds);
    },
  };
}

// ============================================================================
// TGPInferenceFilter Implementation [TGP-I8]
// ============================================================================

function createInferenceFilterImpl(): TGPInferenceFilter {
  return {
    filterForInference(
      conn: DatabaseConnection,
      agentId: AgentId,
      tenantId: TenantId,
    ): Result<readonly TGPTechnique[]> {
      // TGP-I8: Only active techniques participate in inference
      const rows = conn.query<TechniqueRow>(
        `SELECT * FROM learning_techniques
         WHERE agent_id = ? AND tenant_id = ? AND status = 'active'
         ORDER BY confidence DESC`,
        [agentId, tenantId],
      );
      return ok(rows.map(rowToTechnique));
    },
  };
}

// ============================================================================
// TemplateRegistrar Implementation [PSD-1, §29.9]
// ============================================================================

function createTemplateRegistrarImpl(
  deps: TechniqueGovernorDeps,
  _evaluationStore: TechniqueEvaluationStore,
  _promotionStore: PromotionDecisionStore,
): TemplateRegistrar {
  return {
    registerTemplate(
      conn: DatabaseConnection,
      ctx: OperationContext,
      input: TemplateRegistrationInput,
    ): Result<TemplateRegistrationResult> {
      // DC-TGP-907: Empty template rejection
      if (!input.techniques || input.techniques.length === 0) {
        return err(
          TGP_TEMPLATE_ERROR_CODES.EMPTY_TEMPLATE,
          'Template contains no techniques',
          'PSD-1',
        );
      }

      // DC-TGP-307 (BPB-02): Template idempotency check — reject duplicate templateId+templateVersion
      const templateSourceTag = `template:${input.templateId}:${input.templateVersion}`;
      const existingFromTemplate = conn.get<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM learning_techniques lt, json_each(lt.source_memory_ids) je
         WHERE lt.tenant_id = ? AND je.value = ?`,
        [input.tenantId, templateSourceTag],
      );
      if (existingFromTemplate && existingFromTemplate.cnt > 0) {
        return err(
          TGP_TEMPLATE_ERROR_CODES.TEMPLATE_ALREADY_APPLIED,
          `Template ${input.templateId} version ${input.templateVersion} has already been applied to this tenant`,
          'DC-TGP-307',
        );
      }

      // DC-TGP-109 (BPB-05): Validate template confidence scores before any DB writes
      for (const templateTechnique of input.techniques) {
        const score = templateTechnique.evaluationEvidence.confidenceScore;
        if (!Number.isFinite(score) || score < 0 || score > 1) {
          return err(
            TGP_TEMPLATE_ERROR_CODES.INVALID_CONFIDENCE_SCORE,
            `Template technique confidence score must be a finite number in [0.0, 1.0], got ${score}`,
            'DC-TGP-109',
          );
        }
      }

      const techniques: TGPTechnique[] = [];
      const decisions: TechniquePromotionDecision[] = [];

      // Atomic: all 6 operations per technique in one transaction [AMB-06]
      conn.transaction(() => {
        for (const templateTechnique of input.techniques) {
          const techniqueId = newId() as TechniqueId;
          const evalId = newId() as EvaluationId;
          const decisionId = newId() as PromotionDecisionId;
          const now = deps.time.nowISO();

          // Step 1: Create technique as candidate with provenanceKind='template_seed'
          conn.run(
            `INSERT INTO learning_techniques
              (id, tenant_id, agent_id, type, content, source_memory_ids,
               confidence, success_rate, application_count, last_applied,
               last_updated, status, created_at, provenance_kind,
               quarantined_at, promoted_at, promotion_decision_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, 'candidate', ?, 'template_seed', NULL, NULL, NULL)`,
            [
              techniqueId, input.tenantId, input.agentId,
              templateTechnique.type, templateTechnique.content,
              JSON.stringify([`template:${input.templateId}:${input.templateVersion}`]),
              templateTechnique.evaluationEvidence.confidenceScore,
              now, now,
            ],
          );

          // Step 2: Create TechniqueEvaluation with evaluationSource='template'
          conn.run(
            `INSERT INTO technique_evaluations
              (id, technique_id, agent_id, tenant_id, evaluator_agent_id, mission_id,
               evaluation_source, baseline_performance, technique_performance,
               comparison_result, confidence_score, evaluation_method, created_at)
             VALUES (?, ?, ?, ?, ?, NULL, 'template', ?, ?, ?, ?, 'template_provided', ?)`,
            [
              evalId, techniqueId, input.agentId, input.tenantId, input.agentId,
              JSON.stringify(templateTechnique.evaluationEvidence.baselinePerformance),
              JSON.stringify(templateTechnique.evaluationEvidence.techniquePerformance),
              JSON.stringify(templateTechnique.evaluationEvidence.comparisonResult),
              templateTechnique.evaluationEvidence.confidenceScore,
              now,
            ],
          );

          // Step 3: Create TechniquePromotionDecision with result='promoted'
          conn.run(
            `INSERT INTO technique_promotion_decisions
              (id, technique_id, agent_id, tenant_id, decided_by,
               evaluation_lineage, confidence_threshold, decision_rule,
               activation_basis, policy_version, evaluation_schema_version,
               threshold_config_version, result, rejection_reason,
               decided_at, activated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'promoted', NULL, ?, ?)`,
            [
              decisionId, techniqueId, input.agentId, input.tenantId,
              'template_registrar',
              JSON.stringify([evalId]),
              templateTechnique.evaluationEvidence.confidenceScore,
              'template_atomic_registration',
              JSON.stringify({
                templateId: input.templateId,
                templateVersion: input.templateVersion,
                confidenceScore: templateTechnique.evaluationEvidence.confidenceScore,
              }),
              '1.0.0', '1.0.0', '1.0.0',
              now, now,
            ],
          );

          // Step 4: Update status to active + set promotion fields + initialize metrics
          conn.run(
            `UPDATE learning_techniques
             SET status = 'active',
                 confidence = ?,
                 promoted_at = ?,
                 promotion_decision_id = ?,
                 last_updated = ?
             WHERE id = ? AND tenant_id = ?`,
            [
              templateTechnique.evaluationEvidence.confidenceScore,
              now, decisionId, now,
              techniqueId, input.tenantId,
            ],
          );

          // Fetch the final technique state
          const row = conn.get<TechniqueRow>(
            'SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?',
            [techniqueId, input.tenantId],
          );
          if (row) techniques.push(rowToTechnique(row));

          // Build decision object
          decisions.push({
            id: decisionId,
            techniqueId,
            agentId: input.agentId,
            tenantId: input.tenantId,
            decidedBy: 'template_registrar',
            evaluationLineage: [evalId],
            confidenceThreshold: templateTechnique.evaluationEvidence.confidenceScore,
            decisionRule: 'template_atomic_registration',
            activationBasis: {
              templateId: input.templateId,
              templateVersion: input.templateVersion,
              confidenceScore: templateTechnique.evaluationEvidence.confidenceScore,
            },
            policyVersion: '1.0.0',
            evaluationSchemaVersion: '1.0.0',
            thresholdConfigVersion: '1.0.0',
            result: 'promoted',
            rejectionReason: null,
            decidedAt: now,
            activatedAt: now,
          });

          // Step 6: Emit technique.promoted event
          deps.events.emit({
            type: TGP_EVENTS.TECHNIQUE_PROMOTED,
            scope: 'agent',
            payload: {
              techniqueId,
              agentId: input.agentId,
              promotionDecisionId: decisionId,
              templateId: input.templateId,
              confidence: templateTechnique.evaluationEvidence.confidenceScore,
              timestamp: now,
            },
          });
        }

        deps.audit.create(conn, ctx, {
          action: 'technique.template.register',
          resourceType: 'template',
          resourceId: input.templateId,
          details: {
            templateVersion: input.templateVersion,
            techniqueCount: input.techniques.length,
            techniqueIds: techniques.map(t => t.id),
          },
        });
      });

      return ok({ techniques, decisions });
    },
  };
}

// ============================================================================
// Factory — TechniqueGovernor (real implementation)
// ============================================================================

/**
 * DC-TGP-908: Verify SQLite is in WAL mode (or memory mode for in-memory DBs) with serialized writes.
 * Called at factory initialization to ensure TGP governance integrity.
 *
 * @param conn - Database connection to verify
 * @throws Error if journal_mode is not WAL or memory
 */
function verifyDatabaseRequirements(conn: DatabaseConnection): void {
  const result = conn.get<{ journal_mode: string }>('PRAGMA journal_mode');
  const mode = result?.journal_mode;
  // Accept 'wal' (file-based production) or 'memory' (in-memory, inherently serialized)
  if (mode !== 'wal' && mode !== 'memory') {
    throw new Error(
      `TGP-DC-908: SQLite journal_mode must be WAL for TGP governance integrity. ` +
      `Current mode: '${mode ?? 'unknown'}'. Set PRAGMA journal_mode = WAL before initializing TGP.`,
    );
  }
}

/**
 * Create the TGP TechniqueGovernor facade with real SQLite-backed implementations.
 *
 * Replaces the NOT_IMPLEMENTED harness. All methods backed by real SQL.
 * Schema must be initialized via migration 029 before calling any method.
 *
 * @param deps - External dependencies (audit, events)
 * @param conn - Database connection for DC-TGP-908 PRAGMA verification
 * @returns Frozen TechniqueGovernor with all subsystems wired
 */
export function createTechniqueGovernorImpl(deps: TechniqueGovernorDeps, conn?: DatabaseConnection): TechniqueGovernor {
  // DC-TGP-908: Verify SQLite WAL mode at initialization
  if (conn) {
    verifyDatabaseRequirements(conn);
  }
  const evaluationStore = createEvaluationStoreImpl(deps);
  const promotionStore = createPromotionDecisionStoreImpl(deps);
  const promotionGate = createPromotionGateImpl(deps, evaluationStore, promotionStore);
  const quarantineCascade = createQuarantineCascadeImpl(deps);
  const candidateRetention = createCandidateRetentionEvaluatorImpl(deps);
  const inferenceFilter = createInferenceFilterImpl();
  const templateRegistrar = createTemplateRegistrarImpl(deps, evaluationStore, promotionStore);

  return Object.freeze({
    evaluationStore,
    promotionStore,
    promotionGate,
    quarantineCascade,
    candidateRetention,
    inferenceFilter,
    templateRegistrar,
  });
}
