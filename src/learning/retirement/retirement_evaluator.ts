/**
 * Limen — RetirementEvaluator Implementation
 * Phase 4E-2d: Learning System Retirement Evaluation
 *
 * Implements the RetirementEvaluator interface from learning_types.ts.
 * Evaluates techniques against four retirement conditions per S29.6.
 * This is a QUERY-ONLY subsystem — it returns decisions, does not execute them.
 *
 * S ref: S29.6 (retirement thresholds), I-10 (retirement permanence),
 *        I-07 (agent isolation)
 *
 * DESIGN NOTE: evaluate() lacks agentId parameter. It reads techniques
 * directly from learning_techniques by id + tenant_id. The id is a UUID
 * (globally unique), and tenant_id provides isolation. This is architecturally
 * sound and avoids coupling to the store's agentId requirement.
 *
 * DESIGN NOTE: human_flagged (S29.6 condition 4) is not checked in evaluate().
 * The interface has no humanFlagged parameter. Human flagging is handled
 * externally via direct store.retire(reason: 'human_flagged') in HITL
 * batch-review mode. This evaluator checks exactly 3 metric-based conditions.
 *
 * CONDITION PRIORITY ORDER (first match wins):
 *   1. low_success_rate — data says technique fails (most severe data signal)
 *   2. low_confidence — EMA has degraded (secondary data signal)
 *   3. stale — technique unused for >90 days (time-based, least severe)
 */

import type {
  RetirementEvaluator, RetirementDecision, TechniqueId,
  LearningDeps,
} from '../interfaces/index.js';
import {
  RETIREMENT_THRESHOLD_SUCCESS_RATE,
  RETIREMENT_THRESHOLD_CONFIDENCE,
  RETIREMENT_MIN_APPLICATIONS_SUCCESS,
  RETIREMENT_MIN_APPLICATIONS_CONFIDENCE,
  RETIREMENT_STALENESS_DAYS,
} from '../interfaces/index.js';
import type {
  DatabaseConnection, Result, TenantId, AgentId,
} from '../../kernel/interfaces/index.js';

// ─── Row Type ───

interface TechniqueRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  confidence: number;
  success_rate: number;
  application_count: number;
  last_applied: string | null;
  last_updated: string;
  status: string;
  created_at: string;
}

// ─── Staleness Check ───

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute days since a reference timestamp.
 * If lastApplied is null, falls back to createdAt.
 * A never-applied technique created >90 days ago is stale.
 */
function daysSinceLastActivity(lastApplied: string | null, createdAt: string, nowMs: number): number {
  const referenceTime = lastApplied ?? createdAt;
  return (nowMs - new Date(referenceTime).getTime()) / MS_PER_DAY;
}

// ─── Factory ───

/**
 * Create a RetirementEvaluator implementation.
 * Follows the Limen store pattern: factory -> Object.freeze.
 *
 * @param _deps - Learning system dependencies (unused currently, reserved for future audit)
 */
export function createRetirementEvaluator(deps: LearningDeps): RetirementEvaluator {

  // ─── evaluate ───

  function evaluate(
    conn: DatabaseConnection,
    techniqueId: TechniqueId,
    tenantId: TenantId,
  ): Result<RetirementDecision> {
    // Read technique directly (no agentId available in this interface)
    const row = conn.get<TechniqueRow>(
      `SELECT id, tenant_id, agent_id, confidence, success_rate, application_count,
              last_applied, last_updated, status, created_at
       FROM learning_techniques
       WHERE id = ? AND tenant_id = ?`,
      [techniqueId, tenantId],
    );

    if (!row) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${techniqueId} not found for tenant ${tenantId}`,
          spec: 'S29.6',
        },
      };
    }

    // Already retired — no action (I-10: terminal state)
    if (row.status === 'retired') {
      return {
        ok: true,
        value: { techniqueId, shouldRetire: false, reason: null },
      };
    }

    // Condition 1: low_success_rate
    // S29.6: success_rate < 0.3 over 50+ applications
    if (
      row.application_count >= RETIREMENT_MIN_APPLICATIONS_SUCCESS &&
      row.success_rate < RETIREMENT_THRESHOLD_SUCCESS_RATE
    ) {
      return {
        ok: true,
        value: { techniqueId, shouldRetire: true, reason: 'low_success_rate' },
      };
    }

    // Condition 2: low_confidence
    // S29.6: confidence < 0.2 after 20+ applications
    if (
      row.application_count >= RETIREMENT_MIN_APPLICATIONS_CONFIDENCE &&
      row.confidence < RETIREMENT_THRESHOLD_CONFIDENCE
    ) {
      return {
        ok: true,
        value: { techniqueId, shouldRetire: true, reason: 'low_confidence' },
      };
    }

    // Condition 3: stale
    // S29.6: not applied in >90 days (strictly greater than, per gap test boundary)
    // Falls back to createdAt if never applied
    const days = daysSinceLastActivity(row.last_applied, row.created_at, deps.time.nowMs());
    if (days > RETIREMENT_STALENESS_DAYS) {
      return {
        ok: true,
        value: { techniqueId, shouldRetire: true, reason: 'stale' },
      };
    }

    // Healthy — no retirement recommended
    return {
      ok: true,
      value: { techniqueId, shouldRetire: false, reason: null },
    };
  }

  // ─── evaluateAll ───

  function evaluateAll(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
  ): Result<readonly RetirementDecision[]> {
    // Get all active techniques for this agent+tenant
    // BRK-IMPL-005: Only evaluate active techniques. Suspended techniques are
    // deferred to human judgment via quarantine resolution. Evaluating suspended
    // techniques could circumvent the quarantine safety mechanism.
    const rows = conn.query<TechniqueRow>(
      `SELECT id, tenant_id, agent_id, confidence, success_rate, application_count,
              last_applied, last_updated, status, created_at
       FROM learning_techniques
       WHERE agent_id = ? AND tenant_id = ? AND status = 'active'`,
      [agentId, tenantId],
    );

    const decisions: RetirementDecision[] = [];

    for (const row of rows) {
      const result = evaluate(conn, row.id as TechniqueId, tenantId);
      if (!result.ok) {
        return result as Result<readonly RetirementDecision[]>;
      }
      decisions.push(result.value);
    }

    return { ok: true, value: decisions };
  }

  // ─── Return frozen evaluator ───

  return Object.freeze({
    evaluate,
    evaluateAll,
  });
}
