/**
 * In-memory A2A task state store.
 *
 * The A2A protocol requires task lifecycle tracking (submit, get, cancel).
 * Limen operations are synchronous (request-response), so tasks complete
 * immediately. This store records completed/failed task results so that
 * tasks/get can return them, and tasks/cancel can acknowledge them.
 *
 * Design decisions:
 * - In-memory Map: Tasks are ephemeral A2A protocol artifacts, not Limen
 *   persistent state. A server restart clears them — acceptable because
 *   Limen itself is the durable state store.
 * - TTL eviction: Prevents unbounded memory growth. Tasks older than 1 hour
 *   are evicted on access. No background timer needed.
 * - Task IDs come from the A2A client (params.id). If the client does not
 *   provide one, the method handler generates one via crypto.randomUUID().
 */

import type { A2ATaskState } from './jsonrpc/types.js';

export interface A2ATask {
  readonly id: string;
  readonly state: A2ATaskState;
  readonly skill: string;
  readonly result?: unknown;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Maximum age of a stored task before eviction (1 hour). */
const TASK_TTL_MS = 3_600_000;

/** Maximum number of tasks stored before forced eviction of oldest. */
const MAX_TASKS = 10_000;

export class TaskManager {
  private readonly tasks: Map<string, A2ATask> = new Map();

  /**
   * Record a completed task.
   */
  complete(id: string, skill: string, result: unknown): A2ATask {
    this.evictStale();
    const now = new Date().toISOString();
    const task: A2ATask = {
      id,
      state: 'completed',
      skill,
      result,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  /**
   * Record a failed task.
   */
  fail(id: string, skill: string, error: string): A2ATask {
    this.evictStale();
    const now = new Date().toISOString();
    const task: A2ATask = {
      id,
      state: 'failed',
      skill,
      error,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(id, task);
    return task;
  }

  /**
   * Get a task by ID. Returns undefined if not found or evicted.
   */
  get(id: string): A2ATask | undefined {
    this.evictStale();
    return this.tasks.get(id);
  }

  /**
   * Cancel a task. Since Limen operations are synchronous:
   * - If the task exists and is terminal (completed/failed), mark as canceled.
   * - If the task does not exist, return undefined (no-op).
   */
  cancel(id: string): A2ATask | undefined {
    const existing = this.tasks.get(id);
    if (existing === undefined) {
      return undefined;
    }

    const canceled: A2ATask = {
      ...existing,
      state: 'canceled',
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(id, canceled);
    return canceled;
  }

  /**
   * Evict tasks older than TASK_TTL_MS. Also enforces MAX_TASKS by removing
   * oldest entries when the cap is exceeded.
   *
   * Called on every mutating or reading operation — no background timer needed.
   */
  private evictStale(): void {
    const cutoff = Date.now() - TASK_TTL_MS;

    for (const [id, task] of this.tasks) {
      if (new Date(task.createdAt).getTime() < cutoff) {
        this.tasks.delete(id);
      }
    }

    // If still over capacity, evict oldest entries (Map preserves insertion order)
    if (this.tasks.size > MAX_TASKS) {
      const excess = this.tasks.size - MAX_TASKS;
      let removed = 0;
      for (const id of this.tasks.keys()) {
        if (removed >= excess) break;
        this.tasks.delete(id);
        removed++;
      }
    }
  }
}
