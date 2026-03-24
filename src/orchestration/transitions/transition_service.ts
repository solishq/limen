/**
 * OrchestrationTransitionService — P0-A Structural Integrity Pass
 *
 * The canonical mechanism for state transitions at L2 (orchestration layer).
 * Becomes the SOLE mechanism when all callers are rewired (Task #233).
 * Bridges orchestration types (MissionState — 10 flat states) to governance types
 * (MissionLifecycleState — 6 states + substates) via the existing TransitionEnforcer.
 *
 * S ref: S6 (Mission lifecycle), S7 (Task lifecycle), S23 (submit_result → REVIEWING),
 *        BC-062 (TransitionEnforcer is sole mechanism), BC-070 (no terminal reversals),
 *        I-03 (audit in same transaction), I-25 (deterministic replay)
 *
 * Architecture:
 *   Callers → OrchestrationTransitionService (THIS) → TransitionEnforcer (EXISTING)
 *
 * Flow per transition:
 *   1. Validate `to` is in MISSION_TRANSITIONS[from] (orchestration transition map)
 *   2. Translate via MISSION_STATE_BACKFILL_MAP to governance types
 *   3. Delegate to TransitionEnforcer for phantom/terminal/suspension checks
 *   4. Execute transaction: UPDATE + CAS + audit
 *   5. Read-back verify state matches expectation
 *   6. Return Result<TransitionResult>
 *
 * Flag 3 (REVIEWING trigger): After every task transition to a terminal state,
 * check if ALL tasks in that mission's task graph are terminal. If yes, trigger
 * EXECUTING → REVIEWING in the SAME transaction. No async gap.
 */

import type { DatabaseConnection, MissionId, TaskId, TenantId, AuditTrail, TimeProvider, Result } from '../../kernel/interfaces/index.js';
import type { TransitionEnforcer, TransitionResult, MissionLifecycleState, MissionActiveSubstate, TaskLifecycleState } from '../../kernel/interfaces/lifecycle.js';
import { MISSION_STATE_BACKFILL_MAP, TASK_STATE_BACKFILL_MAP } from '../../kernel/interfaces/lifecycle.js';
import type { MissionState, TaskState } from '../interfaces/orchestration.js';
import { MISSION_TRANSITIONS, TASK_TRANSITIONS } from '../interfaces/orchestration.js';

// ─── Terminal state sets ───

const MISSION_TERMINAL_STATES: ReadonlySet<MissionState> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const TASK_TERMINAL_STATES: ReadonlySet<TaskState> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

// ─── Public Interface ───

export interface OrchestrationTransitionService {
  /**
   * Transition a mission state with full validation, governance enforcement,
   * CAS protection, and audit trail.
   */
  transitionMission(
    conn: DatabaseConnection,
    missionId: MissionId,
    from: MissionState,
    to: MissionState,
  ): Result<TransitionResult>;

  /**
   * Transition a task state with full validation, governance enforcement,
   * CAS protection, and audit trail.
   * Flag 3: If the task transitions to a terminal state and ALL tasks in the
   * mission's task graph are now terminal, auto-triggers EXECUTING → REVIEWING
   * on the parent mission (same transaction).
   */
  transitionTask(
    conn: DatabaseConnection,
    taskId: TaskId,
    from: TaskState,
    to: TaskState,
  ): Result<TransitionResult>;

  /**
   * Bulk operation: validates each transition individually, executes all in
   * one transaction. If any transition fails, entire batch is rolled back.
   */
  bulkTransitionTasks(
    conn: DatabaseConnection,
    tasks: Array<{ taskId: TaskId; from: TaskState; to: TaskState }>,
  ): Result<TransitionResult[]>;

  /**
   * Recovery override: skips orchestration transition map validation but
   * keeps audit trail + governance enforcement (phantom/terminal/suspension).
   */
  transitionMissionRecovery(
    conn: DatabaseConnection,
    missionId: MissionId,
    from: MissionState,
    to: MissionState,
  ): Result<TransitionResult>;
}

// ─── Factory ───

/**
 * Create an OrchestrationTransitionService.
 *
 * @param enforcer - The TransitionEnforcer from the governance layer (phantom/terminal/suspension checks)
 * @param audit - AuditTrail for recording all transitions
 * @param time - TimeProvider for deterministic timestamps (Hard Stop #7)
 */
export function createOrchestrationTransitionService(
  enforcer: TransitionEnforcer,
  audit: AuditTrail,
  time: TimeProvider,
): OrchestrationTransitionService {

  // ── Mission transition (core logic) ──

  function transitionMissionCore(
    conn: DatabaseConnection,
    mid: MissionId,
    from: MissionState,
    to: MissionState,
    skipTransitionMapValidation: boolean,
  ): Result<TransitionResult> {
    // Step 1: Validate transition is in orchestration transition map (unless recovery)
    if (!skipTransitionMapValidation) {
      const validTargets = MISSION_TRANSITIONS[from];
      if (!validTargets.includes(to)) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: `Cannot transition mission from ${from} to ${to}`,
            spec: 'S6',
          },
        };
      }
    }

    // Step 2: Translate to governance types via backfill map
    const govMapping = MISSION_STATE_BACKFILL_MAP[to];
    if (!govMapping) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `No governance mapping for state: ${to}`,
          spec: 'S6',
        },
      };
    }
    const govState: MissionLifecycleState = govMapping.state;
    const govSubstate: MissionActiveSubstate | undefined = govMapping.substate ?? undefined;

    // Step 3: Delegate to TransitionEnforcer for phantom/terminal/suspension checks
    const enforceResult = enforcer.enforceMissionTransition(
      conn,
      mid,
      govState,
      govSubstate,
    );
    if (!enforceResult.ok) {
      return enforceResult;
    }

    // Step 4: Execute CAS update + audit in transaction
    const now = time.nowISO();
    const isTerminal = MISSION_TERMINAL_STATES.has(to);

    // Derive tenant_id for audit trail
    const missionRow = conn.get<{ tenant_id: string | null }>(
      'SELECT tenant_id FROM core_missions WHERE id = ?',
      [mid],
    );
    const transitionTenantId = (missionRow?.tenant_id ?? null) as TenantId | null;

    try {
      conn.transaction(() => {
        // CAS: UPDATE WHERE id = ? AND state = ? — prevents TOCTOU
        const updateResult = conn.run(
          `UPDATE core_missions SET state = ?, updated_at = ?${isTerminal ? ', completed_at = ?' : ''} WHERE id = ? AND state = ?`,
          isTerminal ? [to, now, now, mid, from] : [to, now, mid, from],
        );

        if (updateResult.changes === 0) {
          // CAS failure: state was changed between validation and execution
          throw new CASFailure(`Mission ${mid} not in state ${from} — TOCTOU race`);
        }

        // I-03: Audit entry in same transaction
        audit.append(conn, {
          tenantId: transitionTenantId,
          actorType: 'system',
          actorId: 'orchestrator',
          operation: 'mission_transition',
          resourceType: 'mission',
          resourceId: mid,
          detail: { from, to, recovery: skipTransitionMapValidation },
        });
      });
    } catch (e) {
      if (e instanceof CASFailure) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: `Mission ${mid} CAS failed: not in expected state ${from}`,
            spec: 'S6',
          },
        };
      }
      throw e; // re-throw unexpected errors
    }

    // Step 5: Read-back verification
    // Defense-in-depth: In SQLite serialized mode (single-connection), the read-back
    // after CAS within the same transaction is unreachable because the UPDATE + WHERE
    // clause guarantees consistency. This check exists as a safety net for future
    // multi-connection scenarios (e.g., WAL with concurrent readers) where the CAS
    // guarantee could weaken. No test required — documented as defense-in-depth.
    const readBack = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?',
      [mid],
    );
    if (!readBack || readBack.state !== to) {
      return {
        ok: false,
        error: {
          code: 'LIFECYCLE_INVALID_TRANSITION',
          message: `Read-back mismatch: expected ${to}, got ${readBack?.state ?? 'null'}`,
          spec: 'S6',
        },
      };
    }

    return {
      ok: true,
      value: {
        fromState: from,
        toState: to,
        timestamp: now,
      },
    };
  }

  // ── Task transition (core logic) ──

  function transitionTaskCore(
    conn: DatabaseConnection,
    tid: TaskId,
    from: TaskState,
    to: TaskState,
    checkReviewingTrigger: boolean,
  ): Result<TransitionResult> {
    // Step 1: Validate transition is in task transition map
    const validTargets = TASK_TRANSITIONS[from];
    if (!validTargets.includes(to)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `Cannot transition task from ${from} to ${to}`,
          spec: 'S7',
        },
      };
    }

    // Step 2: Translate to governance types via backfill map
    const govMapping = TASK_STATE_BACKFILL_MAP[to];
    if (!govMapping) {
      return {
        ok: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: `No governance mapping for task state: ${to}`,
          spec: 'S7',
        },
      };
    }
    const govState: TaskLifecycleState = govMapping.state;

    // Step 3: Delegate to TransitionEnforcer for phantom/terminal/suspension checks
    const enforceResult = enforcer.enforceTaskTransition(
      conn,
      tid,
      govState,
    );
    if (!enforceResult.ok) {
      return enforceResult;
    }

    // Step 4: Execute CAS update + audit in transaction
    const now = time.nowISO();
    const isTerminal = TASK_TERMINAL_STATES.has(to);

    // Derive tenant_id for audit trail
    const taskRow = conn.get<{ tenant_id: string | null; mission_id: string }>(
      'SELECT tenant_id, mission_id FROM core_tasks WHERE id = ?',
      [tid],
    );
    const taskTenantId = (taskRow?.tenant_id ?? null) as TenantId | null;
    const parentMissionId = taskRow?.mission_id ?? null;

    try {
      conn.transaction(() => {
        // CAS: UPDATE WHERE id = ? AND state = ? — prevents TOCTOU
        const updateResult = conn.run(
          `UPDATE core_tasks SET state = ?, updated_at = ?${isTerminal ? ', completed_at = ?' : ''} WHERE id = ? AND state = ?`,
          isTerminal ? [to, now, now, tid, from] : [to, now, tid, from],
        );

        if (updateResult.changes === 0) {
          throw new CASFailure(`Task ${tid} not in state ${from} — TOCTOU race`);
        }

        // I-03: Audit entry in same transaction
        audit.append(conn, {
          tenantId: taskTenantId,
          actorType: 'system',
          actorId: 'orchestrator',
          operation: 'task_transition',
          resourceType: 'task',
          resourceId: tid,
          detail: { from, to },
        });

        // Flag 3 (REVIEWING trigger): If task transitioned to terminal state,
        // check if ALL tasks in the mission's active graph are terminal.
        // If yes, trigger EXECUTING → REVIEWING on the parent mission.
        if (checkReviewingTrigger && isTerminal && parentMissionId) {
          checkAndTriggerReviewing(conn, parentMissionId as MissionId, now, taskTenantId);
        }
      });
    } catch (e) {
      if (e instanceof CASFailure) {
        return {
          ok: false,
          error: {
            code: 'INVALID_TRANSITION',
            message: `Task ${tid} CAS failed: not in expected state ${from}`,
            spec: 'S7',
          },
        };
      }
      throw e; // re-throw unexpected errors
    }

    // Step 5: Read-back verification
    // Defense-in-depth: Unreachable in SQLite serialized mode (see mission read-back comment).
    // Safety net for future multi-connection scenarios.
    const readBack = conn.get<{ state: string }>(
      'SELECT state FROM core_tasks WHERE id = ?',
      [tid],
    );
    if (!readBack || readBack.state !== to) {
      return {
        ok: false,
        error: {
          code: 'LIFECYCLE_INVALID_TRANSITION',
          message: `Read-back mismatch: expected ${to}, got ${readBack?.state ?? 'null'}`,
          spec: 'S7',
        },
      };
    }

    return {
      ok: true,
      value: {
        fromState: from,
        toState: to,
        timestamp: now,
      },
    };
  }

  // ── REVIEWING trigger (Flag 3) ──

  /**
   * Flag 3: Check if all tasks in the mission's active graph are in terminal states.
   * If yes AND the mission is in EXECUTING state, trigger EXECUTING → REVIEWING.
   * Executes within the caller's transaction — no async gap.
   *
   * Spec derivation:
   *   S6: EXECUTING → REVIEWING is a valid transition
   *   S23: REVIEWING → COMPLETED via submit_result
   *   I-03: Audit in same transaction
   *   I-25: Deterministic, no async gaps
   */
  function checkAndTriggerReviewing(
    conn: DatabaseConnection,
    mid: MissionId,
    now: string,
    tenantId: TenantId | null,
  ): void {
    // Get current mission state
    const mission = conn.get<{ state: string }>(
      'SELECT state FROM core_missions WHERE id = ?',
      [mid],
    );

    // Only trigger from EXECUTING state
    if (!mission || mission.state !== 'EXECUTING') {
      return;
    }

    // Find the active task graph
    const graph = conn.get<{ id: string }>(
      'SELECT id FROM core_task_graphs WHERE mission_id = ? AND is_active = 1',
      [mid],
    );
    if (!graph) {
      return;
    }

    // Check if any non-terminal tasks remain
    const nonTerminalCount = conn.get<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM core_tasks WHERE graph_id = ? AND state NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')`,
      [graph.id],
    );

    if (nonTerminalCount && nonTerminalCount.cnt === 0) {
      // All tasks are terminal — trigger EXECUTING → REVIEWING
      const govMapping = MISSION_STATE_BACKFILL_MAP['REVIEWING'];
      if (!govMapping) return;

      // Governance enforcement for the mission transition
      const enforceResult = enforcer.enforceMissionTransition(
        conn,
        mid,
        govMapping.state,
        govMapping.substate ?? undefined,
      );

      // If governance rejects (e.g., suspended), do not transition — not an error for the task transition.
      // F-P0A-010: Emit audit entry so rejection is traceable (previously silent).
      if (!enforceResult.ok) {
        audit.append(conn, {
          tenantId,
          actorType: 'system',
          actorId: 'orchestrator',
          operation: 'reviewing_trigger_blocked',
          resourceType: 'mission',
          resourceId: mid,
          detail: { missionId: mid, reason: 'governance_rejection', enforceError: enforceResult.error },
        });
        return;
      }

      // CAS update for mission
      const updateResult = conn.run(
        `UPDATE core_missions SET state = 'REVIEWING', updated_at = ? WHERE id = ? AND state = 'EXECUTING'`,
        [now, mid],
      );

      if (updateResult.changes > 0) {
        // Audit the auto-transition
        audit.append(conn, {
          tenantId,
          actorType: 'system',
          actorId: 'orchestrator',
          operation: 'mission_transition',
          resourceType: 'mission',
          resourceId: mid,
          detail: { from: 'EXECUTING', to: 'REVIEWING', trigger: 'all_tasks_terminal' },
        });
      }
    }
  }

  // ── Public service object ──

  return Object.freeze({
    transitionMission(
      conn: DatabaseConnection,
      mid: MissionId,
      from: MissionState,
      to: MissionState,
    ): Result<TransitionResult> {
      return transitionMissionCore(conn, mid, from, to, false);
    },

    transitionTask(
      conn: DatabaseConnection,
      tid: TaskId,
      from: TaskState,
      to: TaskState,
    ): Result<TransitionResult> {
      return transitionTaskCore(conn, tid, from, to, true);
    },

    bulkTransitionTasks(
      conn: DatabaseConnection,
      tasks: Array<{ taskId: TaskId; from: TaskState; to: TaskState }>,
    ): Result<TransitionResult[]> {
      // Pre-validate all transitions before entering the transaction
      for (const t of tasks) {
        const validTargets = TASK_TRANSITIONS[t.from];
        if (!validTargets.includes(t.to)) {
          return {
            ok: false,
            error: {
              code: 'INVALID_TRANSITION',
              message: `Cannot transition task ${t.taskId} from ${t.from} to ${t.to}`,
              spec: 'S7',
            },
          };
        }
      }

      const results: TransitionResult[] = [];
      let error: { code: string; message: string; spec: string } | null = null;

      try {
        conn.transaction(() => {
          for (const t of tasks) {
            const now = time.nowISO();
            const isTerminal = TASK_TERMINAL_STATES.has(t.to);

            // Governance enforcement
            const govMapping = TASK_STATE_BACKFILL_MAP[t.to];
            if (!govMapping) {
              error = { code: 'INVALID_TRANSITION', message: `No governance mapping for task state: ${t.to}`, spec: 'S7' };
              throw new BulkAbort();
            }

            const enforceResult = enforcer.enforceTaskTransition(conn, t.taskId, govMapping.state);
            if (!enforceResult.ok) {
              error = enforceResult.error;
              throw new BulkAbort();
            }

            // CAS update
            const updateResult = conn.run(
              `UPDATE core_tasks SET state = ?, updated_at = ?${isTerminal ? ', completed_at = ?' : ''} WHERE id = ? AND state = ?`,
              isTerminal ? [t.to, now, now, t.taskId, t.from] : [t.to, now, t.taskId, t.from],
            );

            if (updateResult.changes === 0) {
              error = { code: 'INVALID_TRANSITION', message: `Task ${t.taskId} CAS failed: not in state ${t.from}`, spec: 'S7' };
              throw new BulkAbort();
            }

            // Derive tenant_id
            const taskRow = conn.get<{ tenant_id: string | null }>(
              'SELECT tenant_id FROM core_tasks WHERE id = ?',
              [t.taskId],
            );
            const taskTenantId = (taskRow?.tenant_id ?? null) as TenantId | null;

            // Audit
            audit.append(conn, {
              tenantId: taskTenantId,
              actorType: 'system',
              actorId: 'orchestrator',
              operation: 'task_transition',
              resourceType: 'task',
              resourceId: t.taskId,
              detail: { from: t.from, to: t.to, bulk: true },
            });

            results.push({
              fromState: t.from,
              toState: t.to,
              timestamp: now,
            });
          }

          // F-P0A-005: After all bulk transitions complete, check REVIEWING trigger
          // for each unique mission that had tasks transition to terminal states.
          // This must happen within the same transaction — no async gap.
          const missionsToCheck = new Set<string>();
          for (const t of tasks) {
            if (TASK_TERMINAL_STATES.has(t.to)) {
              const taskRow = conn.get<{ mission_id: string }>(
                'SELECT mission_id FROM core_tasks WHERE id = ?',
                [t.taskId],
              );
              if (taskRow?.mission_id) {
                missionsToCheck.add(taskRow.mission_id);
              }
            }
          }
          const now = time.nowISO();
          for (const mid of missionsToCheck) {
            // Derive tenant_id for audit (use first task's tenant)
            const firstTaskForMission = tasks.find(t => {
              const row = conn.get<{ mission_id: string }>(
                'SELECT mission_id FROM core_tasks WHERE id = ?', [t.taskId]);
              return row?.mission_id === mid;
            });
            let bulkTenantId: TenantId | null = null;
            if (firstTaskForMission) {
              const tRow = conn.get<{ tenant_id: string | null }>(
                'SELECT tenant_id FROM core_tasks WHERE id = ?', [firstTaskForMission.taskId]);
              bulkTenantId = (tRow?.tenant_id ?? null) as TenantId | null;
            }
            checkAndTriggerReviewing(conn, mid as MissionId, now, bulkTenantId);
          }
        });
      } catch (e) {
        if (e instanceof BulkAbort && error) {
          return { ok: false, error };
        }
        throw e; // re-throw unexpected errors
      }

      return { ok: true, value: results };
    },

    transitionMissionRecovery(
      conn: DatabaseConnection,
      mid: MissionId,
      from: MissionState,
      to: MissionState,
    ): Result<TransitionResult> {
      return transitionMissionCore(conn, mid, from, to, true);
    },
  });
}

// ─── Internal Error Types (not exported) ───

/** Sentinel for CAS failure within transaction — caught and translated to Result */
class CASFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CASFailure';
  }
}

/** Sentinel for bulk abort within transaction — caught and translated to Result */
class BulkAbort extends Error {
  constructor() {
    super('Bulk transition aborted');
    this.name = 'BulkAbort';
  }
}
