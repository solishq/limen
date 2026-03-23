/**
 * Limen — TechniqueApplicator Implementation
 * Phase 4E-2c: Learning System Application Mechanics
 *
 * Implements the TechniqueApplicator interface from learning_types.ts.
 * Retrieves active techniques at inference time and records applications.
 *
 * S ref: S29.4 (application mechanics), S29.2 (applicationCount, lastApplied),
 *        S29.6 (retirement depends on applicationCount/lastApplied),
 *        I-03 (audit), I-07 (agent isolation)
 *
 * Engineering decisions:
 *   DEC-4E2C-001: Token estimation via chars/4 (no tokenizer, I-01)
 *   DEC-4E2C-002: Greedy fill with skip (not stop-at-overflow)
 *   DEC-4E2C-003: Ordering tiebreaker: created_at ASC, id ASC
 *   DEC-4E2C-004: No FK validation on recordApplications (R-07)
 *   DEC-4E2C-005: recordApplications synchronous, single transaction
 */

import { randomUUID } from 'node:crypto';
import type {
  TechniqueApplicator, TechniqueStore, Technique,
  TechniqueApplication, TechniqueId, TechniqueType, LearningDeps,
} from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result, TenantId, AgentId,
} from '../../kernel/interfaces/index.js';

// ─── Row-to-Domain Mapping ───
// Local copy — cannot modify TechniqueStore (HARD STOP #5).
// Identical to technique_store.ts rowToTechnique.

interface TechniqueRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  type: string;
  content: string;
  source_memory_ids: string;
  confidence: number;
  success_rate: number;
  application_count: number;
  last_applied: string | null;
  last_updated: string;
  status: string;
  created_at: string;
}

function rowToTechnique(row: TechniqueRow): Technique {
  return {
    id: row.id as TechniqueId,
    tenantId: row.tenant_id as TenantId,
    agentId: row.agent_id as AgentId,
    type: row.type as TechniqueType,
    content: row.content,
    sourceMemoryIds: JSON.parse(row.source_memory_ids) as readonly string[],
    confidence: row.confidence,
    successRate: row.success_rate,
    applicationCount: row.application_count,
    lastApplied: row.last_applied,
    lastUpdated: row.last_updated,
    status: row.status as Technique['status'],
    createdAt: row.created_at,
  };
}

// ─── Token Estimation ───

/**
 * Estimate token count from content length.
 *
 * DEC-4E2C-001: Uses chars/4 approximation because:
 *   (1) Contract tests use Math.ceil(content.length / 4)
 *   (2) No tokenizer dependency permitted (I-01: single production dependency)
 *   (3) Caller controls maxTokenBudget — overestimation is safe (conservative)
 *
 * Risk-if-wrong: Non-ASCII content (CJK, emoji) has higher tokens/char ratio,
 * causing underestimation. Mitigated by conservative maxTokenBudget from caller
 * and by the 20% ceiling being a safety margin, not a precision target.
 */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
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
 * Create a TechniqueApplicator implementation.
 * Follows the Limen factory pattern: factory → Object.freeze.
 *
 * @param deps - Learning system dependencies (audit, events, etc.)
 * @param store - TechniqueStore for R-06 applicationCount/lastApplied updates
 */
export function createTechniqueApplicator(
  deps: LearningDeps,
  store: TechniqueStore,
): TechniqueApplicator {

  // ─── getActiveByType (shared query logic) ───

  /**
   * Query active techniques of a specific type for an agent.
   * Results ordered by confidence DESC, created_at ASC, id ASC.
   *
   * DEC-4E2C-003: Tiebreaker rationale:
   *   - confidence DESC: spec requirement (S29.4)
   *   - created_at ASC: older techniques survived more evaluation cycles
   *   - id ASC: absolute determinism for identical confidence + timestamp
   */
  function getActiveByType(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
    type: TechniqueType,
  ): Technique[] {
    const rows = conn.query<TechniqueRow>(
      `SELECT * FROM learning_techniques
       WHERE agent_id = ? AND tenant_id = ? AND status = 'active' AND type = ?
       ORDER BY confidence DESC, created_at ASC, id ASC`,
      [agentId, tenantId, type],
    );
    return rows.map(rowToTechnique);
  }

  // ─── getActivePromptFragments ───

  /**
   * Retrieve active prompt fragments within token budget.
   *
   * DEC-4E2C-002: Greedy fill in confidence order.
   * Processes techniques in confidence-descending order. Includes each technique
   * if its estimated tokens fit within remaining budget. Skips techniques that
   * don't fit and continues to try the next (a smaller one may still fit).
   *
   * The returned list preserves confidence-descending order because we iterate
   * in that order and only append (never reorder).
   *
   * Alternatives rejected:
   *   - Stop-at-overflow: stops at first technique that doesn't fit. Disadvantage:
   *     a single oversized technique blocks all subsequent smaller techniques.
   *   - Partial inclusion: truncate individual technique content. Violates technique
   *     content integrity — a partial prompt fragment is semantically broken.
   */
  function getActivePromptFragments(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
    maxTokenBudget: number,
  ): Result<readonly Technique[]> {
    const techniques = getActiveByType(conn, agentId, tenantId, 'prompt_fragment');

    const result: Technique[] = [];
    let usedTokens = 0;

    for (const technique of techniques) {
      const tokens = estimateTokens(technique.content);
      if (usedTokens + tokens <= maxTokenBudget) {
        result.push(technique);
        usedTokens += tokens;
      }
    }

    return { ok: true, value: result };
  }

  // ─── getActiveDecisionRules ───

  function getActiveDecisionRules(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
  ): Result<readonly Technique[]> {
    return { ok: true, value: getActiveByType(conn, agentId, tenantId, 'decision_rule') };
  }

  // ─── getActiveRagPatterns ───

  function getActiveRagPatterns(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
  ): Result<readonly Technique[]> {
    return { ok: true, value: getActiveByType(conn, agentId, tenantId, 'rag_pattern') };
  }

  // ─── recordApplications ───

  /**
   * Record technique applications and update technique statistics.
   *
   * Two side effects (R-06, BINDING from Principal Architect):
   * 1. Increment applicationCount on techniques where applied=true
   * 2. Update lastApplied timestamp on techniques where applied=true
   *
   * These updates enable retirement evaluation (S29.6):
   *   - "over 50+ applications" uses applicationCount
   *   - "not applied in 90 days" uses lastApplied
   *
   * DEC-4E2C-004: No FK validation. Application records written for phantom
   * technique IDs (R-07). store.get() gracefully returns TECHNIQUE_NOT_FOUND
   * for non-existent techniques; the update is skipped but the log record persists.
   *
   * DEC-4E2C-005: Synchronous, single transaction. All INSERTs and technique
   * updates are atomic. If any fails, the entire batch rolls back. This is
   * acceptable because: (a) SQLite single-writer makes contention impossible,
   * (b) the batch is typically small (techniques applied to one interaction),
   * (c) atomicity prevents partial state (some records written, some not).
   */
  function recordApplications(
    conn: DatabaseConnection,
    ctx: OperationContext,
    applications: readonly TechniqueApplication[],
  ): Result<void> {
    if (applications.length === 0) {
      return { ok: true, value: undefined };
    }

    const firstApp = applications[0]!;
    const batchTenantId = ctx.tenantId ?? firstApp.tenantId;

    conn.transaction(() => {
      for (const app of applications) {
        // Write application record (append-only log)
        conn.run(
          `INSERT INTO learning_applications (id, technique_id, interaction_id, tenant_id, timestamp, applied)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            app.techniqueId,
            app.interactionId,
            app.tenantId,
            app.timestamp,
            app.applied ? 1 : 0,
          ],
        );

        // R-06: Update technique statistics for applied techniques
        if (app.applied && ctx.agentId) {
          const getResult = store.get(
            conn,
            app.techniqueId,
            app.tenantId,
            ctx.agentId,
          );

          if (getResult.ok) {
            store.update(conn, ctx, app.techniqueId, app.tenantId, {
              applicationCount: getResult.value.applicationCount + 1,
              lastApplied: app.timestamp,
            });
          }
          // Phantom IDs: store.get returns TECHNIQUE_NOT_FOUND — skip silently (R-07)
        }
      }

      // Audit entry for the batch (I-03)
      deps.audit.append(conn, {
        tenantId: batchTenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'technique.record_applications',
        resourceType: 'technique_application',
        resourceId: `batch-${applications.length}`,
      });
    });

    return { ok: true, value: undefined };
  }

  // ─── Return frozen applicator ───

  return Object.freeze({
    getActivePromptFragments,
    getActiveDecisionRules,
    getActiveRagPatterns,
    recordApplications,
  });
}
