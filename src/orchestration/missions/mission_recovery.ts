/**
 * Mission Recovery — Safe recovery of non-terminal missions after engine restart.
 * Spec ref: I-18 (Mission Persistence/Recovery), S6 (Mission Lifecycle)
 *
 * Phase: Sprint 4 (Replay & Pipeline)
 * Implements: Idempotent recovery of missions in non-terminal states.
 *
 * Recovery is CONSERVATIVE:
 *   - EXECUTING -> PAUSED (safe: PAUSED is a recoverable state)
 *   - REVIEWING -> PAUSED (safe: needs human re-review)
 *   - CREATED -> unchanged (not yet started)
 *   - PLANNING -> unchanged (idempotent, can restart planning)
 *   - PAUSED -> unchanged (already in recoverable state)
 *   - BLOCKED -> unchanged (already in blocked state)
 *   - DEGRADED -> unchanged (will re-evaluate on next checkpoint)
 *
 * Security constraints:
 *   - Does NOT auto-resume any mission (conservative approach)
 *   - Audit entry for every recovery action
 *   - Each mission recovery in its own transaction
 *   - Non-fatal: one mission failure does not stop others
 *
 * Uses MISSION_TRANSITIONS to validate every state transition.
 * Recovery is IDEMPOTENT — checks for existing recovery audit entries.
 *
 * Invariants enforced: I-18, I-05 (transactional consistency)
 * Failure modes defended: FM-10 (cross-tenant leakage — not applicable, recovery is system-level)
 */

import type { DatabaseConnection, Result, AuditTrail, MissionId } from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import { MISSION_TRANSITIONS } from '../interfaces/orchestration.js';
import type { MissionState } from '../interfaces/orchestration.js';
import type { OrchestrationTransitionService } from '../transitions/transition_service.js';

// ============================================================================
// Types
// ============================================================================

export interface RecoveryResult {
  readonly recoveredCount: number;
  readonly missions: ReadonlyArray<{
    readonly missionId: string;
    readonly previousState: string;
    readonly action: 'paused' | 'unchanged';
  }>;
}

// ============================================================================
// Recovery Rules
// ============================================================================

/** States that should be transitioned to PAUSED on recovery */
const RECOVERY_TRANSITION_STATES: ReadonlySet<string> = new Set(['EXECUTING', 'REVIEWING']);

/** States that are left unchanged on recovery */
const RECOVERY_UNCHANGED_STATES: ReadonlySet<string> = new Set([
  'CREATED', 'PLANNING', 'PAUSED', 'BLOCKED', 'DEGRADED',
]);

// ============================================================================
// Implementation
// ============================================================================

/**
 * Recover non-terminal missions after engine restart.
 *
 * Queries all non-terminal missions in root-first BFS ordering (depth ASC),
 * then applies conservative recovery rules:
 *   - EXECUTING/REVIEWING -> PAUSED (validated via MISSION_TRANSITIONS)
 *   - All other non-terminal states -> unchanged
 *
 * Each mission is recovered in its own transaction with audit entry.
 * Non-fatal: individual mission recovery failures are logged but do not
 * abort the overall recovery process.
 *
 * Recovery is IDEMPOTENT — if a mission already has a recovery audit entry
 * from a previous recovery pass, it is skipped.
 *
 * @param conn - Database connection
 * @param audit - Audit trail for recording recovery actions
 * @param time - Time provider (Hard Stop #7)
 * @returns RecoveryResult with counts and per-mission actions
 */
export function recoverMissions(
  conn: DatabaseConnection,
  audit: AuditTrail,
  time: TimeProvider,
  transitionService?: OrchestrationTransitionService,
): Result<RecoveryResult> {
  // Query non-terminal missions in root-first BFS ordering (depth ASC)
  // Uses the partial index idx_core_missions_non_terminal for efficiency
  const missions = conn.query<{
    id: string;
    state: string;
    tenant_id: string | null;
  }>(
    `SELECT id, state, tenant_id
     FROM core_missions
     WHERE state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
     ORDER BY depth ASC`,
  );

  const results: Array<{
    missionId: string;
    previousState: string;
    action: 'paused' | 'unchanged';
  }> = [];
  let recoveredCount = 0;

  for (const mission of missions) {
    try {
      const action = recoverSingleMission(conn, audit, time, mission.id, mission.state, mission.tenant_id, transitionService);
      results.push({
        missionId: mission.id,
        previousState: mission.state,
        action,
      });
      if (action === 'paused') {
        recoveredCount++;
      }
    } catch (recoveryErr: unknown) {
      // F-S4-003 FIX: Non-fatal, but record failure in audit trail for observability.
      // Pattern: Sprint 1 F-S1-003 / Sprint 2 F-S2-003 (non-fatal audit trail on error).
      try {
        audit.append(conn, {
          tenantId: mission.tenant_id as import('../../kernel/interfaces/index.js').TenantId | null,
          actorType: 'system',
          actorId: 'mission_recovery',
          operation: 'mission_recovery_failed',
          resourceType: 'mission',
          resourceId: mission.id,
          detail: {
            previousState: mission.state,
            error: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
          },
        });
      } catch { /* audit itself failed — truly terminal, nothing to do */ }
      results.push({
        missionId: mission.id,
        previousState: mission.state,
        action: 'unchanged',
      });
    }
  }

  return {
    ok: true,
    value: {
      recoveredCount,
      missions: results,
    },
  };
}

/**
 * Recover a single mission within its own transaction.
 *
 * @returns 'paused' if state was transitioned, 'unchanged' if left as-is
 */
function recoverSingleMission(
  conn: DatabaseConnection,
  audit: AuditTrail,
  time: TimeProvider,
  missionId: string,
  currentState: string,
  tenantId: string | null,
  transitionService?: OrchestrationTransitionService,
): 'paused' | 'unchanged' {
  // Idempotency check: look for existing recovery audit entry for this mission
  const existingRecovery = conn.get<{ id: string }>(
    `SELECT id FROM core_audit_log
     WHERE resource_type = 'mission'
     AND resource_id = ?
     AND operation = 'mission_recovery'
     ORDER BY timestamp DESC
     LIMIT 1`,
    [missionId],
  );

  if (existingRecovery) {
    // Already recovered in a previous pass — idempotent skip
    return 'unchanged';
  }

  // Determine action based on current state
  if (RECOVERY_TRANSITION_STATES.has(currentState)) {
    // Validate transition via MISSION_TRANSITIONS (don't bypass state machine)
    const validTargets = MISSION_TRANSITIONS[currentState as MissionState];
    if (!validTargets.includes('PAUSED')) {
      // REVIEWING -> PAUSED is not in the standard MISSION_TRANSITIONS.
      // REVIEWING valid targets: ['COMPLETED', 'EXECUTING', 'FAILED']
      // For REVIEWING, we use a special recovery path: direct UPDATE with audit.
      // This is safe because recovery is a system-level operation, not a user-initiated transition.
      // However, for EXECUTING -> PAUSED, MISSION_TRANSITIONS DOES allow it.
      if (currentState === 'EXECUTING') {
        // EXECUTING -> PAUSED is valid per MISSION_TRANSITIONS
        // P0-A: Use transition service recovery path when available
        if (transitionService) {
          return transitionViaMissionRecoveryService(conn, audit, time, transitionService, missionId, currentState, tenantId);
        }
        return transitionToPaused(conn, audit, time, missionId, currentState, tenantId);
      }

      // For REVIEWING: The state machine doesn't have REVIEWING -> PAUSED.
      // Recovery rule says REVIEWING -> PAUSED for safety (needs human re-review).
      // This is a system-level recovery override, not a normal state transition.
      // Record the override in the audit trail.
      // P0-A: Use transitionMissionRecovery which skips the transition map
      if (transitionService) {
        return transitionViaMissionRecoveryService(conn, audit, time, transitionService, missionId, currentState, tenantId);
      }
      return transitionToPausedRecoveryOverride(conn, audit, time, missionId, currentState, tenantId);
    }

    // P0-A: Use transition service recovery path when available
    if (transitionService) {
      return transitionViaMissionRecoveryService(conn, audit, time, transitionService, missionId, currentState, tenantId);
    }
    return transitionToPaused(conn, audit, time, missionId, currentState, tenantId);
  }

  if (RECOVERY_UNCHANGED_STATES.has(currentState)) {
    // Record audit entry for unchanged missions too (observability)
    conn.transaction(() => {
      audit.append(conn, {
        tenantId: tenantId as import('../../kernel/interfaces/index.js').TenantId | null,
        actorType: 'system',
        actorId: 'mission_recovery',
        operation: 'mission_recovery',
        resourceType: 'mission',
        resourceId: missionId,
        detail: {
          previousState: currentState,
          action: 'unchanged',
          reason: `State ${currentState} does not require recovery transition`,
        },
      });
    });
    return 'unchanged';
  }

  // Unknown state — leave unchanged, audit for investigation
  conn.transaction(() => {
    audit.append(conn, {
      tenantId: tenantId as import('../../kernel/interfaces/index.js').TenantId | null,
      actorType: 'system',
      actorId: 'mission_recovery',
      operation: 'mission_recovery',
      resourceType: 'mission',
      resourceId: missionId,
      detail: {
        previousState: currentState,
        action: 'unchanged',
        reason: `Unknown state ${currentState} — no recovery rule defined`,
      },
    });
  });
  return 'unchanged';
}

/**
 * P0-A: Transition a mission to PAUSED via the OrchestrationTransitionService recovery path.
 * Uses transitionMissionRecovery which skips the transition map validation but
 * keeps governance enforcement + CAS + audit.
 */
function transitionViaMissionRecoveryService(
  conn: DatabaseConnection,
  _audit: AuditTrail,
  _time: TimeProvider,
  transitionService: OrchestrationTransitionService,
  missionId: string,
  previousState: string,
  _tenantId: string | null,
): 'paused' {
  const result = transitionService.transitionMissionRecovery(
    conn,
    missionId as MissionId,
    previousState as MissionState,
    'PAUSED',
  );
  if (!result.ok) {
    throw new Error(`Recovery transition failed for mission ${missionId}: ${result.error.message}`);
  }
  return 'paused';
}

/**
 * Transition a mission to PAUSED via the standard state machine path.
 */
function transitionToPaused(
  conn: DatabaseConnection,
  audit: AuditTrail,
  time: TimeProvider,
  missionId: string,
  previousState: string,
  tenantId: string | null,
): 'paused' {
  const now = time.nowISO();

  conn.transaction(() => {
    // F-S4-004 FIX: Check UPDATE result to detect TOCTOU race (concurrent state change)
    const result = conn.run(
      `UPDATE core_missions SET state = 'PAUSED', updated_at = ? WHERE id = ? AND state = ?`,
      [now, missionId, previousState],
    );

    if (result.changes === 0) {
      throw new Error(`Mission ${missionId} not in state ${previousState} (TOCTOU: state changed between query and recovery)`);
    }

    audit.append(conn, {
      tenantId: tenantId as import('../../kernel/interfaces/index.js').TenantId | null,
      actorType: 'system',
      actorId: 'mission_recovery',
      operation: 'mission_recovery',
      resourceType: 'mission',
      resourceId: missionId,
      detail: {
        previousState,
        newState: 'PAUSED',
        action: 'paused',
        transitionPath: 'standard',
      },
    });
  });

  return 'paused';
}

/**
 * Transition REVIEWING -> PAUSED via recovery override.
 * REVIEWING -> PAUSED is not in the standard state machine, but recovery
 * rules require it for safety (needs human re-review after restart).
 */
function transitionToPausedRecoveryOverride(
  conn: DatabaseConnection,
  audit: AuditTrail,
  time: TimeProvider,
  missionId: string,
  previousState: string,
  tenantId: string | null,
): 'paused' {
  const now = time.nowISO();

  conn.transaction(() => {
    // F-S4-004 FIX: Check UPDATE result to detect TOCTOU race
    const result = conn.run(
      `UPDATE core_missions SET state = 'PAUSED', updated_at = ? WHERE id = ? AND state = ?`,
      [now, missionId, previousState],
    );

    if (result.changes === 0) {
      throw new Error(`Mission ${missionId} not in state ${previousState} (TOCTOU: state changed between query and recovery)`);
    }

    audit.append(conn, {
      tenantId: tenantId as import('../../kernel/interfaces/index.js').TenantId | null,
      actorType: 'system',
      actorId: 'mission_recovery',
      operation: 'mission_recovery',
      resourceType: 'mission',
      resourceId: missionId,
      detail: {
        previousState,
        newState: 'PAUSED',
        action: 'paused',
        transitionPath: 'recovery_override',
        reason: `${previousState} -> PAUSED not in standard transitions; recovery override for safety`,
      },
    });
  });

  return 'paused';
}
