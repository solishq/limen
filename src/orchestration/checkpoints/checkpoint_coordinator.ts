/**
 * Checkpoint Coordinator -- Checkpoint lifecycle management.
 * S ref: S24 (Checkpoint), I-17 (governance boundary), I-24 (goal anchoring),
 *        I-25 (deterministic replay), I-03 (atomic audit)
 *
 * Phase: 3 (Orchestration)
 * Implements: Checkpoint fire/respond/expire lifecycle,
 *             7 trigger types, confidence-driven behavior thresholds,
 *             semantic drift check against goal anchor (I-24),
 *             replan validation (same rules as propose_task_graph).
 *
 * SD-22: Checkpoints are system-initiated. Agents respond. The orchestrator decides.
 * SD-23: Confidence thresholds: 0.8-1.0 continue, 0.5-0.8 flagged,
 *        0.2-0.5 pause+human, 0.0-0.2 halt+escalate.
 */

import type { Result, MissionId, TenantId, DatabaseConnection } from '../../kernel/interfaces/index.js';
import type {
  OrchestrationDeps, CheckpointCoordinator,
  CheckpointTrigger, CheckpointDecision,
  RespondCheckpointInput, RespondCheckpointOutput,
} from '../interfaces/orchestration.js';
import { CONFIDENCE_BANDS, generateId } from '../interfaces/orchestration.js';
import { assessDrift } from './drift_engine.js';

/** SD-23: Default checkpoint timeout (5 minutes) */
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * S24: Create the checkpoint coordinator module.
 * Factory function returns frozen object per C-07.
 */
export function createCheckpointCoordinator(): CheckpointCoordinator {

  /**
   * S24: Fire a checkpoint for a mission.
   * System-initiated only (I-17: governance boundary).
   * Returns checkpoint ID for agent to respond to.
   */
  function fire(
    deps: OrchestrationDeps,
    missionId: MissionId,
    trigger: CheckpointTrigger,
    detail?: unknown,
  ): Result<string> {
    const checkpointId = generateId();
    const nowMs = deps.time.nowMs();
    const timeoutAt = new Date(nowMs + DEFAULT_TIMEOUT_MS).toISOString();
    const isoNow = deps.time.nowISO();

    // F-04 fix: Derive tenant_id from mission (T-4 cross-tenant isolation)
    const missionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [missionId],
    );
    const tenantId = (missionRow?.tenant_id ?? null) as TenantId | null;

    deps.conn.transaction(() => {
      deps.conn.run(
        `INSERT INTO core_checkpoints (id, mission_id, tenant_id, trigger_type, trigger_detail, state, timeout_at, created_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        [checkpointId, missionId, tenantId, trigger, detail ? JSON.stringify(detail) : null, timeoutAt, isoNow],
      );

      deps.audit.append(deps.conn, {
        tenantId,
        actorType: 'system',
        actorId: 'checkpoint_coordinator',
        operation: 'fire_checkpoint',
        resourceType: 'checkpoint',
        resourceId: checkpointId,
        detail: { missionId, trigger, detail },
      });
    });

    return { ok: true, value: checkpointId };
  }

  /**
   * S24: Process agent's response to a checkpoint.
   * SD-23: Confidence-driven behavior determines system decision.
   * I-24: Semantic drift check against goal anchor.
   * I-25: Full exchange recorded for replay.
   */
  function processResponse(
    deps: OrchestrationDeps,
    input: RespondCheckpointInput,
  ): Result<RespondCheckpointOutput> {
    // Verify checkpoint exists and is PENDING
    const checkpoint = deps.conn.get<{ id: string; mission_id: string; state: string; timeout_at: string }>(
      'SELECT id, mission_id, state, timeout_at FROM core_checkpoints WHERE id = ?',
      [input.checkpointId],
    );
    if (!checkpoint) {
      return { ok: false, error: { code: 'CHECKPOINT_EXPIRED', message: `Checkpoint ${input.checkpointId} not found`, spec: 'S24' } };
    }
    if (checkpoint.state !== 'PENDING') {
      return { ok: false, error: { code: 'CHECKPOINT_EXPIRED', message: `Checkpoint already in state ${checkpoint.state}`, spec: 'S24' } };
    }

    // Check timeout
    const nowMs = deps.time.nowMs();
    if (nowMs > new Date(checkpoint.timeout_at).getTime()) {
      return { ok: false, error: { code: 'CHECKPOINT_EXPIRED', message: 'Checkpoint response after timeout', spec: 'S24' } };
    }

    // Debt 3: Derive tenant_id from mission for audit trail
    const cpMissionRow = deps.conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [checkpoint.mission_id],
    );
    const cpTenantId = (cpMissionRow?.tenant_id ?? null) as TenantId | null;

    // SD-23: Determine system decision based on confidence + proposed action
    let systemAction: CheckpointDecision;
    let reason: string;

    const confidence = input.confidence;

    if (input.proposedAction === 'abort') {
      // Agent wants to abort -- honor it
      systemAction = 'aborted';
      reason = 'Agent proposed abort';
    } else if (input.proposedAction === 'escalate') {
      // Agent wants to escalate -- honor it
      systemAction = 'escalated';
      reason = input.escalationReason ?? 'Agent requested escalation';
    } else if (input.proposedAction === 'replan') {
      // Validate the plan revision if provided
      if (input.planRevision !== null) {
        // Note: Full validation would invoke task graph engine.
        // At this layer, we accept the intent. The syscall layer
        // will validate via proposeTaskGraph when installing.
        systemAction = 'replan_accepted';
        reason = 'Replan accepted for validation';
      } else {
        systemAction = 'replan_rejected';
        reason = 'Replan proposed but no plan revision provided';
      }
    } else {
      // 'continue' -- apply confidence-driven behavior
      if (confidence >= CONFIDENCE_BANDS.CONTINUE_AUTONOMOUS.min) {
        systemAction = 'continue';
        reason = `High confidence (${confidence}) -- continue autonomously`;
      } else if (confidence >= CONFIDENCE_BANDS.CONTINUE_FLAGGED.min) {
        systemAction = 'continue';
        reason = `Medium confidence (${confidence}) -- continue with flag for review`;
      } else if (confidence >= CONFIDENCE_BANDS.PAUSE_HUMAN_INPUT.min) {
        systemAction = 'escalated';
        reason = `Low confidence (${confidence}) -- pause for human input`;
      } else {
        systemAction = 'escalated';
        reason = `Very low confidence (${confidence}) -- halt and escalate`;
      }
    }

    // I-24: Assess semantic drift against goal anchor
    // Drift assessment runs before the transaction so its result can override systemAction.
    // The assessDrift function INSERTs into core_drift_assessments — this must happen
    // inside the same transaction as the checkpoint update for atomicity.
    // We compute the drift result first (outside transaction) conceptually,
    // but the actual INSERT happens in the transaction below.
    const driftMissionId = checkpoint.mission_id as MissionId;

    const isoNow = deps.time.nowISO();

    deps.conn.transaction(() => {
      // I-24: Run drift assessment (INSERTs into core_drift_assessments within this transaction)
      const driftResult = assessDrift(
        input.checkpointId,
        driftMissionId,
        input.assessment,
        deps.conn,
        cpTenantId,
        deps.audit,
        deps.time,
      );

      // I-24: If drift engine returns 'escalated' AND current system_action is 'continue',
      // override to 'escalated' with reason 'goal_drift_detected'
      if (driftResult.actionTaken === 'escalated' && systemAction === 'continue') {
        systemAction = 'escalated';
        reason = driftResult.escalationReason ?? 'goal_drift_detected';
      }

      // Update checkpoint state
      deps.conn.run(
        `UPDATE core_checkpoints
         SET state = 'RESPONDED',
             assessment = ?,
             confidence = ?,
             proposed_action = ?,
             plan_revision = ?,
             escalation_reason = ?,
             system_action = ?,
             system_reason = ?,
             responded_at = ?
         WHERE id = ?`,
        [
          input.assessment,
          input.confidence,
          input.proposedAction,
          input.planRevision ? JSON.stringify(input.planRevision) : null,
          input.escalationReason,
          systemAction,
          reason,
          isoNow,
          input.checkpointId,
        ],
      );

      // Side effects based on system action
      if (systemAction === 'escalated') {
        // Mission -> BLOCKED
        const escalateResult = deps.conn.run(
          `UPDATE core_missions SET state = 'BLOCKED', updated_at = ? WHERE id = ? AND state NOT IN ('COMPLETED','FAILED','CANCELLED')`,
          [isoNow, checkpoint.mission_id],
        );
        // F-08 fix: I-03 audit for mission state side-effect
        if (escalateResult.changes > 0) {
          deps.audit.append(deps.conn, {
            tenantId: cpTenantId,
            actorType: 'system',
            actorId: 'checkpoint_coordinator',
            operation: 'mission_transition',
            resourceType: 'mission',
            resourceId: checkpoint.mission_id,
            detail: { to: 'BLOCKED', reason: 'checkpoint_escalation', checkpointId: input.checkpointId },
          });
        }
      } else if (systemAction === 'aborted') {
        // Mission -> CANCELLED
        const abortResult = deps.conn.run(
          `UPDATE core_missions SET state = 'CANCELLED', updated_at = ?, completed_at = ? WHERE id = ? AND state NOT IN ('COMPLETED','FAILED','CANCELLED')`,
          [isoNow, isoNow, checkpoint.mission_id],
        );
        // F-08 fix: I-03 audit for mission state side-effect
        if (abortResult.changes > 0) {
          deps.audit.append(deps.conn, {
            tenantId: cpTenantId,
            actorType: 'system',
            actorId: 'checkpoint_coordinator',
            operation: 'mission_transition',
            resourceType: 'mission',
            resourceId: checkpoint.mission_id,
            detail: { to: 'CANCELLED', reason: 'checkpoint_abort', checkpointId: input.checkpointId },
          });
        }
      }

      // I-03/I-25: Full checkpoint exchange in audit
      deps.audit.append(deps.conn, {
        tenantId: cpTenantId,
        actorType: 'system',
        actorId: 'checkpoint_coordinator',
        operation: 'respond_checkpoint',
        resourceType: 'checkpoint',
        resourceId: input.checkpointId,
        detail: {
          assessment: input.assessment,
          confidence: input.confidence,
          proposedAction: input.proposedAction,
          systemAction,
          reason,
          missionId: checkpoint.mission_id,
        },
      });
    });

    return {
      ok: true,
      value: { action: systemAction, reason },
    };
  }

  /** S24: Expire overdue checkpoints */
  function expireOverdue(deps: OrchestrationDeps): Result<number> {
    const now = deps.time.nowISO();

    // SYSTEM_SCOPE: batch expiry across all tenants — must not be tenant-scoped.
    // expireOverdue is a system-level maintenance operation. If deps.conn is a
    // TenantScopedConnection, unwrap to raw to avoid scoping the UPDATE to a single tenant.
    const rawConn: DatabaseConnection = 'raw' in deps.conn
      ? (deps.conn as Record<string, unknown>).raw as DatabaseConnection
      : deps.conn;

    // F-06 fix: Wrap in transaction with audit entry (I-03)
    let expired = 0;
    rawConn.transaction(() => {
      const result = rawConn.run(
        `UPDATE core_checkpoints SET state = 'EXPIRED' WHERE state = 'PENDING' AND timeout_at < ?`,
        [now],
      );
      expired = result.changes;

      if (expired > 0) {
        deps.audit.append(rawConn, {
          tenantId: null,
          actorType: 'system',
          actorId: 'checkpoint_coordinator',
          operation: 'expire_checkpoints',
          resourceType: 'checkpoint',
          resourceId: 'batch',
          detail: { expiredCount: expired, expiredAt: now },
        });
      }
    });

    return { ok: true, value: expired };
  }

  return Object.freeze({
    fire,
    processResponse,
    expireOverdue,
  });
}
