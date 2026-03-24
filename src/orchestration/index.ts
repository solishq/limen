/**
 * Orchestration Layer Facade -- createOrchestration() factory.
 * S ref: SD-10 (explicit DI), C-07 (Object.freeze), S2 (three-layer model)
 *
 * Phase: 3 (Orchestration)
 * Implements: The public entry point for the orchestration layer.
 *             Constructs OrchestrationDeps, instantiates all internal modules,
 *             and exposes the 10 system calls plus internal subsystem accessors.
 *
 * SD-10: OrchestrationDeps { conn, substrate, audit } injected at construction.
 * C-07: Returned object is Object.freeze'd.
 */

import type { DatabaseConnection, AuditTrail, OperationContext, MissionId, RateLimiter, TimeProvider, TransitionEnforcer } from '../kernel/interfaces/index.js';
import type { Substrate } from '../substrate/interfaces/substrate.js';
import type {
  OrchestrationDeps, OrchestrationEngine,
  ProposeMissionInput, ProposeMissionOutput,
  ProposeTaskGraphInput, ProposeTaskGraphOutput,
  ProposeTaskExecutionInput, ProposeTaskExecutionOutput,
  CreateArtifactInput, CreateArtifactOutput,
  ReadArtifactInput, ReadArtifactOutput,
  EmitEventInput, EmitEventOutput,
  RequestCapabilityInput, RequestCapabilityOutput,
  RequestBudgetInput, RequestBudgetOutput,
  SubmitResultInput, SubmitResultOutput,
  RespondCheckpointInput, RespondCheckpointOutput,
} from './interfaces/orchestration.js';
import type { Result } from '../kernel/interfaces/index.js';
import { createOrchestrationTransitionService } from './transitions/transition_service.js';

// Core module factories
import { createMissionStore } from './missions/mission_store.js';
import { createTaskGraphEngine } from './tasks/task_graph.js';
import { createArtifactStore } from './artifacts/artifact_store.js';
import { createEventPropagator } from './events/event_propagation.js';
import { createBudgetGovernor } from './budget/budget_governance.js';
import { createCheckpointCoordinator } from './checkpoints/checkpoint_coordinator.js';
import { createConversationManager } from './conversation/conversation_manager.js';
import { createCompactionEngine } from './compaction/bounded_cognition.js';

// System call implementations
import { proposeMission } from './syscalls/propose_mission.js';
import { proposeTaskGraph } from './syscalls/propose_task_graph.js';
import { proposeTaskExecution } from './syscalls/propose_task_execution.js';
import { createArtifact } from './syscalls/create_artifact.js';
import { readArtifact } from './syscalls/read_artifact.js';
import { emitEvent } from './syscalls/emit_event.js';
import { requestCapability } from './syscalls/request_capability.js';
import { requestBudget } from './syscalls/request_budget.js';
import { submitResult } from './syscalls/submit_result.js';
import { respondCheckpoint } from './syscalls/respond_checkpoint.js';

// FM-10: Tenant-scoped connection facade
import { createTenantScopedConnection } from '../kernel/tenant/tenant_scope.js';

// Re-export interfaces and migration
export type { OrchestrationEngine, OrchestrationDeps } from './interfaces/orchestration.js';
export { getPhase3Migrations } from './migration/003_orchestration.js';

/**
 * SD-10: Create the orchestration engine facade.
 * C-07: Returns Object.freeze'd engine.
 *
 * @param conn - DatabaseConnection from kernel
 * @param substrate - Substrate from phase 2
 * @param audit - AuditTrail from kernel
 * @param rateLimiter - Optional kernel rate limiter for persistent, SQLite-backed rate limiting (CF-007)
 */
export function createOrchestration(
  conn: DatabaseConnection,
  substrate: Substrate,
  audit: AuditTrail,
  rateLimiter?: RateLimiter,
  time?: TimeProvider,
  transitionEnforcer?: TransitionEnforcer,
): OrchestrationEngine {
  // Hard Stop #7: Default to system time if not injected (backward compatibility).
  // Production callers should always provide kernel.time.
  const resolvedTime: TimeProvider = time ?? { nowISO: () => new Date().toISOString(), nowMs: () => Date.now() };
  // SD-10: Construct the dependency injection container
  // CF-007: Include rateLimiter in deps for persistent rate limiting in event propagation.
  // exactOptionalPropertyTypes: only include rateLimiter when defined.
  const baseDeps = { conn, substrate, audit, time: resolvedTime };
  const deps: OrchestrationDeps = Object.freeze(
    rateLimiter ? { ...baseDeps, rateLimiter } : baseDeps,
  );

  /**
   * FM-10: Create per-request tenant-scoped deps from OperationContext.
   * In row-level mode: auto-injects AND tenant_id = ? into all queries.
   * In single/database mode: pass-through (no-op).
   * S ref: FM-10 (tenant data leakage prevention), RDD-3 (transparent tenancy)
   */
  function scopeDeps(ctx: OperationContext): OrchestrationDeps {
    if (conn.tenancyMode !== 'row-level' || !ctx.tenantId) return deps;
    return Object.freeze({
      ...deps,
      conn: createTenantScopedConnection(conn, ctx.tenantId),
    });
  }

  // Instantiate all internal modules (C-07: each returns frozen object)
  const missionStore = createMissionStore();
  const taskGraphEngine = createTaskGraphEngine();
  const artifactStore = createArtifactStore();
  const eventPropagator = createEventPropagator();
  const budgetGovernor = createBudgetGovernor();
  const checkpointCoordinator = createCheckpointCoordinator();
  const conversationManager = createConversationManager();
  const compactionEngine = createCompactionEngine();

  // P0-A: OrchestrationTransitionService — bridges L2 transitions to governance TransitionEnforcer.
  // Optional until Task #233 rewires all callers. When transitionEnforcer is provided (from governance layer),
  // the service is created and exposed on the engine. When absent, engine.transitions is undefined.
  const transitionService = transitionEnforcer
    ? createOrchestrationTransitionService(transitionEnforcer, audit, resolvedTime)
    : undefined;

  // FM-19: Delegation detector uses mission store's chain
  const delegationDetector = Object.freeze({
    checkCycle(depsDi: OrchestrationDeps, parentMissionId: MissionId, agentId: import('../kernel/interfaces/index.js').AgentId): Result<boolean> {
      const chainResult = this.getChain(depsDi, parentMissionId);
      if (!chainResult.ok) return chainResult;
      return { ok: true, value: chainResult.value.includes(agentId as string) };
    },
    getChain(depsDi: OrchestrationDeps, missionId: MissionId): Result<string[]> {
      const mission = missionStore.get(depsDi, missionId);
      if (!mission.ok) return { ok: false, error: mission.error };
      return { ok: true, value: [...mission.value.delegationChain] };
    },
  });

  // Build the facade with all 10 system calls
  const engine: OrchestrationEngine = {
    // SC-1: propose_mission
    proposeMission(ctx: OperationContext, input: ProposeMissionInput): Result<ProposeMissionOutput> {
      return proposeMission(scopeDeps(ctx), ctx, input, missionStore, eventPropagator);
    },

    // SC-2: propose_task_graph
    proposeTaskGraph(ctx: OperationContext, input: ProposeTaskGraphInput): Result<ProposeTaskGraphOutput> {
      return proposeTaskGraph(scopeDeps(ctx), ctx, input, taskGraphEngine, eventPropagator);
    },

    // SC-3: propose_task_execution
    proposeTaskExecution(ctx: OperationContext, input: ProposeTaskExecutionInput): Result<ProposeTaskExecutionOutput> {
      return proposeTaskExecution(scopeDeps(ctx), ctx, input, taskGraphEngine, budgetGovernor, eventPropagator);
    },

    // SC-4: create_artifact
    createArtifact(ctx: OperationContext, input: CreateArtifactInput): Result<CreateArtifactOutput> {
      return createArtifact(scopeDeps(ctx), ctx, input, artifactStore, eventPropagator);
    },

    // SC-5: read_artifact
    readArtifact(ctx: OperationContext, input: ReadArtifactInput): Result<ReadArtifactOutput> {
      return readArtifact(scopeDeps(ctx), ctx, input, artifactStore, eventPropagator);
    },

    // SC-6: emit_event
    emitEvent(ctx: OperationContext, input: EmitEventInput): Result<EmitEventOutput> {
      return emitEvent(scopeDeps(ctx), ctx, input, eventPropagator);
    },

    // SC-7: request_capability
    requestCapability(ctx: OperationContext, input: RequestCapabilityInput): Result<RequestCapabilityOutput> {
      return requestCapability(scopeDeps(ctx), ctx, input, budgetGovernor);
    },

    // SC-8: request_budget
    requestBudget(ctx: OperationContext, input: RequestBudgetInput): Result<RequestBudgetOutput> {
      return requestBudget(scopeDeps(ctx), ctx, input, budgetGovernor, eventPropagator, missionStore);
    },

    // SC-9: submit_result
    submitResult(ctx: OperationContext, input: SubmitResultInput): Result<SubmitResultOutput> {
      return submitResult(scopeDeps(ctx), ctx, input, missionStore, eventPropagator, compactionEngine);
    },

    // SC-10: respond_checkpoint
    respondCheckpoint(ctx: OperationContext, input: RespondCheckpointInput): Result<RespondCheckpointOutput> {
      return respondCheckpoint(scopeDeps(ctx), ctx, input, checkpointCoordinator);
    },

    // Internal subsystem access
    missions: missionStore,
    taskGraph: taskGraphEngine,
    artifacts: artifactStore,
    budget: budgetGovernor,
    checkpoints: checkpointCoordinator,
    compaction: compactionEngine,
    events: eventPropagator,
    conversations: conversationManager,
    delegation: delegationDetector,
    // P0-A: Transition service is conditionally included when TransitionEnforcer is provided
    ...(transitionService ? { transitions: transitionService } : {}),
  };

  return Object.freeze(engine);
}
