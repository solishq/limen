/**
 * Limen — TechniqueStore Implementation
 * Phase 4E-2a: Learning System Storage Foundation
 *
 * Implements the TechniqueStore interface from learning_types.ts.
 * All queries manually scoped by tenant_id + agent_id (belt).
 * TenantScopedConnection at API layer provides suspenders.
 *
 * S ref: S29.2 (schema), S29.3 Step 4 (provenance), S29.6 (retirement),
 *        S29.7 (quarantine/suspend/reactivate), I-03 (audit), I-07 (agent isolation),
 *        I-10 (retirement permanence), FM-01 (quarantine cascade via getBySourceMemory)
 */

import { randomUUID } from 'node:crypto';
import type {
  TechniqueStore, Technique, TechniqueCreateInput, TechniqueUpdateInput,
  TechniqueId, TechniqueStatus, RetirementReason, LearningDeps,
} from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result, TenantId, AgentId,
} from '../../kernel/interfaces/index.js';

// ─── State Machine ───

/** Valid state transitions per S29.2, S29.6, S29.7, I-10 */
const VALID_TRANSITIONS: Readonly<Record<TechniqueStatus, readonly TechniqueStatus[]>> = {
  active: ['suspended', 'retired'],
  suspended: ['active', 'retired'],
  retired: [],  // Terminal state (I-10: retirement is permanent)
};

// ─── Row-to-Domain Mapping ───

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
    type: row.type as Technique['type'],
    content: row.content,
    sourceMemoryIds: JSON.parse(row.source_memory_ids) as readonly string[],
    confidence: row.confidence,
    successRate: row.success_rate,
    applicationCount: row.application_count,
    lastApplied: row.last_applied,
    lastUpdated: row.last_updated,
    status: row.status as TechniqueStatus,
    createdAt: row.created_at,
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
 * Create a TechniqueStore implementation.
 * Follows the Limen store pattern: factory → Object.freeze.
 *
 * All mutations are wrapped in transactions with audit entries (I-03).
 * All queries enforce tenant_id + agent_id isolation.
 */
export function createTechniqueStore(deps: LearningDeps): TechniqueStore {

  // ─── create ───

  function create(
    conn: DatabaseConnection,
    ctx: OperationContext,
    input: TechniqueCreateInput,
  ): Result<Technique> {
    // Validate provenance (S29.3 Step 4: sourceMemoryIds MUST be non-empty)
    if (!input.sourceMemoryIds || input.sourceMemoryIds.length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROVENANCE_REQUIRED',
          message: 'sourceMemoryIds must be non-empty — provenance is required (S29.3 Step 4)',
          spec: 'S29.3',
        },
      };
    }

    const id = randomUUID() as TechniqueId;
    const now = deps.time.nowISO();
    const sourceMemoryIdsJson = JSON.stringify(input.sourceMemoryIds);

    const technique: Technique = {
      id,
      tenantId: input.tenantId,
      agentId: input.agentId,
      type: input.type,
      content: input.content,
      sourceMemoryIds: input.sourceMemoryIds,
      confidence: input.initialConfidence,
      successRate: 0,
      applicationCount: 0,
      lastApplied: null,
      lastUpdated: now,
      status: 'active',
      createdAt: now,
    };

    conn.transaction(() => {
      conn.run(
        `INSERT INTO learning_techniques
          (id, tenant_id, agent_id, type, content, source_memory_ids,
           confidence, success_rate, application_count, last_applied,
           last_updated, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, input.tenantId, input.agentId, input.type, input.content,
          sourceMemoryIdsJson, input.initialConfidence, 0, 0, null,
          now, 'active', now,
        ],
      );

      deps.audit.append(conn, {
        tenantId: input.tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'technique.create',
        resourceType: 'technique',
        resourceId: id,
      });
    });

    return { ok: true, value: technique };
  }

  // ─── get ───

  function get(
    conn: DatabaseConnection,
    id: TechniqueId,
    tenantId: TenantId,
    agentId: AgentId,
  ): Result<Technique> {
    const row = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ? AND agent_id = ?`,
      [id, tenantId, agentId],
    );

    if (!row) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${id} not found for tenant ${tenantId} and agent ${agentId}`,
          spec: 'S29.2',
        },
      };
    }

    return { ok: true, value: rowToTechnique(row) };
  }

  // ─── getByAgent ───

  function getByAgent(
    conn: DatabaseConnection,
    agentId: AgentId,
    tenantId: TenantId,
    status?: TechniqueStatus,
  ): Result<readonly Technique[]> {
    let sql = `SELECT * FROM learning_techniques WHERE agent_id = ? AND tenant_id = ?`;
    const params: unknown[] = [agentId, tenantId];

    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    const rows = conn.query<TechniqueRow>(sql, params);
    return { ok: true, value: rows.map(rowToTechnique) };
  }

  // ─── getBySourceMemory ───

  function getBySourceMemory(
    conn: DatabaseConnection,
    memoryId: string,
    tenantId: TenantId,
  ): Result<readonly Technique[]> {
    // Use json_each to search within the JSON array of source memory IDs
    // Comma-join with json_each (no JOIN keyword — compatible with TenantScopedConnection)
    const rows = conn.query<TechniqueRow>(
      `SELECT DISTINCT lt.id, lt.tenant_id, lt.agent_id, lt.type, lt.content,
              lt.source_memory_ids, lt.confidence, lt.success_rate,
              lt.application_count, lt.last_applied, lt.last_updated,
              lt.status, lt.created_at
       FROM learning_techniques lt, json_each(lt.source_memory_ids) je
       WHERE lt.tenant_id = ? AND je.value = ?`,
      [tenantId, memoryId],
    );

    return { ok: true, value: rows.map(rowToTechnique) };
  }

  // ─── update ───

  function update(
    conn: DatabaseConnection,
    ctx: OperationContext,
    id: TechniqueId,
    tenantId: TenantId,
    updates: TechniqueUpdateInput,
  ): Result<Technique> {
    // Fetch current technique (tenant-scoped)
    const current = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [id, tenantId],
    );

    if (!current) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${id} not found for tenant ${tenantId}`,
          spec: 'S29.2',
        },
      };
    }

    // Defense-in-depth: verify ctx.agentId matches (OBS-3)
    if (ctx.agentId && current.agent_id !== (ctx.agentId as string)) {
      return {
        ok: false,
        error: {
          code: 'AGENT_MISMATCH',
          message: `Context agent ${ctx.agentId} does not own technique ${id}`,
          spec: 'I-07',
        },
      };
    }

    // State machine validation: retired is terminal (I-10)
    if (updates.status && current.status === 'retired') {
      return {
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `Cannot transition from retired — retirement is permanent (I-10)`,
          spec: 'I-10',
        },
      };
    }

    // Validate state transition if status change requested
    if (updates.status && updates.status !== current.status) {
      const validTargets = VALID_TRANSITIONS[current.status as TechniqueStatus];
      if (!validTargets.includes(updates.status)) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: `Cannot transition from ${current.status} to ${updates.status}`,
            spec: 'S29.2',
          },
        };
      }
    }

    // Build SET clause dynamically from provided updates
    const setClauses: string[] = [];
    const setParams: unknown[] = [];

    if (updates.confidence !== undefined) {
      setClauses.push('confidence = ?');
      setParams.push(updates.confidence);
    }
    if (updates.successRate !== undefined) {
      setClauses.push('success_rate = ?');
      setParams.push(updates.successRate);
    }
    if (updates.applicationCount !== undefined) {
      setClauses.push('application_count = ?');
      setParams.push(updates.applicationCount);
    }
    if (updates.lastApplied !== undefined) {
      setClauses.push('last_applied = ?');
      setParams.push(updates.lastApplied);
    }
    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      setParams.push(updates.status);
    }

    if (setClauses.length === 0) {
      // No updates — return current state
      return { ok: true, value: rowToTechnique(current) };
    }

    const now = deps.time.nowISO();
    setClauses.push('last_updated = ?');
    setParams.push(now);

    conn.transaction(() => {
      conn.run(
        `UPDATE learning_techniques SET ${setClauses.join(', ')} WHERE id = ? AND tenant_id = ?`,
        [...setParams, id, tenantId],
      );

      deps.audit.append(conn, {
        tenantId: tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'technique.update',
        resourceType: 'technique',
        resourceId: id,
      });
    });

    // Fetch updated row
    const updated = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [id, tenantId],
    );

    return { ok: true, value: rowToTechnique(updated!) };
  }

  // ─── retire ───

  function retire(
    conn: DatabaseConnection,
    ctx: OperationContext,
    id: TechniqueId,
    tenantId: TenantId,
    reason: RetirementReason,
  ): Result<void> {
    const current = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [id, tenantId],
    );

    if (!current) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${id} not found for tenant ${tenantId}`,
          spec: 'S29.6',
        },
      };
    }

    // I-10: Cannot retire an already-retired technique
    if (current.status === 'retired') {
      return {
        ok: false,
        error: {
          code: 'ALREADY_RETIRED',
          message: `Technique ${id} is already retired`,
          spec: 'I-10',
        },
      };
    }

    const now = deps.time.nowISO();

    conn.transaction(() => {
      conn.run(
        `UPDATE learning_techniques SET status = 'retired', last_updated = ? WHERE id = ? AND tenant_id = ?`,
        [now, id, tenantId],
      );

      deps.audit.append(conn, {
        tenantId: tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: `technique.retire:${reason}`,
        resourceType: 'technique',
        resourceId: id,
      });
    });

    return { ok: true, value: undefined };
  }

  // ─── suspend ───

  function suspend(
    conn: DatabaseConnection,
    ctx: OperationContext,
    id: TechniqueId,
    tenantId: TenantId,
  ): Result<void> {
    const current = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [id, tenantId],
    );

    if (!current) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${id} not found for tenant ${tenantId}`,
          spec: 'S29.7',
        },
      };
    }

    // Can only suspend from 'active' state
    if (current.status !== 'active') {
      return {
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `Cannot suspend technique in state ${current.status} — only active techniques can be suspended`,
          spec: 'S29.7',
        },
      };
    }

    const now = deps.time.nowISO();

    conn.transaction(() => {
      conn.run(
        `UPDATE learning_techniques SET status = 'suspended', last_updated = ? WHERE id = ? AND tenant_id = ?`,
        [now, id, tenantId],
      );

      deps.audit.append(conn, {
        tenantId: tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'technique.suspend',
        resourceType: 'technique',
        resourceId: id,
      });
    });

    return { ok: true, value: undefined };
  }

  // ─── reactivate ───

  function reactivate(
    conn: DatabaseConnection,
    ctx: OperationContext,
    id: TechniqueId,
    tenantId: TenantId,
    resetConfidence: number,
  ): Result<void> {
    const current = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [id, tenantId],
    );

    if (!current) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Technique ${id} not found for tenant ${tenantId}`,
          spec: 'S29.7',
        },
      };
    }

    // Can only reactivate from 'suspended' state (I-10: retired is terminal)
    if (current.status !== 'suspended') {
      return {
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `Cannot reactivate technique in state ${current.status} — only suspended techniques can be reactivated (I-10)`,
          spec: 'I-10',
        },
      };
    }

    const now = deps.time.nowISO();

    conn.transaction(() => {
      conn.run(
        `UPDATE learning_techniques SET status = 'active', confidence = ?, last_updated = ? WHERE id = ? AND tenant_id = ?`,
        [resetConfidence, now, id, tenantId],
      );

      deps.audit.append(conn, {
        tenantId: tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'technique.reactivate',
        resourceType: 'technique',
        resourceId: id,
      });
    });

    return { ok: true, value: undefined };
  }

  // ─── Return frozen store ───

  return Object.freeze({
    create,
    get,
    getByAgent,
    getBySourceMemory,
    update,
    retire,
    suspend,
    reactivate,
  });
}
