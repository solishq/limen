// @governance SolisForge Protocol v1.4 — Sole Governing Doctrine
// @traceability contracts/LIMEN_V5_INTEGRATION_CONTRACT.md §5.1
/**
 * createLimen() factory -- the sole entry point to the Limen engine.
 * S ref: S3.3 (engine not framework), C-06 (independent instances),
 *        C-07 (Object.freeze), FPD-2 (async factory), FPD-4 (deep freeze),
 *        S39 IP-4 (TypeScript API), SD-06 (shutdown on instance)
 *
 * ARCHITECTURAL NOTE (Finding-47): This factory function is large (~2400 lines)
 * because it wires all kernel components in a single composition root.
 * Future refactor: decompose into buildKernelLayer(), buildSubstrateLayer(),
 * buildOrchestrationLayer(), wireEventHandlers(), buildPublicApi().
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

import { createRequire } from 'node:module';
import type {
  Kernel, CreateKernelFn, DestroyKernelFn,
  DatabaseConnection, OperationContext, Permission, MissionId,
} from '../kernel/interfaces/index.js';
import type { Substrate } from '../substrate/interfaces/substrate.js';
import type { SubstrateConfig } from '../substrate/interfaces/substrate.js';
import type { OrchestrationEngine } from '../orchestration/interfaces/orchestration.js';
import type { TransitionEnforcer } from '../kernel/interfaces/lifecycle.js';

// CF-004: Real factory functions for default wiring
import { createKernel as realCreateKernel, destroyKernel as realDestroyKernel } from '../kernel/index.js';
import { createStringEncryption } from '../kernel/crypto/crypto_engine.js';
import { rotateKey } from '../kernel/crypto/key_rotation.js';
import { createSubstrate as realCreateSubstrate, getPhase2Migrations } from '../substrate/index.js';
import { createOrchestration as realCreateOrchestration, getPhase3Migrations } from '../orchestration/index.js';
import { getPhase4BMigrations } from '../orchestration/migration/004_tenant_isolation.js';
import type { TenantScopedConnection } from '../kernel/tenant/tenant_scope.js';
import { createTenantScopedConnection } from '../kernel/tenant/tenant_scope.js';
import { getPhase4D2ImmutabilityMigrations } from '../orchestration/migration/005_immutability_triggers.js';
import { getPhase4D4TombstoneMigrations } from '../orchestration/migration/006_audit_tombstone.js';
import type {
  Limen, LimenConfig, ChatMessage, ChatOptions, ChatResult,
  InferOptions, InferResult, SessionOptions, Session,
  HealthStatus, BackpressureConfig, StreamChunk,
} from './interfaces/api.js';

import { randomUUID } from 'node:crypto';
import { applyPermissionGateway, getAllGatewayPermissions } from './gateway/permission_gateway.js';
export type { MethodPermission } from './gateway/permission_gateway.js';
export { PERMISSION_MAP, getAllGatewayPermissions } from './gateway/permission_gateway.js';
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

// Phase 3: Cognitive Metabolism migration (v39) + Access Tracker
import { getCognitiveMetabolismMigrations } from './migration/030_cognitive_metabolism.js';
import { createAccessTracker } from '../cognitive/access_tracker.js';
import type { AccessTracker } from '../cognitive/access_tracker.js';

// Phase 4: Quality & Safety migration (v40)
import { getConflictIndexMigrations } from './migration/031_conflict_index.js';

// Phase 5: Reasoning migration (v41) + Cognitive API
import { getReasoningMigrations } from './migration/032_reasoning.js';
import { createCognitiveNamespace } from './cognitive/cognitive_api.js';

// v3.0.0 WG-02: Replay Engine
import { createReplayEngine } from '../substrate/replay/replay_engine.js';

// v3.0.0 EG-03/04: Trust-to-clearance mapping for classification filtering
import { getClearanceForTrust } from './agents/trust_progression.js';
import type { TrustLevel } from './agents/trust_progression.js';

// Phase 9: Security Hardening migration (v42) + Consent Registry
import { getSecurityHardeningMigrations } from './migration/033_security_hardening.js';
import { createConsentRegistry } from '../security/consent_registry.js';
import { freezeSecurityPolicy } from '../security/security_types.js';
import type { ConsentApi, GovernanceApi, SecurityApi } from './interfaces/api.js';

// ST-19: Consent Gate — wired into remember() and exportAudit() call paths
import { checkConsentGate } from '../security/consent_gate.js';
import type { ConsentGateDeps, ConsentCheckContent } from '../security/consent_gate.js';

// Phase 10: Governance Suite migration (v43) + engines
import { getGovernanceSuiteMigrations } from './migration/034_governance_suite.js';
import { executeErasure } from '../governance/compliance/erasure_engine.js';

// Phase 11: Vector Search migration (v44) + modules
import { getVectorSearchMigrations, createVec0Table } from './migration/035_vector_search.js';
import { createVectorStore } from '../vector/vector_store.js';
import { createEmbeddingQueue } from '../vector/embedding_queue.js';
import { hybridRank } from '../vector/hybrid_ranker.js';
import { checkDuplicate as checkDuplicateImpl, distanceToSimilarity } from '../vector/duplicate_detector.js';
import { DEFAULT_VECTOR_CONFIG } from '../vector/vector_types.js';
import type { EmbeddingStats, DuplicateCheckResult } from '../vector/vector_types.js';
import type { VectorStore } from '../vector/vector_store.js';
import type { ClaimId } from '../claims/interfaces/claim_types.js';
import type { EmbeddingQueue } from '../vector/embedding_queue.js';
import { generateComplianceExport } from '../governance/compliance/compliance_export.js';
import type { ClassificationRule, ProtectedPredicateRule, ErasureRequest, ComplianceExportOptions } from '../governance/classification/governance_types.js';

// Phase 12: Cognitive Engine migration (v45) + self-healing
import { getCognitiveEngineMigrations } from './migration/036_cognitive_engine.js';
import { processSelfHealing, isInActiveCascade } from '../cognitive/self_healing.js';
import { DEFAULT_SELF_HEALING_CONFIG } from '../cognitive/cognitive_types.js';
import type { SelfHealingConfig } from '../cognitive/cognitive_types.js';
import { computeDecayFactor, computeAgeMs } from '../cognitive/decay.js';
import { computeCascadePenalty } from '../cognitive/cascade.js';
import { resolveStability } from '../cognitive/stability.js';
import { classifyFreshness } from '../cognitive/freshness.js';

// Phase 5 fix: FTS5 retraction guard migration (v46)
// Finding-25: Renamed from 037_ to 046_ to match internal version number
import { getFts5RetractionGuardMigrations } from './migration/046_fts5_retraction_guard.js';

// Phase 13A: Sync Foundation migration (v47)
// Finding-25: Renamed from 037_ to 047_ to match internal version number
import { getSyncFoundationMigrations } from './migration/047_sync_foundation.js';

// Phase 5: Agent Lifecycle Management migration (v48)
import { getAgentLifecycleMigrations } from './migration/048_agent_lifecycle.js';
// Phase 5: Lifecycle remediation migration (v49) — BK-12, BK-16, BK-17
import { getLifecycleRemediationMigrations } from './migration/049_lifecycle_remediation.js';

// Phase 5: Agent Lifecycle Client
import { createAgentLifecycleClient } from '../lifecycle/agent_lifecycle_client.js';

// Phase 5 Subsystem 3: Output Governance migration (v50)
import { getOutputGovernanceMigrations } from './migration/050_output_governance.js';

// Subsystem 4: Coordination Governance migration (v51)
import { getCoordinationGovernanceMigrations } from './migration/051_coordination_governance.js';

// Phase 5 Subsystem 3: Output Governance Client
import { createAgentOutputClient, type AgentOutputClient } from '../output/output_governance.js';

// Subsystem 4: Coordination Governance Client
import { createAgentCoordinationClient, type AgentCoordinationClient } from '../coordination/coordination_governance.js';

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

// Phase 4 FR-001: Output Primitives API
import { createOutputApi } from './output/output_api.js';
import { initializeConvenience } from './convenience/convenience_init.js';
import { DEFAULT_MAX_AUTO_CONFIDENCE } from './convenience/convenience_types.js';

// Phase 7 FR-004: Telemetry API
import { createTelemetryApi } from './telemetry/telemetry_api.js';

// Phase 7 FR-002: A2A Governance API
import { createA2AGovernanceApi } from './a2a-governance/a2a_governance_api.js';

// Phase 8: Plugin Registry and Exchange
import { createPluginRegistry } from '../plugins/plugin_registry.js';
import { exportKnowledge } from '../exchange/export.js';
import { importKnowledge } from '../exchange/import.js';
import type { LimenEventName, LimenEventHandler } from '../plugins/plugin_types.js';
import type { ExportOptions, LimenExportDocument, ImportOptions } from '../exchange/exchange_types.js';

// Phase 2.6: Computational Pipeline Hook Registry
import { createHookRegistry } from '../plugins/hook_registry.js';
import type { HookRegistry } from '../plugins/hook_registry.js';

// ============================================================================
// Vector Search Hydration Helpers (Task 4: compute real values instead of hardcoding)
// ============================================================================

/** Check if a claim is superseded by querying the relationship graph. */
function vectorHydrateSuperseded(conn: DatabaseConnection, claimId: string): boolean {
  const row = conn.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claim_relationships WHERE to_claim_id = ? AND type = 'supersedes'`,
    [claimId],
  );
  return (row?.cnt ?? 0) > 0;
}

/** Check if a claim is disputed (bidirectional 'contradicts' check, per I-P4-09).
 *  v3.0.0 fix (F-V3P1-001): Only count contradictions where the OTHER claim is still active.
 *  Previously counted retracted contradictors, leaving disputed=true after retraction.
 *  Matches the query pattern applied to claim_stores.ts (2 of 3 sites were fixed; this is site 3).
 */
function vectorHydrateDisputed(conn: DatabaseConnection, claimId: string): boolean {
  const row = conn.get<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM claim_relationships cr
     JOIN claim_assertions ca ON ca.id = CASE WHEN cr.from_claim_id = ? THEN cr.to_claim_id ELSE cr.from_claim_id END
     WHERE (cr.to_claim_id = ? OR cr.from_claim_id = ?) AND cr.type = 'contradicts' AND ca.status = 'active'`,
    [claimId, claimId, claimId],
  );
  return (row?.cnt ?? 0) > 0;
}


// ============================================================================
// Re-export public types (convenience for consumers)
// ============================================================================

export type { Limen, LimenConfig, LimenLogEvent, LimenLogger } from './interfaces/api.js';
export { LimenError } from './errors/limen_error.js';
export type { LimenErrorCode } from './interfaces/api.js';
export { resolveDefaults, detectProviders, resolveMasterKey, resolveDataDir } from './defaults.js';
export { DEFAULT_HOOK_PRIORITY } from '../plugins/hook_types.js';

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
  ClaimRelationship, RelationshipType,
  ClaimQueryInput, ClaimQueryResult, RetractClaimInput,
  CognitiveConfig, RememberOptions, RememberResult,
  RecallOptions, BeliefView, ReflectEntry, ReflectResult,
  ConvenienceErrorCode, EvidenceRef, ForgetOptions,
  FreshnessLabel, FreshnessThresholds,
  StabilityConfig, AccessTrackerConfig,
  WorkingMemoryApi, WriteWorkingMemoryInput, WriteWorkingMemoryOutput,
  ReadWorkingMemoryInput, ReadWorkingMemoryOutput,
  DiscardWorkingMemoryInput, DiscardWorkingMemoryOutput,
  // Phase 5: Cognitive API types
  CognitiveNamespace, CognitiveHealthReport, CognitiveHealthConfig,
  // Phase 4 FR-001: Output Primitives API types
  OutputApi, OutputAssertOptions, OutputQueryOptions,
  // Phase 8: Plugin and Exchange types
  LimenPlugin, LimenEventName, LimenEventHandler, LimenEvent,
  PluginMeta, PluginContext, PluginApi, PluginLogger,
  PluginErrorCode,
  // Phase 2.6: Hook types
  LimenHook,
  ClaimAssertionHook, DecayHook, RecallHook,
  AssertionHookContext, AssertedClaimInfo,
  RecallBeliefView, RecallQueryContext,
  HookErrorCode,
  ExportOptions, ExportFormat,
  LimenExportDocument, ExportedClaim, ExportedRelationship, ExportedEvidenceRef,
  ExportMetadata,
  ImportOptions, ImportResult, ImportError, ImportDedup,
  ExchangeErrorCode,
  // Phase 9: Security and Consent types
  ConsentApi, SecurityApi, ConsentRecord, ConsentCreateInput, ConsentBasis, ConsentStatus,
  SecurityPolicy, PiiCategory, PiiAction, SecurityErrorCode,
  ContentScanResult, PiiScanResult, InjectionScanResult,
  // Phase 10: Governance types
  GovernanceApi,
  ClassificationLevel, ClassificationRule, ClassificationResult,
  ProtectedPredicateRule, ErasureRequest, ErasureCertificate,
  Soc2AuditPackage, Soc2ControlEvidence, Soc2Statistics,
  ComplianceExportOptions, GovernanceConfig, GovernanceErrorCode,
  // Phase 11: Vector Search types
  EmbeddingProvider, VectorConfig, StoredEmbedding,
  DuplicateCandidate, DuplicateCheckResult,
  SearchMode, HybridScore, HybridWeights,
  VectorErrorCode, EmbeddingStats,
  // Phase 12: Cognitive Engine types
  SelfHealingConfig, SelfHealingEvent,
  ConsolidationOptions, ConsolidationResult, ConsolidationLogEntry, ConflictResolution,
  ImportanceScore, ImportanceWeights,
  ConnectionSuggestion,
  NarrativeSnapshot, NarrativeThread,
  VerificationResult, VerificationProvider,
  CognitiveErrorCode,
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
      ...getCognitiveMetabolismMigrations(),              // v39: Phase 3 cognitive metabolism columns
      ...getConflictIndexMigrations(),                     // v40: Phase 4 conflict detection index
      ...getReasoningMigrations(),                          // v41: Phase 5 reasoning column
      ...getSecurityHardeningMigrations(),                    // v42: Phase 9 security hardening
      ...getGovernanceSuiteMigrations(),                       // v43: Phase 10 governance suite
      ...getVectorSearchMigrations(),                          // v44: Phase 11 vector search
      ...getCognitiveEngineMigrations(),                         // v45: Phase 12 cognitive engine
      ...getFts5RetractionGuardMigrations(),                      // v46: Phase 5 fix — FTS5 retraction guard
      ...getSyncFoundationMigrations(),                            // v47: Phase 13A sync foundation
      ...getAgentLifecycleMigrations(),                              // v48: Phase 5 agent lifecycle
      ...getLifecycleRemediationMigrations(),                        // v49: BK-12, BK-16, BK-17 remediation
      ...getOutputGovernanceMigrations(),                              // v50: Phase 5 output governance
      ...getCoordinationGovernanceMigrations(),                          // v51: Subsystem 4 coordination governance
    ]);
    if (!phase4Governance.ok) {
      conn.close();
      throw new LimenError('ENGINE_UNHEALTHY', `Failed to run migrations (v16-v39): ${phase4Governance.error.message}`);
    }

    // CF-004 / self-review: cleanup connection if orchestration construction fails
    // CF-007: Pass kernel.rateLimiter for persistent, SQLite-backed rate limiting
    // P0-A: Pass transitionEnforcer for the OrchestrationTransitionService.
    // createOrchestration() uses a passthrough enforcer when undefined (test backward compat).
    try {
      return realCreateOrchestration(conn, substrate, kernel.audit, kernel.rateLimiter, kernel.time, transitionEnforcer, kernel.events);
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
 * FINDING-022: Utility type — drop the first element from a tuple type.
 * Used to strip the OperationContext parameter from v5 subsystem method signatures,
 * enabling ctx auto-injection at the API surface while preserving type safety.
 */
type DropFirst<T extends readonly unknown[]> = T extends [unknown, ...infer R] ? R : never;

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
  // Merge user-provided partial config with auto-detected defaults.
  // FINDING-015: `config ?? resolveDefaults()` replaced entire defaults when ANY config provided.
  // Fix: always resolve defaults, then overlay user config on top.
  const defaults = resolveDefaults();
  const resolvedConfig: LimenConfig = config
    ? {
        ...defaults,
        ...config,
        // Preserve defaults for fields the user didn't specify
        dataDir: config.dataDir ?? defaults.dataDir,
        masterKey: config.masterKey ?? defaults.masterKey,
      } as LimenConfig
    : defaults;

  // Phase 8: Extract debug flag for error construction throughout the factory.
  // When true, LimenError preserves original stack traces and messages.
  const debug = resolvedConfig.debug === true;

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
  const rateLimitingConfig = (resolvedConfig.rateLimiting !== false && resolvedConfig.rateLimiting)
    ? resolvedConfig.rateLimiting : undefined;
  const maxConcurrentStreams = rateLimitingConfig?.maxConcurrentStreams ?? 50;

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
    // Phase 4 §4.5, C.8: Thread requireRbac to kernel RBAC engine.
    // I-P4-10: Default false when undefined.
    ...(resolvedConfig.requireRbac ? { requireRbac: true } : {}),
    // H12-FIX: Thread rate limiting config overrides to kernel rate limiter.
    // exactOptionalPropertyTypes: only include defined values.
    ...(rateLimitingConfig ? {
      rateLimiting: {
        ...(rateLimitingConfig.apiCallsPerMinute !== undefined
          ? { apiCallsPerMinute: rateLimitingConfig.apiCallsPerMinute } : {}),
        ...(rateLimitingConfig.emitEventPerMinute !== undefined
          ? { emitEventPerMinute: rateLimitingConfig.emitEventPerMinute } : {}),
      },
    } : {}),
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
    throw ensureLimenError(err, debug);
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
    throw ensureLimenError(err, debug);
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
        ...getCognitiveMetabolismMigrations(),
        ...getConflictIndexMigrations(),
        ...getReasoningMigrations(),
        ...getSecurityHardeningMigrations(),
        ...getGovernanceSuiteMigrations(),
        ...getVectorSearchMigrations(),
        ...getCognitiveEngineMigrations(),
        ...getFts5RetractionGuardMigrations(),
        ...getSyncFoundationMigrations(),
        ...getAgentLifecycleMigrations(),
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

  // v3.0.0 EG-01: Lazy consent registry binding.
  // consentRegistry is created later (~line 1324) but referenced by claimSystem's
  // getConsentRegistry getter. This mutable binding captures the eventual reference.
  let lazyConsentRegistry: ReturnType<typeof createConsentRegistry> | null = null;

  // Phase 2.6: Create and register computational pipeline hooks (before claimSystem)
  const hookRegistry: HookRegistry = createHookRegistry({
    log: (level, category, message, context) => {
      log({ level: level as 'debug' | 'info' | 'warn' | 'error', category, message, ...(context ? { context } : {}) });
    },
  });
  if (resolvedConfig.hooks && resolvedConfig.hooks.length > 0) {
    const hookResult = hookRegistry.registerAll(resolvedConfig.hooks);
    if (!hookResult.ok) {
      log({ level: 'error', category: 'hook', message: `Hook registration failed: ${hookResult.error.message}` });
    }
  }

  // CCP claim system (closure-local — DC-P4-406, C-SEC-05)
  // Sprint 1: Real evidence validator replaces accept-all stub (CCP-01, CCP-02)
  const evidenceValidator = createEvidenceValidator();
  const capabilityResultScopeValidator = createCapabilityResultScopeValidator();

  const claimSystem = createClaimSystem({
    // Phase 2.6: Hook registry for assertion/decay interception
    hookRegistry,
    evidenceValidator,
    audit: kernel.audit,
    eventBus: kernel.events,
    traceEmitter: governanceSystem.traceEmitter,
    rateLimiter: kernel.rateLimiter,
    capabilityResultScopeValidator,
    time: kernel.time,
    // v5.0.0 FINDING-001: Disable claim-level rate limiting unconditionally.
    // Rate limiting belongs at the TRANSPORT boundary (MCP, HTTP), not inside the library.
    // Library consumers calling convenience API in batch/test scenarios hit the 100/min limit
    // rapidly because each remember() = query + assert + N relate operations.
    // The kernel rateLimiter (API facade level) handles transport protection.
    disableRateLimit: true,
    // Phase 3: Stability and freshness configuration for decay computation.
    // Spread conditionally to avoid passing undefined with exactOptionalPropertyTypes.
    ...(config?.cognitive?.stability ? { stabilityConfig: config.cognitive.stability } : {}),
    ...(config?.cognitive?.freshness ? { freshnessThresholds: config.cognitive.freshness } : {}),
    // Phase 4 §4.1: Structural conflict detection configuration.
    // Default true when undefined. Only false when explicitly set to false.
    ...(resolvedConfig.autoConflict === false ? { autoConflict: false } : {}),
    // Phase 9: Security policy (I-P9-50: non-breaking defaults)
    // F-P9-032: Deep-copy and freeze to prevent post-construction mutation (I-P9-51).
    ...(resolvedConfig.security ? { securityPolicy: freezeSecurityPolicy(resolvedConfig.security) } : {}),
    // Phase 10: Dynamic getters for governance rules (F-P10-001, F-P10-002, F-P10-003 fix).
    // Rules are stored in governance_classification_rules and governance_protected_predicates tables.
    // Getters read from DB at assertion/retraction time so custom rules added via GovernanceApi are enforced.
    getClassificationRules: () => {
      const conn = getConnection();
      const ctx = getContext();
      const rows = conn.query<Record<string, unknown>>(
        `SELECT id, predicate_pattern, level, reason, created_at FROM governance_classification_rules ${ctx.tenantId !== null ? 'WHERE tenant_id = ?' : 'WHERE tenant_id IS NULL'}`,
        ctx.tenantId !== null ? [ctx.tenantId] : [],
      );
      return rows.map(r => ({
        id: r['id'] as string,
        predicatePattern: r['predicate_pattern'] as string,
        level: r['level'] as import('../governance/classification/governance_types.js').ClassificationLevel,
        reason: r['reason'] as string,
        createdAt: r['created_at'] as string,
      }));
    },
    getProtectedPredicateRules: () => {
      const conn = getConnection();
      const ctx = getContext();
      const rows = conn.query<Record<string, unknown>>(
        `SELECT id, predicate_pattern, required_permission, action, created_at FROM governance_protected_predicates ${ctx.tenantId !== null ? 'WHERE tenant_id = ?' : 'WHERE tenant_id IS NULL'}`,
        ctx.tenantId !== null ? [ctx.tenantId] : [],
      );
      return rows.map(r => ({
        id: r['id'] as string,
        predicatePattern: r['predicate_pattern'] as string,
        requiredPermission: r['required_permission'] as import('../kernel/interfaces/common.js').Permission,
        action: r['action'] as 'assert' | 'retract' | 'both',
        createdAt: r['created_at'] as string,
      }));
    },
    getRbacActive: () => kernel.rbac.isActive(),
    // Phase 11+: Lazy getter for vector store — initialized after createClaimSystem.
    // I-P11-30: Retraction deletes stale embedding.
    getVectorStore: () => vectorStore,
    // v3.0.0 EG-01: Lazy getter for consent registry (initialized after claimSystem).
    // Returns null until consentRegistry is created (line ~1324).
    // Safe because assertClaim is only called after createLimen() completes.
    getConsentRegistry: () => lazyConsentRegistry,
  });

  // WMP working memory system (closure-local — DC-P4-406, C-SEC-05)
  const wmpSystem = createWorkingMemorySystem({
    time: kernel.time,
  });

  // ── Step 4.6: Replay Engine (v3.0.0 WG-02) ──
  const replayEngine = createReplayEngine(kernel.audit);

  // ── Step 5: Compose the Limen public API ──
  log({ level: 'info', category: 'init', message: 'Limen initialization complete' });

  const startTime = kernel.time.nowMs();
  const rbac = kernel.rbac;
  const rateLimiter = kernel.rateLimiter;

  // Connection accessor - each call gets the current connection
  // DatabaseLifecycle.open() returns a connection. We store it from kernel creation.
  // The kernel manages its own connection internally.
  let activeConn: DatabaseConnection | null = null;
  // DX-CRITICAL-FIX: Shutdown idempotency guard.
  // Prevents double-shutdown and post-shutdown connection access.
  let isShutDown = false;

  const getConnection = (): TenantScopedConnection => {
    // DX-CRITICAL-FIX: Reject connection requests after shutdown
    if (isShutDown) {
      throw new LimenError('ENGINE_SHUTDOWN', 'Limen has been shut down. Create a new instance.');
    }
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
    // Wrap raw connection with tenant scope.
    // In single-tenant mode (tenantId=null), createTenantScopedConnection returns a pass-through.
    // TenantScopedConnection extends DatabaseConnection — backward compatible for all callers.
    return createTenantScopedConnection(activeConn, getContext().tenantId);
  };

  // Build default operation context for single-user mode
  const allPermissions = new Set<Permission>([
    'create_agent', 'modify_agent', 'delete_agent',
    'chat', 'infer', 'create_mission',
    'view_telemetry', 'view_audit',
    'manage_providers', 'manage_budgets', 'manage_roles',
    'purge_data',
    'approve_response', 'edit_response', 'takeover_session', 'review_batch',
    // Phase 10: Governance permissions (I-P10-41: dormant RBAC unaffected)
    'classify_claims', 'manage_classification_rules',
    'manage_protected_predicates',
    'request_erasure', 'export_compliance',
    // v2.1.0: Include all gateway permissions so single-user mode has full access
    ...getAllGatewayPermissions(),
  ]);

  // Library-mode agent identity: set via setDefaultAgent() after agent registration.
  // Captured by getContext closure — mutable even after engine object is frozen.
  let defaultAgentId: import('../kernel/interfaces/index.js').AgentId | null = null;

  const getContext = (): OperationContext => {
    if (tenancyMode === 'single') {
      // v3.0.0 EG-03/04: In single-tenant mode, RBAC is dormant (§3.7).
      // The default convenience agent has trust_level='untrusted' (I-09: earned trust).
      // But in single-user mode, we grant full clearance for backward compat — the
      // classification filter only restricts in multi-tenant mode with explicit RBAC.
      // When requireRbac is true, resolve actual trust level for classification filtering.
      let clearance: number = 4; // full clearance by default in single-tenant
      if (resolvedConfig.requireRbac && defaultAgentId) {
        try {
          const conn = activeConn;
          if (conn) {
            const row = conn.get<{ trust_level: string | null }>(
              'SELECT trust_level FROM core_agents WHERE id = ?',
              [defaultAgentId],
            );
            clearance = getClearanceForTrust(row?.trust_level as TrustLevel | null);
          }
        } catch {
          // Non-fatal: default to full clearance if lookup fails
        }
      }
      return buildOperationContext(null, null, defaultAgentId, allPermissions, undefined, clearance);
    }
    // Multi-tenant: context must be provided per-call via session.
    // v3.0.0 EG-03/04: No clearance set — classification filter inactive for
    // multi-tenant until session-based clearance is implemented.
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
  // M6-FIX: unref() so this timer does not keep the Node.js process alive
  checkpointExpiryTimer.unref();

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
  // M6-FIX: unref() so this timer does not keep the Node.js process alive
  walCheckpointTimer.unref();

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

  // Phase 5 Subsystem 2: Agent Lifecycle Client (LM-2.01 through LM-2.22)
  const lifecycleClient = createAgentLifecycleClient({
    getConnection,
    audit: kernel.audit,
    kernelEvents: kernel.events,
    time: kernel.time,
    getContext,
  });

  const rolesApi = new RolesApiImpl(
    rbac, rateLimiter, getConnection, getContext,
  );

  const dataApi = new DataApiImpl(
    rbac, rateLimiter, kernel, getConnection, getContext,
  );

  // Phase 4: Create facade instances (DC-P4-404, DC-P4-405, DC-P4-406)
  const rawClaimsFacade = createRawClaimFacade(claimSystem, rbac, rateLimiter);
  const rawWmFacade = createRawWorkingMemoryFacade(wmpSystem, rbac, rateLimiter);

  // Phase 3: Create AccessTracker for cognitive metabolism (I-P3-12, I-P3-13).
  // PA Amendment: flushIntervalMs exposed via CognitiveConfig.accessTracking.
  const accessTracker: AccessTracker = createAccessTracker(getConnection, config?.cognitive?.accessTracking);
  const claimsApi = new ClaimApiImpl(rawClaimsFacade, getConnection, getContext, accessTracker, kernel.time);
  const wmApi = new WorkingMemoryApiImpl(rawWmFacade, getConnection, getContext);

  // Phase 1: Eager convenience initialization (I-CONV-01, I-CONV-02)
  // Register convenience agent + create convenience mission during createLimen().
  // All convenience methods become synchronous Result<T> after this point.
  let convenienceLayer: ReturnType<typeof createConvenienceLayer> | null = null;
  let convenienceMissionId: MissionId | null = null; // Phase 8: tracked for import
  try {
    const convInit = await initializeConvenience(agentsApi, missionsApi, (agentId) => {
      defaultAgentId = agentId;
    }, kernel.time);

    convenienceMissionId = convInit.missionId;

    convenienceLayer = createConvenienceLayer({
      claims: claimsApi,
      getConnection,
      time: kernel.time,
      missionId: convInit.missionId,
      taskId: convInit.taskId,
      maxAutoConfidence,
      // v3.0.0 WG-04: Pass stability/freshness config for query-time decay computation.
      // Ensures recall() returns decay-adjusted effectiveConfidence matching search().
      ...(config?.cognitive?.stability ? { stabilityConfig: config.cognitive.stability } : {}),
      ...(config?.cognitive?.freshness ? { freshnessThresholds: config.cognitive.freshness } : {}),
      // Phase 2.6: Wire hook registry for decay/recall interception
      hookRegistry,
    });

    log({ level: 'info', category: 'init', message: 'Convenience API initialized', context: { missionId: convInit.missionId, agentId: String(convInit.agentId) } });
  } catch (convErr) {
    // Convenience init failure is non-fatal for backward compatibility.
    // Existing consumers who don't use convenience methods are unaffected.
    // Convenience methods will throw if called without initialization.
    log({ level: 'warn', category: 'init', message: 'Convenience API initialization failed (non-fatal)', context: { error: convErr instanceof Error ? convErr.message : String(convErr) } });
  }

  // Phase 4 FR-001: Output Primitives API
  // Uses the same convenience mission context. If convenience init failed, output API also unavailable.
  let outputApi: ReturnType<typeof createOutputApi> | null = null;
  if (convenienceMissionId) {
    outputApi = createOutputApi({
      claims: claimsApi,
      getConnection,
      time: kernel.time,
      missionId: convenienceMissionId,
      taskId: null,
      maxAutoConfidence,
    });
    log({ level: 'info', category: 'init', message: 'Output Primitives API initialized' });
  }

  // Phase 7 FR-004: Telemetry API
  // Uses the same convenience mission context. If convenience init failed, telemetry API also unavailable.
  let telemetryApi: ReturnType<typeof createTelemetryApi> | null = null;
  if (convenienceMissionId) {
    telemetryApi = createTelemetryApi({
      claims: claimsApi,
      getConnection,
      time: kernel.time,
      missionId: convenienceMissionId,
      taskId: null,
      maxAutoConfidence,
    });
    log({ level: 'info', category: 'init', message: 'Telemetry API initialized' });
  }

  // Phase 5 Subsystem 3: Output Governance Client
  // Full output governance with hooks, plugins, inference, and telemetry.
  // BRK-008: Generate a real session ID for the output governance client
  const outputGovernanceSessionId = randomUUID() as import('../kernel/interfaces/index.js').SessionId;
  let outputGovernanceClient: AgentOutputClient | null = null;
  if (convenienceMissionId && defaultAgentId) {
    // BRK-007: Wire to actual capability lookup from lifecycle client
    const capturedAgentId = defaultAgentId;
    outputGovernanceClient = createAgentOutputClient({
      claims: claimsApi,
      getConnection,
      getContext,
      audit: kernel.audit,
      time: kernel.time,
      events: kernel.events,
      missionId: convenienceMissionId,
      taskId: null,
      agentId: defaultAgentId,
      sessionId: outputGovernanceSessionId,
      maxAutoConfidence,
      inferenceProvider: null,
      getAgentCapabilities: () => {
        // BRK-007: Delegate to lifecycle client for real capability lookup
        try {
          const conn = getConnection();
          const row = conn.get<{ capabilities: string | null }>(
            'SELECT capabilities FROM core_agents WHERE id = ?',
            [capturedAgentId],
          );
          if (row?.capabilities) {
            try {
              return JSON.parse(row.capabilities) as readonly string[];
            } catch { return []; }
          }
        } catch { /* non-fatal — return empty */ }
        return [];
      },
    });
    log({ level: 'info', category: 'init', message: 'Output Governance Client initialized' });
  }

  // Phase 7 FR-002: A2A Governance API
  // Uses the same convenience mission context. If convenience init failed, governance API also unavailable.
  let a2aGovernanceApi: ReturnType<typeof createA2AGovernanceApi> | null = null;
  if (convenienceMissionId) {
    a2aGovernanceApi = createA2AGovernanceApi({
      claims: claimsApi,
      getConnection,
      time: kernel.time,
      missionId: convenienceMissionId,
      taskId: null,
      maxAutoConfidence,
    });
    log({ level: 'info', category: 'init', message: 'A2A Governance API initialized' });
  }

  // Subsystem 4: Coordination Governance Client
  const coordinationClient: AgentCoordinationClient = createAgentCoordinationClient({
    getConnection,
    getContext,
    audit: kernel.audit,
    time: kernel.time,
  });
  log({ level: 'info', category: 'init', message: 'Coordination Governance Client initialized' });

  // ── Phase 11: Vector Search Subsystem ──
  // sqlite-vec is OPTIONAL. Try to load. If it fails, vector features degrade gracefully.
  // I-P11-01: Core features work without sqlite-vec.
  let vectorAvailable = false;
  let vectorStore: VectorStore | null = null;
  let embeddingQueue: EmbeddingQueue | null = null;
  const vectorConfig = resolvedConfig.vector;
  const vectorDimensions = vectorConfig?.dimensions ?? DEFAULT_VECTOR_CONFIG.dimensions;
  const vectorModelId = vectorConfig?.modelId ?? DEFAULT_VECTOR_CONFIG.modelId;
  const vectorBatchSize = vectorConfig?.batchSize ?? DEFAULT_VECTOR_CONFIG.batchSize;
  const vectorDuplicateThreshold = vectorConfig?.duplicateThreshold ?? DEFAULT_VECTOR_CONFIG.duplicateThreshold;

  try {
    // Dynamic import of sqlite-vec -- optional peer dependency
    // ESM-compatible require for native addon (sqlite-vec)
    const esmRequire = createRequire(import.meta.url);
    const sqliteVec = esmRequire('sqlite-vec') as { load: (db: unknown) => void };
    // Get raw database handle from connection for extension loading (I-P11-01)
    const conn = getConnection();
    if (!conn.rawHandle) throw new Error('DatabaseConnection does not expose rawHandle');
    sqliteVec.load(conn.rawHandle);
    vectorAvailable = true;
    // Create vec0 virtual table with configured dimensions
    createVec0Table(conn, vectorDimensions);
    log({ level: 'info', category: 'init', message: 'sqlite-vec loaded, vector search enabled', context: { dimensions: vectorDimensions } });
  } catch (vecErr) {
    // sqlite-vec not available -- vector features degrade gracefully
    log({ level: 'info', category: 'init', message: 'sqlite-vec not available, vector features disabled', context: { error: vecErr instanceof Error ? vecErr.message : String(vecErr) } });
  }

  vectorStore = createVectorStore(vectorAvailable, vectorDimensions, kernel.time);
  embeddingQueue = createEmbeddingQueue();

  // Phase 11: Background embedding interval (if configured)
  let embeddingTimer: ReturnType<typeof setInterval> | null = null;
  if (vectorConfig && vectorConfig.embeddingInterval && vectorConfig.embeddingInterval > 0 && vectorAvailable) {
    embeddingTimer = setInterval(async () => {
      try {
        if (vectorStore && embeddingQueue && vectorConfig.provider) {
          const conn = getConnection();
          await embeddingQueue.process(conn, vectorConfig.provider, vectorStore, {
            batchSize: vectorBatchSize,
            dimensions: vectorDimensions,
            modelId: vectorModelId,
          });
        }
      } catch {
        // Background embedding errors are non-fatal
      }
    }, vectorConfig.embeddingInterval);
    // M6-FIX: unref() so this timer does not keep the Node.js process alive
    embeddingTimer.unref();
  }

  // ── v3.0.0 WG-01: Retention Scheduler Automation ──
  // Background timer for automatic retention passes.
  // M6-FIX: unref() so timer does not keep Node.js process alive.
  let retentionTimer: ReturnType<typeof setInterval> | undefined;
  const retentionIntervalMs = resolvedConfig.maintenance?.retentionIntervalMs ?? 86_400_000;
  const retentionEnabled = resolvedConfig.maintenance?.retentionEnabled !== false;

  if (retentionEnabled && retentionIntervalMs > 0) {
    retentionTimer = setInterval(() => {
      try {
        const conn = getConnection();
        const ctx = getContext();
        kernel.retention.executeRetention(conn, ctx);
      } catch (retentionErr) {
        log({ level: 'warn', category: 'maintenance', message: 'Retention pass failed', context: { error: String(retentionErr) } });
      }
    }, retentionIntervalMs);
    retentionTimer.unref();
    log({ level: 'info', category: 'init', message: 'Retention scheduler started', context: { intervalMs: retentionIntervalMs } });
  }

  // Phase 5 + Phase 12: Create CognitiveNamespace for limen.cognitive
  // Phase 12: Extended with consolidation, importance, narrative, verify, auto-connection
  const selfHealingConfig: SelfHealingConfig = resolvedConfig.selfHealing ?? DEFAULT_SELF_HEALING_CONFIG;
  const cognitiveNamespace = createCognitiveNamespace({
    getConnection,
    getContext,
    getTenantId: () => getContext().tenantId,
    time: kernel.time,
    freshnessThresholds: config?.cognitive?.freshness,
    stabilityConfig: config?.cognitive?.stability,
    // Phase 12 additions
    retractClaim: claimSystem.retractClaim,
    relateClaims: claimSystem.relateClaims,
    vectorStore: vectorStore ?? null,
    embeddingProvider: vectorConfig?.provider ?? null,
    verificationProvider: resolvedConfig.verificationProvider ?? null,
    selfHealingConfig,
  });

  // FR-003: Invalidate health cache on claim mutations
  kernel.events.subscribe('claim.asserted', () => {
    cognitiveNamespace.invalidateHealthCache();
  });
  kernel.events.subscribe('claim.retracted', () => {
    cognitiveNamespace.invalidateHealthCache();
  });

  // Phase 12: Register self-healing event listener on claim.retracted
  // F-P12-003 fix: The listener is the ENTRY POINT only. When processSelfHealing
  // internally retracts child claims, those retractions emit claim.retracted events
  // synchronously. Without the isInActiveCascade guard, each re-entry would create
  // a fresh cascade with depth=0 and visited=new Set(), defeating the depth limit.
  // The guard ensures the recursive traversal inside processSelfHealing handles
  // cascading — the event listener does NOT re-enter for claims already in an active cascade.
  if (selfHealingConfig.enabled) {
    kernel.events.subscribe('claim.retracted', (event) => {
      try {
        const payload = event.payload as { claimId?: string };
        if (payload?.claimId && !isInActiveCascade(payload.claimId)) {
          processSelfHealing(payload.claimId, {
            getConnection,
            getContext,
            retractClaim: claimSystem.retractClaim,
            time: kernel.time,
            config: selfHealingConfig,
            stabilityConfig: config?.cognitive?.stability,
          });
        }
      } catch {
        // Self-healing errors are non-fatal — logged but never propagated to emitter
      }
    });
  }

  // v3.0.0 WG-02: Subscribe to mission.transitioned for replay snapshots
  // F-V3P1-004: Use orchestrationConn (same DB connection as the transition emitter)
  // instead of getConnection() (separate DB connection). The handler runs synchronously
  // INSIDE the proposeTaskGraph transaction, so using a different connection would cause
  // SQLITE_BUSY errors. orchestrationConn shares the same transaction context.
  kernel.events.subscribe('mission.transitioned', (event) => {
    try {
      const { missionId, newState } = event.payload as { missionId?: string; newState?: string };
      if (!missionId) return;
      // Use orchestrationConn when available (production wiring), fall back to getConnection() (test DI)
      const conn = orchestrationConn ?? getConnection();
      const tenantId = conn.get<{ tenant_id: string | null }>(
        'SELECT tenant_id FROM core_missions WHERE id = ?',
        [missionId],
      )?.tenant_id ?? null;

      if (newState === 'CREATED' || newState === 'PLANNING') {
        replayEngine.takeSnapshot(conn, missionId, tenantId, 'mission_start', kernel.time);
      } else if (newState === 'COMPLETED' || newState === 'FAILED' || newState === 'CANCELLED') {
        replayEngine.takeSnapshot(conn, missionId, tenantId, 'mission_end', kernel.time);
      }
    } catch {
      // Non-fatal: replay snapshot failure must not break mission transitions
    }
  });

  // v3.0.0 WG-03: Auto-connection suggestions on claim assertion
  // F-V3P1-010: Hoisted timer to outer scope so shutdown can clear it.
  const autoSuggestEnabled = resolvedConfig.cognitive?.autoSuggestConnections !== false;
  let suggestionDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  if (autoSuggestEnabled && cognitiveNamespace) {
    const pendingClaimIds: string[] = [];

    kernel.events.subscribe('claim.asserted', (event) => {
      const { claimId } = event.payload as { claimId?: string };
      if (claimId) {
        pendingClaimIds.push(claimId);
        if (suggestionDebounceTimer) clearTimeout(suggestionDebounceTimer);
        suggestionDebounceTimer = setTimeout(async () => {
          const batch = pendingClaimIds.splice(0);
          for (const id of batch) {
            try { await cognitiveNamespace!.suggestConnections(id); } catch { /* non-fatal */ }
          }
        }, 5000);
        if (suggestionDebounceTimer.unref) suggestionDebounceTimer.unref();
      }
    });
  }

  // Phase 9: Create ConsentRegistry for limen.consent (I-P9-23: audit trail)
  const consentRegistry = createConsentRegistry({
    audit: kernel.audit,
    time: kernel.time,
  });
  // v3.0.0 EG-01: Bind lazy consent registry for ClaimSystem's getConsentRegistry getter.
  lazyConsentRegistry = consentRegistry;

  // ST-19: Consent Gate Dependencies — assembled once, used by remember() and exportAudit().
  // consentRegistry is the Phase 9 ConsentRegistry instance.
  // time is the kernel TimeProvider.
  // Consent scope defaults to 'claim_assertion' (overridden per call site as needed).
  const consentGateDeps: ConsentGateDeps = {
    consentRegistry,
    time: kernel.time,
  };

  // Phase 8: Create Plugin Registry (I-P8-01: before freeze)
  // PluginApi provider returns null until enableApi() is called (I-P8-03).
  let pluginApiRef: import('../plugins/plugin_types.js').PluginApi | null = null;
  const pluginRegistry = createPluginRegistry({
    eventBus: kernel.events,
    time: kernel.time,
    log: (level, category, message, context) => {
      log({ level: level as 'debug' | 'info' | 'warn' | 'error', category, message, ...(context ? { context } : {}) });
    },
    apiProvider: () => pluginApiRef,
  });

  // Phase 8: Install plugins from config (I-P8-01: before freeze, I-P8-06: non-fatal)
  if (resolvedConfig.plugins && resolvedConfig.plugins.length > 0) {
    const installResult = pluginRegistry.installAll(resolvedConfig.plugins, resolvedConfig.pluginConfig);
    if (!installResult.ok) {
      log({ level: 'error', category: 'plugin', message: `Plugin installation failed: ${installResult.error.message}` });
    }
  }


  // Finding-18: Read version from package.json at factory time (was hardcoded '4.0.0')
  // Uses createRequire (already imported at top of file) for ESM-compatible JSON resolution
  const esmRequirePkg = createRequire(import.meta.url);
  const pkgJson = esmRequirePkg('../../package.json') as { version: string };
  const limenVersion = pkgJson.version;

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
                return { value: undefined!, done: true };
              },
              async throw(err: Error): Promise<IteratorResult<StreamChunk>> {
                if (innerIterator?.throw) {
                  return innerIterator.throw(err);
                }
                return { value: undefined!, done: true };
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
        const limeError = ensureLimenError(error, debug);
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

    // Phase 5 Subsystem 2: Agent Lifecycle Management (LM-2.01 through LM-2.22)
    // FINDING-022: ctx-injecting adapter. The raw lifecycleClient methods expect
    // (ctx: OperationContext, ...args) as the first parameter, but the permission
    // gateway's wrapMethod does NOT prepend ctx — it only uses ctx for RBAC checks.
    // This adapter auto-injects getContext() for methods that require it, and
    // passes through methods that don't (read-only queries, event subscriptions).
    lifecycle: {
      // Methods WITH ctx parameter — ctx auto-injected from factory closure:
      registerAgent: (...args: DropFirst<Parameters<typeof lifecycleClient.registerAgent>>) =>
        lifecycleClient.registerAgent(getContext(), ...args),
      updateAgent: (...args: DropFirst<Parameters<typeof lifecycleClient.updateAgent>>) =>
        lifecycleClient.updateAgent(getContext(), ...args),
      decommissionAgent: (...args: DropFirst<Parameters<typeof lifecycleClient.decommissionAgent>>) =>
        lifecycleClient.decommissionAgent(getContext(), ...args),
      suspendAgent: (...args: DropFirst<Parameters<typeof lifecycleClient.suspendAgent>>) =>
        lifecycleClient.suspendAgent(getContext(), ...args),
      reactivateAgent: (...args: DropFirst<Parameters<typeof lifecycleClient.reactivateAgent>>) =>
        lifecycleClient.reactivateAgent(getContext(), ...args),
      requestCapabilityUpgrade: (...args: DropFirst<Parameters<typeof lifecycleClient.requestCapabilityUpgrade>>) =>
        lifecycleClient.requestCapabilityUpgrade(getContext(), ...args),
      revokeCapability: (...args: DropFirst<Parameters<typeof lifecycleClient.revokeCapability>>) =>
        lifecycleClient.revokeCapability(getContext(), ...args),
      promoteAgent: (...args: DropFirst<Parameters<typeof lifecycleClient.promoteAgent>>) =>
        lifecycleClient.promoteAgent(getContext(), ...args),
      demoteAgent: (...args: DropFirst<Parameters<typeof lifecycleClient.demoteAgent>>) =>
        lifecycleClient.demoteAgent(getContext(), ...args),
      registerConsent: (...args: DropFirst<Parameters<typeof lifecycleClient.registerConsent>>) =>
        lifecycleClient.registerConsent(getContext(), ...args),
      revokeConsent: (...args: DropFirst<Parameters<typeof lifecycleClient.revokeConsent>>) =>
        lifecycleClient.revokeConsent(getContext(), ...args),
      exportKnowledge: (...args: DropFirst<Parameters<typeof lifecycleClient.exportKnowledge>>) =>
        lifecycleClient.exportKnowledge(getContext(), ...args),
      importKnowledge: (...args: DropFirst<Parameters<typeof lifecycleClient.importKnowledge>>) =>
        lifecycleClient.importKnowledge(getContext(), ...args),
      transferKnowledge: (...args: DropFirst<Parameters<typeof lifecycleClient.transferKnowledge>>) =>
        lifecycleClient.transferKnowledge(getContext(), ...args),
      // Methods WITHOUT ctx parameter (read-only queries + event subscriptions):
      getAgent: (...args: Parameters<typeof lifecycleClient.getAgent>) =>
        lifecycleClient.getAgent(...args),
      listAgents: (...args: Parameters<typeof lifecycleClient.listAgents>) =>
        lifecycleClient.listAgents(...args),
      getCapabilities: (...args: Parameters<typeof lifecycleClient.getCapabilities>) =>
        lifecycleClient.getCapabilities(...args),
      getCapabilityHistory: (...args: Parameters<typeof lifecycleClient.getCapabilityHistory>) =>
        lifecycleClient.getCapabilityHistory(...args),
      getTrustLevel: (...args: Parameters<typeof lifecycleClient.getTrustLevel>) =>
        lifecycleClient.getTrustLevel(...args),
      checkConsent: (...args: Parameters<typeof lifecycleClient.checkConsent>) =>
        lifecycleClient.checkConsent(...args),
      listConsents: (...args: Parameters<typeof lifecycleClient.listConsents>) =>
        lifecycleClient.listConsents(...args),
      on: (...args: Parameters<typeof lifecycleClient.on>) =>
        lifecycleClient.on(...args),
      off: (...args: Parameters<typeof lifecycleClient.off>) =>
        lifecycleClient.off(...args),
    },

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
    health(): HealthStatus {
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

    // Phase 5: Cognitive intelligence namespace (limen.cognitive.health())
    cognitive: cognitiveNamespace,

    // Phase 4 FR-001: Output Primitives namespace (limen.output.assert/query)
    output: outputApi ?? {
      assert() { throw new LimenError('ENGINE_UNHEALTHY', 'Output Primitives API not initialized'); },
      query() { throw new LimenError('ENGINE_UNHEALTHY', 'Output Primitives API not initialized'); },
    },

    // Phase 7 FR-004: Telemetry namespace (limen.telemetry.record/query)
    telemetry: telemetryApi ?? {
      record() { throw new LimenError('ENGINE_UNHEALTHY', 'Telemetry API not initialized'); },
      query() { throw new LimenError('ENGINE_UNHEALTHY', 'Telemetry API not initialized'); },
    },

    // Phase 5 Subsystem 3: Full Output Governance Client (BRK-001: wired, not voided)
    // FINDING-022: ctx-injecting adapter — ALL outputGovernance methods take ctx as first param.
    outputGovernance: outputGovernanceClient ? {
      produce: (...args: DropFirst<Parameters<typeof outputGovernanceClient.produce>>) =>
        outputGovernanceClient!.produce(getContext(), ...args),
      queryOutputs: (...args: DropFirst<Parameters<typeof outputGovernanceClient.queryOutputs>>) =>
        outputGovernanceClient!.queryOutputs(getContext(), ...args),
      retractOutput: (...args: DropFirst<Parameters<typeof outputGovernanceClient.retractOutput>>) =>
        outputGovernanceClient!.retractOutput(getContext(), ...args),
      recordCost: (...args: DropFirst<Parameters<typeof outputGovernanceClient.recordCost>>) =>
        outputGovernanceClient!.recordCost(getContext(), ...args),
      recordVital: (...args: DropFirst<Parameters<typeof outputGovernanceClient.recordVital>>) =>
        outputGovernanceClient!.recordVital(getContext(), ...args),
      queryCosts: (...args: DropFirst<Parameters<typeof outputGovernanceClient.queryCosts>>) =>
        outputGovernanceClient!.queryCosts(getContext(), ...args),
      queryVitals: (...args: DropFirst<Parameters<typeof outputGovernanceClient.queryVitals>>) =>
        outputGovernanceClient!.queryVitals(getContext(), ...args),
      getBudgetConsumption: (...args: DropFirst<Parameters<typeof outputGovernanceClient.getBudgetConsumption>>) =>
        outputGovernanceClient!.getBudgetConsumption(getContext(), ...args),
      infer: (...args: DropFirst<Parameters<typeof outputGovernanceClient.infer>>) =>
        outputGovernanceClient!.infer(getContext(), ...args),
      installPlugin: (...args: DropFirst<Parameters<typeof outputGovernanceClient.installPlugin>>) =>
        outputGovernanceClient!.installPlugin(getContext(), ...args),
      uninstallPlugin: (...args: DropFirst<Parameters<typeof outputGovernanceClient.uninstallPlugin>>) =>
        outputGovernanceClient!.uninstallPlugin(getContext(), ...args),
      listPlugins: (...args: DropFirst<Parameters<typeof outputGovernanceClient.listPlugins>>) =>
        outputGovernanceClient!.listPlugins(getContext(), ...args),
      registerHook: (...args: DropFirst<Parameters<typeof outputGovernanceClient.registerHook>>) =>
        outputGovernanceClient!.registerHook(getContext(), ...args),
      unregisterHook: (...args: DropFirst<Parameters<typeof outputGovernanceClient.unregisterHook>>) =>
        outputGovernanceClient!.unregisterHook(getContext(), ...args),
      listHooks: (...args: DropFirst<Parameters<typeof outputGovernanceClient.listHooks>>) =>
        outputGovernanceClient!.listHooks(getContext(), ...args),
      on: (...args: DropFirst<Parameters<typeof outputGovernanceClient.on>>) =>
        outputGovernanceClient!.on(getContext(), ...args),
      off: (...args: DropFirst<Parameters<typeof outputGovernanceClient.off>>) =>
        outputGovernanceClient!.off(getContext(), ...args),
    } : null,

    // Subsystem 4: Coordination Governance Client
    // FINDING-022: ctx-injecting adapter — ALL coordination methods take ctx as first param.
    coordination: {
      registerA2ARule: (...args: DropFirst<Parameters<typeof coordinationClient.registerA2ARule>>) =>
        coordinationClient.registerA2ARule(getContext(), ...args),
      removeA2ARule: (...args: DropFirst<Parameters<typeof coordinationClient.removeA2ARule>>) =>
        coordinationClient.removeA2ARule(getContext(), ...args),
      listA2ARules: (...args: DropFirst<Parameters<typeof coordinationClient.listA2ARules>>) =>
        coordinationClient.listA2ARules(getContext(), ...args),
      validateA2AAction: (...args: DropFirst<Parameters<typeof coordinationClient.validateA2AAction>>) =>
        coordinationClient.validateA2AAction(getContext(), ...args),
      getCapabilityBoundary: (...args: DropFirst<Parameters<typeof coordinationClient.getCapabilityBoundary>>) =>
        coordinationClient.getCapabilityBoundary(getContext(), ...args),
      forkSession: (...args: DropFirst<Parameters<typeof coordinationClient.forkSession>>) =>
        coordinationClient.forkSession(getContext(), ...args),
      listForks: (...args: DropFirst<Parameters<typeof coordinationClient.listForks>>) =>
        coordinationClient.listForks(getContext(), ...args),
      mergeFork: (...args: DropFirst<Parameters<typeof coordinationClient.mergeFork>>) =>
        coordinationClient.mergeFork(getContext(), ...args),
      discardFork: (...args: DropFirst<Parameters<typeof coordinationClient.discardFork>>) =>
        coordinationClient.discardFork(getContext(), ...args),
      getSyncState: (...args: DropFirst<Parameters<typeof coordinationClient.getSyncState>>) =>
        coordinationClient.getSyncState(getContext(), ...args),
      registerPeer: (...args: DropFirst<Parameters<typeof coordinationClient.registerPeer>>) =>
        coordinationClient.registerPeer(getContext(), ...args),
      removePeer: (...args: DropFirst<Parameters<typeof coordinationClient.removePeer>>) =>
        coordinationClient.removePeer(getContext(), ...args),
      triggerSync: (...args: DropFirst<Parameters<typeof coordinationClient.triggerSync>>) =>
        coordinationClient.triggerSync(getContext(), ...args),
      getSyncLog: (...args: DropFirst<Parameters<typeof coordinationClient.getSyncLog>>) =>
        coordinationClient.getSyncLog(getContext(), ...args),
      captureSnapshot: (...args: DropFirst<Parameters<typeof coordinationClient.captureSnapshot>>) =>
        coordinationClient.captureSnapshot(getContext(), ...args),
      verifyReplay: (...args: DropFirst<Parameters<typeof coordinationClient.verifyReplay>>) =>
        coordinationClient.verifyReplay(getContext(), ...args),
      getSnapshots: (...args: DropFirst<Parameters<typeof coordinationClient.getSnapshots>>) =>
        coordinationClient.getSnapshots(getContext(), ...args),
      detectDivergence: (...args: DropFirst<Parameters<typeof coordinationClient.detectDivergence>>) =>
        coordinationClient.detectDivergence(getContext(), ...args),
      on: (...args: DropFirst<Parameters<typeof coordinationClient.on>>) =>
        coordinationClient.on(getContext(), ...args),
      off: (...args: DropFirst<Parameters<typeof coordinationClient.off>>) =>
        coordinationClient.off(getContext(), ...args),
    },

    // Phase 7 FR-002: A2A Governance namespace
    a2aGovernance: a2aGovernanceApi ?? {
      setGovernanceBlock() { throw new LimenError('ENGINE_UNHEALTHY', 'A2A Governance API not initialized'); },
      getGovernanceBlock() { throw new LimenError('ENGINE_UNHEALTHY', 'A2A Governance API not initialized'); },
      registerProactiveRule() { throw new LimenError('ENGINE_UNHEALTHY', 'A2A Governance API not initialized'); },
      listProactiveRules() { throw new LimenError('ENGINE_UNHEALTHY', 'A2A Governance API not initialized'); },
    },

    // Phase 9: Consent management (I-P9-23: all mutations audited)
    consent: {
      register(input: import('../security/security_types.js').ConsentCreateInput) {
        const conn = getConnection();
        const ctx = getContext();
        return conn.transaction(() => consentRegistry.register(conn, ctx, input));
      },
      revoke(id: string) {
        const conn = getConnection();
        const ctx = getContext();
        return conn.transaction(() => consentRegistry.revoke(conn, ctx, id));
      },
      check(dataSubjectId: string, scope: string) {
        const conn = getConnection();
        const ctx = getContext();
        return consentRegistry.check(conn, ctx, dataSubjectId, scope);
      },
      list(dataSubjectId: string) {
        const conn = getConnection();
        const ctx = getContext();
        return consentRegistry.list(conn, ctx, dataSubjectId);
      },
    } satisfies ConsentApi,

    // v3.0.0 EG-02: Security operations (key rotation)
    security: {
      rotateKey(newMasterKey: Buffer) {
        const conn = getConnection();
        const ctx = getContext();
        // rotateKey internally wraps in conn.transaction() — no outer transaction needed.
        return rotateKey(
          { crypto: kernel.crypto, audit: kernel.audit },
          conn, ctx, resolvedConfig.masterKey, newMasterKey,
        );
      },
    } satisfies SecurityApi,

    // Phase 10: Governance Suite (classification, protected predicates, erasure, SOC 2)
    governance: {
      erasure(request: ErasureRequest) {
        const conn = getConnection();
        const ctx = getContext();
        return executeErasure(
          { claimStore: claimSystem.store, audit: kernel.audit, consentRegistry, time: kernel.time, vectorStore },
          conn, ctx, request,
        );
      },
      exportAudit(options: ComplianceExportOptions) {
        const conn = getConnection();
        const ctx = getContext();

        // ST-19.10: Consent gate before data export.
        // Export operations may contain personal data — consent gate checks
        // whether the operation requires consent and blocks if denied.
        const exportConsentContent: ConsentCheckContent = {
          predicate: 'export.audit_data',
          classification: 'restricted',
        };
        const exportConsentResult = checkConsentGate(
          conn, ctx, exportConsentContent,
          { ...consentGateDeps, consentScope: 'data_processing' },
        );
        if (exportConsentResult !== null && !exportConsentResult.granted) {
          return {
            ok: false as const,
            error: {
              code: 'CONSENT_REQUIRED',
              message: `Consent required for export_data operation on data subject '${exportConsentResult.dataSubjectId}'`,
              spec: 'ST-19.10',
            },
          };
        }

        return generateComplianceExport(
          { audit: kernel.audit, time: kernel.time },
          conn, ctx, options,
        );
      },
      addRule(rule: Omit<ClassificationRule, 'id' | 'createdAt'>) {
        const conn = getConnection();
        const ctx = getContext();
        return conn.transaction(() => {
          const id = randomUUID();
          const now = kernel.time.nowISO();
          conn.run(
            `INSERT INTO governance_classification_rules (id, tenant_id, predicate_pattern, level, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, ctx.tenantId, rule.predicatePattern, rule.level, rule.reason, now],
          );
          kernel.audit.append(conn, {
            tenantId: ctx.tenantId,
            actorType: 'system',
            actorId: ctx.agentId ?? 'system',
            operation: 'governance.rule.add',
            resourceType: 'classification_rule',
            resourceId: id,
            detail: { predicatePattern: rule.predicatePattern, level: rule.level, reason: rule.reason },
          });
          const result: ClassificationRule = { id, predicatePattern: rule.predicatePattern, level: rule.level, reason: rule.reason, createdAt: now };
          return { ok: true as const, value: result };
        });
      },
      removeRule(ruleId: string) {
        const conn = getConnection();
        const ctx = getContext();
        return conn.transaction(() => {
          const result = conn.run(`DELETE FROM governance_classification_rules WHERE id = ? ${ctx.tenantId !== null ? 'AND tenant_id = ?' : 'AND tenant_id IS NULL'}`,
            ctx.tenantId !== null ? [ruleId, ctx.tenantId] : [ruleId]);
          if (result.changes === 0) {
            return { ok: false as const, error: { code: 'NOT_FOUND' as const, message: `Classification rule '${ruleId}' not found.`, spec: 'P10' } };
          }
          kernel.audit.append(conn, {
            tenantId: ctx.tenantId,
            actorType: 'system',
            actorId: ctx.agentId ?? 'system',
            operation: 'governance.rule.remove',
            resourceType: 'classification_rule',
            resourceId: ruleId,
          });
          return { ok: true as const, value: undefined };
        });
      },
      listRules() {
        const conn = getConnection();
        const ctx = getContext();
        const rows = conn.query<Record<string, unknown>>(
          `SELECT id, predicate_pattern, level, reason, created_at FROM governance_classification_rules ${ctx.tenantId !== null ? 'WHERE tenant_id = ?' : 'WHERE tenant_id IS NULL'}`,
          ctx.tenantId !== null ? [ctx.tenantId] : [],
        );
        const rules: ClassificationRule[] = rows.map(r => ({
          id: r['id'] as string,
          predicatePattern: r['predicate_pattern'] as string,
          level: r['level'] as import('../governance/classification/governance_types.js').ClassificationLevel,
          reason: r['reason'] as string,
          createdAt: r['created_at'] as string,
        }));
        return { ok: true as const, value: rules as readonly ClassificationRule[] };
      },
      protectPredicate(rule: Omit<ProtectedPredicateRule, 'id' | 'createdAt'>) {
        const conn = getConnection();
        const ctx = getContext();
        return conn.transaction(() => {
          const id = randomUUID();
          const now = kernel.time.nowISO();
          conn.run(
            `INSERT INTO governance_protected_predicates (id, tenant_id, predicate_pattern, required_permission, action, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, ctx.tenantId, rule.predicatePattern, rule.requiredPermission, rule.action, now],
          );
          kernel.audit.append(conn, {
            tenantId: ctx.tenantId,
            actorType: 'system',
            actorId: ctx.agentId ?? 'system',
            operation: 'governance.predicate.protect',
            resourceType: 'protected_predicate',
            resourceId: id,
            detail: { predicatePattern: rule.predicatePattern, requiredPermission: rule.requiredPermission, action: rule.action },
          });
          const result: ProtectedPredicateRule = { id, predicatePattern: rule.predicatePattern, requiredPermission: rule.requiredPermission, action: rule.action, createdAt: now };
          return { ok: true as const, value: result };
        });
      },
      listProtectedPredicates() {
        const conn = getConnection();
        const ctx = getContext();
        const rows = conn.query<Record<string, unknown>>(
          `SELECT id, predicate_pattern, required_permission, action, created_at FROM governance_protected_predicates ${ctx.tenantId !== null ? 'WHERE tenant_id = ?' : 'WHERE tenant_id IS NULL'}`,
          ctx.tenantId !== null ? [ctx.tenantId] : [],
        );
        const rules: ProtectedPredicateRule[] = rows.map(r => ({
          id: r['id'] as string,
          predicatePattern: r['predicate_pattern'] as string,
          requiredPermission: r['required_permission'] as import('../kernel/interfaces/common.js').Permission,
          action: r['action'] as 'assert' | 'retract' | 'both',
          createdAt: r['created_at'] as string,
        }));
        return { ok: true as const, value: rules as readonly ProtectedPredicateRule[] };
      },
    } satisfies GovernanceApi,

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

      // ST-19.10: Consent gate runs BEFORE persistence.
      // Extract subject/predicate from overloaded arguments for consent detection.
      const consentContent: ConsentCheckContent = typeof predicateOrOptions === 'string'
        ? { subject: subjectOrText, predicate: predicateOrOptions }
        : { predicate: 'observation.note' }; // 1-param form: auto-generated predicate
      const consentResult = checkConsentGate(
        getConnection(), getContext(), consentContent, consentGateDeps,
      );
      // ST-19.11: If consent required and denied, return CONSENT_REQUIRED error (fail-closed).
      if (consentResult !== null && !consentResult.granted) {
        return {
          ok: false as const,
          error: {
            code: 'CONSENT_REQUIRED',
            message: `Consent required for operation '${consentResult.operation}' on data subject '${consentResult.dataSubjectId}'`,
            spec: 'ST-19.10',
          },
        };
      }

      const result = convenienceLayer.remember(subjectOrText, predicateOrOptions, value, options);

      // Phase 11: Enqueue embedding for newly asserted claim (I-P11-12: same transaction scope)
      if (result.ok && embeddingQueue && vectorConfig?.provider) {
        const conn = getConnection();
        // Determine subject, predicate, value from the overloaded arguments
        let sub: string;
        let pred: string;
        let val: string;
        if (typeof predicateOrOptions === 'string') {
          sub = subjectOrText;
          pred = predicateOrOptions;
          val = value ?? '';
        } else {
          // 1-param form: text is the value, subject/predicate are auto-generated
          sub = 'entity:reflection:auto';
          pred = 'reflection.auto';
          val = subjectOrText;
        }
        const content = `${sub} ${pred} ${val}`;
        const ctx = getContext();
        embeddingQueue.enqueue(conn, result.value.claimId, ctx.tenantId, content);
      }

      return result;
    },

    recall(subject?: string, predicate?: string, options?: import('./interfaces/api.js').RecallOptions) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.recall(subject, predicate, options);
    },

    forget(claimId: string, reason?: import('../claims/interfaces/claim_types.js').RetractionReason) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.forget(claimId, reason);
    },

    connect(claimId1: string, claimId2: string, type: 'supports' | 'contradicts' | 'supersedes' | 'derived_from') {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.connect(claimId1, claimId2, type);
    },

    reflect(entries: readonly import('./interfaces/api.js').ReflectEntry[]) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      const result = convenienceLayer.reflect(entries);

      // F-P11-007: Enqueue embedding for each claim created by reflect()
      if (result.ok && embeddingQueue && vectorConfig?.provider) {
        const conn = getConnection();
        const ctx = getContext();
        for (let i = 0; i < result.value.claimIds.length; i++) {
          const entry = entries[i]!;
          const content = `reflection.${entry.category} ${entry.statement}`;
          embeddingQueue.enqueue(conn, result.value.claimIds[i]!, ctx.tenantId, content);
        }
      }

      return result;
    },

    promptInstructions() {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      return convenienceLayer.promptInstructions();
    },

    search(query: string, options?: import('./convenience/convenience_types.js').SearchOptions) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');

      // Phase 11: Handle semantic and hybrid modes
      const mode = options?.mode ?? 'fulltext';
      if (mode === 'semantic') {
        // Semantic mode requires queryEmbedding to be sync
        if (!options?.queryEmbedding) {
          return { ok: false as const, error: { code: 'VECTOR_NOT_AVAILABLE', message: 'Semantic search requires queryEmbedding in sync mode. Use semanticSearch() for async provider calls.', spec: 'I-P11-02' } };
        }
        if (!vectorStore || !vectorStore.isAvailable()) {
          return { ok: false as const, error: { code: 'VECTOR_NOT_AVAILABLE', message: 'sqlite-vec is not installed. Semantic search unavailable.', spec: 'I-P11-02' } };
        }
        const conn = getConnection();
        const ctx = getContext();
        const knnResult = vectorStore.knn(conn, [...options.queryEmbedding], options.limit ?? 20, ctx.tenantId);
        if (!knnResult.ok) return knnResult;

        if (knnResult.value.length === 0) {
          return { ok: true as const, value: [] };
        }

        // Hydrate results into SearchResult format
        const results: import('./convenience/convenience_types.js').SearchResult[] = [];
        for (const kr of knnResult.value) {
          const claimRow = conn.get<Record<string, unknown>>(
            `SELECT * FROM claim_assertions WHERE id = ? AND purged_at IS NULL`,
            [kr.claimId],
          );
          if (!claimRow) continue;

          // C3/C4/C6/H7/H8: Proper hydration with decay, cascade penalty, stability, freshness
          const claimPredicate = claimRow['predicate'] as string;
          const claimConfidence = claimRow['confidence'] as number;
          const claimValidAt = claimRow['valid_at'] as string;
          const claimId = claimRow['id'] as string;
          const nowMs = kernel.time.nowMs(); // C6: TimeProvider instead of Date.now()
          const stabilityDays = resolveStability(claimPredicate, config?.cognitive?.stability); // H7: proper stability resolution
          const ageMs = computeAgeMs(claimValidAt, nowMs);
          const decayFactor = computeDecayFactor(ageMs, stabilityDays);
          const cascadePenalty = computeCascadePenalty(conn, claimId); // C4: cascade penalty included
          const effConf = claimConfidence * decayFactor * cascadePenalty;
          const lastAccessMs = claimRow['last_accessed_at'] ? Date.parse(claimRow['last_accessed_at'] as string) : null;
          const freshness = classifyFreshness(
            lastAccessMs && Number.isFinite(lastAccessMs) ? lastAccessMs : null,
            nowMs,
            config?.cognitive?.freshness, // H8: freshness thresholds passed
          );

          results.push({
            belief: {
              claimId: claimRow['id'] as ClaimId,
              subject: claimRow['subject'] as string,
              predicate: claimPredicate,
              value: String(claimRow['object_value'] ?? ''),
              confidence: claimConfidence,
              validAt: claimValidAt,
              createdAt: claimRow['created_at'] as string,
              superseded: vectorHydrateSuperseded(conn, claimRow['id'] as string),
              disputed: vectorHydrateDisputed(conn, claimRow['id'] as string),
              effectiveConfidence: effConf, // C4: includes decay * cascadePenalty
              freshness, // H8: properly classified
              stability: stabilityDays, // H7: resolveStability instead of hardcoded 90
              lastAccessedAt: (claimRow['last_accessed_at'] ?? null) as string | null,
              accessCount: (claimRow['access_count'] ?? 0) as number,
              reasoning: (claimRow['reasoning'] ?? null) as string | null,
              reviewNeeded: false, // FR-007: Vector search path does not compute reviewNeeded
            },
            relevance: -kr.distance, // Negate distance for consistency with FTS5 convention
            score: distanceToSimilarity(kr.distance), // C3: correct L2→cosine formula from duplicate_detector
          });
        }
        return { ok: true as const, value: results };
      }

      if (mode === 'hybrid') {
        if (!vectorStore || !vectorStore.isAvailable()) {
          // I-P11-03: Fallback to fulltext
          return convenienceLayer.search(query, { ...options, mode: 'fulltext' });
        }
        if (!options?.queryEmbedding) {
          // No embedding provided -- fallback to fulltext
          return convenienceLayer.search(query, { ...options, mode: 'fulltext' });
        }
        const conn = getConnection();
        const ctx = getContext();

        // Get FTS5 results
        const fts5Result = convenienceLayer.search(query, { ...options, mode: 'fulltext' });
        const fts5Items = fts5Result.ok ? fts5Result.value : [];

        // Get vector results
        const knnResult = vectorStore.knn(conn, [...options.queryEmbedding], (options.limit ?? 20) * 2, ctx.tenantId);
        const knnItems = knnResult.ok ? knnResult.value : [];

        // Combine using hybrid ranker
        const hybridScores = hybridRank(
          fts5Items.map(r => ({ claimId: r.belief.claimId, relevance: r.relevance })),
          knnItems.map(r => ({ claimId: r.claimId, distance: r.distance })),
        );

        // Build result map from FTS5 results
        const fts5Map = new Map(fts5Items.map(r => [r.belief.claimId, r]));

        const results: import('./convenience/convenience_types.js').SearchResult[] = [];
        const limit = options?.limit ?? 20;
        for (const hs of hybridScores.slice(0, limit)) {
          const existing = fts5Map.get(hs.claimId as ClaimId);
          if (existing) {
            results.push({ ...existing, score: hs.combinedScore });
          } else {
            // Claim only in vector results -- hydrate it
            const claimRow = conn.get<Record<string, unknown>>(
              `SELECT * FROM claim_assertions WHERE id = ? AND purged_at IS NULL`,
              [hs.claimId],
            );
            if (!claimRow) continue;

            // C3/C4/C6/H7/H8: Proper hydration with decay, cascade penalty, stability, freshness
            const hClaimPredicate = claimRow['predicate'] as string;
            const hClaimConfidence = claimRow['confidence'] as number;
            const hClaimValidAt = claimRow['valid_at'] as string;
            const hClaimId = claimRow['id'] as string;
            const hNowMs = kernel.time.nowMs(); // C6: TimeProvider instead of Date.now()
            const hStabilityDays = resolveStability(hClaimPredicate, config?.cognitive?.stability); // H7: proper stability
            const hAgeMs = computeAgeMs(hClaimValidAt, hNowMs);
            const hDecayFactor = computeDecayFactor(hAgeMs, hStabilityDays);
            const hCascadePenalty = computeCascadePenalty(conn, hClaimId); // C4: cascade penalty
            const hEffConf = hClaimConfidence * hDecayFactor * hCascadePenalty;
            const hLastAccessMs = claimRow['last_accessed_at'] ? Date.parse(claimRow['last_accessed_at'] as string) : null;
            const hFreshness = classifyFreshness(
              hLastAccessMs && Number.isFinite(hLastAccessMs) ? hLastAccessMs : null,
              hNowMs,
              config?.cognitive?.freshness, // H8: freshness thresholds passed
            );

            results.push({
              belief: {
                claimId: claimRow['id'] as ClaimId,
                subject: claimRow['subject'] as string,
                predicate: hClaimPredicate,
                value: String(claimRow['object_value'] ?? ''),
                confidence: hClaimConfidence,
                validAt: hClaimValidAt,
                createdAt: claimRow['created_at'] as string,
                superseded: vectorHydrateSuperseded(conn, claimRow['id'] as string),
                disputed: vectorHydrateDisputed(conn, claimRow['id'] as string),
                effectiveConfidence: hEffConf, // C4: includes decay * cascadePenalty
                freshness: hFreshness, // H8: properly classified
                stability: hStabilityDays, // H7: resolveStability instead of hardcoded 90
                lastAccessedAt: (claimRow['last_accessed_at'] ?? null) as string | null,
                accessCount: (claimRow['access_count'] ?? 0) as number,
                reasoning: (claimRow['reasoning'] ?? null) as string | null,
                reviewNeeded: false, // FR-007: Hybrid search path does not compute reviewNeeded
              },
              relevance: 0,
              score: hs.combinedScore,
            });
          }
        }
        return { ok: true as const, value: results };
      }

      // Default fulltext mode
      return convenienceLayer.search(query, options);
    },

    // Phase 11: Vector search methods
    async embedPending() {
      if (!vectorConfig?.provider || !embeddingQueue || !vectorStore) {
        return { ok: true as const, value: { processed: 0, failed: 0 } };
      }
      if (!vectorStore.isAvailable()) {
        return { ok: true as const, value: { processed: 0, failed: 0 } };
      }
      const conn = getConnection();
      return embeddingQueue.process(conn, vectorConfig.provider, vectorStore, {
        batchSize: vectorBatchSize,
        dimensions: vectorDimensions,
        modelId: vectorModelId,
      });
    },

    async checkDuplicate(subject: string, predicate: string, value: string) {
      if (!vectorConfig?.provider || !vectorStore) {
        return { ok: true as const, value: { isDuplicate: false, candidates: [] as readonly import('../vector/vector_types.js').DuplicateCandidate[], threshold: 0 } satisfies DuplicateCheckResult };
      }
      const threshold = vectorDuplicateThreshold;
      if (threshold === 0) {
        return { ok: true as const, value: { isDuplicate: false, candidates: [] as readonly import('../vector/vector_types.js').DuplicateCandidate[], threshold: 0 } satisfies DuplicateCheckResult };
      }
      try {
        const content = `${subject} ${predicate} ${value}`;
        const embedding = await vectorConfig.provider(content);
        const conn = getConnection();
        const ctx = getContext();
        return checkDuplicateImpl(conn, vectorStore, embedding, predicate, ctx.tenantId, threshold);
      } catch (providerErr) {
        return { ok: false as const, error: { code: 'VECTOR_PROVIDER_FAILED', message: providerErr instanceof Error ? providerErr.message : String(providerErr), spec: 'I-P11-40' } };
      }
    },

    async semanticSearch(query: string, options?: Omit<import('./convenience/convenience_types.js').SearchOptions, 'mode'>) {
      if (!vectorConfig?.provider) {
        return { ok: false as const, error: { code: 'VECTOR_NOT_AVAILABLE', message: 'No vector provider configured', spec: 'I-P11-02' } };
      }
      if (!vectorStore || !vectorStore.isAvailable()) {
        return { ok: false as const, error: { code: 'VECTOR_NOT_AVAILABLE', message: 'sqlite-vec is not installed', spec: 'I-P11-02' } };
      }

      // Auto-embed pending if configured
      const autoEmbed = vectorConfig.autoEmbed ?? DEFAULT_VECTOR_CONFIG.autoEmbed;
      if (autoEmbed && embeddingQueue) {
        const conn = getConnection();
        await embeddingQueue.process(conn, vectorConfig.provider, vectorStore, {
          batchSize: vectorBatchSize,
          dimensions: vectorDimensions,
          modelId: vectorModelId,
        });
      }

      try {
        const queryEmbedding = await vectorConfig.provider(query);
        // Delegate to sync search with the computed embedding
        return this.search(query, {
          ...options,
          mode: 'semantic' as const,
          queryEmbedding: queryEmbedding,
        });
      } catch (providerErr) {
        return { ok: false as const, error: { code: 'VECTOR_PROVIDER_FAILED', message: providerErr instanceof Error ? providerErr.message : String(providerErr), spec: 'I-P11-02' } };
      }
    },

    embeddingStats(): import('../kernel/interfaces/common.js').Result<EmbeddingStats> {
      try {
        const conn = getConnection();
        const embeddedRow = conn.get<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM embedding_metadata`,
        );
        const pendingRow = conn.get<{ cnt: number }>(
          `SELECT COUNT(*) as cnt FROM embedding_pending`,
        );
        return {
          ok: true as const,
          value: {
            embeddedCount: embeddedRow?.cnt ?? 0,
            pendingCount: pendingRow?.cnt ?? 0,
            modelId: vectorModelId,
            dimensions: vectorDimensions,
            vectorAvailable,
          },
        };
      } catch (e) {
        return { ok: false as const, error: { code: 'VECTOR_STATS_FAILED', message: e instanceof Error ? e.message : String(e), spec: 'Phase-11' } };
      }
    },

    // Library-mode agent identity setter.
    // Modifies closure-captured defaultAgentId — safe after deep freeze
    // because the function reference is frozen, not the captured variable.
    setDefaultAgent(agentId: import('../kernel/interfaces/index.js').AgentId) {
      if (!agentId || typeof agentId !== 'string' || agentId.trim().length === 0) {
        throw new LimenError('INVALID_INPUT', 'setDefaultAgent requires a non-empty agentId string');
      }
      defaultAgentId = agentId;
    },

    // Phase 8 §8.5: Event hooks (I-P8-10, I-P8-11, I-P8-12)
    on(event: LimenEventName, handler: LimenEventHandler): string {
      const result = pluginRegistry.on(event, handler);
      if (!result.ok) throw new LimenError('INVALID_CONFIG', result.error.message);
      return result.value;
    },

    off(subscriptionId: string): void {
      pluginRegistry.off(subscriptionId);
    },

    // Phase 8 §8.3: Export (I-P8-20, I-P8-24, I-P8-26)
    exportData(options: ExportOptions) {
      return exportKnowledge(
        { getConnection, time: kernel.time, limenVersion },
        options,
      );
    },

    // Phase 8 §8.4: Import (I-P8-21, I-P8-22, I-P8-23, I-P8-26)
    importData(document: LimenExportDocument, options?: ImportOptions) {
      if (!convenienceLayer) throw new LimenError('ENGINE_UNHEALTHY', 'Convenience API not initialized');
      // Provide import deps using the ClaimApi facade
      return importKnowledge(
        {
          assertClaim: (input) => {
            const result = claimsApi.assertClaim(input);
            if (!result.ok) return result;
            return { ok: true as const, value: { claim: { id: result.value.claim.id } } };
          },
          relateClaims: (input) => claimsApi.relateClaims(input),
          queryClaims: (input) => {
            const queryInput: import('../claims/interfaces/claim_types.js').ClaimQueryInput = {
              ...(input.subject ? { subject: input.subject } : {}),
              ...(input.predicate ? { predicate: input.predicate } : {}),
              ...(input.status ? { status: input.status as 'active' | 'retracted' } : {}),
              limit: input.limit ?? 100000,
              includeEvidence: false,
              includeRelationships: false,
            };
            const result = claimsApi.queryClaims(queryInput);
            if (!result.ok) return result;
            return {
              ok: true as const,
              value: {
                claims: result.value.claims.map(c => ({
                  claim: {
                    subject: c.claim.subject,
                    predicate: c.claim.predicate,
                    object: { value: String(c.claim.object.value) },
                    status: c.claim.status as string,
                  },
                })),
              },
            };
          },
          missionId: convenienceMissionId ?? 'mission:convenience' as MissionId,
          // Phase 3: Provide transaction wrapper for all-or-nothing import semantics
          withTransaction: <T>(fn: () => T): T => {
            const conn = getConnection();
            return conn.transaction(fn);
          },
        },
        document,
        options,
      );
    },

    // v3.0.0 WG-01: Maintenance operations
    // Phase 5 Subsystem 5: Audit Visualization (AV-8.1 through AV-8.6)
    auditVisualization: {
      queryEntries(filter: import('../audit/visualization/visualization_types.js').AuditFilter, pagination: import('../audit/visualization/visualization_types.js').Pagination) {
        const { createAuditQueryService } = require('../audit/visualization/audit_query_service.js') as typeof import('../audit/visualization/audit_query_service.js');
        const svc = createAuditQueryService({ conn: getConnection(), timeProvider: kernel.time, clearanceLevel: getContext().clearanceLevel });
        return svc.queryEntries(filter, pagination);
      },
      getTimeline(sessionId: import('../kernel/interfaces/common.js').SessionId) {
        const { createAuditQueryService } = require('../audit/visualization/audit_query_service.js') as typeof import('../audit/visualization/audit_query_service.js');
        const svc = createAuditQueryService({ conn: getConnection(), timeProvider: kernel.time, clearanceLevel: getContext().clearanceLevel });
        return svc.getTimeline(sessionId);
      },
      getBeliefGraph(options: import('../audit/visualization/visualization_types.js').BeliefGraphOptions) {
        const { createAuditQueryService } = require('../audit/visualization/audit_query_service.js') as typeof import('../audit/visualization/audit_query_service.js');
        const svc = createAuditQueryService({ conn: getConnection(), timeProvider: kernel.time, clearanceLevel: getContext().clearanceLevel });
        return svc.getBeliefGraph(options);
      },
      getGovernanceHeatmap(options: import('../audit/visualization/visualization_types.js').HeatmapOptions) {
        const { createAuditQueryService } = require('../audit/visualization/audit_query_service.js') as typeof import('../audit/visualization/audit_query_service.js');
        const svc = createAuditQueryService({ conn: getConnection(), timeProvider: kernel.time, clearanceLevel: getContext().clearanceLevel });
        return svc.getGovernanceHeatmap(options);
      },
      export(request: import('../audit/visualization/visualization_types.js').ExportRequest) {
        const { createAuditQueryService } = require('../audit/visualization/audit_query_service.js') as typeof import('../audit/visualization/audit_query_service.js');
        const svc = createAuditQueryService({ conn: getConnection(), timeProvider: kernel.time, clearanceLevel: getContext().clearanceLevel });
        return svc.export(request);
      },
      verifyChainIntegrity(options: import('../audit/visualization/visualization_types.js').IntegrityCheckOptions) {
        const { createAuditQueryService } = require('../audit/visualization/audit_query_service.js') as typeof import('../audit/visualization/audit_query_service.js');
        const svc = createAuditQueryService({ conn: getConnection(), timeProvider: kernel.time, clearanceLevel: getContext().clearanceLevel });
        return svc.verifyChainIntegrity(options);
      },
    } satisfies import('../audit/visualization/visualization_types.js').AuditQueryService,

    maintenance: {
      runRetention() {
        const conn = getConnection();
        const ctx = getContext();
        return kernel.retention.executeRetention(conn, ctx);
      },
      getRetentionPolicies() {
        const conn = getConnection();
        const ctx = getContext();
        return kernel.retention.getPolicies(conn, ctx);
      },
      updateRetentionPolicy(dataType: string, retentionDays: number, action: 'archive' | 'delete' | 'soft_delete') {
        const conn = getConnection();
        const ctx = getContext();
        return kernel.retention.updatePolicy(conn, ctx, dataType, retentionDays, action);
      },
    },

    // v3.0.0 WG-02: Replay verification
    replay: {
      verify(missionId: string) {
        const conn = getConnection();
        const tenantId = conn.get<{ tenant_id: string | null }>(
          'SELECT tenant_id FROM core_missions WHERE id = ?',
          [missionId],
        )?.tenant_id ?? null;
        return replayEngine.verifyReplay(conn, missionId, tenantId);
      },
      getSnapshots(missionId: string) {
        const conn = getConnection();
        const tenantId = conn.get<{ tenant_id: string | null }>(
          'SELECT tenant_id FROM core_missions WHERE id = ?',
          [missionId],
        )?.tenant_id ?? null;
        return replayEngine.getSnapshots(conn, missionId, tenantId);
      },
    },

    // S3.4, I-05, SD-06: Graceful shutdown
    // CF-011: Each step wrapped in try/catch so that one failure
    // does not prevent subsequent cleanup. Errors are collected.
    async shutdown(): Promise<void> {
      // DX-CRITICAL-FIX: Idempotent shutdown — second call is a no-op
      if (isShutDown) return;
      isShutDown = true;

      log({ level: 'info', category: 'shutdown', message: 'Limen shutdown starting' });
      const shutdownErrors: Error[] = [];

      // Phase 8: Destroy plugins in reverse order (I-P8-04, DC-P8-204)
      try {
        await pluginRegistry.destroyAll();
      } catch (err) {
        // Non-fatal: plugin destroy errors do not block shutdown
        log({ level: 'warn', category: 'shutdown', message: 'Plugin destroy failed (non-fatal)', context: { error: err instanceof Error ? err.message : String(err) } });
      }

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

      // Phase 11: Stop embedding timer
      if (embeddingTimer) {
        try {
          clearInterval(embeddingTimer);
        } catch (err) {
          shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }

      // v3.0.0 WG-01: Stop retention timer
      if (retentionTimer) {
        try {
          clearInterval(retentionTimer);
        } catch (err) {
          shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
        }
      }

      // v3.0.0 WG-03 F-V3P1-010: Stop auto-suggest debounce timer
      if (suggestionDebounceTimer) {
        try {
          clearTimeout(suggestionDebounceTimer);
        } catch (err) {
          shutdownErrors.push(err instanceof Error ? err : new Error(String(err)));
        }
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

      // 1.7. Phase 3: Flush and destroy AccessTracker before closing DB.
      // I-P3-12: flush() then destroy() during shutdown.
      try {
        accessTracker.flush();
        accessTracker.destroy();
      } catch (err) {
        // DC-P3-902: Flush errors non-fatal. Log and continue.
        log({ level: 'warn', category: 'shutdown', message: 'AccessTracker flush failed (non-fatal)', context: { error: err instanceof Error ? err.message : String(err) } });
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
        throw ensureLimenError(shutdownErrors[0]!, debug);
      }
      log({ level: 'info', category: 'shutdown', message: 'Limen shutdown complete' });
    },
  };

  // ── Step 5.5: Phase 8 Plugin API Enable (I-P8-03) ──
  // After engine construction, set the API reference so plugins can
  // use the convenience API in event handlers (deferred calls).
  pluginApiRef = {
    remember: (s, p, v, o) => engine.remember(s, p, v, o as import('./interfaces/api.js').RememberOptions | undefined),
    recall: (s, p, o) => engine.recall(s, p, o as import('./interfaces/api.js').RecallOptions | undefined),
    forget: (id, r) => engine.forget(id, r as import('../claims/interfaces/claim_types.js').RetractionReason | undefined),
    search: (q, o) => engine.search(q, o as import('./convenience/convenience_types.js').SearchOptions | undefined),
    connect: (a, b, t) => engine.connect(a, b, t as 'supports' | 'contradicts' | 'supersedes' | 'derived_from'),
  };
  pluginRegistry.enableApi();

  // ── Step 5.6: Permission Gateway (v2.1.0 Phase 2) ──
  // Structural RBAC enforcement: wraps every public method with permission checks.
  // MUST run before deepFreeze — gateway mutates method references on the engine.
  // I-13 (authorization completeness), FPD-5 (RBAC before rate limit)
  applyPermissionGateway(
    engine as unknown as Record<string, unknown>,
    kernel.rbac,
    kernel.rateLimiter,
    getContext,
    getConnection,
  );

  // ── Step 6: Deep freeze (C-07, FPD-4) ──

  deepFreeze(engine);

  return engine;
}
