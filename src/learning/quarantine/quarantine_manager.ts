/**
 * Limen — QuarantineManager Implementation
 * Phase 4E-2e: Learning System Convergence Subsystems
 *
 * Implements the QuarantineManager interface from learning_types.ts.
 * FM-01 defense: atomic suspension of suspected techniques.
 * Resolution requires human authority (HITL review).
 *
 * S ref: S29.7 (quarantine cascade), FM-01 (memory poisoning),
 *        I-03 (audit atomicity), I-07 (agent isolation)
 *
 * Engineering decisions:
 *   D1: Already-retired techniques in cascade are SKIPPED (FS-04: cannot suspend retired).
 *       A quarantine entry is NOT created for skipped retired techniques — they're
 *       already out of service. Creating an entry would pollute getPending.
 *   D2: Already-suspended techniques in cascade: quarantine entry IS created, but
 *       store.suspend() is NOT called (suspended→suspended is invalid transition).
 *       The entry tracks the quarantine reason even though the technique was already suspended.
 *   D3: resolve() checks technique's current status before acting. If technique was
 *       retired between quarantine and resolution (e.g., by RetirementEvaluator), the
 *       entry is still resolved but the reactivation fails gracefully.
 *   D4: Cross-agent quarantine: quarantine() is the only operation that crosses agent
 *       boundaries within a tenant. It queries by id+tenant_id (no agentId filter)
 *       because memory poisoning affects all agents referencing that memory.
 */

import { randomUUID } from 'node:crypto';
import type {
  QuarantineManager, QuarantineEntry, QuarantineResolution,
  TechniqueId, TechniqueStore, LearningDeps,
} from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result, TenantId,
} from '../../kernel/interfaces/index.js';
import { CONFIDENCE_RESET_REACTIVATION } from '../interfaces/index.js';

// ─── Row Types ───

interface TechniqueRow {
  id: string;
  tenant_id: string;
  agent_id: string;
  status: string;
}

interface QuarantineRow {
  id: string;
  technique_id: string;
  agent_id: string;
  tenant_id: string;
  reason: string;
  quarantined_at: string;
  resolved_at: string | null;
  resolution: string | null;
  created_at: string;
}

function rowToEntry(row: QuarantineRow): QuarantineEntry {
  return {
    id: row.id,
    techniqueId: row.technique_id as TechniqueId,
    tenantId: row.tenant_id as TenantId,
    agentId: row.agent_id as import('../../kernel/interfaces/index.js').AgentId,
    reason: row.reason,
    quarantinedAt: row.quarantined_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution as QuarantineResolution | null,
  };
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
 * Create a QuarantineManager implementation.
 * Follows the Limen store pattern: factory → Object.freeze.
 *
 * S29.7: "memory quarantine + technique suspension in one SQLite transaction (I-03)."
 */
export function createQuarantineManager(deps: LearningDeps, store: TechniqueStore): QuarantineManager {

  // ─── quarantine ───

  function quarantine(
    conn: DatabaseConnection,
    ctx: OperationContext,
    techniqueIds: readonly TechniqueId[],
    tenantId: TenantId,
    reason: string,
  ): Result<readonly QuarantineEntry[]> {
    const entries: QuarantineEntry[] = [];
    const now = deps.time.nowISO();

    conn.transaction(() => {
      for (const tid of techniqueIds) {
        // Query directly by id + tenant_id (no agentId — cross-agent quarantine, D4)
        const technique = conn.get<TechniqueRow>(
          `SELECT id, tenant_id, agent_id, status FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
          [tid, tenantId],
        );

        if (!technique) continue; // Technique not found — skip silently

        // D1: Skip already-retired techniques (FS-04)
        if (technique.status === 'retired') continue;

        // D2: If already suspended, create entry but skip suspend call
        if (technique.status === 'active') {
          store.suspend(conn, ctx, tid, tenantId);
        }

        const entryId = randomUUID();
        conn.run(
          `INSERT INTO learning_quarantine_entries
            (id, technique_id, agent_id, tenant_id, reason, quarantined_at, resolved_at, resolution, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
          [entryId, tid, technique.agent_id, tenantId, reason, now, now],
        );

        entries.push({
          id: entryId,
          techniqueId: tid,
          tenantId,
          agentId: technique.agent_id as import('../../kernel/interfaces/index.js').AgentId,
          reason,
          quarantinedAt: now,
          resolvedAt: null,
          resolution: null,
        });
      }

      deps.audit.append(conn, {
        tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: `quarantine.cascade:${techniqueIds.length}`,
        resourceType: 'quarantine',
        resourceId: entries.map(e => e.id).join(','),
      });
    });

    return { ok: true, value: entries };
  }

  // ─── resolve ───

  function resolve(
    conn: DatabaseConnection,
    ctx: OperationContext,
    entryId: string,
    resolution: QuarantineResolution,
  ): Result<void> {
    const callerTenantId = ctx.tenantId as TenantId;
    const entry = conn.get<QuarantineRow>(
      `SELECT * FROM learning_quarantine_entries WHERE id = ? AND tenant_id = ?`,
      [entryId, callerTenantId],
    );

    if (!entry) {
      return {
        ok: false,
        error: {
          code: 'QUARANTINE_ENTRY_NOT_FOUND',
          message: `Quarantine entry ${entryId} not found`,
          spec: 'S29.7',
        },
      };
    }

    if (entry.resolved_at !== null) {
      return {
        ok: false,
        error: {
          code: 'ALREADY_RESOLVED',
          message: `Quarantine entry ${entryId} already resolved as ${entry.resolution}`,
          spec: 'S29.7',
        },
      };
    }

    const techniqueId = entry.technique_id as TechniqueId;
    const entryTenantId = entry.tenant_id as TenantId;
    const now = deps.time.nowISO();

    // BRK-IMPL-006: Check store operation result BEFORE updating quarantine entry.
    // If the technique's state has changed since quarantine (e.g., retired through
    // another path), the store operation will fail. We must not mark the entry as
    // resolved with an incorrect resolution.
    let storeResult: Result<void>;
    if (resolution === 'reactivated') {
      storeResult = store.reactivate(conn, ctx, techniqueId, entryTenantId, CONFIDENCE_RESET_REACTIVATION);
    } else {
      // permanently_retired
      storeResult = store.retire(conn, ctx, techniqueId, entryTenantId, 'quarantine_retired' as import('../interfaces/index.js').RetirementReason);
    }

    if (!storeResult.ok) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_STATE_CHANGED',
          message: `Cannot resolve quarantine as '${resolution}': ${storeResult.error.message}`,
          spec: 'S29.7',
        },
      };
    }

    // Store operation succeeded — now update quarantine entry
    conn.transaction(() => {
      conn.run(
        `UPDATE learning_quarantine_entries SET resolved_at = ?, resolution = ? WHERE id = ?`,
        [now, resolution, entryId],
      );

      deps.audit.append(conn, {
        tenantId: entryTenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: `quarantine.resolve:${resolution}`,
        resourceType: 'quarantine',
        resourceId: entryId,
      });
    });

    return { ok: true, value: undefined };
  }

  // ─── getPending ───

  function getPending(
    conn: DatabaseConnection,
    tenantId: TenantId,
  ): Result<readonly QuarantineEntry[]> {
    const rows = conn.query<QuarantineRow>(
      `SELECT * FROM learning_quarantine_entries WHERE tenant_id = ? AND resolved_at IS NULL ORDER BY quarantined_at ASC`,
      [tenantId],
    );

    return { ok: true, value: rows.map(rowToEntry) };
  }

  // ─── cascadeFromMemory (BRK-IMPL-007) ───

  /**
   * BRK-IMPL-007: GDPR cascade — when a source memory is tombstoned/poisoned,
   * find all derived techniques via getBySourceMemory and quarantine them.
   * Bridges memory → technique → quarantine in one operation.
   *
   * S ref: S29.7 (quarantine cascade), FM-01 (memory poisoning), GDPR Art. 17
   */
  function cascadeFromMemory(
    conn: DatabaseConnection,
    ctx: OperationContext,
    memoryId: string,
    tenantId: TenantId,
    reason: string,
  ): Result<readonly QuarantineEntry[]> {
    // Step 1: Find all techniques derived from this memory
    const techniquesResult = store.getBySourceMemory(conn, memoryId, tenantId);
    if (!techniquesResult.ok) return techniquesResult;

    const techniques = techniquesResult.value;
    if (techniques.length === 0) {
      // No derived techniques — cascade is a no-op (valid case)
      return { ok: true, value: [] };
    }

    // Step 2: Quarantine all derived techniques
    const techniqueIds = techniques.map(t => t.id);
    return quarantine(conn, ctx, techniqueIds, tenantId, reason);
  }

  // ─── Return frozen manager ───

  return Object.freeze({
    quarantine,
    resolve,
    getPending,
    cascadeFromMemory,
  });
}
