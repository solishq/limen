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

  // 3. Create convenience mission
  // Deadline: 1 year from now. Budget: 1,000,000 tokens.
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

  // 4. Propose a task graph with a single convenience task
  await missionHandle.proposeTaskGraph({
    missionId,
    tasks: [{
      id: 'convenience-task',
      description: 'Convenience API operations',
      executionMode: 'deterministic',
      estimatedTokens: 1_000_000,
    }],
    dependencies: [],
    objectiveAlignment: 'Convenience API thin delegation layer for remember/recall/forget/connect/reflect',
  });

  // 5. Get the task ID from the graph
  // The task graph creates tasks with IDs that are mission-scoped.
  // We need to query the mission's tasks to find the one we created.
  // The task ID format is typically the mission's task graph ID.
  // For simplicity, we look up the mission to get the task.
  const missionState = await missions.get(missionId);
  if (!missionState) {
    throw new Error(`Convenience mission ${missionId} not found after creation`);
  }

  // Propose task execution to get the actual taskId
  // The taskId from the graph is a string, but we need the internal TaskId.
  // We'll use the graph's task count to derive it.
  // Actually, looking at the orchestration, tasks are created by proposeTaskGraph
  // and their IDs are returned. But proposeTaskGraph returns TaskGraphOutput
  // which has taskCount but not individual task IDs.
  //
  // For the convenience API, the missionId is the critical piece.
  // The taskId can be null for convenience claims. Let me verify...
  // Looking at ClaimCreateInput: taskId is TaskId | null.
  // MissionId is required (not null). TaskId can be null.
  //
  // Decision: Use null for taskId. The missionId is sufficient for
  // SC-11 validation. This avoids the complexity of retrieving the
  // internal TaskId from the task graph.

  return {
    agentId,
    missionId,
    taskId: null,
  };
}
