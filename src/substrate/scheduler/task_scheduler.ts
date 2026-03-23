/**
 * Task Scheduler implementation.
 * S ref: §25.1 (Task Scheduler), §25.7 (Queue Cleanup, Worker Exhaustion)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: SQLite-backed priority queue with three configurable policies,
 *             100ms polling interval, enqueue/dequeue semantics, task lifecycle
 *             management, cleanup, and backpressure.
 *
 * Three scheduling policies per §25.1:
 *   - 'fifo': First-in-first-out by created_at
 *   - 'priority': Lower priority integer = higher execution priority
 *   - 'deadline': Tasks from missions closest to deadline get priority
 *     (Approximated by priority since deadline info comes from orchestration layer)
 *
 * Invariants enforced: I-03 (audit in same transaction), I-05 (transactional), I-14 (latency)
 * Failure modes defended: FM-20 (heartbeat columns), backpressure (§25.7)
 *
 * SYNC interface. All methods return Result<T>.
 */

import type { DatabaseConnection } from '../../kernel/interfaces/index.js';
import type {
  Result,
  TaskId,
  MissionId,
  KernelError,
  OperationContext,
  AuditCreateInput,
} from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type {
  TaskScheduler,
  PriorityPolicy,
  EnqueueRequest,
  QueuedTask,
  QueueStats,
  CapabilityType,
} from '../interfaces/substrate.js';

/**
 * Minimal audit dependency. Uses only the append method to keep coupling lightweight.
 * S ref: I-03 (every state mutation and its audit entry in same transaction)
 */
interface AuditDep {
  append(conn: DatabaseConnection, input: AuditCreateInput): Result<unknown>;
}

// ─── Error Constructors ───

function err(code: string, message: string, spec: string): { ok: false; error: KernelError } {
  return { ok: false, error: { code, message, spec } };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ─── Constants ───

/** §25.7: Maximum queue depth for backpressure */
const MAX_QUEUE_DEPTH = 1000;

// ─── Task Scheduler Factory ───

/**
 * Create a TaskScheduler implementation.
 * S ref: §25.1, C-07 (Object.freeze), I-03 (audit in same transaction)
 */
export function createTaskScheduler(audit?: AuditDep, time?: TimeProvider): TaskScheduler {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };

  /** §25.1: Enqueue a task for execution */
  function enqueue(conn: DatabaseConnection, _ctx: OperationContext, request: EnqueueRequest): Result<void> {
    // F-02: Input validation
    if (!request.taskId || typeof request.taskId !== 'string' || request.taskId.trim() === '') {
      return err('INVALID_INPUT', 'taskId must be a non-empty string', '§25.1');
    }
    if (typeof request.priority !== 'number' || !Number.isFinite(request.priority) || !Number.isInteger(request.priority) || request.priority < 0) {
      return err('INVALID_INPUT', 'priority must be a finite integer >= 0', '§25.1');
    }
    if (request.timeoutMs !== undefined && (typeof request.timeoutMs !== 'number' || request.timeoutMs <= 0)) {
      return err('INVALID_INPUT', 'timeoutMs must be > 0 if provided', '§25.1');
    }

    // §25.7: Backpressure check
    const depthRow = conn.get<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM core_task_queue'
    );
    const depth = depthRow?.cnt ?? 0;

    if (depth >= MAX_QUEUE_DEPTH) {
      return err(
        'WORKER_UNAVAILABLE',
        `Queue depth ${depth} exceeds maxQueueDepth ${MAX_QUEUE_DEPTH}`,
        '§25.7'
      );
    }

    const now = clock.nowISO();

    // F-10: scheduled_at is NULL for PENDING tasks. It is set when poll()
    // transitions PENDING -> SCHEDULED. This correctly reflects the semantics:
    // a task is not "scheduled" until it is picked up by the scheduler.
    // I-03: mutation + audit in same transaction
    conn.transaction(() => {
      conn.run(
        `INSERT INTO core_task_queue
          (task_id, mission_id, tenant_id, agent_id, priority, status, execution_mode,
           scheduled_at, retry_count, max_retries, timeout_ms, heartbeat_interval_ms,
           estimated_tokens, capabilities_required, payload, created_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?)`,
        [
          request.taskId,
          request.missionId,
          request.tenantId,
          request.agentId,
          request.priority,
          request.executionMode,
          request.maxRetries ?? 2,
          request.timeoutMs ?? 300000,
          request.heartbeatIntervalMs ?? 30000,
          request.estimatedTokens ?? null,
          JSON.stringify(request.capabilitiesRequired),
          JSON.stringify(request.payload),
          now,
        ]
      );

      audit?.append(conn, {
        tenantId: request.tenantId,
        actorType: 'system',
        actorId: 'substrate.scheduler',
        operation: 'task.enqueue',
        resourceType: 'task',
        resourceId: request.taskId as string,
        detail: { missionId: request.missionId, priority: request.priority },
      });
    });

    return ok(undefined);
  }

  /**
   * §25.1: Poll for the next available task.
   * Selection depends on the active policy:
   *   - 'fifo': ORDER BY created_at ASC
   *   - 'priority': ORDER BY priority ASC (lower = higher)
   *   - 'deadline': ORDER BY priority ASC (proxy for deadline urgency)
   *
   * Atomically transitions PENDING -> SCHEDULED.
   */
  function poll(conn: DatabaseConnection, policy: PriorityPolicy): Result<QueuedTask | null> {
    let orderClause: string;
    switch (policy) {
      case 'fifo':
        orderClause = 'ORDER BY created_at ASC';
        break;
      case 'priority':
        orderClause = 'ORDER BY priority ASC, created_at ASC';
        break;
      case 'deadline':
        // Deadline info comes from orchestration; we approximate with priority
        orderClause = 'ORDER BY priority ASC, created_at ASC';
        break;
      default:
        orderClause = 'ORDER BY priority ASC, created_at ASC';
    }

    const result = conn.transaction(() => {
      const row = conn.get<{
        task_id: string;
        mission_id: string;
        tenant_id: string | null;
        agent_id: string;
        priority: number;
        execution_mode: string;
        estimated_tokens: number | null;
        capabilities_required: string;
        payload: string;
        max_retries: number;
        timeout_ms: number;
        heartbeat_interval_ms: number;
        retry_count: number;
      }>(
        `SELECT task_id, mission_id, tenant_id, agent_id, priority, execution_mode,
                estimated_tokens, capabilities_required, payload, max_retries,
                timeout_ms, heartbeat_interval_ms, retry_count
         FROM core_task_queue
         WHERE status = 'PENDING'
         ${orderClause}
         LIMIT 1`
      );

      if (!row) return null;

      // Atomic transition PENDING -> SCHEDULED
      conn.run(
        `UPDATE core_task_queue SET status = 'SCHEDULED', scheduled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE task_id = ? AND status = 'PENDING'`,
        [row.task_id]
      );

      // I-03: audit in same transaction as state mutation
      audit?.append(conn, {
        tenantId: (row.tenant_id as any) ?? null, // lint-allow: as any — SQLite row typing
        actorType: 'scheduler',
        actorId: 'substrate.scheduler',
        operation: 'task.schedule',
        resourceType: 'task',
        resourceId: row.task_id,
        detail: { policy, missionId: row.mission_id },
      });

      return row;
    });

    if (!result) {
      return ok(null);
    }

    let capabilities: readonly CapabilityType[];
    try {
      capabilities = JSON.parse(result.capabilities_required);
    } catch {
      capabilities = [];
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(result.payload);
    } catch {
      payload = {};
    }

    return ok({
      taskId: result.task_id as TaskId,
      missionId: result.mission_id as MissionId,
      tenantId: result.tenant_id as any, // lint-allow: as any — SQLite row typing
      agentId: result.agent_id as any, // lint-allow: as any — SQLite row typing
      priority: result.priority,
      executionMode: result.execution_mode as 'deterministic' | 'stochastic' | 'hybrid',
      estimatedTokens: result.estimated_tokens,
      capabilitiesRequired: capabilities,
      payload,
      maxRetries: result.max_retries,
      timeoutMs: result.timeout_ms,
      heartbeatIntervalMs: result.heartbeat_interval_ms,
      retryCount: result.retry_count,
    });
  }

  /** §25.1: Mark a task as running with assigned worker */
  function markRunning(conn: DatabaseConnection, _ctx: OperationContext, taskId: TaskId, workerId: string): Result<void> {
    const now = clock.nowISO();

    // I-03: mutation + audit in same transaction
    const result = conn.transaction(() => {
      const r = conn.run(
        `UPDATE core_task_queue
         SET status = 'RUNNING', started_at = ?, worker_id = ?, last_heartbeat_at = ?
         WHERE task_id = ? AND status = 'SCHEDULED'`,
        [now, workerId, now, taskId]
      );

      if (r.changes > 0) {
        audit?.append(conn, {
          tenantId: null,
          actorType: 'system',
          actorId: 'substrate.scheduler',
          operation: 'task.start',
          resourceType: 'task',
          resourceId: taskId as string,
          detail: { workerId },
        });
      }

      return r;
    });

    if (result.changes === 0) {
      return err(
        'TASK_NOT_SCHEDULED',
        `Task ${taskId} is not in SCHEDULED state`,
        '§25.1'
      );
    }

    return ok(undefined);
  }

  /** §25.1: Complete a task (archive + remove from queue) */
  function complete(conn: DatabaseConnection, _ctx: OperationContext, taskId: TaskId): Result<void> {
    conn.transaction(() => {
      const task = conn.get<{
        task_id: string;
        mission_id: string;
        tenant_id: string | null;
        agent_id: string;
        execution_mode: string;
        retry_count: number;
        worker_id: string | null;
        started_at: string | null;
        created_at: string;
      }>(
        `SELECT task_id, mission_id, tenant_id, agent_id, execution_mode, retry_count,
                worker_id, started_at, created_at
         FROM core_task_queue WHERE task_id = ?`,
        [taskId]
      );

      if (!task) return;

      // Archive with COMPLETED status
      conn.run(
        `INSERT OR REPLACE INTO core_task_archive
          (task_id, mission_id, tenant_id, agent_id, final_status, execution_mode,
           retry_count, worker_id, started_at, completed_at, created_at)
         VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)`,
        [
          task.task_id,
          task.mission_id,
          task.tenant_id,
          task.agent_id,
          task.execution_mode,
          task.retry_count,
          task.worker_id,
          task.started_at,
          task.created_at,
        ]
      );

      // Remove from active queue
      conn.run('DELETE FROM core_task_queue WHERE task_id = ?', [taskId]);

      // I-03: audit in same transaction
      audit?.append(conn, {
        tenantId: (task.tenant_id as any) ?? null, // lint-allow: as any — SQLite row typing
        actorType: 'system',
        actorId: 'substrate.scheduler',
        operation: 'task.complete',
        resourceType: 'task',
        resourceId: taskId as string,
        detail: { missionId: task.mission_id },
      });
    });

    return ok(undefined);
  }

  /** §25.1: Fail a task (archive with error details) */
  function fail(conn: DatabaseConnection, _ctx: OperationContext, taskId: TaskId, errorCode: string, errorMessage: string, errorDetail?: string): Result<void> {
    conn.transaction(() => {
      const task = conn.get<{
        task_id: string;
        mission_id: string;
        tenant_id: string | null;
        agent_id: string;
        execution_mode: string;
        retry_count: number;
        max_retries: number;
        worker_id: string | null;
        started_at: string | null;
        created_at: string;
      }>(
        `SELECT task_id, mission_id, tenant_id, agent_id, execution_mode, retry_count,
                max_retries, worker_id, started_at, created_at
         FROM core_task_queue WHERE task_id = ?`,
        [taskId]
      );

      if (!task) return;

      // Check if task should be retried (§25.2: retry if retryCount < maxRetries)
      if (task.retry_count < task.max_retries) {
        // Re-enqueue with incremented retry count
        conn.run(
          `UPDATE core_task_queue
           SET status = 'PENDING', worker_id = NULL, started_at = NULL,
               allocated_at = NULL, retry_count = ?, missed_heartbeats = 0,
               last_heartbeat_at = NULL,
               scheduled_at = NULL
           WHERE task_id = ?`,
          [task.retry_count + 1, taskId]
        );
      } else {
        // Permanently fail -- archive
        conn.run(
          `INSERT OR REPLACE INTO core_task_archive
            (task_id, mission_id, tenant_id, agent_id, final_status, execution_mode,
             retry_count, worker_id, started_at, completed_at, error_code,
             error_message, error_detail, created_at)
           VALUES (?, ?, ?, ?, 'FAILED', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, ?, ?, ?)`,
          [
            task.task_id,
            task.mission_id,
            task.tenant_id,
            task.agent_id,
            task.execution_mode,
            task.retry_count,
            task.worker_id,
            task.started_at,
            errorCode,
            errorMessage,
            errorDetail ?? null,
            task.created_at,
          ]
        );

        conn.run('DELETE FROM core_task_queue WHERE task_id = ?', [taskId]);
      }

      // I-03: audit in same transaction (covers both retry and permanent fail paths)
      audit?.append(conn, {
        tenantId: (task.tenant_id as any) ?? null, // lint-allow: as any — SQLite row typing
        actorType: 'system',
        actorId: 'substrate.scheduler',
        operation: 'task.fail',
        resourceType: 'task',
        resourceId: taskId as string,
        detail: {
          missionId: task.mission_id,
          errorCode,
          retryCount: task.retry_count,
          maxRetries: task.max_retries,
          retried: task.retry_count < task.max_retries,
        },
      });
    });

    return ok(undefined);
  }

  /** §25.1: Cancel a task */
  function cancel(conn: DatabaseConnection, _ctx: OperationContext, taskId: TaskId): Result<void> {
    conn.transaction(() => {
      const task = conn.get<{
        task_id: string;
        mission_id: string;
        tenant_id: string | null;
        agent_id: string;
        execution_mode: string;
        retry_count: number;
        worker_id: string | null;
        started_at: string | null;
        created_at: string;
      }>(
        `SELECT task_id, mission_id, tenant_id, agent_id, execution_mode, retry_count,
                worker_id, started_at, created_at
         FROM core_task_queue WHERE task_id = ?`,
        [taskId]
      );

      if (!task) return;

      // Archive as CANCELLED
      conn.run(
        `INSERT OR REPLACE INTO core_task_archive
          (task_id, mission_id, tenant_id, agent_id, final_status, execution_mode,
           retry_count, worker_id, started_at, completed_at, created_at)
         VALUES (?, ?, ?, ?, 'CANCELLED', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)`,
        [
          task.task_id,
          task.mission_id,
          task.tenant_id,
          task.agent_id,
          task.execution_mode,
          task.retry_count,
          task.worker_id,
          task.started_at,
          task.created_at,
        ]
      );

      conn.run('DELETE FROM core_task_queue WHERE task_id = ?', [taskId]);

      // I-03: audit in same transaction
      audit?.append(conn, {
        tenantId: (task.tenant_id as any) ?? null, // lint-allow: as any — SQLite row typing
        actorType: 'system',
        actorId: 'substrate.scheduler',
        operation: 'task.cancel',
        resourceType: 'task',
        resourceId: taskId as string,
        detail: { missionId: task.mission_id },
      });
    });

    return ok(undefined);
  }

  /** §25.7: Bulk-cancel all tasks for a mission */
  function cancelMissionTasks(conn: DatabaseConnection, _ctx: OperationContext, missionId: MissionId): Result<{ cancelled: number }> {
    let cancelled = 0;

    conn.transaction(() => {
      // Get all PENDING tasks for this mission
      const tasks = conn.query<{
        task_id: string;
        mission_id: string;
        tenant_id: string | null;
        agent_id: string;
        execution_mode: string;
        retry_count: number;
        worker_id: string | null;
        started_at: string | null;
        created_at: string;
      }>(
        `SELECT task_id, mission_id, tenant_id, agent_id, execution_mode, retry_count,
                worker_id, started_at, created_at
         FROM core_task_queue WHERE mission_id = ? AND status = 'PENDING'`,
        [missionId]
      );

      for (const task of tasks) {
        conn.run(
          `INSERT OR REPLACE INTO core_task_archive
            (task_id, mission_id, tenant_id, agent_id, final_status, execution_mode,
             retry_count, worker_id, started_at, completed_at, created_at)
           VALUES (?, ?, ?, ?, 'CANCELLED', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?)`,
          [
            task.task_id,
            task.mission_id,
            task.tenant_id,
            task.agent_id,
            task.execution_mode,
            task.retry_count,
            task.worker_id,
            task.started_at,
            task.created_at,
          ]
        );
      }

      const result = conn.run(
        `DELETE FROM core_task_queue WHERE mission_id = ? AND status = 'PENDING'`,
        [missionId]
      );

      cancelled = result.changes;

      // I-03: audit bulk cancellation in same transaction
      if (cancelled > 0) {
        audit?.append(conn, {
          tenantId: null,
          actorType: 'system',
          actorId: 'substrate.scheduler',
          operation: 'task.cancel_mission',
          resourceType: 'mission',
          resourceId: missionId as string,
          detail: { cancelled },
        });
      }
    });

    return ok({ cancelled });
  }

  /** §32.4: Get queue statistics */
  function getStats(conn: DatabaseConnection): Result<QueueStats> {
    const row = conn.get<{
      pending: number;
      scheduled: number;
      running: number;
      total: number;
    }>(
      `SELECT
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'SCHEDULED' THEN 1 ELSE 0 END) as scheduled,
        SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running,
        COUNT(*) as total
       FROM core_task_queue`
    );

    if (!row) {
      return ok({ pending: 0, scheduled: 0, running: 0, total: 0 });
    }

    return ok({
      pending: row.pending ?? 0,
      scheduled: row.scheduled ?? 0,
      running: row.running ?? 0,
      total: row.total ?? 0,
    });
  }

  /**
   * §25.7: Cleanup stale tasks.
   * - Archive stale RUNNING tasks that have exceeded their timeout
   * - Cancel orphaned PENDING tasks older than 24 hours (prevents indefinite queue growth)
   */
  function cleanup(conn: DatabaseConnection, _ctx: OperationContext): Result<{ archived: number; orphansCancelled: number }> {
    let archived = 0;
    let orphansCancelled = 0;

    conn.transaction(() => {
      // Archive stale RUNNING tasks that have exceeded their timeout
      const staleTasks = conn.query<{
        task_id: string;
        mission_id: string;
        tenant_id: string | null;
        agent_id: string;
        execution_mode: string;
        retry_count: number;
        worker_id: string | null;
        started_at: string | null;
        timeout_ms: number;
        created_at: string;
      }>(
        `SELECT task_id, mission_id, tenant_id, agent_id, execution_mode, retry_count,
                worker_id, started_at, timeout_ms, created_at
         FROM core_task_queue
         WHERE status = 'RUNNING'
         AND started_at IS NOT NULL
         AND (julianday('now') - julianday(started_at)) * 86400000 > timeout_ms`
      );

      for (const task of staleTasks) {
        conn.run(
          `INSERT OR REPLACE INTO core_task_archive
            (task_id, mission_id, tenant_id, agent_id, final_status, execution_mode,
             retry_count, worker_id, started_at, completed_at, error_code,
             error_message, created_at)
           VALUES (?, ?, ?, ?, 'FAILED', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                   'EXECUTION_TIMEOUT', 'Task exceeded timeout', ?)`,
          [
            task.task_id,
            task.mission_id,
            task.tenant_id,
            task.agent_id,
            task.execution_mode,
            task.retry_count,
            task.worker_id,
            task.started_at,
            task.created_at,
          ]
        );
        conn.run('DELETE FROM core_task_queue WHERE task_id = ?', [task.task_id]);
        archived++;
      }

      // §25.7: Cancel orphaned PENDING tasks older than 24 hours.
      // Prevents indefinite queue growth — matches §25.7 "FAILED tasks remain for 24 hours" semantics.
      const orphanedTasks = conn.query<{
        task_id: string;
        mission_id: string;
        tenant_id: string | null;
        agent_id: string;
        execution_mode: string;
        retry_count: number;
        worker_id: string | null;
        started_at: string | null;
        created_at: string;
      }>(
        `SELECT task_id, mission_id, tenant_id, agent_id, execution_mode, retry_count,
                worker_id, started_at, created_at
         FROM core_task_queue
         WHERE status = 'PENDING'
         AND (julianday('now') - julianday(created_at)) * 86400000 > 86400000`
      );

      for (const task of orphanedTasks) {
        conn.run(
          `INSERT OR REPLACE INTO core_task_archive
            (task_id, mission_id, tenant_id, agent_id, final_status, execution_mode,
             retry_count, worker_id, started_at, completed_at, error_code,
             error_message, created_at)
           VALUES (?, ?, ?, ?, 'CANCELLED', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                   'ORPHAN_TIMEOUT', 'PENDING task exceeded 24-hour queue age limit', ?)`,
          [
            task.task_id,
            task.mission_id,
            task.tenant_id,
            task.agent_id,
            task.execution_mode,
            task.retry_count,
            task.worker_id,
            task.started_at,
            task.created_at,
          ]
        );
        conn.run('DELETE FROM core_task_queue WHERE task_id = ?', [task.task_id]);
        orphansCancelled++;
      }

      // I-03: audit cleanup mutations in same transaction
      if (archived > 0 || orphansCancelled > 0) {
        audit?.append(conn, {
          tenantId: null,
          actorType: 'system',
          actorId: 'substrate.scheduler',
          operation: 'task.cleanup',
          resourceType: 'task_queue',
          resourceId: 'cleanup',
          detail: { archived, orphansCancelled },
        });
      }
    });

    return ok({ archived, orphansCancelled });
  }

  const scheduler: TaskScheduler = {
    enqueue,
    poll,
    markRunning,
    complete,
    fail,
    cancel,
    cancelMissionTasks,
    getStats,
    cleanup,
  };

  return Object.freeze(scheduler);
}
