/**
 * A2A tasks/send method handler.
 *
 * Routes incoming A2A tasks to the appropriate Limen API based on the
 * skill and action specified in the task metadata.
 *
 * Skill routing map:
 *   agent-management   -> limen.agents.register/list/get/promote
 *   claim-management   -> limen.claims.assertClaim/queryClaims
 *   working-memory     -> limen.workingMemory.write/read/discard
 *   mission-orchestration -> limen.missions.create/list
 *   health             -> limen.health()
 *
 * The action field within metadata determines which specific method to call.
 * Parameters for the Limen method are passed via metadata.params.
 *
 * Design: Each skill+action combination is an explicit case — no dynamic
 * dispatch or reflection. This makes the routing auditable and prevents
 * injection of arbitrary method calls.
 *
 * Type safety note: A2A params arrive as untyped JSON. We cast through
 * `unknown` to the Limen input types. The Limen engine itself validates
 * the inputs and returns typed Result<T> errors if they are malformed.
 * The A2A layer does not duplicate that validation.
 */

import type {
  Limen,
  ClaimCreateInput,
  ClaimQueryInput,
  WriteWorkingMemoryInput,
  ReadWorkingMemoryInput,
  DiscardWorkingMemoryInput,
  MissionCreateOptions,
  MissionFilter,
} from 'limen-ai';
import type { A2ATaskSendParams, A2ATaskResult, A2AMessage } from '../jsonrpc/types.js';
import { TaskManager } from '../task_manager.js';
import { randomUUID } from 'node:crypto';

/**
 * Validate tasks/send params structure.
 * Returns typed params or throws with a descriptive message.
 */
function validateSendParams(raw: unknown): A2ATaskSendParams {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('params must be an object');
  }

  const obj = raw as Record<string, unknown>;

  const id = typeof obj.id === 'string' && obj.id.length > 0
    ? obj.id
    : randomUUID();

  if (typeof obj.message !== 'object' || obj.message === null) {
    throw new Error('params.message is required');
  }

  const message = obj.message as Record<string, unknown>;
  if (typeof message.role !== 'string') {
    throw new Error('params.message.role is required');
  }

  const metadata = obj.metadata as Record<string, unknown> | undefined;

  return {
    id,
    message: message as unknown as A2ATaskSendParams['message'],
    metadata: metadata as A2ATaskSendParams['metadata'],
  };
}

/**
 * Extract skill and action from task params.
 * Skill comes from metadata.skill. Action comes from metadata.action.
 * If no skill is provided, defaults to 'health'.
 */
function extractRouting(params: A2ATaskSendParams): { skill: string; action: string } {
  const skill = params.metadata?.skill ?? 'health';
  const action = params.metadata?.action ?? 'default';
  return { skill, action };
}

/**
 * Build a successful A2A task result.
 */
function buildResult(id: string, result: unknown): A2ATaskResult {
  const agentMessage: A2AMessage = {
    role: 'agent',
    parts: [{
      type: 'text',
      text: typeof result === 'string' ? result : JSON.stringify(result),
    }],
  };

  return {
    id,
    state: 'completed',
    messages: [agentMessage],
    metadata: { result },
  };
}

/**
 * Build a failed A2A task result.
 */
function buildError(id: string, error: string): A2ATaskResult {
  const agentMessage: A2AMessage = {
    role: 'agent',
    parts: [{ type: 'text', text: error }],
  };

  return {
    id,
    state: 'failed',
    messages: [agentMessage],
    metadata: { error },
  };
}

/**
 * Handle the agent-management skill.
 * Actions: register, list, get, promote.
 */
async function handleAgentManagement(
  limen: Limen,
  action: string,
  params: Record<string, unknown> | undefined,
): Promise<unknown> {
  switch (action) {
    case 'register': {
      if (!params?.name || typeof params.name !== 'string') {
        throw new Error('agent-management/register requires params.name (string)');
      }
      const domains = Array.isArray(params.domains) ? params.domains as string[] : undefined;
      return limen.agents.register({ name: params.name, domains });
    }

    case 'list':
      return limen.agents.list();

    case 'get': {
      if (!params?.name || typeof params.name !== 'string') {
        throw new Error('agent-management/get requires params.name (string)');
      }
      const agent = await limen.agents.get(params.name);
      if (agent === null) {
        throw new Error(`Agent not found: ${params.name}`);
      }
      return agent;
    }

    case 'promote': {
      if (!params?.name || typeof params.name !== 'string') {
        throw new Error('agent-management/promote requires params.name (string)');
      }
      return limen.agents.promote(params.name);
    }

    default:
      throw new Error(
        `Unknown action "${action}" for agent-management. Valid: register, list, get, promote`,
      );
  }
}

/**
 * Handle the claim-management skill.
 * Actions: assertClaim, queryClaims.
 *
 * Limen's ClaimApi methods return Result<T> (discriminated union).
 * We unwrap them here: ok=true yields the value, ok=false yields an error.
 */
function handleClaimManagement(
  limen: Limen,
  action: string,
  params: Record<string, unknown> | undefined,
): unknown {
  switch (action) {
    case 'assertClaim':
    case 'assert': {
      if (!params) {
        throw new Error('claim-management/assertClaim requires params');
      }
      const result = limen.claims.assertClaim(params as unknown as ClaimCreateInput);
      if (!result.ok) {
        throw new Error(`assertClaim failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    case 'queryClaims':
    case 'query': {
      if (!params) {
        throw new Error('claim-management/queryClaims requires params');
      }
      const result = limen.claims.queryClaims(params as unknown as ClaimQueryInput);
      if (!result.ok) {
        throw new Error(`queryClaims failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    default:
      throw new Error(
        `Unknown action "${action}" for claim-management. Valid: assertClaim, queryClaims`,
      );
  }
}

/**
 * Handle the working-memory skill.
 * Actions: write, read, discard.
 *
 * Same Result<T> unwrapping as claim-management.
 */
function handleWorkingMemory(
  limen: Limen,
  action: string,
  params: Record<string, unknown> | undefined,
): unknown {
  switch (action) {
    case 'write': {
      if (!params) {
        throw new Error('working-memory/write requires params');
      }
      const result = limen.workingMemory.write(params as unknown as WriteWorkingMemoryInput);
      if (!result.ok) {
        throw new Error(`workingMemory.write failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    case 'read': {
      if (!params) {
        throw new Error('working-memory/read requires params');
      }
      const result = limen.workingMemory.read(params as unknown as ReadWorkingMemoryInput);
      if (!result.ok) {
        throw new Error(`workingMemory.read failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    case 'discard': {
      if (!params) {
        throw new Error('working-memory/discard requires params');
      }
      const result = limen.workingMemory.discard(params as unknown as DiscardWorkingMemoryInput);
      if (!result.ok) {
        throw new Error(`workingMemory.discard failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    default:
      throw new Error(
        `Unknown action "${action}" for working-memory. Valid: write, read, discard`,
      );
  }
}

/**
 * Handle the mission-orchestration skill.
 * Actions: create, list.
 */
async function handleMissionOrchestration(
  limen: Limen,
  action: string,
  params: Record<string, unknown> | undefined,
): Promise<unknown> {
  switch (action) {
    case 'create': {
      if (!params) {
        throw new Error('mission-orchestration/create requires params');
      }
      const handle = await limen.missions.create(params as unknown as MissionCreateOptions);
      // MissionHandle has id, state, budget — return a serializable view
      return { id: handle.id, state: handle.state, budget: handle.budget };
    }

    case 'list': {
      const filter = params as unknown as MissionFilter | undefined;
      return limen.missions.list(filter);
    }

    default:
      throw new Error(
        `Unknown action "${action}" for mission-orchestration. Valid: create, list`,
      );
  }
}

/**
 * Handle the health skill.
 * No action parameter needed — always returns engine health.
 */
async function handleHealth(limen: Limen): Promise<unknown> {
  return limen.health();
}

/**
 * Create the tasks/send method handler.
 *
 * This is a factory that captures the Limen engine instance and TaskManager,
 * returning a MethodHandler-compatible async function.
 */
export function createTaskSendHandler(
  limen: Limen,
  taskManager: TaskManager,
): (params: unknown, id: string | number) => Promise<unknown> {
  return async function handleTaskSend(rawParams: unknown, _requestId: string | number): Promise<unknown> {
    // Validate and parse the A2A task envelope
    const sendParams = validateSendParams(rawParams);

    const { skill, action } = extractRouting(sendParams);
    const actionParams = sendParams.metadata?.params;

    try {
      let result: unknown;

      switch (skill) {
        case 'agent-management':
          result = await handleAgentManagement(limen, action, actionParams);
          break;

        case 'claim-management':
          result = handleClaimManagement(limen, action, actionParams);
          break;

        case 'working-memory':
          result = handleWorkingMemory(limen, action, actionParams);
          break;

        case 'mission-orchestration':
          result = await handleMissionOrchestration(limen, action, actionParams);
          break;

        case 'health':
          result = await handleHealth(limen);
          break;

        default:
          throw new Error(
            `Unknown skill: "${skill}". Valid skills: agent-management, claim-management, working-memory, mission-orchestration, health`,
          );
      }

      // Record completed task and return A2A result
      taskManager.complete(sendParams.id, skill, result);
      return buildResult(sendParams.id, result);

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      taskManager.fail(sendParams.id, skill, errorMessage);
      return buildError(sendParams.id, errorMessage);
    }
  };
}
