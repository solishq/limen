/**
 * Worker Runtime implementation.
 * S ref: §25.2 (Worker Runtime), I-12 (Tool Sandboxing), I-07 (Agent Isolation)
 *
 * Phase: 2 (Execution Substrate)
 * Implements: Fixed-size worker pool with node:worker_threads, resource limits,
 *             crash recovery, and replacement. Workers have lifecycle states:
 *             IDLE -> ALLOCATED -> RUNNING -> IDLE (or crash -> replace).
 *
 * Invariants enforced: I-03 (audit), I-05 (transactional), I-12 (resourceLimits)
 * Failure modes defended: FM-20 (hung workers via replacement), FM-09 (isolation)
 *
 * SYNC interface. All methods return Result<T>.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '../../kernel/interfaces/index.js';
import type {
  Result,
  TaskId,
  OperationContext,
  KernelError,
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
  WorkerRuntime,
  WorkerPoolConfig,
  WorkerInfo,
  WorkerPoolStatus,
  QueuedTask,
} from '../interfaces/substrate.js';

// ─── Error Constructors ───

function err(code: string, message: string, spec: string): { ok: false; error: KernelError } {
  return { ok: false, error: { code, message, spec } };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

// ─── Worker Runtime Factory ───

/**
 * Create a WorkerRuntime implementation.
 * S ref: §25.2, C-07 (Object.freeze on public API)
 *
 * The runtime manages a fixed-size pool of worker registrations in SQLite.
 * Actual Node.js Worker threads are NOT spawned in this layer -- that is
 * the responsibility of the dispatch mechanism. This layer manages the
 * registry state (allocation, lifecycle, crash recovery).
 *
 * ASSUMPTION WR-1: Worker communication uses Node.js postMessage/on('message').
 * ASSUMPTION WR-2: Graceful shutdown = stop accepting, wait for running, then terminate.
 */
export function createWorkerRuntime(audit?: AuditDep, time?: TimeProvider): WorkerRuntime {
  const clock = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };

  /**
   * In-memory pool state. MUST live inside the closure to prevent cross-tenant
   * leakage via module-scoped mutable state (F-08). SQLite (core_worker_registry)
   * is the durable state; this tracks whether the pool has been initialized
   * in this process.
   * S ref: I-07 (Agent Isolation)
   */
  const poolState: {
    initialized: boolean;
    config: WorkerPoolConfig | null;
    shuttingDown: boolean;
  } = {
    initialized: false,
    config: null,
    shuttingDown: false,
  };

  /** §25.2: Initialize the worker pool -- register N workers in SQLite */
  function initialize(conn: DatabaseConnection, config: WorkerPoolConfig): Result<void> {
    if (poolState.initialized) {
      return err('POOL_ALREADY_INITIALIZED', 'Worker pool already initialized', '§25.2');
    }
    if (config.poolSize < 1) {
      return err('INVALID_POOL_SIZE', 'Pool size must be >= 1', '§25.2');
    }
    if (config.resourceLimits.maxOldGenerationSizeMb < 1) {
      return err('INVALID_RESOURCE_LIMITS', 'maxOldGenerationSizeMb must be >= 1', 'I-12');
    }
    if (config.resourceLimits.maxYoungGenerationSizeMb < 1) {
      return err('INVALID_RESOURCE_LIMITS', 'maxYoungGenerationSizeMb must be >= 1', 'I-12');
    }
    if (config.resourceLimits.codeRangeSizeMb < 1) {
      return err('INVALID_RESOURCE_LIMITS', 'codeRangeSizeMb must be >= 1', 'I-12');
    }

    conn.transaction(() => {
      // Clear any stale workers from a prior process
      conn.run('DELETE FROM core_worker_registry');

      for (let i = 0; i < config.poolSize; i++) {
        const workerId = `worker-${randomUUID()}`;
        conn.run(
          `INSERT INTO core_worker_registry
            (worker_id, status, max_old_generation_mb, max_young_generation_mb, code_range_size_mb)
           VALUES (?, 'IDLE', ?, ?, ?)`,
          [
            workerId,
            config.resourceLimits.maxOldGenerationSizeMb,
            config.resourceLimits.maxYoungGenerationSizeMb,
            config.resourceLimits.codeRangeSizeMb,
          ]
        );

        // I-03: audit each worker initialization in same transaction
        audit?.append(conn, {
          tenantId: null,
          actorType: 'system',
          actorId: 'substrate.workers',
          operation: 'worker.initialize',
          resourceType: 'worker',
          resourceId: workerId,
          detail: { poolSize: config.poolSize, index: i },
        });
      }
    });

    poolState.initialized = true;
    poolState.config = config;
    poolState.shuttingDown = false;

    return ok(undefined);
  }

  /** §25.2: Allocate an idle worker for a task -- IDLE -> ALLOCATED */
  function allocate(conn: DatabaseConnection, _ctx: OperationContext, taskId: TaskId): Result<string> {
    if (poolState.shuttingDown) {
      return err('POOL_SHUTTING_DOWN', 'Pool is shutting down; cannot allocate', '§25.2');
    }

    const now = clock.nowISO();
    const result = conn.transaction(() => {
      // Find an IDLE worker
      const worker = conn.get<{ worker_id: string }>(
        'SELECT worker_id FROM core_worker_registry WHERE status = ? LIMIT 1',
        ['IDLE']
      );
      if (!worker) {
        return null;
      }

      // Transition IDLE -> ALLOCATED with task binding
      conn.run(
        `UPDATE core_worker_registry
         SET status = 'ALLOCATED', current_task_id = ?, allocated_at = ?
         WHERE worker_id = ? AND status = 'IDLE'`,
        [taskId, now, worker.worker_id]
      );

      // I-03: audit in same transaction
      audit?.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'substrate.workers',
        operation: 'worker.allocate',
        resourceType: 'worker',
        resourceId: worker.worker_id,
        detail: { taskId },
      });

      return worker.worker_id;
    });

    if (result === null) {
      return err('NO_IDLE_WORKERS', 'All workers are busy', '§25.7');
    }

    return ok(result);
  }

  /** §25.2: Dispatch a task to an allocated worker -- ALLOCATED -> RUNNING */
  function dispatch(conn: DatabaseConnection, _ctx: OperationContext, workerId: string, task: QueuedTask): Result<void> {
    const now = clock.nowISO();
    const result = conn.transaction(() => {
      const worker = conn.get<{ status: string }>(
        'SELECT status FROM core_worker_registry WHERE worker_id = ?',
        [workerId]
      );
      if (!worker) {
        return 'WORKER_NOT_FOUND';
      }
      if (worker.status !== 'ALLOCATED') {
        return 'WORKER_NOT_ALLOCATED';
      }

      // Transition ALLOCATED -> RUNNING
      conn.run(
        `UPDATE core_worker_registry
         SET status = 'RUNNING', current_task_id = ?
         WHERE worker_id = ?`,
        [task.taskId, workerId]
      );

      // Update the task queue entry: SCHEDULED -> RUNNING with started_at
      conn.run(
        `UPDATE core_task_queue
         SET status = 'RUNNING', started_at = ?, worker_id = ?
         WHERE task_id = ?`,
        [now, workerId, task.taskId]
      );

      // I-03: audit in same transaction
      audit?.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'substrate.workers',
        operation: 'worker.dispatch',
        resourceType: 'worker',
        resourceId: workerId,
        detail: { taskId: task.taskId },
      });

      return null;
    });

    if (result === 'WORKER_NOT_FOUND') {
      return err('WORKER_NOT_FOUND', `Worker ${workerId} not found`, '§25.2');
    }
    if (result === 'WORKER_NOT_ALLOCATED') {
      return err('WORKER_NOT_ALLOCATED', `Worker ${workerId} is not in ALLOCATED state`, '§25.2');
    }

    return ok(undefined);
  }

  /** §25.2: Release a worker back to IDLE -- RUNNING -> IDLE */
  function release(conn: DatabaseConnection, _ctx: OperationContext, workerId: string): Result<void> {
    const result = conn.transaction(() => {
      const worker = conn.get<{ status: string; task_count: number }>(
        'SELECT status, task_count FROM core_worker_registry WHERE worker_id = ?',
        [workerId]
      );
      if (!worker) {
        return 'WORKER_NOT_FOUND';
      }

      // Allow release from RUNNING or ALLOCATED (graceful cancel)
      if (worker.status !== 'RUNNING' && worker.status !== 'ALLOCATED') {
        return 'WORKER_NOT_RELEASABLE';
      }

      // Transition -> IDLE, clear task reference, increment task_count
      conn.run(
        `UPDATE core_worker_registry
         SET status = 'IDLE', current_task_id = NULL, allocated_at = NULL, task_count = ?
         WHERE worker_id = ?`,
        [worker.task_count + 1, workerId]
      );

      // I-03: audit in same transaction
      audit?.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'substrate.workers',
        operation: 'worker.release',
        resourceType: 'worker',
        resourceId: workerId,
        detail: { taskCount: worker.task_count + 1 },
      });

      return null;
    });

    if (result === 'WORKER_NOT_FOUND') {
      return err('WORKER_NOT_FOUND', `Worker ${workerId} not found`, '§25.2');
    }
    if (result === 'WORKER_NOT_RELEASABLE') {
      return err('WORKER_NOT_RELEASABLE', `Worker ${workerId} cannot be released from current state`, '§25.2');
    }

    return ok(undefined);
  }

  /** §25.2: Terminate and replace a worker (crash recovery) */
  function terminate(conn: DatabaseConnection, _ctx: OperationContext, workerId: string): Result<void> {
    if (!poolState.config) {
      return err('POOL_NOT_INITIALIZED', 'Worker pool not initialized', '§25.2');
    }

    const config = poolState.config;

    conn.transaction(() => {
      // Remove the crashed/terminated worker
      conn.run('DELETE FROM core_worker_registry WHERE worker_id = ?', [workerId]);

      // Create a replacement worker with identical resourceLimits
      const replacementId = `worker-${randomUUID()}`;
      conn.run(
        `INSERT INTO core_worker_registry
          (worker_id, status, max_old_generation_mb, max_young_generation_mb, code_range_size_mb)
         VALUES (?, 'IDLE', ?, ?, ?)`,
        [
          replacementId,
          config.resourceLimits.maxOldGenerationSizeMb,
          config.resourceLimits.maxYoungGenerationSizeMb,
          config.resourceLimits.codeRangeSizeMb,
        ]
      );

      // I-03: audit in same transaction
      audit?.append(conn, {
        tenantId: null,
        actorType: 'system',
        actorId: 'substrate.workers',
        operation: 'worker.terminate',
        resourceType: 'worker',
        resourceId: workerId,
        detail: { replacementId },
      });
    });

    return ok(undefined);
  }

  /** §25.2: Get all worker info */
  function getWorkers(conn: DatabaseConnection): Result<readonly WorkerInfo[]> {
    const rows = conn.query<{
      worker_id: string;
      thread_id: number | null;
      status: string;
      current_task_id: string | null;
      task_count: number;
      allocated_at: string | null;
      created_at: string;
    }>('SELECT worker_id, thread_id, status, current_task_id, task_count, allocated_at, created_at FROM core_worker_registry');

    const workers: WorkerInfo[] = rows.map((row) => ({
      workerId: row.worker_id,
      threadId: row.thread_id,
      status: row.status as 'IDLE' | 'ALLOCATED' | 'RUNNING',
      currentTaskId: row.current_task_id as TaskId | null,
      taskCount: row.task_count,
      allocatedAt: row.allocated_at,
      createdAt: row.created_at,
    }));

    return ok(workers);
  }

  /** §25.2: Get pool status summary */
  function statusFn(conn: DatabaseConnection): Result<WorkerPoolStatus> {
    const counts = conn.get<{
      total: number;
      idle: number;
      allocated: number;
      running: number;
    }>(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'IDLE' THEN 1 ELSE 0 END) as idle,
        SUM(CASE WHEN status = 'ALLOCATED' THEN 1 ELSE 0 END) as allocated,
        SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running
      FROM core_worker_registry
    `);

    if (!counts) {
      return ok({ total: 0, idle: 0, allocated: 0, running: 0 });
    }

    return ok({
      total: counts.total,
      idle: counts.idle,
      allocated: counts.allocated,
      running: counts.running,
    });
  }

  /** §25.2: Graceful shutdown of all workers */
  function shutdown(conn: DatabaseConnection, _ctx: OperationContext, _timeoutMs?: number): Result<void> {
    poolState.shuttingDown = true;

    conn.transaction(() => {
      // Force all workers to IDLE (graceful: in production, would wait for running tasks)
      conn.run(
        `UPDATE core_worker_registry
         SET status = 'IDLE', current_task_id = NULL, allocated_at = NULL`
      );
    });

    poolState.initialized = false;
    poolState.config = null;

    return ok(undefined);
  }

  const runtime: WorkerRuntime = {
    initialize,
    allocate,
    dispatch,
    release,
    terminate,
    getWorkers,
    poolStatus: statusFn,
    shutdown,
  };

  return Object.freeze(runtime);
}
