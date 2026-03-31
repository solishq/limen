/**
 * createLimen() factory -- the sole entry point to the Limen engine.
 * S ref: S3.3 (engine not framework), C-06 (independent instances),
 *        C-07 (Object.freeze), FPD-2 (async factory), FPD-4 (deep freeze),
 *        S39 IP-4 (TypeScript API), SD-06 (shutdown on instance)
 *
 * Phase: 4 (API Surface)
 * Implements: SDD §7 build order item 14 (final composition)
 *
 * This factory:
 *   1. Creates L1 Kernel (opens SQLite, runs migrations, initializes RBAC/audit/crypto/events)
 *   2. Creates L1.5 Substrate (worker pool, LLM gateway, capability adapters, scheduler)
 *   3. Creates L2 Orchestration (mission store, task graph, budget, checkpoints, conversations)
 *   4. Composes the Limen public API object from all sub-modules
 *   5. Deep-freezes the result (Object.freeze recursive per C-07, FPD-4)
 *   6. Returns the frozen object
 *
 * C-06: Two createLimen() calls produce independent instances.
 * C-07: The returned Limen object is recursively frozen.
 * FPD-4: Deep freeze applied once at factory time. Zero ongoing cost.
 *
 * Invariants enforced: C-06, C-07, I-13, I-17
 * Failure modes defended: FM-10 (instance independence prevents cross-tenant leakage)
 */

import type {
  Kernel, CreateKernelFn, DestroyKernelFn,
  DatabaseConnection, OperationContext, Permission,
} from '../kernel/interfaces/index.js';
import type { Substrate } from '../substrate/interfaces/substrate.js';
import type { SubstrateConfig } from '../substrate/interfaces/substrate.js';
import type { OrchestrationEngine } from '../orchestration/interfaces/orchestration.js';
import type { TransitionEnforcer } from '../kernel/interfaces/lifecycle.js';

// CF-004: Real factory functions for default wiring
import { createKernel as realCreateKernel, destroyKernel as realDestroyKernel } from '../kernel/index.js';
import { createStringEncryption } from '../kernel/crypto/crypto_engine.js';
import { createSubstrate as realCreateSubstrate, getPhase2Migrations } from '../substrate/index.js';
import { createOrchestration as realCreateOrchestration, getPhase3Migrations } from '../orchestration/index.js';
import { getPhase4BMigrations } from '../orchestration/migration/004_tenant_isolation.js';
import { getPhase4D2ImmutabilityMigrations } from '../orchestration/migration/005_immutability_triggers.js';
import { getPhase4D4TombstoneMigrations } from '../orchestration/migration/006_audit_tombstone.js';
import type {
  Limen, LimenConfig, ChatMessage, ChatOptions, ChatResult,
  InferOptions, InferResult, SessionOptions, Session,
  HealthStatus, BackpressureConfig, StreamChunk,
} from './interfaces/api.js';

import { LimenError, ensureLimenError } from './errors/limen_error.js';
import { resolveDefaults } from './defaults.js';
import { buildOperationContext } from './enforcement/rbac_guard.js';
import { SessionManager } from './sessions/session_manager.js';
import { ChatPipeline } from './chat/chat_pipeline.js';
import { InferPipeline } from './infer/infer_pipeline.js';
import { MissionApiImpl } from './missions/mission_api.js';
import { AgentApiImpl } from './agents/agent_api.js';
import { RolesApiImpl } from './roles/roles_api.js';
import { DataApiImpl } from './data/data_api.js';
import { MetricsCollector } from './observability/metrics.js';
import { getHealth } from './observability/health.js';
// Phase 2B: TGP ↔ Pipeline — learning system for technique injection
import { createLearningSystem } from '../learning/harness/learning_harness.js';

// ── Phase 4: Governance Wiring Imports ──

// Phase 4: v16-v30 migration functions (15 files)
import { getPhase4E2aTechniquesMigration } from '../learning/migration/007_learning_techniques.js';
import { getPhase4E2dOutcomesMigration } from '../learning/migration/008_learning_outcomes.js';
import { getPhase4E2cApplicationsMigration } from '../learning/migration/009_learning_applications.js';
import { getPhase4E2eQuarantineMigration } from '../learning/migration/010_learning_quarantine.js';
import { getPhase4E2eTransferMigration } from '../learning/migration/011_learning_transfers.js';
import { getGovernanceRunsTracesMigrations } from '../governance/migration/012_governance_runs_traces.js';
import { getGovernanceContractsMigrations } from '../governance/migration/013_governance_contracts.js';
import { getGovernanceSupervisorMigrations } from '../governance/migration/014_governance_supervisor.js';
import { getGovernanceEvalMigrations } from '../governance/migration/015_governance_eval.js';
import { getGovernanceCapabilitiesMigrations } from '../governance/migration/016_governance_capabilities.js';
import { getGovernanceHandoffsIdempotencyMigrations } from '../governance/migration/017_governance_handoffs_idempotency.js';
import { getSupervisorDecisionDeleteTriggerMigrations } from '../governance/migration/018_supervisor_decision_delete_trigger.js';
import { getCcpClaimsMigrations } from '../claims/migration/019_ccp_claims.js';
import { getTgpGovernanceMigration } from '../techniques/migration/020_tgp_governance.js';
import { getWmpMigrations } from '../working-memory/migration/021_wmp.js';
import { getTransportDeliberationMigration } from '../substrate/migration/022_transport_deliberation.js';

// Sprint 1: Agent persistence + capability results migration (v32)
import { getAgentPersistenceMigrations } from './migration/023_agent_persistence.js';

// Sprint 2: Trust progression + safety violations + interactions migration (v33)
import { getTrustLearningMigrations } from './migration/024_trust_learning.js';

// Sprint 3: Knowledge graph — artifact cascading + goal drift detection migration (v34)
import { getKnowledgeGraphMigrations } from './migration/025_knowledge_graph.js';

// Sprint 4: Replay & pipeline — replay snapshots + LLM log immutability + recovery index (v35)
import { getReplayPipelineMigrations } from './migration/026_replay_pipeline.js';

// PRR-PE-016: Interactions retention policy (v36)
import { getInteractionsRetentionMigrations } from './migration/027_interactions_retention.js';

// Phase 2: FTS5 search migrations (v37, v38)
import { getFts5SearchMigrations } from './migration/028_fts5_search.js';
import { getFts5CjkMigrations } from './migration/029_fts5_cjk.js';

// Sprint 4: Mission recovery (I-18)
import { recoverMissions } from '../orchestration/missions/mission_recovery.js';

// Sprint 5: Webhook delivery (EVENT-01, IP-6)
import { deliverWebhooks } from '../kernel/events/webhook_delivery.js';

// Sprint 1: Real evidence validators (CCP-01, CCP-02)
import { createEvidenceValidator } from '../claims/evidence/evidence_validator.js';
import { createCapabilityResultScopeValidator } from '../claims/evidence/capability_scope_validator.js';

// Phase 4: Governance protocol factories
import { createGovernanceSystem } from '../governance/harness/governance_harness.js';
import { createExecutionGovernor } from '../execution/harness/egp_harness.js';
import { createInvocationGate } from '../execution/wiring/invocation_gate.js';

// Phase 4: GovernedOrchestration wrapper
import { createGovernedOrchestration } from './governance/governed_orchestration.js';

// Phase 4: Claim and Working Memory subsystem factories
import { createClaimSystem } from '../claims/store/claim_stores.js';
import { createWorkingMemorySystem } from '../working-memory/harness/wmp_harness.js';

// Phase 4: Facade factories
import { createRawClaimFacade } from './facades/claim_facade.js';
import { createRawWorkingMemoryFacade } from './facades/working_memory_facade.js';
import { ClaimApiImpl } from './facades/claim_api_impl.js';
import { WorkingMemoryApiImpl } from './facades/working_memory_api_impl.js';

// Phase 1: Convenience API
import { createConvenienceLayer } from './convenience/convenience_layer.js';
import { initializeConvenience } from './convenience/convenience_init.js';
import { DEFAULT_MAX_AUTO_CONFIDENCE } from './convenience/convenience_types.js';

// ============================================================================
// Re-export public types (convenience for consumers)
// ============================================================================

export type { Limen, LimenConfig, LimenLogEvent, LimenLogger } from './interfaces/api.js';
export { LimenError } from './errors/limen_error.js';
export type { LimenErrorCode } from './interfaces/api.js';
export { resolveDefaults, detectProviders, resolveMasterKey, resolveDataDir } from './defaults.js';

// Re-export all public API types consumers need
export type {
  ProviderConfig, HitlConfig, HitlMode,
  ChatMessage, ChatOptions, ChatResult, StreamChunk,
  PipelinePhase, FinishReason, ResponseMetadata,
  InferOptions, InferResult, JsonSchema, ZodSchema, SchemaValidationError,
  SessionOptions, Session, ConversationTurnView,
  MissionApi, MissionCreateOptions, MissionHandle, MissionState, MissionResult,
  MissionView, MissionFilter,
  TaskGraphInput, TaskGraphOutput, TaskSpec,
  TaskExecutionInput, TaskExecutionOutput,
  ArtifactCreateInput, ArtifactCreateOutput,
  ArtifactReadInput, ArtifactReadOutput,
  EventEmitInput, EventEmitOutput,
  CapabilityRequestInput, CapabilityRequestOutput,
  BudgetRequestInput, BudgetRequestOutput,
  ResultSubmitInput, ResultSubmitOutput,
  CheckpointResponseInput, CheckpointResponseOutput,
  AgentApi, AgentRegistration, AgentView, PipelineStage, AgentPipeline,
  TrustPromotionOptions, SafetyViolationInput,
  PurgeFilter,
  RolesApi, Permission,
  HealthStatus, SubsystemHealth, MetricsApi, MetricsSnapshot, HistogramData,
  DataApi,
  BackpressureConfig,
  ClaimApi, ClaimCreateInput, AssertClaimOutput,
  RelationshipCreateInput, RelateClaimsOutput,
  ClaimQueryInput, ClaimQueryResult, RetractClaimInput,
  CognitiveConfig, RememberOptions, RememberResult,
  RecallOptions, BeliefView, ReflectEntry, ReflectResult,
  ConvenienceErrorCode, EvidenceRef, ForgetOptions,
  WorkingMemoryApi, WriteWorkingMemoryInput, WriteWorkingMemoryOutput,
  ReadWorkingMemoryInput, ReadWorkingMemoryOutput,
  DiscardWorkingMemoryInput, DiscardWorkingMemoryOutput,
} from './interfaces/api.js';

export type {
  TenantId, UserId, AgentId, MissionId, TaskId,
  EventId, ArtifactId, SessionId,
} from '../kernel/interfaces/index.js';

// ============================================================================
// Deep Freeze (C-07, FPD-4)
// ============================================================================

/**
 * C-07, FPD-4: Recursively freeze an object.
 * Applied once at factory time. Zero ongoing cost.
 *
 * Prevents monkey-patching: consumer cannot replace limen.agents.register
 * with a malicious function. All nested objects are frozen.
 *
 * Functions are not recursively frozen (they have non-configurable prototype).
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);

  for (const key of Object.getOwnPropertyNames(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (
      value !== null &&
      value !== undefined &&
      typeof value === 'object' &&
      !Object.isFrozen(value)
    ) {
      deepFreeze(value as object);
    }
  }

  return obj;
}

// ============================================================================
// Layer Factory Types (Internal)
// ============================================================================

/**
 * Internal dependencies for createLimen().
 * These are the factory functions for each layer.
 * In production, they come from the layer implementations.
 * In tests, they can be mocked.
 */
export interface LimenDeps {
  readonly createKernel: CreateKernelFn;
  readonly destroyKernel: DestroyKernelFn;
  readonly createSubstrate: (kernel: Kernel, config: LimenConfig) => Substrate;
  readonly createOrchestration: (kernel: Kernel, substrate: Substrate, config: LimenConfig) => OrchestrationEngine;
}

// ============================================================================
// CF-004: Default Wiring (Phase 4C — Public Integration Boundary)
// ============================================================================

/**
 * CF-004, §3.3: Substrate adapter — bridges LimenConfig to SubstrateConfig.
 * LimenConfig.substrate has { maxWorkers?, schedulerPolicy? }.
 * SubstrateConfig needs { workerPool: WorkerPoolConfig, providers }.
 * S ref: S25.2 (worker pool), S25.4 (providers)
 */
function buildSubstrateAdapter(): LimenDeps['createSubstrate'] {
  return (kernel: Kernel, config: LimenConfig): Substrate => {
    // S25.2: Transform LimenConfig → SubstrateConfig
    const substrateConfig: SubstrateConfig = {
      workerPool: {
        poolSize: config.substrate?.maxWorkers ?? 4,
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          codeRangeSizeMb: 16,
        },
        workerScript: './worker.js',
      },
      // S25.4: Map public ProviderConfig (type field) → internal LlmProviderConfig (providerId field)
      providers: (config.providers ?? []).map(p => ({
        providerId: p.type,
        baseUrl: p.baseUrl,
        models: p.models,
        apiKeyEnvVar: p.apiKeyEnvVar ?? `${p.type.toUpperCase()}_API_KEY`,
        ...(p.maxConcurrent !== undefined && { maxConcurrent: p.maxConcurrent }),
        ...(p.costPerInputToken !== undefined && { costPerInputToken: p.costPerInputToken }),
        ...(p.costPerOutputToken !== undefined && { costPerOutputToken: p.costPerOutputToken }),
      })),
    };

    // CF-010: Create encryption adapter from kernel crypto engine + masterKey
    // for LLM gateway request/response body encryption at rest (I-11)
    const encryption = createStringEncryption(kernel.crypto, config.masterKey);

    // I-17: Pass kernel's audit trail for substrate audit compliance
    // CF-010: Pass encryption adapter for LLM gateway body encryption
    const result = realCreateSubstrate(substrateConfig, kernel.audit, encryption);

    if (!result.ok) {
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to create substrate: ${result.error.message}`);
    }

    return result.value;
  };
}

/**
 * CF-004, §3.3: Orchestration adapter — bridges Kernel to DatabaseConnection + AuditTrail.
 * LimenDeps.createOrchestration takes (kernel, substrate, config).
 * Real createOrchestration takes (conn, substrate, audit).
 * S ref: SD-10 (explicit DI), RDD-3 (tenancy modes)
 */
function buildOrchestrationAdapter(
  trackConn?: (conn: DatabaseConnection) => void,
  transitionEnforcer?: TransitionEnforcer,
): LimenDeps['createOrchestration'] {
  return (kernel: Kernel, substrate: Substrate, config: LimenConfig): OrchestrationEngine => {
    // RDD-3: Translate public tenancy config to kernel tenancy mode
    const tenancyMode = config.tenancy?.mode ?? 'single';
    const openResult = kernel.database.open({
      dataDir: config.dataDir,
      tenancy: {
        mode: tenancyMode === 'multi'
          ? (config.tenancy?.isolation ?? 'row-level')
          : 'single',
      },
    });

    if (!openResult.ok) {
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to open database for orchestration: ${openResult.error.message}`);
    }

    const conn = openResult.value;
    trackConn?.(conn);

    // C-05: Run Phase 2 (substrate), Phase 3 (orchestration), Phase 4B (tenant isolation) migrations.
    // createKernel() only runs Phase 1 migrations. Remaining migrations must be applied
    // before substrate/orchestration can query their tables.
    const phase2 = kernel.database.migrate(conn, getPhase2Migrations());
    if (!phase2.ok) {
      conn.close();
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to run substrate migrations: ${phase2.error.message}`);
    }
    const phase3 = kernel.database.migrate(conn, getPhase3Migrations());
    if (!phase3.ok) {
      conn.close();
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to run orchestration migrations: ${phase3.error.message}`);
    }
    const phase4b = kernel.database.migrate(conn, getPhase4BMigrations());
    if (!phase4b.ok) {
      conn.close();
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to run tenant isolation migrations: ${phase4b.error.message}`);
    }
    const phase4d2 = kernel.database.migrate(conn, getPhase4D2ImmutabilityMigrations());
    if (!phase4d2.ok) {
      conn.close();
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to run immutability trigger migrations: ${phase4d2.error.message}`);
    }
    const phase4d4 = kernel.database.migrate(conn, getPhase4D4TombstoneMigrations());
    if (!phase4d4.ok) {
      conn.close();
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to run audit tombstone migrations: ${phase4d4.error.message}`);
    }

    // Phase 4: Register v16-v30 governance subsystem migrations (DC-P4-601)
    // 15 migrations run after v1-v15 (Phase 1-3). Version ordering enforced by
    // the migration system (DC-P4-602). Failure → close conn → ENGINE_UNHEALTHY (DC-P4-603).
    const phase4Governance = kernel.database.migrate(conn, [
      ...getPhase4E2aTechniquesMigration(),       // v16: learning_techniques
      ...getPhase4E2dOutcomesMigration(),          // v17: learning_outcomes
      ...getPhase4E2cApplicationsMigration(),      // v18: learning_applications
      ...getPhase4E2eQuarantineMigration(),        // v19: quarantine_entries
      ...getPhase4E2eTransferMigration(),          // v20: transfer_requests
      ...getGovernanceRunsTracesMigrations(),      // v21: gov_runs, gov_attempts, obs_trace_events
      ...getGovernanceContractsMigrations(),       // v22: gov_mission_contracts
      ...getGovernanceSupervisorMigrations(),      // v23: gov_supervisor_decisions, gov_suspension_records
      ...getGovernanceEvalMigrations(),            // v24: gov_eval_cases
      ...getGovernanceCapabilitiesMigrations(),    // v25: gov_capability_manifests
      ...getGovernanceHandoffsIdempotencyMigrations(), // v26: gov_handoffs, gov_idempotency_keys, gov_resume_tokens
      ...getSupervisorDecisionDeleteTriggerMigrations(), // v27: DELETE trigger
      ...getCcpClaimsMigrations(),                 // v28: claim_assertions, claim_evidence, etc.
      ...getTgpGovernanceMigration(),              // v29: learning_techniques rebuild + evaluations
      ...getWmpMigrations(),                       // v30: working_memory_entries, etc.
      ...getTransportDeliberationMigration(),       // v31: transport deliberation columns
      ...getAgentPersistenceMigrations(),            // v32: core_agents, core_capability_results
      ...getTrustLearningMigrations(),                 // v33: core_trust_transitions, core_safety_violations, core_interactions
      ...getKnowledgeGraphMigrations(),                // v34: staleness_flag, core_drift_assessments
      ...getReplayPipelineMigrations(),                // v35: core_replay_snapshots, LLM log immutability, recovery index
      ...getInteractionsRetentionMigrations(),          // v36: expand retention CHECK constraint, seed interactions policy
      ...getFts5SearchMigrations(),                      // v37: FTS5 full-text search index + sync triggers
      ...getFts5CjkMigrations(),                         // v38: FTS5 CJK trigram index + sync triggers
    ]);
    if (!phase4Governance.ok) {
      conn.close();
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to run migrations (v16-v38): ${phase4Governance.error.message}`);
    }

    // CF-004 / self-review: cleanup connection if orchestration construction fails
    // CF-007: Pass kernel.rateLimiter for persistent, SQLite-backed rate limiting
    // P0-A: Pass transitionEnforcer for the OrchestrationTransitionService.
    // createOrchestration() uses a passthrough enforcer when undefined (test backward compat).
    try {
      return realCreateOrchestration(conn, substrate, kernel.audit, kernel.rateLimiter, kernel.time, transitionEnforcer);
    } catch (err) {
      conn.close();
      throw err;
    }
  };
}

/**
 * CF-004: Create default LimenDeps using the real layer factory functions.
 * This is the production wiring that connects createLimen() to the actual
 * kernel, substrate, and orchestration implementations.
 *
 * Consumers should NOT need this — createLimen(config) calls it internally.
 * Exported for:
 *   (a) Test code that wants to extend/override one factory while using defaults for others
 *   (b) Inspection/debugging of the wiring
 *
 * S ref: S3.3, C-06, C-07
 */
export function createDefaultDeps(): LimenDeps {
  return Object.freeze({
    createKernel: realCreateKernel,
    destroyKernel: realDestroyKernel,
    createSubstrate: buildSubstrateAdapter(),
    createOrchestration: buildOrchestrationAdapter(),
  });
}

// ============================================================================
// createLimen() Factory
// ============================================================================

/**
 * S3.3, C-07, C-06: Create an independent Limen engine instance.
 *
 * This is the SOLE entry point to the Limen engine. It:
 *   1. Validates configuration
 *   2. Creates L1 Kernel (SQLite, RBAC, audit, crypto, events)
 *   3. Creates L1.5 Substrate (workers, LLM gateway, adapters, scheduler)
 *   4. Creates L2 Orchestration (missions, tasks, budget, checkpoints, conversations)
 *   5. Composes the Limen public API
 *   6. Deep-freezes the result (C-07)
 *   7. Returns the frozen instance
 *
 * C-06: Two calls produce independent instances (separate kernel, substrate, orchestration).
 * C-07: The returned object is recursively frozen via Object.freeze.
 *
 * FPD-2: Returns Promise<Limen> because worker thread initialization (S25.2)
 *        and provider health probes (S25.4) are inherently async.
 *
 * @param config - Engine configuration
 * @param deps - Layer factory functions (optional; defaults to real implementations via createDefaultDeps())
 * @returns Frozen Limen engine instance
 * @throws LimenError with code INVALID_CONFIG on configuration errors
 * @throws LimenError with code ENGINE_UNHEALTHY if layer construction fails
 */
export async function createLimen(
  config?: LimenConfig,
  deps?: LimenDeps,
): Promise<Limen> {
  // Zero-config: when called with no arguments, resolve defaults from environment.
  // Provider auto-detection, dev master key, temp data dir.
  // Throws INVALID_CONFIG with helpful message if no providers detected.
  const resolvedConfig: LimenConfig = config ?? resolveDefaults();

  // CF-004: Default to production wiring when deps not provided.
  // S3.3: Consumers call createLimen(config) — no internal imports needed.
  // R4C-004: Track orchestration connection for shutdown cleanup.
  let orchestrationConn: DatabaseConnection | null = null;
  // P0-A: When no external deps, build default wiring. The orchestration adapter
  // is built without TransitionEnforcer initially — Step 4 rebuilds it with the
  // enforcer from GovernanceSystem. For external deps (tests), use as-is.
  const resolvedDeps = deps ?? Object.freeze({
    createKernel: realCreateKernel,
    destroyKernel: realDestroyKernel,
    createSubstrate: buildSubstrateAdapter(),
    createOrchestration: buildOrchestrationAdapter((conn) => {
      orchestrationConn = conn;
    }),
  });

  // ── Step 1: Validate configuration ──

  if (!resolvedConfig.dataDir || typeof resolvedConfig.dataDir !== 'string') {
    throw new LimenError('INVALID_CONFIG', 'dataDir is required and must be a non-empty string.');
  }

  if (!resolvedConfig.masterKey || !Buffer.isBuffer(resolvedConfig.masterKey) || resolvedConfig.masterKey.length < 32) {
    throw new LimenError('INVALID_CONFIG', 'masterKey is required and must be a Buffer of at least 32 bytes.');
  }

  // R4C-006: Validate tenancy mode (defense-in-depth for JavaScript consumers)
  const tenancyModeRaw = resolvedConfig.tenancy?.mode as string | undefined;
  if (tenancyModeRaw !== undefined && tenancyModeRaw !== 'single' && tenancyModeRaw !== 'multi') {
    throw new LimenError('INVALID_CONFIG',
      `tenancy.mode must be 'single' or 'multi', got '${tenancyModeRaw}'.`);
  }

  const tenancyMode = resolvedConfig.tenancy?.mode ?? 'single';
  const defaultTimeoutMs = resolvedConfig.defaultTimeoutMs ?? 60000;
  const maxConcurrentStreams = resolvedConfig.rateLimiting?.maxConcurrentStreams ?? 50;

  // Phase 1: Validate CognitiveConfig.maxAutoConfidence (I-CONV-03)
  const maxAutoConfidence = resolvedConfig.cognitive?.maxAutoConfidence ?? DEFAULT_MAX_AUTO_CONFIDENCE;
  if (!Number.isFinite(maxAutoConfidence) || maxAutoConfidence < 0 || maxAutoConfidence > 1) {
    throw new LimenError('INVALID_CONFIG',
      `cognitive.maxAutoConfidence must be a finite number in [0.0, 1.0], got ${maxAutoConfidence}.`);
  }

  // CF-021: Logger callback (no-op if not configured — zero behavioral change)
  const log = resolvedConfig.logger ?? (() => {});
  log({ level: 'info', category: 'init', message: 'Limen initialization starting', context: { dataDir: resolvedConfig.dataDir, tenancyMode } });

  const backpressureConfig: BackpressureConfig = {
    bufferSizeBytes: 4096,        // S36: 4KB default
    stallTimeoutMs: 30000,        // S27: 30s stall timeout
    maxConcurrentStreams,          // S36: 50 per tenant default
  };

  // ── Step 2: Create L1 Kernel ──

  const kernelResult = resolvedDeps.createKernel({
    dataDir: resolvedConfig.dataDir,
    tenancy: {
      mode: tenancyMode === 'multi' ? (resolvedConfig.tenancy?.isolation ?? 'row-level') : 'single',
    },
    masterKey: resolvedConfig.masterKey,
  });

  if (!kernelResult.ok) {
    log({ level: 'error', category: 'init', message: 'Kernel initialization failed', context: { error: kernelResult.error } });
    throw new LimenError('INVALID_CONFIG', 'Failed to initialize kernel.');
  }
  const kernel = kernelResult.value;
  const destroyKernel = resolvedDeps.destroyKernel;
  log({ level: 'info', category: 'init', message: 'Kernel initialized' });

  // CF-033 OP-02: Startup health gate.
  // Verify kernel health immediately after initialization.
  // An unhealthy kernel at startup indicates database corruption or schema issues.
  const startupHealth = kernel.health();
  if (!startupHealth.ok || startupHealth.value.status === 'unhealthy') {
    const reason = !startupHealth.ok
      ? startupHealth.error.message
      : 'Database integrity check failed';
    log({ level: 'error', category: 'init', message: 'Startup health gate failed', context: { reason } });
    try { destroyKernel(kernel); } catch { /* ignore cleanup errors */ }
    throw new LimenError('ENGINE_UNHEALTHY', `Startup health gate failed: ${reason}`);
  }
  log({ level: 'info', category: 'health', message: 'Startup health gate passed', context: { status: startupHealth.value.status } });

  // ── Step 3: Create L1.5 Substrate ──

  let substrate: Substrate;
  try {
    substrate = resolvedDeps.createSubstrate(kernel, resolvedConfig);
  } catch (err) {
    // R4C-005: Cleanup kernel on substrate construction failure
    try { destroyKernel(kernel); } catch { /* ignore cleanup errors */ }
    throw ensureLimenError(err);
  }

  // ── Step 3.5: Create GovernanceSystem early for TransitionEnforcer (P0-A) ──
  // The GovernanceSystem only needs kernel.time and has no dependencies on
  // orchestration or substrate. Creating it before orchestration allows the
  // TransitionEnforcer to be injected into the OrchestrationTransitionService.
  const earlyGovernanceSystem = createGovernanceSystem(kernel.time);

  // ── Step 4: Create L2 Orchestration ──

  let orchestration: OrchestrationEngine;
  try {
    // P0-A: For production wiring, rebuild the orchestration adapter with the
    // TransitionEnforcer from governance. For external deps (tests), use as-is —
    // createOrchestration() factory provides a passthrough enforcer when none given.
    if (!deps) {
      const orchestrationAdapterWithEnforcer = buildOrchestrationAdapter(
        (conn) => { orchestrationConn = conn; },
        earlyGovernanceSystem.transitionEnforcer,
      );
      orchestration = orchestrationAdapterWithEnforcer(kernel, substrate, resolvedConfig);
    } else {
      orchestration = resolvedDeps.createOrchestration(kernel, substrate, resolvedConfig);
    }
  } catch (err) {
    // R4C-005: Cleanup kernel on orchestration construction failure
    try { destroyKernel(kernel); } catch { /* ignore cleanup errors */ }
    throw ensureLimenError(err);
  }

  // ── Step 4.5a: Mission Recovery (Sprint 4, I-18) ──
  // After orchestration creation, before API surface composition.
  // Recovers non-terminal missions that were in-flight when the engine last shut down.
  // EXECUTING/REVIEWING -> PAUSED (conservative). Other non-terminal states unchanged.
  // Non-fatal: recovery failure does not prevent engine startup.
  try {
    // Open a recovery connection for the recovery pass
    const recoveryConnResult = kernel.database.open({
      dataDir: resolvedConfig.dataDir,
      tenancy: { mode: tenancyMode === 'multi' ? (resolvedConfig.tenancy?.isolation ?? 'row-level') : 'single' },
    });
    if (recoveryConnResult.ok) {
      const recoveryConn = recoveryConnResult.value;
      // Run all migrations on recovery connection first
      const recoveryMigResult = kernel.database.migrate(recoveryConn, [
        ...getPhase2Migrations(),
        ...getPhase3Migrations(),
        ...getPhase4BMigrations(),
        ...getPhase4D2ImmutabilityMigrations(),
        ...getPhase4D4TombstoneMigrations(),
        ...getPhase4E2aTechniquesMigration(),
        ...getPhase4E2dOutcomesMigration(),
        ...getPhase4E2cApplicationsMigration(),
        ...getPhase4E2eQuarantineMigration(),
        ...getPhase4E2eTransferMigration(),
        ...getGovernanceRunsTracesMigrations(),
        ...getGovernanceContractsMigrations(),
        ...getGovernanceSupervisorMigrations(),
        ...getGovernanceEvalMigrations(),
        ...getGovernanceCapabilitiesMigrations(),
        ...getGovernanceHandoffsIdempotencyMigrations(),
        ...getSupervisorDecisionDeleteTriggerMigrations(),
        ...getCcpClaimsMigrations(),
        ...getTgpGovernanceMigration(),
        ...getWmpMigrations(),
        ...getTransportDeliberationMigration(),
        ...getAgentPersistenceMigrations(),
        ...getTrustLearningMigrations(),
        ...getKnowledgeGraphMigrations(),
        ...getReplayPipelineMigrations(),
        ...getInteractionsRetentionMigrations(),
        ...getFts5SearchMigrations(),
        ...getFts5CjkMigrations(),
      ]);
      if (recoveryMigResult.ok) {
        // P0-A: Pass transition service to recovery for governance-enforced transitions.
        const recoveryResult = recoverMissions(recoveryConn, kernel.audit, kernel.time, orchestration.transitions);
        if (recoveryResult.ok && recoveryResult.value.recoveredCount > 0) {
          log({ level: 'info', category: 'recovery', message: `Mission recovery: ${recoveryResult.value.recoveredCount} missions transitioned to PAUSED` });
        }
      }
      recoveryConn.close();
    }
  } catch (recoveryErr) {
    // Non-fatal: recovery failure does not prevent engine startup
    log({ level: 'warn', category: 'recovery', message: 'Mission recovery failed (non-fatal)', context: { error: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr) } });
  }

  // ── Step 4.5: Governance Composition (Phase 4) ──
  // Instantiation order: Phase 0A → EGP → InvocationGate → GovernedOrchestration
  // Design Source §Output 4, Architecture §4 (composition order)

  // Phase 0A governance system — reuse the instance created at step 3.5 (P0-A).
  // Previously created here; moved earlier so TransitionEnforcer is available
  // before orchestration creation.
  const governanceSystem = earlyGovernanceSystem;

  // EGP execution governor
  // ExecutionGovernorDeps uses structural projections of audit/events that are
  // narrower than the kernel's full AuditTrail/EventBus interfaces.
  // Adapt kernel types to match EGP's minimal structural requirement.
  const egpDeps: import('../execution/interfaces/egp_types.js').ExecutionGovernorDeps = {
    audit: {
      append(conn: DatabaseConnection, input: {
        readonly tenantId: string | null;
        readonly actorType: string;
        readonly actorId: string;
        readonly action: string;
        readonly resourceType: string;
        readonly resourceId: string;
        readonly detail: Record<string, unknown>;
        readonly parentEntryId?: string;
      }) {
        return kernel.audit.append(conn, {
          ...input,
          operation: input.action,
        } as import('../kernel/interfaces/audit.js').AuditCreateInput);
      },
    },
    events: {
      emit() {
        // EGP events are diagnostic — non-blocking, no-op adapter
      },
    },
    traceEmitter: {
      emit(conn: DatabaseConnection, ctx: OperationContext, event: {
        readonly correlationId: import('../kernel/interfaces/governance_ids.js').CorrelationId;
        readonly type: string;
        readonly payload: Record<string, unknown>;
      }) {
        return governanceSystem.traceEmitter.emit(conn, ctx, {
          runId: `egp-${event.correlationId}` as import('../kernel/interfaces/governance_ids.js').RunId,
          correlationId: event.correlationId,
          type: event.type as import('../kernel/interfaces/trace.js').TraceEventType,
          payload: event.payload as import('../kernel/interfaces/trace.js').TraceEventPayload,
        });
      },
    },
    suspensionQuery: governanceSystem.suspensionStore,
    time: kernel.time,
  };
  const egp = createExecutionGovernor(egpDeps);

  // EGP invocation gate (headroom check before capability execution)
  const invocationGate = createInvocationGate(egp);

  // GovernedOrchestration wrapper — replaces raw orchestration for all consumers (C-SEC-04)
  // C-06: createGovernedOrchestration returns { engine, getConsumptionRecordingFailureCount }
  // The counter is per-instance (closure-local), not module-level.
  const getGovernanceConnection = (): DatabaseConnection => {
    // Reuse the same connection accessor as the rest of the API surface
    return getConnection();
  };
  const governedOrchResult = createGovernedOrchestration(orchestration, {
    governance: governanceSystem,
    egp,
    invocationGate,
    getConnection: getGovernanceConnection,
    time: kernel.time,
  });
  const governedOrchestration = governedOrchResult.engine;

  // CCP claim system (closure-local — DC-P4-406, C-SEC-05)
  // Sprint 1: Real evidence validator replaces accept-all stub (CCP-01, CCP-02)
  const evidenceValidator = createEvidenceValidator();
  const capabilityResultScopeValidator = createCapabilityResultScopeValidator();

  const claimSystem = createClaimSystem({
    evidenceValidator,
    audit: kernel.audit,
    eventBus: kernel.events,
    traceEmitter: governanceSystem.traceEmitter,
    rateLimiter: kernel.rateLimiter,
    capabilityResultScopeValidator,
    time: kernel.time,
  });

  // WMP working memory system (closure-local — DC-P4-406, C-SEC-05)
  const wmpSystem = createWorkingMemorySystem({
    time: kernel.time,
  });

  // ── Step 5: Compose the Limen public API ──
  log({ level: 'info', category: 'init', message: 'Limen initialization complete' });

  const startTime = kernel.time.nowMs();
  const rbac = kernel.rbac;
  const rateLimiter = kernel.rateLimiter;

  // Connection accessor - each call gets the current connection
  // DatabaseLifecycle.open() returns a connection. We store it from kernel creation.
  // The kernel manages its own connection internally.
  let activeConn: DatabaseConnection | null = null;
  const getConnection = (): DatabaseConnection => {
    if (!activeConn) {
      // Open a connection via the database lifecycle
      const openResult = kernel.database.open({
        dataDir: resolvedConfig.dataDir,
        tenancy: { mode: tenancyMode === 'multi' ? (resolvedConfig.tenancy?.isolation ?? 'row-level') : 'single' },
      });
      if (!openResult.ok) {
        throw new LimenError('ENGINE_UNHEALTHY', 'Failed to open database connection.');
      }
      activeConn = openResult.value;
    }
    return activeConn;
  };

  // Build default operation context for single-user mode
  const allPermissions = new Set<Permission>([
    'create_agent', 'modify_agent', 'delete_agent',
    'chat', 'infer', 'create_mission',
    'view_telemetry', 'view_audit',
    'manage_providers', 'manage_budgets', 'manage_roles',
    'purge_data',
    'approve_response', 'edit_response', 'takeover_session', 'review_batch',
  ]);

  // Library-mode agent identity: set via setDefaultAgent() after agent registration.
  // Captured by getContext closure — mutable even after engine object is frozen.
  let defaultAgentId: import('../kernel/interfaces/index.js').AgentId | null = null;

  const getContext = (): OperationContext => {
    if (tenancyMode === 'single') {
      return buildOperationContext(null, null, defaultAgentId, allPermissions);
    }
    // Multi-tenant: context must be provided per-call via session
    return buildOperationContext(null, null, null, new Set());
  };

  const getAudit = () => kernel.audit;
  const getSubstrate = () => substrate;

  // Initialize metrics collector
  const metricsCollector = new MetricsCollector(kernel);

  // CF-017: Wire checkpoint auto-expiry timer.
  // S24: Expired checkpoints auto-rejected every 30 seconds.
  // Uses OrchestrationDeps with current conn + audit.
  const checkpointExpiryTimer = setInterval(() => {
    try {
      const conn = getConnection();
      const expiryDeps = Object.freeze({
        conn,
        substrate,
        audit: kernel.audit,
        time: kernel.time,
      });
      orchestration.checkpoints.expireOverdue(expiryDeps as import('../orchestration/interfaces/orchestration.js').OrchestrationDeps);
    } catch {
      // Timer errors do not propagate. Expiry will retry next tick.
    }
  }, 30_000);

  // CF-033 OP-01: Periodic WAL checkpoint timer.
  // PASSIVE checkpoint every 5 minutes to bound WAL file growth.
  // PASSIVE mode does not block concurrent readers or writers.
  const walCheckpointTimer = setInterval(() => {
    try {
      const conn = getConnection();
      conn.run('PRAGMA wal_checkpoint(PASSIVE)');
    } catch {
      // Checkpoint failure is non-fatal. WAL will be replayed on next open.
    }
  }, 300_000); // 5 minutes

  // Determine default model from providers config
  const defaultModel = resolvedConfig.providers?.[0]?.models[0] ?? 'default';

  // Phase 2B: TGP ↔ Pipeline — create learning system for technique injection.
  // The applicator is wired as the technique reader into the chat pipeline.
  // Only the read-only getActivePromptFragments path is used at inference time.
  const learningSystem = createLearningSystem({
    getConnection,
    audit: kernel.audit,
    events: kernel.events,
    rbac,
    rateLimiter,
    gateway: substrate.gateway,
    time: kernel.time,
  });

  // Initialize chat pipeline
  // C-SEC-04: ChatPipeline receives governedOrchestration (not raw orchestration)
  const chatPipeline = new ChatPipeline(
    rbac, rateLimiter, governedOrchestration, substrate.gateway,
    getConnection, getAudit, getSubstrate,
    defaultTimeoutMs, backpressureConfig, defaultModel,
    learningSystem.applicator, 127_500, kernel.time, metricsCollector,
  );

  // Initialize infer pipeline
  const inferPipeline = new InferPipeline(
    rbac, rateLimiter, substrate.gateway,
    getConnection, defaultTimeoutMs, defaultModel, metricsCollector,
  );

  // Initialize session manager (needs chat and infer functions)
  // C-SEC-04: SessionManager receives governedOrchestration (not raw orchestration)
  const sessionManager = new SessionManager(
    rbac, governedOrchestration, getConnection, getAudit, getSubstrate, tenancyMode,
    // chatFn: delegates to chat pipeline
    (sessionState, message, options) => chatPipeline.execute(sessionState, message, options),
    // inferFn: delegates to infer pipeline
    async (sessionState, options) => inferPipeline.execute(sessionState, options),
    kernel.time,
  );

  // Initialize sub-API implementations
  // C-SEC-04: MissionApiImpl receives governedOrchestration (not raw orchestration)
  const missionsApi = new MissionApiImpl(
    rbac, rateLimiter, governedOrchestration, kernel.events,
    getConnection, getContext, getAudit, getSubstrate,
  );

  const agentsApi = new AgentApiImpl(
    rbac, rateLimiter, getConnection, getContext, kernel.time,
  );

  const rolesApi = new RolesApiImpl(
    rbac, rateLimiter, getConnection, getContext,
  );

  const dataApi = new DataApiImpl(
    rbac, rateLimiter, kernel, getConnection, getContext,
  );

  // Phase 4: Create facade instances (DC-P4-404, DC-P4-405, DC-P4-406)
  const rawClaimsFacade = createRawClaimFacade(claimSystem, rbac, rateLimiter);
  const rawWmFacade = createRawWorkingMemoryFacade(wmpSystem, rbac, rateLimiter);
  const claimsApi = new ClaimApiImpl(rawClaimsFacade, getConnection, getContext);
  const wmApi = new WorkingMemoryApiImpl(rawWmFacade, getConnection, getContext);

  // Phase 1: Eager convenience initialization (I-CONV-01, I-CONV-02)
  // Register convenience agent + create convenience mission during createLimen().
  // All convenience methods become synchronous Result<T> after this point.
  let convenienceLayer: ReturnType<typeof createConvenienceLayer> | null = null;
  try {
    const convInit = await initializeConvenience(agentsApi, missionsApi, (agentId) => {
      defaultAgentId = agentId;
    }, kernel.time);

    convenienceLayer = createConvenienceLayer({
      claims: claimsApi,
      getConnection,
      time: kernel.time,
      missionId: convInit.missionId,
      taskId: convInit.taskId,
      maxAutoConfidence,
    });

    log({ level: 'info', category: 'init', message: 'Convenience API initialized', context: { missionId: convInit.missionId, agentId: String(convInit.agentId) } });
  } catch (convErr) {
    // Convenience init failure is non-fatal for backward compatibility.
    // Existing consumers who don't use convenience methods are unaffected.
    // Convenience methods will throw if called without initialization.
    log({ level: 'warn', category: 'init', message: 'Convenience API initialization failed (non-fatal)', context: { error: convErr instanceof Error ? convErr.message : String(convErr) } });
  }

  // Build the Limen object
  const engine: Limen = {
    // S27, S48: Chat API
    chat(message: string | ChatMessage, options?: ChatOptions): ChatResult {
      try {
        // For top-level limen.chat(), use the default session (SD-15, S48)
        const sessionId = options?.sessionId;

        if (sessionId) {
          const state = sessionManager.getSessionState(sessionId);
          if (!state) {
            // Return a ChatResult whose promises reject
            const error = new LimenError('SESSION_NOT_FOUND', 'The specified session was not found.');
            return {
              text: Promise.reject(error),
              stream: (async function* (): AsyncGenerator<StreamChunk> {
                yield { type: 'error' as const, code: error.code, message: error.message };
              })(),
              metadata: Promise.reject(error),
            };
          }
          return chatPipeline.execute(state, message, options);
        }

        // S48, SD-15: Use default session (lazy initialization)
        // Since chat() must return synchronously (SD-01), we start the pipeline
        // with a deferred session resolution.
        //
        // MEDIUM-001: Execute the pipeline ONCE and reuse the result.
        // Store the promise of the ChatResult and distribute its fields.
        const defaultSessionPromise = sessionManager.getDefaultSession();
        const resultPromise = defaultSessionPromise.then(
          (state) => chatPipeline.execute(state, message, options),
        );

        // SD-01: Distribute the single pipeline execution across the ChatResult fields
        const textPromise = resultPromise.then((r) => r.text);
        const metadataPromise = resultPromise.then((r) => r.metadata);

        const streamIterable: AsyncIterable<StreamChunk> = {
          [Symbol.asyncIterator]() {
            let innerIterator: AsyncIterator<StreamChunk> | null = null;

            return {
              async next(): Promise<IteratorResult<StreamChunk>> {
                if (!innerIterator) {
                  const result = await resultPromise;
                  innerIterator = result.stream[Symbol.asyncIterator]();
                }
                return innerIterator.next();
              },
              async return(): Promise<IteratorResult<StreamChunk>> {
                if (innerIterator?.return) {
                  return innerIterator.return();
                }
                return { value: undefined as unknown as StreamChunk, done: true };
              },
              async throw(err: Error): Promise<IteratorResult<StreamChunk>> {
                if (innerIterator?.throw) {
                  return innerIterator.throw(err);
                }
                return { value: undefined as unknown as StreamChunk, done: true };
              },
            };
          },
        };

        return {
          text: textPromise,
          stream: streamIterable,
          metadata: metadataPromise,
        };
      } catch (error) {
        const limeError = ensureLimenError(error);
        return {
          text: Promise.reject(limeError),
          stream: (async function* (): AsyncGenerator<StreamChunk> {
            yield { type: 'error' as const, code: limeError.code, message: limeError.message };
          })(),
          metadata: Promise.reject(limeError),
        };
      }
    },

    // S28: Structured output
    async infer<T>(options: InferOptions<T>): Promise<InferResult<T>> {
      const sessionId = options.sessionId;

      if (sessionId) {
        const state = sessionManager.getSessionState(sessionId);
        if (!state) {
          throw new LimenError('SESSION_NOT_FOUND', 'The specified session was not found.');
        }
        return inferPipeline.execute(state, options);
      }

      // Use default session
      const state = await sessionManager.getDefaultSession();
      return inferPipeline.execute(state, options);
    },

    // S26: Session management
    async session(options: SessionOptions): Promise<Session> {
      return sessionManager.createSession(options);
    },

    // S12, DL-2: Agent management
    agents: agentsApi,

    // S14-S24: Mission management
    missions: missionsApi,

    // §34: RBAC management
    roles: rolesApi,

    // S32.4: Health check
    // MEDIUM-003: RBAC limitation documented. The public Limen.health() interface
    // takes no parameters (no OperationContext), so RBAC cannot be enforced here.
    // In single-tenant mode, RBAC is dormant (all permissions granted), so this is safe.
    // In multi-tenant mode, health() should be gated by a middleware/transport layer
    // that injects context before reaching the engine. This is a known limitation
    // for the Phase 4 API surface; the transport layer (Phase 5+) will enforce
    // 'view_telemetry' permission before proxying health calls.
    async health(): Promise<HealthStatus> {
      return getHealth(kernel, substrate, getConnection(), startTime);
    },

    // S32.2: Metrics
    // MEDIUM-002: Expose a frozen facade instead of the mutable MetricsCollector directly.
    // deepFreeze (C-07) would freeze the collector's internal counters, breaking mutation.
    // The facade delegates snapshot() to the unfrozen collector, which remains outside
    // the frozen engine object graph.
    // SEC-018: Pass optional tenantId through to MetricsCollector for tenant-scoped metrics
    metrics: { snapshot: (tenantId?: string) => metricsCollector.snapshot(tenantId) },

    // I-02: Data management
    data: dataApi,

    // Sprint 7: Claim management — consumer convenience wrapper (SC-11, SC-12, SC-13)
    // DC-P4-406: Raw ClaimSystem is closure-local, wrapped by ClaimApiImpl
    claims: claimsApi,

    // Sprint 7: Working memory management — consumer convenience wrapper (SC-14, SC-15, SC-16)
    // DC-P4-406: Raw WorkingMemorySystem is closure-local, wrapped by WorkingMemoryApiImpl
    workingMemory: wmApi,

    // Phase 1: Convenience API methods
    // Delegates to convenienceLayer (created during eager init).
    // If convenience init failed, methods throw LimenError.
    remember(
      subjectOrText: string,
      predicateOrOptions?: string | import('./interfaces/api.js').RememberOptions,
      value?: string,
      options?: import('./interfaces/api.js').RememberOptions,
    ) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.remember(subjectOrText, predicateOrOptions, value, options);
    },

    recall(subject?: string, predicate?: string, options?: import('./interfaces/api.js').RecallOptions) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.recall(subject, predicate, options);
    },

    forget(claimId: string, reason?: string) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.forget(claimId, reason);
    },

    connect(claimId1: string, claimId2: string, type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from') {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.connect(claimId1, claimId2, type);
    },

    reflect(entries: readonly import('./interfaces/api.js').ReflectEntry[]) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.reflect(entries);
    },

    promptInstructions() {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.promptInstructions();
    },

    search(query: string, options?: import('./convenience/convenience_types.js').SearchOptions) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.search(query, options);
    },

    // Library-mode agent identity setter.
    // Modifies closure-captured defaultAgentId — safe after deep freeze
    // because the function reference is frozen, not the captured variable.
    setDefaultAgent(agentId: import('../kernel/interfaces/index.js').AgentId) {
      defaultAgentId = agentId;
    },

    // S3.4, I-05, SD-06: Graceful shutdown
    // CF-011: Each step wrapped in try/catch so that one failure
    // does not prevent subsequent cleanup. Errors are collected.
    async shutdown(): Promise<void> {
      log({ level: 'info', category: 'shutdown', message: 'Limen shutdown starting' });
      const shutdownErrors: Error[] = [];

      // CF-017: Stop checkpoint expiry timer before closing connections
      try {
        clearInterval(checkpointExpiryTimer);
      } catch (err) {
        shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
      }

      // CF-033 OP-01: Stop WAL checkpoint timer
      try {
        clearInterval(walCheckpointTimer);
      } catch (err) {
        shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
      }

      // 1. Close all active sessions (terminates streams with error chunks)
      try {
        await sessionManager.closeAll();
      } catch (err) {
        shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
      }

      // 1.5. Sprint 5 (EVENT-01): Flush pending webhook deliveries before closing.
      // IP-6: Best-effort delivery of any queued webhooks during shutdown.
      // Non-fatal: delivery failure does not block shutdown.
      try {
        if (activeConn) {
          const deliveryResult = await deliverWebhooks(activeConn, undefined, kernel.time);
          if (deliveryResult.delivered > 0 || deliveryResult.failed > 0) {
            log({ level: 'info', category: 'shutdown', message: `Webhook flush: ${deliveryResult.delivered} delivered, ${deliveryResult.failed} failed, ${deliveryResult.exhausted} exhausted` });
          }
        }
      } catch (err) {
        log({ level: 'warn', category: 'shutdown', message: 'Webhook flush failed (non-fatal)', context: { error: err instanceof Error ? err.message : String(err) } });
      }

      // 2. Shutdown substrate (stop workers, drain queues)
      try {
        if (activeConn) {
          const ctx = getContext();
          substrate.shutdown(activeConn, ctx);
        }
      } catch (err) {
        shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
      }

      // 3. Close database connections
      try {
        if (activeConn) {
          activeConn.close();
          activeConn = null;
        }
      } catch (err) {
        shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
      }

      // R4C-004: Close orchestration connection (opened by default adapter)
      try {
        if (orchestrationConn) {
          orchestrationConn.close();
          orchestrationConn = null;
        }
      } catch (err) {
        shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
      }

      // 4. Destroy kernel (checkpoint WAL, close kernel's internal connection)
      try {
        destroyKernel(kernel);
      } catch (err) {
        shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
      }

      // If any errors occurred during shutdown, report the first one
      // but all steps have completed their cleanup attempt.
      if (shutdownErrors.length > 0) {
        log({ level: 'error', category: 'shutdown', message: 'Shutdown completed with errors', context: { errorCount: shutdownErrors.length, firstError: shutdownErrors[0]!.message } });
        throw ensureLimenError(shutdownErrors[0]!);
      }
      log({ level: 'info', category: 'shutdown', message: 'Limen shutdown complete' });
    },
  };

  // ── Step 6: Deep freeze (C-07, FPD-4) ──

  deepFreeze(engine);

  return engine;
}
