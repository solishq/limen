/**
 * Limen — EffectivenessTracker Implementation
 * Phase 4E-2d: Learning System Effectiveness Tracking
 *
 * Implements the EffectivenessTracker interface from learning_types.ts.
 * Tracks technique outcomes, computes success rates, and updates
 * confidence via EMA formula.
 *
 * S ref: S29.5 (EMA confidence, rolling window success rate),
 *        I-03 (audit trail), I-07 (agent isolation)
 *
 * CRITICAL DATA OWNERSHIP (R-04):
 *   updateConfidence OWNS persistence of both confidence and successRate.
 *   It computes these from outcomes and writes them to the technique
 *   via store.update(). Without this write, retirement reads stale zeros.
 */

import { randomUUID } from 'node:crypto';
import type {
  EffectivenessTracker, TechniqueStore, TechniqueId,
  OutcomeClassification, LearningDeps,
} from '../interfaces/index.js';
import {
  EMA_WEIGHT_OLD, EMA_WEIGHT_RECENT, SUCCESS_RATE_WINDOW,
} from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result, TenantId,
} from '../../kernel/interfaces/index.js';

// ─── Row Types ───

interface TechniqueRow {
  id: string;
  tenant_id: string;
  confidence: number;
}

interface OutcomeRow {
  outcome: string;
}

interface CountRow {
  cnt: number;
}

// ─── Audit Helpers ───

function actorType(ctx: OperationContext): 'user' | 'agent' | 'system' {
  if (ctx.userId) return 'user';
  if (ctx.agentId) return 'agent';
  return 'system';
}

function actorId(ctx: OperationContext): string {
  return (ctx.userId ?? ctx.agentId ?? 'system') as string;
}

// ─── Factory ───

/**
 * Create an EffectivenessTracker implementation.
 * Follows the Limen store pattern: factory -> Object.freeze.
 *
 * @param deps - Learning system dependencies (getConnection, audit, etc.)
 * @param store - TechniqueStore reference for persisting computed metrics
 */
export function createEffectivenessTracker(
  deps: LearningDeps,
  store: TechniqueStore,
): EffectivenessTracker {

  // ─── recordOutcome ───

  function recordOutcome(
    conn: DatabaseConnection,
    ctx: OperationContext,
    techniqueId: TechniqueId,
    tenantId: TenantId,
    outcome: OutcomeClassification,
  ): Result<void> {
    // Verify technique exists for this tenant (tenant isolation)
    const technique = conn.get<TechniqueRow>(
      `SELECT id FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [techniqueId, tenantId],
    );

    if (!technique) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${techniqueId} not found for tenant ${tenantId}`,
          spec: 'S29.5',
        },
      };
    }

    const id = randomUUID();
    const now = deps.time.nowISO();

    conn.transaction(() => {
      conn.run(
        `INSERT INTO learning_outcomes (id, technique_id, tenant_id, outcome, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, techniqueId, tenantId, outcome, now],
      );

      deps.audit.append(conn, {
        tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: `tracker.recordOutcome:${outcome}`,
        resourceType: 'technique',
        resourceId: techniqueId,
      });
    });

    return { ok: true, value: undefined };
  }

  // ─── getSuccessRate ───

  function getSuccessRate(
    conn: DatabaseConnection,
    techniqueId: TechniqueId,
    tenantId: TenantId,
  ): Result<number> {
    // Verify technique exists for this tenant (tenant isolation — BRK-S29-019)
    const technique = conn.get<TechniqueRow>(
      `SELECT id FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [techniqueId, tenantId],
    );

    if (!technique) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${techniqueId} not found for tenant ${tenantId}`,
          spec: 'S29.5',
        },
      };
    }

    // Rolling window: last SUCCESS_RATE_WINDOW (50) outcomes of any type,
    // then compute ratio excluding neutral (S29.5).
    // ORDER BY created_at DESC, rowid DESC: rowid is tiebreaker for
    // outcomes inserted within the same timestamp (deterministic ordering).
    const outcomes = conn.query<OutcomeRow>(
      `SELECT outcome FROM learning_outcomes
       WHERE technique_id = ? AND tenant_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`,
      [techniqueId, tenantId, SUCCESS_RATE_WINDOW],
    );

    let positive = 0;
    let negative = 0;

    for (const row of outcomes) {
      if (row.outcome === 'positive') positive++;
      else if (row.outcome === 'negative') negative++;
      // neutral: excluded from ratio (S29.5)
    }

    const denominator = positive + negative;

    // Zero non-neutral outcomes: success rate is 0.0 (no evidence of success).
    // This is a defined boundary: no data = 0.0, not undefined/NaN.
    if (denominator === 0) {
      return { ok: true, value: 0.0 };
    }

    return { ok: true, value: positive / denominator };
  }

  // ─── updateConfidence ───

  function updateConfidence(
    conn: DatabaseConnection,
    ctx: OperationContext,
    techniqueId: TechniqueId,
    tenantId: TenantId,
  ): Result<number> {
    // Read current technique confidence
    const technique = conn.get<TechniqueRow>(
      `SELECT id, tenant_id, confidence FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [techniqueId, tenantId],
    );

    if (!technique) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${techniqueId} not found for tenant ${tenantId}`,
          spec: 'S29.5',
        },
      };
    }

    // Check if any non-neutral outcomes exist.
    // If zero outcomes, EMA has no input — skip update, return current confidence.
    // Rationale: 0.8*old + 0.2*undefined = undefined. No evidence = no change.
    const nonNeutralCount = conn.get<CountRow>(
      `SELECT COUNT(*) as cnt FROM learning_outcomes
       WHERE technique_id = ? AND tenant_id = ? AND outcome != 'neutral'`,
      [techniqueId, tenantId],
    );

    if (!nonNeutralCount || nonNeutralCount.cnt === 0) {
      return { ok: true, value: technique.confidence };
    }

    // Compute recent success rate via getSuccessRate (rolling window)
    const srResult = getSuccessRate(conn, techniqueId, tenantId);
    if (!srResult.ok) return srResult;

    const recentSuccessRate = srResult.value;
    const oldConfidence = technique.confidence;

    // EMA formula (S29.5): new = 0.8 * old + 0.2 * recent
    const newConfidence = EMA_WEIGHT_OLD * oldConfidence + EMA_WEIGHT_RECENT * recentSuccessRate;

    // R-04: PERSIST both confidence and successRate to the technique.
    // This is the critical integration seam. Without this write:
    //   - confidence stays at initial 0.5 forever
    //   - successRate stays at 0.0 forever
    //   - retirement reads stale zeros and makes wrong decisions
    const updateResult = store.update(conn, ctx, techniqueId, tenantId, {
      confidence: newConfidence,
      successRate: recentSuccessRate,
    });

    if (!updateResult.ok) return updateResult as Result<number>;

    return { ok: true, value: newConfidence };
  }

  // ─── Return frozen tracker ───

  return Object.freeze({
    recordOutcome,
    updateConfidence,
    getSuccessRate,
  });
}
