/**
 * Phase 1: Convenience API eager initialization.
 *
 * Registers the "limen-convenience" agent and creates the convenience mission
 * during createLimen(). This provides the missionId and taskId needed for
 * all convenience API claim operations.
 *
 * Design Source: Decision 1 (MissionId for Convenience Claims)
 * Invariants: I-CONV-01 (immediately usable), I-CONV-02 (created once, cached)
 *
 * Trade-off: Adds ~30ms to createLimen() (already async). All convenience
 * methods are synchronous Result<T> after engine creation.
 */

import type { AgentId, MissionId, TaskId } from '../../kernel/interfaces/index.js';
import type { TimeProvider } from '../../kernel/interfaces/time.js';
import type { AgentApi, MissionApi } from '../interfaces/api.js';

/**
 * Result of convenience initialization.
 * Contains the cached IDs needed for all convenience operations.
 */
export interface ConvenienceInitResult {
  readonly agentId: AgentId;
  readonly missionId: MissionId;
  readonly taskId: TaskId | null;
}

/** Well-known agent name for convenience API */
export const CONVENIENCE_AGENT_NAME = 'limen-convenience';

/** Well-known mission objective for convenience API */
export const CONVENIENCE_MISSION_OBJECTIVE = 'limen-convenience-api';

/**
 * Initialize the convenience API infrastructure.
 *
 * 1. Register (or retrieve) the "limen-convenience" agent
 * 2. Create the convenience mission with standard config
 * 3. Propose a task graph with a single task
 * 4. Return cached IDs for all subsequent operations
 *
 * This runs during createLimen() (already async). All failures
 * propagate as exceptions to the createLimen() caller.
 *
 * @param agents - The AgentApi for agent registration
 * @param missions - The MissionApi for mission creation
 * @param setDefaultAgent - Function to set the default agent identity
 */
export async function initializeConvenience(
  agents: AgentApi,
  missions: MissionApi,
  setDefaultAgent: (agentId: AgentId) => void,
  time: TimeProvider,
): Promise<ConvenienceInitResult> {
  // 1. Register agent (idempotent -- if already exists, retrieve it)
  let agentId: AgentId;
  try {
    const agent = await agents.register({
      name: CONVENIENCE_AGENT_NAME,
      domains: ['convenience'],
      capabilities: ['remember', 'recall', 'forget', 'connect', 'reflect'],
    });
    agentId = agent.id;
  } catch (regErr: unknown) {
    // Agent may already exist from a previous createLimen() with the same dataDir.
    // Try to retrieve it instead.
    const existing = await agents.get(CONVENIENCE_AGENT_NAME);
    if (existing) {
      agentId = existing.id;
    } else {
      throw regErr;
    }
  }

  // 2. Set default agent so all ClaimApi calls carry this agentId
  setDefaultAgent(agentId);

  // 3. Create convenience mission with session-unique task ID.
  //
  // Fixes applied (Breaker findings F-2, F-7, F-17):
  //   F-2:  Return the computed taskId (was discarded as null).
  //   F-7:  Use mission-scoped task ID to prevent UNIQUE constraint on restart.
  //   F-17: Each session gets its own mission — accepted trade-off; cleanup
  //         is the retention scheduler's responsibility (core_missions.deadline).
  const deadline = new Date(time.nowMs() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const missionHandle = await missions.create({
    agent: CONVENIENCE_AGENT_NAME,
    objective: CONVENIENCE_MISSION_OBJECTIVE,
    constraints: {
      tokenBudget: 1_000_000,
      deadline,
    },
  });

  const missionId = missionHandle.id;

  // Task ID is mission-scoped — unique across sessions, prevents UNIQUE constraint.
  const taskId = `conv-${missionId.slice(0, 8)}`;
  await missionHandle.proposeTaskGraph({
    missionId,
    tasks: [{
      id: taskId,
      description: 'Convenience API operations',
      executionMode: 'deterministic',
      estimatedTokens: 1_000_000,
    }],
    dependencies: [],
    objectiveAlignment: 'Convenience API thin delegation layer for remember/recall/forget/connect/reflect',
  });

  return {
    agentId,
    missionId,
    taskId: taskId as TaskId,  // F-2: thread task ID through for claim traceability
  };
}
