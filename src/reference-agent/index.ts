/**
 * Reference Agent public exports.
 * S ref: S49 (developer experience), §41 (use cases)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD File Manifest -- public entry point
 *
 * This file is the SOLE public entry point for the reference agent.
 * Consumers import from here. Internal modules are not exported.
 *
 * Usage:
 *   import { createReferenceAgent } from './reference-agent/index.js';
 *   import type { Limen } from './api/index.js';
 *
 *   const limen: Limen = await createLimen({ ... });
 *   const agent = createReferenceAgent(limen, { name: 'strategist' });
 *   const result = await agent.runMission({
 *     objective: 'Analyze SEA drone delivery market',
 *     constraints: { tokenBudget: 50000, deadline: '48h' },
 *   });
 *
 * I-17: The reference agent imports ONLY from src/api/.
 *       No kernel, substrate, or orchestration internals.
 */

import type { Limen } from '../api/index.js';
import { ReferenceAgent } from './reference_agent.js';
import type { ReferenceAgentConfig } from './reference_agent.types.js';

// ============================================================================
// Factory Function (S49 DX)
// ============================================================================

/**
 * S49: Create a reference agent instance.
 *
 * This is the canonical developer experience entry point.
 * The agent is a library -- it does not run autonomously.
 * The consumer drives execution by calling runMission().
 *
 * @param limen - A Limen engine instance (from createLimen())
 * @param config - Agent configuration
 * @returns ReferenceAgent instance ready to run missions
 */
export function createReferenceAgent(
  limen: Limen,
  config: ReferenceAgentConfig,
): ReferenceAgent {
  return new ReferenceAgent(limen, config);
}

// ============================================================================
// Public Type Exports
// ============================================================================

export { ReferenceAgent } from './reference_agent.js';

export type {
  ReferenceAgentConfig,
  MissionRunOptions,
  AgentExecutionState,
  CheckpointRecord,
  DecompositionStrategy,
  CheckpointAssessmentMode,
  CheckpointCallback,
  TaskExecutionCallback,
  ErrorCategory,
  ClassifiedError,
} from './reference_agent.types.js';

export {
  DEFAULT_BUDGET_DECAY_FACTOR,
  MISSION_TREE_DEFAULTS,
  MAX_PLAN_REVISIONS,
  DEFAULT_MAX_TASK_RETRIES,
  ESCALATION_CONFIDENCE_THRESHOLD,
  BUDGET_CHECKPOINT_THRESHOLDS,
} from './reference_agent.types.js';

// DR-P5-013: Internal modules are NOT exported from the public API surface.
// Consumers should use only the factory function and public types.
// For testing, import directly from the internal module files.
// Internal modules: SystemCallClient, MissionPlanner, TaskExecutor,
// ArtifactManager, CheckpointHandler, ResultAggregator.
