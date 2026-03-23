/**
 * Heartbeat Monitor implementation.
 * S ref: §25.5 (Heartbeat Protocol), FM-20 (Infinite Loops / Hung Workers)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: 30s default heartbeat interval with escalation ladder:
 *   1 miss = warn, 2 misses = notify orchestrator, 3 misses = kill worker + retry.
 *
 * Heartbeat state is colocated in core_task_queue (FPD-5/DL-2) to avoid JOINs
 * on the hot path per I-14.
 *
 * Invariants enforced: I-12 (execution timeout as defense-in-depth), I-14 (latency)
 * Failure modes defended: FM-20 (hung workers via escalation ladder)
 *
 * SYNC interface. All methods return Result<T>.
 */

import type { DatabaseConnection } from '../../kernel/interfaces/index.js';
import type {
  Result,
  TaskId,
  KernelError,
  OperationContext,
  AuditCreateInput,
} from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';

/**
 * Minimal audit dependency. Uses only the append method to keep coupling lightweight.
 * S ref: I-03 (every state mutation and its audit entry in same transaction)
 */
interface AuditDep {
  append(conn: DatabaseConnection, input: AuditCreateInput): Result<unknown>;
}
import type {
  HeartbeatMonitor,
  HeartbeatCheckResult,
  HeartbeatStatus,
} from '../interfaces/substrate.js';

// ─── Error Constructors ───

function err(code: string, message: string, spec: string): { ok: false; error: KernelError } {
  return { ok: false, error: { code, message, spec } };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ─── Heartbeat Monitor Factory ───

/**
 * Create a HeartbeatMonitor implementation.
 * S ref: §25.5, C-07 (Object.freeze)
 *
 * Heartbeat data is stored in core_task_queue columns:
 *   last_heartbeat_at, missed_heartbeats, heartbeat_interval_ms
 *
 * The checkCycle() method is designed to be called every polling interval
 * by the scheduler. It scans all RUNNING tasks and checks for missed heartbeats.
 */
export function createHeartbeatMonitor(audit?: AuditDep, time?: TimeProvider): HeartbeatMonitor {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };

  /** §25.5: Receive heartbeat from a running task */
  function receiveHeartbeat(conn: DatabaseConnection, taskId: TaskId, workerId: string): Result<void> {
    const now = clock.nowISO();

    // I-03: mutation + audit in same transaction
    const result = conn.transaction(() => {
      const r = conn.run(
        `UPDATE core_task_queue
         SET last_heartbeat_at = ?, missed_heartbeats = 0
         WHERE task_id = ? AND worker_id = ? AND status = 'RUNNING'`,
        [now, taskId, workerId]
      );

      if (r.changes > 0) {
        audit?.append(conn, {
          tenantId: null,
          actorType: 'system',
          actorId: 'substrate.heartbeat',
          operation: 'heartbeat.receive',
          resourceType: 'task',
          resourceId: taskId as string,
          detail: { workerId },
        });
      }

      return r;
    });

    if (result.changes === 0) {
      return err(
        'HEARTBEAT_TASK_NOT_FOUND',
        `No running task ${taskId} on worker ${workerId}`,
        '§25.5'
      );
    }

    return ok(undefined);
  }

  /**
   * §25.5: Check all running tasks for missed heartbeats.
   * Escalation ladder: 1 miss = warn, 2 = notify, 3 = kill.
   *
   * A heartbeat is "missed" if:
   *   now - last_heartbeat_at > heartbeat_interval_ms
   * OR if last_heartbeat_at is NULL and:
   *   now - started_at > heartbeat_interval_ms
   */
  function checkCycle(conn: DatabaseConnection, _ctx: OperationContext): Result<HeartbeatCheckResult> {
    const now = clock.nowMs();
    const warned: TaskId[] = [];
    const notified: TaskId[] = [];
    const killed: TaskId[] = [];

    // I-03, CQ-08: All heartbeat updates and audit entries are atomic
    conn.transaction(() => {
      // Get all RUNNING tasks
      const tasks = conn.query<{
        task_id: string;
        worker_id: string;
        heartbeat_interval_ms: number;
        last_heartbeat_at: string | null;
        started_at: string | null;
        missed_heartbeats: number;
      }>(
        `SELECT task_id, worker_id, heartbeat_interval_ms, last_heartbeat_at, started_at, missed_heartbeats
         FROM core_task_queue
         WHERE status = 'RUNNING'`
      );

      for (const task of tasks) {
        const lastBeat = task.last_heartbeat_at
          ? new Date(task.last_heartbeat_at).getTime()
          : (task.started_at ? new Date(task.started_at).getTime() : now);

        const elapsed = now - lastBeat;
        const intervalMs = task.heartbeat_interval_ms;

        if (elapsed <= intervalMs) {
          // Heartbeat is on time -- nothing to do
          continue;
        }

        // Calculate how many heartbeats have been missed
        const newMissed = task.missed_heartbeats + 1;

        // Update missed count
        conn.run(
          `UPDATE core_task_queue
           SET missed_heartbeats = ?
           WHERE task_id = ?`,
          [newMissed, task.task_id]
        );

        // I-03: audit heartbeat check mutation
        audit?.append(conn, {
          tenantId: null,
          actorType: 'scheduler',
          actorId: 'substrate.heartbeat',
          operation: 'heartbeat.check',
          resourceType: 'task',
          resourceId: task.task_id,
          detail: { missedCount: newMissed, workerId: task.worker_id, action: newMissed >= 3 ? 'kill' : newMissed === 2 ? 'notify' : 'warn' },
        });

        const taskId = task.task_id as TaskId;

        if (newMissed >= 3) {
          // §25.5: 3 misses = kill worker + mark for retry
          killed.push(taskId);
        } else if (newMissed === 2) {
          // §25.5: 2 misses = notify orchestrator
          notified.push(taskId);
        } else {
          // §25.5: 1 miss = warn
          warned.push(taskId);
        }
      }
    });

    return ok({ warned, notified, killed });
  }

  /** §25.5: Reset heartbeat counter for a task */
  function resetHeartbeat(conn: DatabaseConnection, taskId: TaskId): Result<void> {
    const now = clock.nowISO();

    // I-03: mutation + audit in same transaction
    conn.transaction(() => {
      conn.run(
        `UPDATE core_task_queue
         SET missed_heartbeats = 0, last_heartbeat_at = ?
         WHERE task_id = ?`,
        [now, taskId]
      );

      audit?.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'substrate.heartbeat',
        operation: 'heartbeat.reset',
        resourceType: 'task',
        resourceId: taskId as string,
        detail: { resetAt: now },
      });
    });

    return ok(undefined);
  }

  /** §25.5: Get heartbeat status for a task */
  function getStatus(conn: DatabaseConnection, taskId: TaskId): Result<HeartbeatStatus | null> {
    const row = conn.get<{
      task_id: string;
      worker_id: string | null;
      missed_heartbeats: number;
      last_heartbeat_at: string | null;
      heartbeat_interval_ms: number;
    }>(
      `SELECT task_id, worker_id, missed_heartbeats, last_heartbeat_at, heartbeat_interval_ms
       FROM core_task_queue
       WHERE task_id = ?`,
      [taskId]
    );

    if (!row || !row.worker_id) {
      return ok(null);
    }

    return ok({
      taskId: row.task_id as TaskId,
      workerId: row.worker_id,
      missedHeartbeats: row.missed_heartbeats,
      lastHeartbeatAt: row.last_heartbeat_at,
      heartbeatIntervalMs: row.heartbeat_interval_ms,
    });
  }

  const monitor: HeartbeatMonitor = {
    receiveHeartbeat,
    checkCycle,
    resetHeartbeat,
    getStatus,
  };

  return Object.freeze(monitor);
}
