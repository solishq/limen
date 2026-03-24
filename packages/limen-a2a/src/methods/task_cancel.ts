/**
 * A2A tasks/cancel method handler.
 *
 * Cancels a previously submitted task. Since Limen operations are
 * synchronous, by the time a cancel request arrives the task has
 * already completed or failed. We mark it as canceled in the store
 * regardless — this is semantically correct for the A2A protocol.
 *
 * If the task was never submitted (or was evicted from the store),
 * we return success — idempotent cancellation. A client should not
 * receive an error for canceling a task that does not exist; it may
 * have already been evicted by the TTL.
 */

import type { A2ATaskCancelParams, A2ATaskResult, A2AMessage } from '../jsonrpc/types.js';
import type { TaskManager } from '../task_manager.js';

/**
 * Validate tasks/cancel params.
 */
function validateCancelParams(raw: unknown): A2ATaskCancelParams {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('params must be an object');
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    throw new Error('params.id is required (string)');
  }

  return { id: obj.id };
}

/**
 * Create the tasks/cancel method handler.
 */
export function createTaskCancelHandler(
  taskManager: TaskManager,
): (params: unknown, id: string | number) => Promise<unknown> {
  return async function handleTaskCancel(rawParams: unknown, _requestId: string | number): Promise<unknown> {
    const cancelParams = validateCancelParams(rawParams);

    const task = taskManager.cancel(cancelParams.id);

    // Build result — either the canceled task or an acknowledgment for unknown tasks
    const agentMessage: A2AMessage = {
      role: 'agent',
      parts: [{
        type: 'text',
        text: task !== undefined
          ? `Task ${cancelParams.id} canceled`
          : `Task ${cancelParams.id} not found (may have completed or expired)`,
      }],
    };

    const result: A2ATaskResult = {
      id: cancelParams.id,
      state: 'canceled',
      messages: [agentMessage],
    };

    return result;
  };
}
