/**
 * Limen — CrossAgentTransfer Implementation
 * Phase 4E-2e: Learning System Convergence Subsystems
 *
 * Implements the CrossAgentTransfer interface from learning_types.ts.
 * Human gate required. Confidence resets to 0.4 on transfer.
 * Source provenance chain preserved.
 *
 * S ref: S29.8 (cross-agent transfer protocol), I-07 (agent isolation),
 *        I-03 (audit atomicity), DEC-4E-002 (cross-tenant blocked)
 *
 * Engineering decisions:
 *   D1: Qualification gate enforced at requestTransfer (§29.8 Step 1, BRK-S29-002).
 *       Source technique must have confidence > 0.8, success_rate > 0.7,
 *       applicationCount > 50. This prevents low-quality techniques from being
 *       proposed for transfer.
 *   D2: Clone mechanics: approveTransfer creates a NEW technique via store.create()
 *       with the target agent's ID. Source technique is unaffected (clone, not move).
 *   D3: Provenance preservation: the cloned technique's sourceMemoryIds = the source
 *       technique's sourceMemoryIds. Full provenance chain maintained.
 *   D4: DEC-4E-002 enforcement: TransferRequest has single tenantId field. The
 *       implementation uses this tenantId for all queries — no cross-tenant path exists.
 *   D5: Self-transfer (sourceAgentId === targetAgentId) is rejected immediately.
 *       No request record created (§29.8, I-07).
 */

import { randomUUID } from 'node:crypto';
import type {
  CrossAgentTransfer, TransferRequest, TransferResult,
  TechniqueStore, LearningDeps,
} from '../interfaces/index.js';
import {
  TRANSFER_MIN_CONFIDENCE,
  TRANSFER_MIN_SUCCESS_RATE,
  TRANSFER_MIN_APPLICATIONS,
  CONFIDENCE_RESET_TRANSFER,
} from '../interfaces/index.js';
import type {
  DatabaseConnection, OperationContext, Result, AgentId,
} from '../../kernel/interfaces/index.js';

// ─── Row Types ───

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
  status: string;
}

interface TransferRequestRow {
  id: string;
  tenant_id: string;
  source_agent_id: string;
  target_agent_id: string;
  technique_id: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
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
 * Create a CrossAgentTransfer implementation.
 * Follows the Limen store pattern: factory → Object.freeze.
 *
 * S29.8: Transfer lifecycle: request → pending → approved/rejected.
 * Human gate required. Confidence resets to 0.4.
 */
export function createCrossAgentTransfer(deps: LearningDeps, store: TechniqueStore): CrossAgentTransfer {

  // ─── requestTransfer ───

  function requestTransfer(
    conn: DatabaseConnection,
    ctx: OperationContext,
    request: TransferRequest,
  ): Result<string> {
    // D5: Self-transfer rejection
    if (request.sourceAgentId === request.targetAgentId) {
      return {
        ok: false,
        error: {
          code: 'SELF_TRANSFER',
          message: 'Cannot transfer technique to the same agent',
          spec: 'S29.8',
        },
      };
    }

    // Get source technique (by id + tenant_id, no agent filter — we're verifying the source)
    const technique = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [request.sourceTechniqueId, request.tenantId],
    );

    if (!technique) {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_FOUND',
          message: `Source technique ${request.sourceTechniqueId} not found`,
          spec: 'S29.8',
        },
      };
    }

    // Verify source agent owns this technique
    if (technique.agent_id !== (request.sourceAgentId as string)) {
      return {
        ok: false,
        error: {
          code: 'AGENT_MISMATCH',
          message: `Source agent ${request.sourceAgentId} does not own technique ${request.sourceTechniqueId}`,
          spec: 'I-07',
        },
      };
    }

    // Cannot transfer retired or suspended technique (FS-14)
    if (technique.status !== 'active') {
      return {
        ok: false,
        error: {
          code: 'TECHNIQUE_NOT_ACTIVE',
          message: `Cannot transfer technique in state ${technique.status} — must be active`,
          spec: 'S29.8',
        },
      };
    }

    // D1: Qualification gate (§29.8 Step 1, BRK-S29-002)
    if (technique.confidence <= TRANSFER_MIN_CONFIDENCE ||
        technique.success_rate <= TRANSFER_MIN_SUCCESS_RATE ||
        technique.application_count <= TRANSFER_MIN_APPLICATIONS) {
      return {
        ok: false,
        error: {
          code: 'TRANSFER_QUALIFICATION_FAILED',
          message: `Technique does not meet transfer qualification: confidence > ${TRANSFER_MIN_CONFIDENCE}, success_rate > ${TRANSFER_MIN_SUCCESS_RATE}, applicationCount > ${TRANSFER_MIN_APPLICATIONS}`,
          spec: 'S29.8',
        },
      };
    }

    const requestId = randomUUID();
    const now = deps.time.nowISO();

    conn.transaction(() => {
      conn.run(
        `INSERT INTO learning_transfer_requests
          (id, tenant_id, source_agent_id, target_agent_id, technique_id, status, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)`,
        [requestId, request.tenantId, request.sourceAgentId, request.targetAgentId,
         request.sourceTechniqueId, now],
      );

      deps.audit.append(conn, {
        tenantId: request.tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'transfer.request',
        resourceType: 'transfer',
        resourceId: requestId,
      });
    });

    return { ok: true, value: requestId };
  }

  // ─── approveTransfer ───

  function approveTransfer(
    conn: DatabaseConnection,
    ctx: OperationContext,
    requestId: string,
  ): Result<TransferResult> {
    const callerTenantId = ctx.tenantId as import('../../kernel/interfaces/index.js').TenantId;
    const request = conn.get<TransferRequestRow>(
      `SELECT * FROM learning_transfer_requests WHERE id = ? AND tenant_id = ?`,
      [requestId, callerTenantId],
    );

    if (!request) {
      return {
        ok: false,
        error: {
          code: 'TRANSFER_REQUEST_NOT_FOUND',
          message: `Transfer request ${requestId} not found`,
          spec: 'S29.8',
        },
      };
    }

    if (request.status !== 'pending') {
      return {
        ok: false,
        error: {
          code: 'TRANSFER_NOT_PENDING',
          message: `Transfer request ${requestId} is ${request.status}, not pending`,
          spec: 'S29.8',
        },
      };
    }

    // Get source technique for cloning
    const technique = conn.get<TechniqueRow>(
      `SELECT * FROM learning_techniques WHERE id = ? AND tenant_id = ?`,
      [request.technique_id, request.tenant_id],
    );

    if (!technique) {
      return {
        ok: false,
        error: {
          code: 'SOURCE_TECHNIQUE_NOT_FOUND',
          message: `Source technique ${request.technique_id} no longer exists`,
          spec: 'S29.8',
        },
      };
    }

    const sourceMemoryIds: readonly string[] = JSON.parse(technique.source_memory_ids);
    const targetAgentId = request.target_agent_id as AgentId;
    const tenantId = request.tenant_id as import('../../kernel/interfaces/index.js').TenantId;
    const now = deps.time.nowISO();

    // D2: Clone technique for target agent via store.create()
    // D3: Provenance preserved — same sourceMemoryIds
    const createResult = store.create(conn, ctx, {
      tenantId,
      agentId: targetAgentId,
      type: technique.type as import('../interfaces/index.js').TechniqueType,
      content: technique.content,
      sourceMemoryIds,
      initialConfidence: CONFIDENCE_RESET_TRANSFER, // 0.4 per S29.8
    });

    if (!createResult.ok) {
      return createResult as Result<TransferResult>;
    }

    conn.transaction(() => {
      conn.run(
        `UPDATE learning_transfer_requests SET status = 'approved', resolved_at = ? WHERE id = ?`,
        [now, requestId],
      );

      deps.audit.append(conn, {
        tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'transfer.approve',
        resourceType: 'transfer',
        resourceId: requestId,
      });
    });

    return {
      ok: true,
      value: {
        newTechniqueId: createResult.value.id,
        sourceProvenanceChain: sourceMemoryIds,
        confidence: CONFIDENCE_RESET_TRANSFER,
      },
    };
  }

  // ─── rejectTransfer ───

  function rejectTransfer(
    conn: DatabaseConnection,
    ctx: OperationContext,
    requestId: string,
  ): Result<void> {
    const rejectCallerTenantId = ctx.tenantId as import('../../kernel/interfaces/index.js').TenantId;
    const request = conn.get<TransferRequestRow>(
      `SELECT * FROM learning_transfer_requests WHERE id = ? AND tenant_id = ?`,
      [requestId, rejectCallerTenantId],
    );

    if (!request) {
      return {
        ok: false,
        error: {
          code: 'TRANSFER_REQUEST_NOT_FOUND',
          message: `Transfer request ${requestId} not found`,
          spec: 'S29.8',
        },
      };
    }

    if (request.status !== 'pending') {
      return {
        ok: false,
        error: {
          code: 'TRANSFER_NOT_PENDING',
          message: `Transfer request ${requestId} is ${request.status}, not pending`,
          spec: 'S29.8',
        },
      };
    }

    const now = deps.time.nowISO();
    const tenantId = request.tenant_id as import('../../kernel/interfaces/index.js').TenantId;

    conn.transaction(() => {
      conn.run(
        `UPDATE learning_transfer_requests SET status = 'rejected', resolved_at = ? WHERE id = ?`,
        [now, requestId],
      );

      deps.audit.append(conn, {
        tenantId,
        actorType: actorType(ctx),
        actorId: actorId(ctx),
        operation: 'transfer.reject',
        resourceType: 'transfer',
        resourceId: requestId,
      });
    });

    return { ok: true, value: undefined };
  }

  // ─── Return frozen transfer ───

  return Object.freeze({
    requestTransfer,
    approveTransfer,
    rejectTransfer,
  });
}
