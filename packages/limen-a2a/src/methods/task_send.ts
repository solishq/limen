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
 * Perimeter validation: All incoming JSON is validated through Zod schemas
 * at the trust boundary. Structure is validated here; semantic validation
 * (FK existence, state machine validity) is delegated to the Limen engine.
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
import { z } from 'zod';
import {
  A2ATaskSendParamsSchema,
  ClaimCreateInputSchema,
  ClaimQueryInputSchema,
  WriteWorkingMemoryInputSchema,
  ReadWorkingMemoryInputSchema,
  DiscardWorkingMemoryInputSchema,
  MissionCreateOptionsSchema,
  MissionFilterSchema,
  AgentRegisterSchema,
  AgentGetSchema,
  AgentPromoteSchema,
  toBrandedInput,
  formatZodError,
} from '../validation/schemas.js';

/**
 * Validate and parse the A2A task envelope using Zod.
 * Returns typed params or throws ZodError.
 */
function parseSendParams(raw: unknown): A2ATaskSendParams {
  const parsed = A2ATaskSendParamsSchema.parse(raw);
  return {
    id: parsed.id ?? randomUUID(),
    message: parsed.message,
    metadata: parsed.metadata,
  } satisfies A2ATaskSendParams;
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
      const validated = AgentRegisterSchema.parse(params);
      return limen.agents.register(validated);
    }

    case 'list':
      return limen.agents.list();

    case 'get': {
      const validated = AgentGetSchema.parse(params);
      const agent = await limen.agents.get(validated.name);
      if (agent === null) {
        throw new Error(`Agent not found: ${validated.name}`);
      }
      return agent;
    }

    case 'promote': {
      const validated = AgentPromoteSchema.parse(params);
      return limen.agents.promote(validated.name);
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
      const validated = ClaimCreateInputSchema.parse(params);
      const result = limen.claims.assertClaim(toBrandedInput<ClaimCreateInput>(validated));
      if (!result.ok) {
        throw new Error(`assertClaim failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    case 'queryClaims':
    case 'query': {
      const validated = ClaimQueryInputSchema.parse(params);
      const result = limen.claims.queryClaims(toBrandedInput<ClaimQueryInput>(validated));
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
      const validated = WriteWorkingMemoryInputSchema.parse(params);
      const result = limen.workingMemory.write(toBrandedInput<WriteWorkingMemoryInput>(validated));
      if (!result.ok) {
        throw new Error(`workingMemory.write failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    case 'read': {
      const validated = ReadWorkingMemoryInputSchema.parse(params);
      const result = limen.workingMemory.read(toBrandedInput<ReadWorkingMemoryInput>(validated));
      if (!result.ok) {
        throw new Error(`workingMemory.read failed: ${result.error.message} (${result.error.code})`);
      }
      return result.value;
    }

    case 'discard': {
      const validated = DiscardWorkingMemoryInputSchema.parse(params);
      const result = limen.workingMemory.discard(toBrandedInput<DiscardWorkingMemoryInput>(validated));
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
      const validated = MissionCreateOptionsSchema.parse(params);
      const handle = await limen.missions.create(toBrandedInput<MissionCreateOptions>(validated));
      return { id: handle.id, state: handle.state, budget: handle.budget };
    }

    case 'list': {
      const validated = params ? MissionFilterSchema.parse(params) : undefined;
      return limen.missions.list(validated ? toBrandedInput<MissionFilter>(validated) : undefined);
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
    let sendParams: A2ATaskSendParams;
    try {
      sendParams = parseSendParams(rawParams);
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return buildError(
          typeof rawParams === 'object' && rawParams !== null && 'id' in rawParams && typeof (rawParams as Record<string, unknown>).id === 'string'
            ? (rawParams as Record<string, unknown>).id as string
            : randomUUID(),
          `Invalid A2A task params: ${formatZodError(err)}`,
        );
      }
      throw err;
    }

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
      if (err instanceof z.ZodError) {
        const errorMessage = `Invalid parameters: ${formatZodError(err)}`;
        taskManager.fail(sendParams.id, skill, errorMessage);
        return buildError(sendParams.id, errorMessage);
      }
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      taskManager.fail(sendParams.id, skill, errorMessage);
      return buildError(sendParams.id, errorMessage);
    }
  };
}
