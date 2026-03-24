/**
 * A2A tasks/get method handler.
 *
 * Retrieves a previously submitted task's state and result from the
 * in-memory TaskManager.
 *
 * Since Limen operations are synchronous (request-response), tasks are
 * always in a terminal state (completed, failed, or canceled) when
 * retrieved. There is no "working" state to poll for.
 *
 * Design: The A2A protocol mandates tasks/get for state polling. Even
 * though our tasks complete synchronously, we implement it faithfully
 * so that A2A-compliant clients work correctly.
 */

import type { A2ATaskGetParams, A2ATaskResult, A2AMessage } from '../jsonrpc/types.js';
import type { TaskManager } from '../task_manager.js';

/**
 * Validate tasks/get params.
 */
function validateGetParams(raw: unknown): A2ATaskGetParams {
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
 * Create the tasks/get method handler.
 */
export function createTaskGetHandler(
  taskManager: TaskManager,
): (params: unknown, id: string | number) => Promise<unknown> {
  return async function handleTaskGet(rawParams: unknown, _requestId: string | number): Promise<unknown> {
    const getParams = validateGetParams(rawParams);

    const task = taskManager.get(getParams.id);

    if (task === undefined) {
      // A2A spec: return a task result with state info.
      // If the task was never submitted or was evicted, report it as not found.
      throw new Error(`Task not found: ${getParams.id}`);
    }

    // Build A2A task result from stored task
    const agentMessage: A2AMessage = {
      role: 'agent',
      parts: [{
        type: 'text',
        text: task.error ?? (typeof task.result === 'string' ? task.result : JSON.stringify(task.result)),
      }],
    };

    const result: A2ATaskResult = {
      id: task.id,
      state: task.state,
      messages: [agentMessage],
      metadata: task.error ? { error: task.error } : { result: task.result },
    };

    return result;
  };
}
